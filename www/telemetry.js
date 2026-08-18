(function () {
  if (window.CncTelemetry) return;

  const state = {};
  const mirroredState = {
    system: null,
    connection: { connected: false, stale: true, transportStatus: 'connecting' },
    controller: null,
    machine: null,
    job: null,
    jog: null,
    control: null,
    log: { entries: [], oldestId: 0, latestId: 0, nextId: 1, lastCritical: null, dropped: 0 },
    machineProfile: null,
  };

  const inFlight = new Map();
  const demand = new Map();
  const canonicalSlices = ['system', 'controller', 'machine', 'job', 'jog', 'control', 'log', 'machineProfile'];
  const canonicalSliceSet = new Set(canonicalSlices);
  const protocolMessageTypes = new Set(['snapshot', 'patch', 'delta', 'event', 'sync', 'protocol-error', 'commandAck', 'commandResult']);
  let started = false;
  let socket = null;
  let socketConnected = false;
  let transportStatus = 'connecting'; // 'connecting', 'synchronized', 'reconnecting', 'stale', 'failed'
  let reconnectTimer = null;
  let reconnectDelayMs = 1000;
  let reconnectAttempts = 0;
  let heartbeatTimer = null;
  let lastServerMessageMs = 0;
  let resyncPending = false;
  let resyncStartedAtMs = 0;
  let resyncRequestSent = false;
  const RESYNC_COMPLETION_TIMEOUT_MS = 6000;

  let clientSeq = 1;
  let highestClientSeqSuccessfullySent = 0;
  let highestClientSeqAcknowledgedByESP = 0;
  let lastServerSeq = 0;
  let knownBootId = null;
  let lastStateRevision = 0;
  let lastLogId = 0;

  // ── WebSocket command-authorization state ──────────────────────────────────
  // socketCommandToken is received ONLY in the Claim/Reconnect HTTP response body.
  // It is never persisted and is cleared on page unload or explicit release.
  let socketCommandToken = null;
  let controlSessionEpoch = 0;
  const MAX_PENDING_COMMANDS = 32;
  const MAX_COMMAND_LEDGER = 64;

  // Pending command callbacks: commandId → { resolve, reject, timer }
  const pendingCommands = new Map();

  // ── Idempotency ledger (mirrors the firmware ring buffer, client-side) ─────
  // Allows re-delivery of results to callers who reconnect before the promise resolves.
  const commandLedger = new Map(); // commandId → { completed, ok, code, message, action, payloadSignature, epoch }

  function commandError(message, code, commandId, disposition, extra = {}) {
    return Object.assign(new Error(message), {
      code,
      commandId,
      commandDisposition: disposition,
      definitelyNotSent: disposition === 'not-sent',
      definitelyNotAccepted: disposition === 'not-sent' || disposition === 'rejected',
      accepted: disposition === 'accepted' || disposition === 'completed',
      ...extra,
    });
  }

  function rememberCommandResult(commandId, entry) {
    commandLedger.delete(commandId);
    commandLedger.set(commandId, entry);
    while (commandLedger.size > MAX_COMMAND_LEDGER) commandLedger.delete(commandLedger.keys().next().value);
  }

  function settleCommandListeners(entry, result, error) {
    for (const listener of entry?.listeners || []) {
      clearTimeout(listener.timer);
      if (error) listener.reject(error);
      else listener.resolve(result);
    }
    entry?.listeners?.clear();
  }

  function settleCommandAdmissions(entry, result, error) {
    for (const listener of entry?.admissions || []) {
      clearTimeout(listener.timer);
      if (error) listener.reject(error);
      else listener.resolve(result);
    }
    entry?.admissions?.clear();
  }

  function addCommandAdmissionListener(entry, commandId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const listener = { resolve, reject, timer: null };
      listener.timer = setTimeout(() => {
        entry.admissions.delete(listener);
        const disposition = entry.acknowledged ? 'accepted' : entry.sent ? 'outcome-unknown' : 'not-sent';
        reject(commandError(`Command admission ${commandId} timed out after ${timeoutMs}ms`,
          'TIMEOUT', commandId, disposition, { acknowledged: entry.acknowledged, sent: entry.sent }));
      }, timeoutMs);
      entry.admissions.add(listener);
    });
  }

  function addCommandListener(entry, commandId, timeoutMs, label = 'Command') {
    return new Promise((resolve, reject) => {
      const listener = { resolve, reject, timer: null };
      listener.timer = setTimeout(() => {
        entry.listeners.delete(listener);
        const disposition = entry.acknowledged ? 'accepted' : entry.sent ? 'outcome-unknown' : 'not-sent';
        reject(commandError(`${label} ${commandId} timed out after ${timeoutMs}ms`,
          'TIMEOUT', commandId, disposition, { acknowledged: entry.acknowledged, sent: entry.sent }));
      }, timeoutMs);
      entry.listeners.add(listener);
    });
  }

  function createPendingCommand(commandId, action = null, payloadSignature = null) {
    if (pendingCommands.size >= MAX_PENDING_COMMANDS) {
      let reclaimableId = null;
      let oldestCreatedAt = Infinity;
      for (const [id, pending] of pendingCommands) {
        if (pending.listeners.size === 0 && pending.createdAt < oldestCreatedAt) {
          reclaimableId = id;
          oldestCreatedAt = pending.createdAt;
        }
      }
      if (reclaimableId === null) return null;
      pendingCommands.delete(reclaimableId);
    }
    const entry = {
      commandId, action, payloadSignature, epoch: controlSessionEpoch,
      sent: false, acknowledged: false, completed: false,
      listeners: new Set(), admissions: new Set(), createdAt: Date.now(),
    };
    pendingCommands.set(commandId, entry);
    return entry;
  }

  // ── Public token lifecycle API (called by operator control module) ─────────
  function setSocketCommandToken(token, epoch) {
    const nextToken = typeof token === 'string' && token.length > 0 ? token : null;
    const nextEpoch = Number.isInteger(Number(epoch)) && Number(epoch) > 0 ? Number(epoch) : 0;
    if (!nextToken || !nextEpoch) {
      revokeCommandAuthorization('Command authorization is invalid.');
      return;
    }
    if ((socketCommandToken && socketCommandToken !== nextToken) ||
        (controlSessionEpoch && controlSessionEpoch !== nextEpoch)) {
      revokeCommandAuthorization('Operator control session changed.', 'CONTROL_SESSION_CHANGED');
    }
    socketCommandToken = nextToken;
    controlSessionEpoch = nextEpoch;
  }

  function revokeCommandAuthorization(reason = 'Control session ended; command authorization revoked.', code = 'AUTHORIZATION_REVOKED') {
    socketCommandToken = null;
    controlSessionEpoch = 0;
    for (const [id, pending] of pendingCommands) {
      const disposition = pending.acknowledged ? 'accepted' : pending.sent ? 'outcome-unknown' : 'rejected';
      const error = commandError(reason, code, id, disposition,
        { acknowledged: pending.acknowledged, sent: pending.sent });
      settleCommandListeners(pending, null, error);
      settleCommandAdmissions(pending, null, error);
      pendingCommands.delete(id);
    }
    commandLedger.clear();
  }

  function clearSocketCommandToken() {
    revokeCommandAuthorization();
  }

  // ── command() API ─────────────────────────────────────────────────────────
  // Sends a WS command and returns a Promise that resolves/rejects with the result.
  // commandId must be a unique string (uuid or similar) provided by the caller for idempotency.
  function command(action, payload, commandId, options = {}) {
    const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 15000;

    if (!socketCommandToken) {
      return Promise.reject(commandError('No active control session; obtain operator control first.', 'UNAUTHORIZED', commandId, 'not-sent'));
    }
    if (!socketConnected || socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(commandError('WebSocket is not connected.', 'TRANSPORT_UNAVAILABLE', commandId, 'not-sent'));
    }
    if (typeof commandId !== 'string' || !/^[A-Za-z0-9._:-]{1,96}$/.test(commandId)) {
      return Promise.reject(commandError('commandId contains invalid characters or length.', 'INVALID_COMMAND', commandId, 'not-sent'));
    }
    if (typeof action !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(action)) {
      return Promise.reject(commandError('action contains invalid characters or length.', 'INVALID_COMMAND', commandId, 'not-sent'));
    }
    const payloadSignature = payload === undefined || payload === null ? '' : JSON.stringify(payload);
    if (new TextEncoder().encode(payloadSignature).length > 4096) {
      return Promise.reject(commandError('Command payload exceeds 4096 bytes.', 'PAYLOAD_TOO_LARGE', commandId, 'not-sent'));
    }

    // Completed results are reusable only for the exact request that produced them.
    if (commandLedger.has(commandId)) {
      const entry = commandLedger.get(commandId);
      if (entry.completed) {
        if (entry.action !== action || entry.payloadSignature !== payloadSignature || entry.epoch !== controlSessionEpoch) {
          return Promise.reject(commandError('commandId is already associated with a different action, payload, or control session.',
            'IDEMPOTENCY_CONFLICT', commandId, 'rejected'));
        }
        return entry.ok
          ? Promise.resolve({ commandId, ok: true, code: entry.code, message: entry.message, accepted: true })
          : Promise.reject(commandError(entry.message, entry.code, commandId, 'completed'));
      }
    }

    if (pendingCommands.has(commandId)) {
      const existing = pendingCommands.get(commandId);
      if (existing.action !== action || existing.payloadSignature !== payloadSignature) {
        return Promise.reject(commandError('commandId is already associated with a different action or payload.', 'IDEMPOTENCY_CONFLICT', commandId, 'rejected'));
      }
      return addCommandListener(existing, commandId, timeoutMs);
    }

    const pending = createPendingCommand(commandId, action, payloadSignature);
    if (!pending) return Promise.reject(commandError('Too many unresolved commands.', 'COMMAND_CAPACITY', commandId, 'not-sent'));
    const promise = addCommandListener(pending, commandId, timeoutMs);
    const packet = {
      protocolVersion: 1,
      type: 'command',
      commandId,
      action,
      authorization: { controlSessionEpoch, socketCommandToken },
    };
    if (payload !== undefined && payload !== null) packet.payload = payload;
    pending.sent = sendSocketPacket(packet);
    if (!pending.sent) {
      settleCommandListeners(pending, null, commandError('Failed to send command packet; WebSocket not ready.', 'SEND_FAILED', commandId, 'not-sent'));
      pendingCommands.delete(commandId);
    }
    return promise;
  }

  // ── beginCommand(): two-phase command API ─────────────────────────────────
  // Separates COMMAND ADMISSION (bounded, decides whether HTTP fallback is
  // allowed) from OPERATION COMPLETION (may legitimately take minutes for
  // machine operations; recoverable by commandQuery and reconnect). The
  // single-phase command() above remains for short-lived job commands.
  function beginCommand(action, payload, commandId, options = {}) {
    const admissionTimeoutMs = typeof options.admissionTimeoutMs === 'number' ? options.admissionTimeoutMs : 5000;
    const resultTimeoutMs = typeof options.resultTimeoutMs === 'number' && options.resultTimeoutMs > 0
      ? options.resultTimeoutMs : 600000;

    if (!socketCommandToken) {
      return rejectedHandle(commandError('No active control session; obtain operator control first.', 'UNAUTHORIZED', commandId, 'not-sent'));
    }
    if (!socketConnected || socket?.readyState !== WebSocket.OPEN) {
      return rejectedHandle(commandError('WebSocket is not connected.', 'TRANSPORT_UNAVAILABLE', commandId, 'not-sent'));
    }
    if (typeof commandId !== 'string' || !/^[A-Za-z0-9._:-]{1,96}$/.test(commandId)) {
      return rejectedHandle(commandError('commandId contains invalid characters or length.', 'INVALID_COMMAND', commandId, 'not-sent'));
    }
    if (typeof action !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(action)) {
      return rejectedHandle(commandError('action contains invalid characters or length.', 'INVALID_COMMAND', commandId, 'not-sent'));
    }
    const payloadSignature = payload === undefined || payload === null ? '' : JSON.stringify(payload);
    if (new TextEncoder().encode(payloadSignature).length > 4096) {
      return rejectedHandle(commandError('Command payload exceeds 4096 bytes.', 'PAYLOAD_TOO_LARGE', commandId, 'not-sent'));
    }

    if (commandLedger.has(commandId)) {
      const entry = commandLedger.get(commandId);
      if (entry.completed) {
        if (entry.action !== action || entry.payloadSignature !== payloadSignature || entry.epoch !== controlSessionEpoch) {
          return rejectedHandle(commandError('commandId is already associated with a different action, payload, or control session.',
            'IDEMPOTENCY_CONFLICT', commandId, 'rejected'));
        }
        return entry.ok
          ? resolvedHandle({ commandId, ok: true, code: entry.code, message: entry.message, accepted: true })
          : rejectedHandle(commandError(entry.message, entry.code, commandId, 'completed'));
      }
    }

    let pending = pendingCommands.get(commandId);
    if (!pending) {
      if (pendingCommands.has(commandId)) {
        return rejectedHandle(commandError('commandId is already associated with a different action or payload.', 'IDEMPOTENCY_CONFLICT', commandId, 'rejected'));
      }
      pending = createPendingCommand(commandId, action, payloadSignature);
      if (!pending) return rejectedHandle(commandError('Too many unresolved commands.', 'COMMAND_CAPACITY', commandId, 'not-sent'));
    } else if (pending.action !== action || pending.payloadSignature !== payloadSignature) {
      return rejectedHandle(commandError('commandId is already associated with a different action or payload.', 'IDEMPOTENCY_CONFLICT', commandId, 'rejected'));
    }

    const accepted = pending.acknowledged
      ? Promise.resolve({ commandId, accepted: true, inProgress: true })
      : addCommandAdmissionListener(pending, commandId, admissionTimeoutMs);
    const result = addCommandListener(pending, commandId, resultTimeoutMs, 'Command result for');
    const packet = {
      protocolVersion: 1,
      type: 'command',
      commandId,
      action,
      authorization: { controlSessionEpoch, socketCommandToken },
    };
    if (payload !== undefined && payload !== null) packet.payload = payload;
    const sent = !pending.sent ? sendSocketPacket(packet) : true;
    if (sent) pending.sent = true;
    if (!sent && !pending.sent) {
      const error = commandError('Failed to send command packet; WebSocket not ready.', 'SEND_FAILED', commandId, 'not-sent');
      settleCommandListeners(pending, null, error);
      settleCommandAdmissions(pending, null, error);
      pendingCommands.delete(commandId);
    }
    return { commandId, accepted, result };
  }

  function resolvedHandle(result) {
    return { commandId: result.commandId, accepted: Promise.resolve(result), result: Promise.resolve(result) };
  }

  function rejectedHandle(error) {
    return { commandId: error.commandId, accepted: Promise.reject(error), result: Promise.reject(error) };
  }

  // ── Handle incoming commandAck / commandResult messages ───────────────────
  function applyCommandAck(msg) {
    const commandId = msg.commandId;
    if (typeof commandId !== 'string') return;
    const pending = pendingCommands.get(commandId);
    const prior = commandLedger.get(commandId);
    const identity = {
      action: pending?.action ?? prior?.action ?? null,
      payloadSignature: pending?.payloadSignature ?? prior?.payloadSignature ?? null,
      epoch: pending?.epoch ?? prior?.epoch ?? controlSessionEpoch,
    };

    if (!msg.accepted) {
      // Server rejected the command before queuing.
      rememberCommandResult(commandId, {
        completed: true, ok: false, code: msg.code || 'REJECTED', message: msg.message || 'Command rejected',
        action: identity.action, payloadSignature: identity.payloadSignature, epoch: identity.epoch,
      });
      if (pending) {
        const rejection = commandError(msg.message || 'Command rejected', msg.code || 'REJECTED', commandId, 'rejected');
        settleCommandListeners(pending, null, rejection);
        settleCommandAdmissions(pending, null, rejection);
        pendingCommands.delete(commandId);
      }
      window.dispatchEvent(new CustomEvent('cnc-command-rejected', { detail: { commandId, code: msg.code, message: msg.message } }));
      return;
    }

    // Accepted (in queue or in-progress); update ledger.
    if (pending && !pending.acknowledged) {
      pending.acknowledged = true;
      settleCommandAdmissions(pending, {
        commandId, accepted: true, inProgress: Boolean(msg.inProgress), code: msg.code || 'ACCEPTED',
      }, null);
    }
    rememberCommandResult(commandId, {
      completed: false, ok: false, code: msg.code || 'ACCEPTED', message: msg.message || '',
      action: identity.action, payloadSignature: identity.payloadSignature, epoch: identity.epoch,
    });
    window.dispatchEvent(new CustomEvent('cnc-command-ack', { detail: { commandId, accepted: true, inProgress: Boolean(msg.inProgress) } }));
  }

  function applyCommandResult(msg) {
    const commandId = msg.commandId;
    if (typeof commandId !== 'string') return;

    const ok = Boolean(msg.ok);
    const code = String(msg.code || (ok ? 'OK' : 'ERROR'));
    const message = String(msg.message || '');

    const pending = pendingCommands.get(commandId);
    const prior = commandLedger.get(commandId);
    const identity = {
      action: pending?.action ?? prior?.action ?? null,
      payloadSignature: pending?.payloadSignature ?? prior?.payloadSignature ?? null,
      epoch: pending?.epoch ?? prior?.epoch ?? controlSessionEpoch,
    };
    rememberCommandResult(commandId, {
      completed: true, ok, code, message,
      action: identity.action, payloadSignature: identity.payloadSignature, epoch: identity.epoch,
    });

    if (pending) {
      pending.completed = true;
      pendingCommands.delete(commandId);
      if (ok) {
        settleCommandListeners(pending, { commandId, ok: true, code, message, accepted: true }, null);
      } else {
        settleCommandListeners(pending, null, commandError(message, code, commandId, 'completed', { resultOk: false }));
      }
    }

    window.dispatchEvent(new CustomEvent('cnc-command-result', { detail: { commandId, ok, code, message } }));
  }

  // ── commandQuery: ask the server for the result of an in-flight command ───
  function commandQuery(commandId, options = {}) {
    const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 10000;
    if (typeof commandId !== 'string' || !/^[A-Za-z0-9._:-]{1,96}$/.test(commandId)) {
      return Promise.reject(commandError('Valid commandId is required.', 'INVALID_COMMAND', commandId, 'not-sent'));
    }
    if (!socketCommandToken || !controlSessionEpoch) {
      return Promise.reject(commandError('No active control session.', 'UNAUTHORIZED', commandId, 'not-sent'));
    }
    if (!socketConnected || socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(commandError('WebSocket is not connected.', 'TRANSPORT_UNAVAILABLE', commandId, 'not-sent'));
    }
    // If already completed in local ledger, return immediately.
    if (commandLedger.has(commandId)) {
      const entry = commandLedger.get(commandId);
      if (entry.completed) {
        return entry.ok
          ? Promise.resolve({ commandId, ok: true, code: entry.code, message: entry.message, accepted: true })
          : Promise.reject(commandError(entry.message, entry.code, commandId, 'completed'));
      }
    }

    let pending = pendingCommands.get(commandId);
    if (!pending) pending = createPendingCommand(commandId);
    if (!pending) return Promise.reject(commandError('Too many unresolved commands.', 'COMMAND_CAPACITY', commandId, 'not-sent'));
    const promise = addCommandListener(pending, commandId, timeoutMs, 'commandQuery for');
    const wasSent = pending.sent;
    const sent = sendSocketPacket({
      protocolVersion: 1,
      type: 'commandQuery',
      commandId,
      authorization: { controlSessionEpoch, socketCommandToken },
    });
    pending.sent = wasSent || sent;
    if (!sent) {
      settleCommandListeners(pending, null, commandError('Failed to send command query.', 'SEND_FAILED', commandId, wasSent ? 'outcome-unknown' : 'not-sent'));
      if (!wasSent) pendingCommands.delete(commandId);
    }
    return promise;
  }

  function recoverPendingCommands() {
    if (!socketCommandToken || !controlSessionEpoch || !socketConnected) return;
    for (const pending of pendingCommands.values()) {
      if (!pending.completed && pending.sent && pending.epoch === controlSessionEpoch) {
        sendSocketPacket({
          protocolVersion: 1,
          type: 'commandQuery',
          commandId: pending.commandId,
          authorization: { controlSessionEpoch, socketCommandToken },
        });
      }
    }
  }

  async function readJson(res) {
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (err) {
      throw new Error(`Invalid JSON from ${res.url}: ${err.message}`);
    }
    if (!res.ok) throw new Error(data.error || `${res.url} failed`);
    return data;
  }

  function isSliceEqual(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function updateTransportStatus(newStatus, extraError) {
    transportStatus = newStatus;
    const isSynced = newStatus === 'synchronized';
    const isConn = isSynced || socketConnected;
    mirroredState.connection = {
      connected: isConn,
      stale: !isSynced,
      transportStatus: newStatus,
      lastError: extraError || mirroredState.connection?.lastError || null,
    };
    window.dispatchEvent(new CustomEvent('cnc-telemetry-transport', {
      detail: { transportStatus: newStatus, connected: isConn, stale: !isSynced },
    }));
    window.dispatchEvent(new CustomEvent('cnc-telemetry-connection', {
      detail: mirroredState.connection,
    }));
  }

  function formatLogSlice(logData, isSnapshot = false) {
    const incoming = Array.isArray(logData?.entries) ? logData.entries : [];

    if (isSnapshot) {
      const sorted = [...incoming].sort((a, b) => Number(a.id) - Number(b.id)).slice(-80);
      const latestId = Number(logData.latestId ?? (sorted.length > 0 ? sorted[sorted.length - 1].id : 0));
      const nextId = latestId + 1;
      const oldestId = Number(logData.oldestId ?? (sorted.length > 0 ? sorted[0].id : 0));
      return {
        entries: sorted,
        oldestId,
        latestId,
        nextId,
        lastCritical: logData.lastCritical || null,
        dropped: Number(logData.dropped || 0),
      };
    }

    const currentLog = state.log || { entries: [], oldestId: 0, latestId: 0, nextId: 1, lastCritical: null, dropped: 0 };
    if (Number(logData?.dropped || 0) > 0) {
      requestResync();
      return currentLog;
    }

    const ordered = incoming
      .filter((entry) => Number.isInteger(Number(entry?.id)) && Number(entry.id) > 0)
      .sort((a, b) => Number(a.id) - Number(b.id));
    const fresh = ordered.filter((entry) => Number(entry.id) > lastLogId);
    let expectedId = lastLogId + 1;
    for (const entry of fresh) {
      if (Number(entry.id) !== expectedId) {
        requestResync();
        return currentLog;
      }
      expectedId += 1;
    }

    if (fresh.length === 0) return currentLog;

    const advertisedLatestId = logData?.latestId === undefined ? Number(fresh[fresh.length - 1].id) : Number(logData.latestId);
    const advertisedNextId = logData?.nextId === undefined ? advertisedLatestId + 1 : Number(logData.nextId);
    if (advertisedLatestId !== Number(fresh[fresh.length - 1].id) || advertisedNextId !== advertisedLatestId + 1) {
      requestResync();
      return currentLog;
    }

    const existing = Array.isArray(currentLog.entries) ? currentLog.entries : [];
    const byId = new Map(existing.map((entry) => [Number(entry.id), entry]));
    fresh.forEach((entry) => byId.set(Number(entry.id), entry));

    const mergedEntries = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id)).slice(-80);
    const latestId = Number(fresh[fresh.length - 1].id);
    const nextId = latestId + 1;
    const oldestId = Number(mergedEntries.length > 0 ? mergedEntries[0].id : 0);
    lastLogId = latestId;

    return {
      entries: mergedEntries,
      oldestId,
      latestId,
      nextId,
      lastCritical: logData.lastCritical || currentLog.lastCritical || null,
      dropped: 0,
    };
  }

  function emit(name, data) {
    if (name === 'log') {
      data = formatLogSlice(data);
    }
    const oldSlice = state[name];
    if (isSliceEqual(oldSlice, data)) return;

    if (typeof oldSlice === 'object' && oldSlice !== null && typeof data === 'object' && data !== null && !Array.isArray(data)) {
      state[name] = { ...oldSlice, ...data };
    } else {
      state[name] = data;
    }

    if (typeof mirroredState[name] === 'object' && mirroredState[name] !== null && typeof data === 'object' && data !== null && !Array.isArray(data)) {
      mirroredState[name] = { ...mirroredState[name], ...data };
    } else {
      mirroredState[name] = state[name];
    }

    window.dispatchEvent(new CustomEvent(`cnc-telemetry-${name}`, { detail: state[name] }));

    // Dispatch backwards-compatibility aliases
    if (name === 'system') {
      window.dispatchEvent(new CustomEvent('cnc-telemetry-health', { detail: state.system?.health || state.system }));
    } else if (name === 'machine') {
      window.dispatchEvent(new CustomEvent('cnc-telemetry-position', { detail: state.machine?.position || state.machine }));
    }
  }

  async function diagnosticRequest(name) {
    // Independent manual diagnostic read helper: DOES NOT mutate CncTelemetry.state or call emit()
    const endpoints = {
      health: '/api/health',
      job: '/api/job/status',
      log: `/api/marlin/log?after=${lastLogId}`,
      jog: '/api/jog/status',
    };
    const url = endpoints[name];
    if (!url) throw new Error(`Unknown diagnostic endpoint: ${name}`);
    if (inFlight.has(name)) return inFlight.get(name);

    const pending = fetch(url)
      .then(readJson)
      .finally(() => {
        inFlight.delete(name);
      });
    inFlight.set(name, pending);
    return pending;
  }

  function setDemand(name, owner, enabled) {
    const owners = demand.get(name) || new Set();
    if (enabled) owners.add(owner);
    else owners.delete(owner);
    demand.set(name, owners);
    sendSocketDemand();
  }

  function isWanted(name) {
    return (demand.get(name)?.size || 0) > 0;
  }

  function sendSocketPacket(packet) {
    if (!socketConnected || socket?.readyState !== WebSocket.OPEN) return false;
    const seq = clientSeq;
    packet.seq = seq;
    packet.ack = lastServerSeq;
    try {
      socket.send(JSON.stringify(packet));
      clientSeq += 1;
      highestClientSeqSuccessfullySent = seq;
      return true;
    } catch {
      return false;
    }
  }

  function sendSocketDemand() {
    sendSocketPacket({
      protocolVersion: 1,
      type: 'log',
      subscribe: { log: isWanted('log') },
    });
  }

  function subscribe(name, listener) {
    const eventName = `cnc-telemetry-${name}`;
    const handler = (event) => listener(event.detail);
    window.addEventListener(eventName, handler);
    if (state[name]) listener(state[name]);
    return () => window.removeEventListener(eventName, handler);
  }

  function requestResync() {
    if (resyncPending && resyncRequestSent) return;
    if (!resyncPending) {
      resyncPending = true;
      resyncStartedAtMs = Date.now();
      updateTransportStatus('stale');
    } else if (resyncStartedAtMs === 0) {
      resyncStartedAtMs = Date.now();
    }
    resyncRequestSent = true;
    sendSocketPacket({
      protocolVersion: 1,
      type: 'resync',
      knownBootId,
      lastStateRevision,
    });
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function rawSnapshotState(snapshotObj) {
    if (!isObject(snapshotObj)) return null;
    if (isObject(snapshotObj.state)) return snapshotObj.state;
    if (isObject(snapshotObj.data)) return snapshotObj.data;
    return canonicalSlices.every((key) => Object.prototype.hasOwnProperty.call(snapshotObj, key)) ? snapshotObj : null;
  }

  function isCoherentLogSnapshot(logData) {
    if (!isObject(logData) || !Array.isArray(logData.entries)) return false;
    const ids = logData.entries.map((entry) => Number(entry?.id));
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return false;
    if (new Set(ids).size !== ids.length) return false;
    const latestId = Number(logData.latestId);
    const oldestId = Number(logData.oldestId);
    const nextId = Number(logData.nextId);
    if (!Number.isInteger(latestId) || !Number.isInteger(oldestId) || !Number.isInteger(nextId)) return false;
    if (nextId !== latestId + 1) return false;
    if (ids.length === 0) return oldestId === 0 && latestId === 0 && nextId === 1;
    if (oldestId !== ids[0] || latestId !== ids[ids.length - 1]) return false;
    for (let index = 1; index < ids.length; index += 1) {
      if (ids[index] !== ids[index - 1] + 1) return false;
    }
    return true;
  }

  function isValidSnapshotState(rawState) {
    if (!isObject(rawState)) return false;
    if (!canonicalSlices.every((key) => Object.prototype.hasOwnProperty.call(rawState, key))) return false;
    if (!canonicalSlices.filter((key) => key !== 'log').every((key) => isObject(rawState[key]))) return false;
    return isCoherentLogSnapshot(rawState.log);
  }

  function applySnapshot(snapshotObj, bootId, seq, stateRevision) {
    const rawState = rawSnapshotState(snapshotObj);
    if (!isValidSnapshotState(rawState)) return false;

    // 1. Construct nextState object containing all 8 canonical slices
    const nextState = {
      system: rawState.system,
      controller: rawState.controller,
      machine: rawState.machine,
      job: rawState.job,
      jog: rawState.jog,
      control: rawState.control,
      log: formatLogSlice(rawState.log, true),
      machineProfile: rawState.machineProfile,
    };

    // 2. Identify changed keys
    const changedKeys = Object.keys(nextState).filter((key) => !isSliceEqual(state[key], nextState[key]));

    // 3. Replace state & mirroredState store ATOMICALLY BEFORE notifying subscribers
    Object.keys(nextState).forEach((key) => {
      state[key] = nextState[key];
      mirroredState[key] = nextState[key];
    });

    // 4. Update bootId, sequence, stateRevision, lastLogId, and clear resyncPending
    if (bootId) knownBootId = bootId;
    if (seq > 0) lastServerSeq = seq;
    if (stateRevision > 0) lastStateRevision = stateRevision;
    lastLogId = Number(nextState.log.latestId || 0);

    resyncPending = false;
    resyncStartedAtMs = 0;
    resyncRequestSent = false;
    reconnectAttempts = 0;

    // 5. Update transportStatus to 'synchronized'
    updateTransportStatus('synchronized');

    // 6. Notify subscribers ONLY AFTER state store replacement is complete
    changedKeys.forEach((key) => {
      window.dispatchEvent(new CustomEvent(`cnc-telemetry-${key}`, { detail: state[key] }));
      if (key === 'system') window.dispatchEvent(new CustomEvent('cnc-telemetry-health', { detail: state.system?.health || state.system }));
      if (key === 'machine') window.dispatchEvent(new CustomEvent('cnc-telemetry-position', { detail: state.machine?.position || state.machine }));
    });
    recoverPendingCommands();
    return true;
  }

  function isValidCommandResponse(message) {
    if (!isObject(message) || Number(message.protocolVersion) !== 1) return false;
    if (message.type !== 'commandAck' && message.type !== 'commandResult') return false;
    if (typeof message.commandId !== 'string' || message.commandId.length > 96) return false;
    if (typeof message.accepted !== 'boolean' || typeof message.inProgress !== 'boolean' ||
        typeof message.ok !== 'boolean' || typeof message.code !== 'string' ||
        typeof message.message !== 'string') return false;
    return message.seq === undefined && message.stateRevision === undefined;
  }

  function isValidProtocolEnvelope(message) {
    if (!isObject(message) || Number(message.protocolVersion) !== 1) return false;
    if (!protocolMessageTypes.has(message.type)) return false;
    for (const field of ['seq', 'ack', 'stateRevision']) {
      if (message[field] !== undefined && (!Number.isInteger(Number(message[field])) || Number(message[field]) < 0)) return false;
    }
    if (message.type === 'snapshot') return isValidSnapshotState(rawSnapshotState(message));
    if (message.type === 'patch' || message.type === 'delta') {
      return isObject(message.patch) || (typeof message.channel === 'string' && message.data !== undefined);
    }
    if (message.type === 'event') {
      return typeof (message.channel || message.event) === 'string' && message.data !== undefined;
    }
    if (message.type === 'protocol-error') return typeof message.error === 'string' && message.error.length > 0;
    if (message.type === 'commandAck' || message.type === 'commandResult') {
      return isValidCommandResponse(message);
    }
    return true;
  }

  function applySocketMessage(message) {
    if (isObject(message) && message.type === 'commandAck') {
      if (!isValidCommandResponse(message)) return false;
      lastServerMessageMs = Date.now();
      applyCommandAck(message);
      return true;
    }
    if (isObject(message) && message.type === 'commandResult') {
      if (!isValidCommandResponse(message)) return false;
      lastServerMessageMs = Date.now();
      applyCommandResult(message);
      return true;
    }

    if (!isValidProtocolEnvelope(message)) {
      if (isObject(message) && message.type === 'snapshot') requestResync();
      return false;
    }

    lastServerMessageMs = Date.now();

    const seq = Number(message.seq || 0);
    const ack = Number(message.ack || 0);
    const bootId = message.bootId || null;
    const stateRevision = Number(message.stateRevision || message.revision || 0);
    const msgType = message.type;
    const bootChanged = Boolean(bootId && knownBootId && bootId !== knownBootId);

    // Only a complete snapshot may replace state after a server reboot.
    if (bootChanged && msgType !== 'snapshot') {
      requestResync();
      return true;
    }

    if (seq > 0) {
      if (!bootChanged && seq <= lastServerSeq) {
        return true; // Every duplicate sequence is ignored without exception.
      }
      if (!bootChanged && seq > lastServerSeq + 1 && lastServerSeq > 0) {
        if (msgType !== 'snapshot') {
          requestResync();
          return true;
        }
      }
      lastServerSeq = seq;
    }

    if (ack > 0) {
      if (ack > highestClientSeqSuccessfullySent) {
        updateTransportStatus('stale', 'received ACK for unsent packet');
        window.dispatchEvent(new CustomEvent('cnc-telemetry-protocol-error', { detail: { error: 'invalid future ACK' } }));
        requestResync();
        return true;
      } else if (ack >= highestClientSeqAcknowledgedByESP) {
        highestClientSeqAcknowledgedByESP = ack;
      }
    }

    if (stateRevision > 0) {
      if (!bootChanged && stateRevision < lastStateRevision && bootId === knownBootId) {
        updateTransportStatus('stale', 'stateRevision regression detected');
        window.dispatchEvent(new CustomEvent('cnc-telemetry-protocol-error', { detail: { error: 'stateRevision regression detected' } }));
        requestResync();
        return true;
      } else {
        lastStateRevision = stateRevision;
      }
    }

    if (msgType === 'protocol-error') {
      updateTransportStatus('stale', message.error || 'protocol error');
      window.dispatchEvent(new CustomEvent('cnc-telemetry-protocol-error', { detail: message }));
      requestResync();
      return true;
    }

    if (msgType === 'snapshot') {
      if (!applySnapshot(message, bootId, seq, stateRevision)) requestResync();
      return true;
    }

    if (msgType === 'sync') {
      return true;
    }

    // STRICT RESYNC GATING: Ignore all patch/delta/event packets while resyncPending or not synchronized!
    if (resyncPending || transportStatus !== 'synchronized') {
      return true;
    }

    if (msgType === 'event') {
      const channel = message.channel || message.event;
      const eventData = message.data !== undefined ? message.data : message;
      if (channel) {
        if (canonicalSliceSet.has(channel)) {
          emit(channel, eventData);
        } else {
          window.dispatchEvent(new CustomEvent(`cnc-telemetry-${channel}`, { detail: eventData }));
        }
      }
      return true;
    }

    if (msgType === 'patch' || msgType === 'delta') {
      if (message.patch) {
        Object.keys(message.patch).filter((key) => canonicalSliceSet.has(key)).forEach((key) => {
          emit(key, message.patch[key]);
        });
      }
      if (canonicalSliceSet.has(message.channel) && message.data) {
        emit(message.channel, message.data);
      }
      return true;
    }
    return true;
  }

  function getWebSocketUrl() {
    if (window.CNC_WS_URL) return window.CNC_WS_URL;
    const host = location.hostname || '127.0.0.1';
    const isStandardPort = !location.port || location.port === '80' || location.port === '443';
    const port = isStandardPort ? '81' : location.port;
    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const path = isStandardPort ? '/' : '/ws';
    return `${wsProtocol}//${host}:${port}${path}`;
  }

  function connectSocket() {
    if (!started || document.hidden || socket) return;
    updateTransportStatus('connecting');
    let candidate;
    try {
      candidate = new WebSocket(getWebSocketUrl());
      socket = candidate;
    } catch (err) {
      socket = null;
      scheduleReconnect();
      return;
    }
    candidate.addEventListener('open', () => {
      if (socket !== candidate) return;
      socketConnected = true;
      reconnectDelayMs = 1000;
      clientSeq = 1;
      highestClientSeqSuccessfullySent = 0;
      highestClientSeqAcknowledgedByESP = 0;
      lastServerSeq = 0;
      lastServerMessageMs = 0;
      resyncPending = true;
      resyncStartedAtMs = Date.now();
      resyncRequestSent = false;

      sendSocketPacket({
        protocolVersion: 1,
        type: 'hello',
        knownBootId: knownBootId || null,
        lastStateRevision,
        utcMs: Date.now(),
        timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
        timeZone: typeof Intl !== 'undefined' && Intl.DateTimeFormat
          ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
          : 'UTC',
      });
      sendSocketDemand();
    });
    candidate.addEventListener('message', (event) => {
      if (socket !== candidate) return;
      try {
        applySocketMessage(JSON.parse(event.data));
      } catch (err) {
        // Ignore malformed socket message
      }
    });
    candidate.addEventListener('close', () => {
      if (socket !== candidate) return;
      socket = null;
      socketConnected = false;
      if (document.hidden || !started) return;
      if (!resyncPending) {
        resyncPending = true;
        resyncStartedAtMs = Date.now();
        updateTransportStatus('stale');
      }
      scheduleReconnect();
    });
    candidate.addEventListener('error', () => {
      if (socket === candidate) candidate.close();
    });
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (!started || document.hidden || socket) return;
    reconnectAttempts++;
    if (reconnectAttempts > 5) {
      updateTransportStatus('failed');
    } else {
      updateTransportStatus('reconnecting');
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectSocket();
    }, reconnectDelayMs);
    reconnectDelayMs = Math.min(10000, reconnectDelayMs * 2);
  }

  function checkHeartbeatLiveness() {
    if (socketConnected && resyncPending) {
      if (resyncStartedAtMs === 0) resyncStartedAtMs = Date.now();
      if (Date.now() - resyncStartedAtMs > RESYNC_COMPLETION_TIMEOUT_MS) {
        updateTransportStatus('stale', 'full resync snapshot timed out');
        socket?.close();
      }
      return;
    }
    if (socketConnected && transportStatus === 'synchronized') {
      if (Date.now() - lastServerMessageMs > 7000) {
        if (!resyncPending) {
          resyncPending = true;
          resyncStartedAtMs = Date.now();
          updateTransportStatus('stale');
        }
        if (socket) {
          socket.close();
        }
      }
    }
  }

  function start() {
    if (started) return;
    started = true;
    connectSocket();
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(checkHeartbeatLiveness, 2000);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      const visibleSocket = socket;
      socket = null;
      socketConnected = false;
      if (!resyncPending) {
        resyncPending = true;
        resyncStartedAtMs = 0;
        updateTransportStatus('stale');
      }
      visibleSocket?.close();
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    connectSocket();
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(checkHeartbeatLiveness, 2000);
  });

  window.addEventListener('pagehide', () => {
    revokeCommandAuthorization('Page lifecycle ended the control session.', 'PAGE_LIFECYCLE_ENDED');
  });

  const api = {
    request: diagnosticRequest,
    diagnosticRequest,
    setDemand,
    start,
    state,
    mirroredState,
    subscribe,
    command,
    beginCommand,
    commandQuery,
    setSocketCommandToken,
    clearSocketCommandToken,
    revokeCommandAuthorization,
    get transportStatus() {
      return transportStatus;
    },
  };

  if (typeof window !== 'undefined' && window.CNC_TELEMETRY_TEST_MODE === true) {
    api.__test__ = {
      getTransportStatus: () => transportStatus,
      setTransportStatus: (st) => updateTransportStatus(st),
      getClientSeq: () => clientSeq,
      getHighestClientSeqSuccessfullySent: () => highestClientSeqSuccessfullySent,
      getHighestClientSeqAcknowledgedByESP: () => highestClientSeqAcknowledgedByESP,
      getLastServerSeq: () => lastServerSeq,
      getLastStateRevision: () => lastStateRevision,
      getKnownBootId: () => knownBootId,
      getLastLogId: () => lastLogId,
      getLastServerMessageMs: () => lastServerMessageMs,
      getReconnectAttempts: () => reconnectAttempts,
      isResyncPending: () => resyncPending,
      getResyncStartedAtMs: () => resyncStartedAtMs,
      getResyncCompletionTimeoutMs: () => RESYNC_COMPLETION_TIMEOUT_MS,
      getSocket: () => socket,
      getSocketCommandToken: () => socketCommandToken,
      getControlSessionEpoch: () => controlSessionEpoch,
      getPendingCommands: () => pendingCommands,
      getCommandLedger: () => commandLedger,
      connectSocket,
      scheduleReconnect,
      checkHeartbeatLiveness,
      applySocketMessage,
      applySnapshot,
      applyCommandAck,
      applyCommandResult,
      recoverPendingCommands,
      isValidCommandResponse,
    };
  }
  window.CncTelemetry = api;
}());
