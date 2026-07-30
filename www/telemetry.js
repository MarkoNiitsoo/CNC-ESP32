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

  // Pending command callbacks: commandId → { resolve, reject, timer }
  const pendingCommands = new Map();

  // ── Idempotency ledger (mirrors the firmware ring buffer, client-side) ─────
  // Allows re-delivery of results to callers who reconnect before the promise resolves.
  const commandLedger = new Map(); // commandId → { accepted, ok, code, message }

  // ── Public token lifecycle API (called by operator control module) ─────────
  function setSocketCommandToken(token, epoch) {
    socketCommandToken = typeof token === 'string' && token.length > 0 ? token : null;
    controlSessionEpoch = typeof epoch === 'number' ? epoch : 0;
  }

  function clearSocketCommandToken() {
    socketCommandToken = null;
    controlSessionEpoch = 0;
    // Reject all pending commands immediately.
    for (const [id, pending] of pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Control session ended; command authorization revoked.'));
      pendingCommands.delete(id);
    }
  }

  // ── command() API ─────────────────────────────────────────────────────────
  // Sends a WS command and returns a Promise that resolves/rejects with the result.
  // commandId must be a unique string (uuid or similar) provided by the caller for idempotency.
  function command(action, payload, commandId, options = {}) {
    const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 15000;

    if (!socketCommandToken) {
      return Promise.reject(new Error('No active control session; obtain operator control first.'));
    }
    if (!socketConnected || socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket is not connected.'));
    }
    if (typeof commandId !== 'string' || commandId.length === 0 || commandId.length > 96) {
      return Promise.reject(new Error('commandId must be a non-empty string up to 96 characters.'));
    }

    // If this commandId is already in the ledger (completed), return immediately.
    if (commandLedger.has(commandId)) {
      const entry = commandLedger.get(commandId);
      if (entry.completed) {
        return entry.ok
          ? Promise.resolve({ commandId, ok: true, code: entry.code, message: entry.message })
          : Promise.reject(Object.assign(new Error(entry.message), { code: entry.code, commandId }));
      }
    }

    // If already in-flight, just re-register a listener.
    if (pendingCommands.has(commandId)) {
      return new Promise((resolve, reject) => {
        const existing = pendingCommands.get(commandId);
        const origResolve = existing.resolve;
        const origReject = existing.reject;
        existing.resolve = (v) => { origResolve(v); resolve(v); };
        existing.reject = (e) => { origReject(e); reject(e); };
      });
    }

    return new Promise((resolve, reject) => {
      const packet = {
        protocolVersion: 1,
        type: 'command',
        commandId,
        action,
        authorization: {
          controlSessionEpoch,
          socketCommandToken,
        },
      };
      if (payload !== undefined && payload !== null) {
        packet.payload = payload;
      }

      const timer = setTimeout(() => {
        if (pendingCommands.has(commandId)) {
          pendingCommands.delete(commandId);
          reject(Object.assign(new Error(`Command ${commandId} timed out after ${timeoutMs}ms`), { code: 'TIMEOUT', commandId }));
        }
      }, timeoutMs);

      pendingCommands.set(commandId, { resolve, reject, timer });

      const sent = sendSocketPacket(packet);
      if (!sent) {
        clearTimeout(timer);
        pendingCommands.delete(commandId);
        reject(new Error('Failed to send command packet; WebSocket not ready.'));
      }
    });
  }

  // ── Handle incoming commandAck / commandResult messages ───────────────────
  function applyCommandAck(msg) {
    const commandId = msg.commandId;
    if (typeof commandId !== 'string') return;

    if (!msg.accepted) {
      // Server rejected the command before queuing.
      commandLedger.set(commandId, { completed: true, ok: false, code: msg.code || 'REJECTED', message: msg.message || 'Command rejected' });
      const pending = pendingCommands.get(commandId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingCommands.delete(commandId);
        pending.reject(Object.assign(new Error(msg.message || 'Command rejected'), { code: msg.code || 'REJECTED', commandId }));
      }
      window.dispatchEvent(new CustomEvent('cnc-command-rejected', { detail: { commandId, code: msg.code, message: msg.message } }));
      return;
    }

    // Accepted (in queue or in-progress); update ledger.
    if (!commandLedger.has(commandId)) {
      commandLedger.set(commandId, { completed: false, ok: false, code: '', message: '' });
    }
    window.dispatchEvent(new CustomEvent('cnc-command-ack', { detail: { commandId, accepted: true, inProgress: Boolean(msg.inProgress) } }));
  }

  function applyCommandResult(msg) {
    const commandId = msg.commandId;
    if (typeof commandId !== 'string') return;

    const ok = Boolean(msg.ok);
    const code = String(msg.code || (ok ? 'OK' : 'ERROR'));
    const message = String(msg.message || '');

    // Update the ledger.
    commandLedger.set(commandId, { completed: true, ok, code, message });
    // Keep ledger bounded to 64 entries.
    if (commandLedger.size > 64) {
      const oldest = commandLedger.keys().next().value;
      commandLedger.delete(oldest);
    }

    const pending = pendingCommands.get(commandId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingCommands.delete(commandId);
      if (ok) {
        pending.resolve({ commandId, ok: true, code, message });
      } else {
        pending.reject(Object.assign(new Error(message), { code, commandId }));
      }
    }

    window.dispatchEvent(new CustomEvent('cnc-command-result', { detail: { commandId, ok, code, message } }));
  }

  // ── commandQuery: ask the server for the result of an in-flight command ───
  function commandQuery(commandId) {
    if (typeof commandId !== 'string' || commandId.length === 0) {
      return Promise.reject(new Error('commandId is required.'));
    }
    // If already completed in local ledger, return immediately.
    if (commandLedger.has(commandId)) {
      const entry = commandLedger.get(commandId);
      if (entry.completed) {
        return entry.ok
          ? Promise.resolve({ commandId, ok: true, code: entry.code, message: entry.message })
          : Promise.reject(Object.assign(new Error(entry.message), { code: entry.code, commandId }));
      }
    }

    // If already in-flight, just re-register a listener.
    if (pendingCommands.has(commandId)) {
      return new Promise((resolve, reject) => {
        const existing = pendingCommands.get(commandId);
        const origResolve = existing.resolve;
        const origReject = existing.reject;
        existing.resolve = (v) => { origResolve(v); resolve(v); };
        existing.reject = (e) => { origReject(e); reject(e); };
      });
    }

    // Register as pending and send query.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCommands.delete(commandId);
        reject(Object.assign(new Error(`commandQuery for ${commandId} timed out`), { code: 'TIMEOUT', commandId }));
      }, 10000);
      pendingCommands.set(commandId, { resolve, reject, timer });
      sendSocketPacket({ protocolVersion: 1, type: 'commandQuery', commandId });
    });
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
    return true;
  }

  function isValidProtocolEnvelope(message) {
    if (!isObject(message) || Number(message.protocolVersion) !== 1) return false;
    // commandAck and commandResult do NOT require protocolVersion on the incoming side —
    // they are server-originated responses, but we still accept them if they arrive.
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
    // commandAck / commandResult: flexible, just need commandId
    if (message.type === 'commandAck' || message.type === 'commandResult') {
      return typeof message.commandId === 'string';
    }
    return true;
  }

  function applySocketMessage(message) {
    // commandAck and commandResult are lightweight command-channel messages that bypass
    // the full protocol-envelope validation (they don't carry seq/stateRevision).
    if (isObject(message) && message.type === 'commandAck') {
      applyCommandAck(message);
      return true;
    }
    if (isObject(message) && message.type === 'commandResult') {
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

  const api = {
    request: diagnosticRequest,
    diagnosticRequest,
    setDemand,
    start,
    state,
    mirroredState,
    subscribe,
    command,
    commandQuery,
    setSocketCommandToken,
    clearSocketCommandToken,
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
    };
  }
  window.CncTelemetry = api;
}());
