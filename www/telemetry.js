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
    log: { entries: [], oldestId: 0, latestId: 0, nextId: 0, lastCritical: null },
    machineProfile: null,
  };

  const inFlight = new Map();
  const demand = new Map();
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

  let clientSeq = 1;
  let highestClientSeqSuccessfullySent = 0;
  let highestClientSeqAcknowledgedByESP = 0;
  let lastServerSeq = 0;
  let knownBootId = null;
  let lastStateRevision = 0;
  let logCursor = 0;

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
      const nextId = Number(logData.nextId || (sorted.length > 0 ? sorted[sorted.length - 1].id + 1 : 1));
      return {
        entries: sorted,
        oldestId: Number(logData.oldestId || (sorted.length > 0 ? sorted[0].id : 0)),
        latestId: Number(logData.latestId || (sorted.length > 0 ? sorted[sorted.length - 1].id : 0)),
        nextId,
        lastCritical: logData.lastCritical || null,
      };
    }

    const existing = Array.isArray(state.log?.entries) ? state.log.entries : [];
    const byId = new Map(existing.map((entry) => [Number(entry.id), entry]));

    if (incoming.length > 0 && logCursor > 0) {
      const minIncomingId = Math.min(...incoming.map((e) => Number(e.id)));
      if (minIncomingId > logCursor + 1) {
        requestResync();
      }
    }

    incoming.forEach((entry) => byId.set(Number(entry.id), entry));
    const mergedEntries = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id)).slice(-80);
    const nextId = Number(logData.nextId || (mergedEntries.length > 0 ? mergedEntries[mergedEntries.length - 1].id : 1));
    const oldestId = Number(logData.oldestId || (mergedEntries.length > 0 ? mergedEntries[0].id : 0));
    const latestId = Number(logData.latestId || (mergedEntries.length > 0 ? mergedEntries[mergedEntries.length - 1].id : 0));

    return {
      entries: mergedEntries,
      oldestId,
      latestId,
      nextId,
      lastCritical: logData.lastCritical || state.log?.lastCritical || null,
    };
  }

  function emit(name, data) {
    if (name === 'log') {
      data = formatLogSlice(data);
      logCursor = Math.max(logCursor, Number(data.nextId) || 0);
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

  function accept(name, data) {
    emit(name, data);
  }

  async function diagnosticRequest(name) {
    // Independent manual diagnostic read helper: DOES NOT mutate CncTelemetry.state or call emit()
    const endpoints = {
      health: '/api/health',
      job: '/api/job/status',
      log: `/api/marlin/log?after=${logCursor}`,
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
    resyncPending = true;
    updateTransportStatus('stale');
    sendSocketPacket({
      protocolVersion: 1,
      type: 'resync',
      knownBootId,
      lastStateRevision,
    });
  }

  function applySnapshot(snapshotObj, bootId, seq, stateRevision) {
    const rawState = snapshotObj.state || snapshotObj.data || snapshotObj || {};

    // 1. Construct nextState object containing all 8 canonical slices
    const nextState = {
      system: rawState.system ?? null,
      controller: rawState.controller ?? null,
      machine: rawState.machine ?? null,
      job: rawState.job ?? null,
      jog: rawState.jog ?? null,
      control: rawState.control ?? null,
      log: rawState.log ? formatLogSlice(rawState.log, true) : { entries: [], oldestId: 0, latestId: 0, nextId: 0, lastCritical: null },
      machineProfile: rawState.machineProfile ?? rawState.machine_profile ?? null,
    };

    // 2. Identify changed keys
    const changedKeys = Object.keys(nextState).filter((key) => !isSliceEqual(state[key], nextState[key]));

    // 3. Replace state & mirroredState store ATOMICALLY BEFORE notifying subscribers
    Object.keys(nextState).forEach((key) => {
      state[key] = nextState[key];
      mirroredState[key] = nextState[key];
    });

    // 4. Update bootId, sequence, stateRevision, logCursor, and clear resyncPending
    if (bootId) knownBootId = bootId;
    if (seq > 0) lastServerSeq = seq;
    if (stateRevision > 0) lastStateRevision = stateRevision;
    if (nextState.log?.nextId) logCursor = Math.max(logCursor, Number(nextState.log.nextId) || 0);

    resyncPending = false;
    reconnectAttempts = 0;

    // 5. Update transportStatus to 'synchronized'
    updateTransportStatus('synchronized');

    // 6. Notify subscribers ONLY AFTER state store replacement is complete
    changedKeys.forEach((key) => {
      window.dispatchEvent(new CustomEvent(`cnc-telemetry-${key}`, { detail: state[key] }));
      if (key === 'system') window.dispatchEvent(new CustomEvent('cnc-telemetry-health', { detail: state.system?.health || state.system }));
      if (key === 'machine') window.dispatchEvent(new CustomEvent('cnc-telemetry-position', { detail: state.machine?.position || state.machine }));
    });
  }

  function applySocketMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.protocolVersion && Number(message.protocolVersion) !== 1) return;

    lastServerMessageMs = Date.now();

    const seq = Number(message.seq || 0);
    const ack = Number(message.ack || 0);
    const bootId = message.bootId || null;
    const stateRevision = Number(message.stateRevision || message.revision || 0);
    const msgType = message.type;

    // Handle Boot ID Mismatch
    if (bootId && knownBootId && bootId !== knownBootId) {
      ['system', 'controller', 'machine', 'job', 'jog', 'control', 'log', 'machineProfile'].forEach((sliceKey) => {
        state[sliceKey] = null;
        mirroredState[sliceKey] = null;
      });
      lastServerSeq = 0;
      lastStateRevision = 0;
      logCursor = 0;
      knownBootId = bootId;
      requestResync();
      return;
    }
    if (bootId) knownBootId = bootId;

    if (seq > 0) {
      if (seq <= lastServerSeq) {
        return; // Every duplicate sequence is ignored without exception.
      }
      if (seq > lastServerSeq + 1 && lastServerSeq > 0) {
        if (msgType !== 'snapshot') {
          requestResync();
          return;
        }
      }
      lastServerSeq = seq;
    }

    if (ack > 0) {
      if (ack > highestClientSeqSuccessfullySent) {
        updateTransportStatus('stale', 'received ACK for unsent packet');
        window.dispatchEvent(new CustomEvent('cnc-telemetry-protocol-error', { detail: { error: 'invalid future ACK' } }));
        requestResync();
        return;
      } else if (ack >= highestClientSeqAcknowledgedByESP) {
        highestClientSeqAcknowledgedByESP = ack;
      }
    }

    if (stateRevision > 0) {
      if (stateRevision < lastStateRevision && bootId === knownBootId) {
        updateTransportStatus('stale', 'stateRevision regression detected');
        window.dispatchEvent(new CustomEvent('cnc-telemetry-protocol-error', { detail: { error: 'stateRevision regression detected' } }));
        requestResync();
        return;
      } else {
        lastStateRevision = stateRevision;
      }
    }

    if (msgType === 'protocol-error') {
      window.dispatchEvent(new CustomEvent('cnc-telemetry-protocol-error', { detail: message }));
      return;
    }

    if (msgType === 'snapshot') {
      if (message.data) {
        Object.keys(message.data).forEach((sliceKey) => {
          emit(sliceKey, message.data[sliceKey]);
        });
        updateTransportStatus('synchronized');
        return;
      }
      applySnapshot(message, bootId, seq, stateRevision);
      return;
    }

    if (msgType === 'sync') {
      return;
    }

    if (msgType === 'event') {
      const channel = message.channel || message.event;
      const eventData = message.data !== undefined ? message.data : message;
      if (channel) {
        emit(channel, eventData);
        window.dispatchEvent(new CustomEvent(`cnc-telemetry-${channel}`, { detail: eventData }));
      }
      return;
    }

    // STRICT RESYNC GATING: Ignore all patch/delta packets while resyncPending or stale!
    if (resyncPending || (transportStatus !== 'synchronized' && transportStatus !== 'connecting')) {
      return;
    }

    if (msgType === 'patch' || msgType === 'delta') {
      if (message.patch) {
        Object.keys(message.patch).forEach((key) => {
          emit(key, message.patch[key]);
        });
      }
      if (message.channel && message.data) {
        emit(message.channel, message.data);
      }
      return;
    }
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
    try {
      socket = new WebSocket(getWebSocketUrl());
    } catch (err) {
      socket = null;
      scheduleReconnect();
      return;
    }
    socket.addEventListener('open', () => {
      socketConnected = true;
      reconnectDelayMs = 1000;
      clientSeq = 1;
      highestClientSeqSuccessfullySent = 0;
      highestClientSeqAcknowledgedByESP = 0;
      lastServerSeq = 0;
      lastServerMessageMs = Date.now();

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
    socket.addEventListener('message', (event) => {
      try {
        applySocketMessage(JSON.parse(event.data));
      } catch (err) {
        // Ignore malformed socket message
      }
    });
    socket.addEventListener('close', () => {
      socket = null;
      socketConnected = false;
      scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      socket?.close();
    });
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectAttempts++;
    if (reconnectAttempts > 5) {
      updateTransportStatus('failed');
    } else {
      updateTransportStatus('reconnecting');
    }
    reconnectTimer = setTimeout(connectSocket, reconnectDelayMs);
    reconnectDelayMs = Math.min(10000, reconnectDelayMs * 2);
  }

  function checkHeartbeatLiveness() {
    if (socketConnected && transportStatus === 'synchronized') {
      if (Date.now() - lastServerMessageMs > 7000) {
        updateTransportStatus('stale');
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
      clearInterval(heartbeatTimer);
      socket?.close();
      return;
    }
    connectSocket();
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(checkHeartbeatLiveness, 2000);
  });

  const api = {
    accept,
    request: diagnosticRequest,
    diagnosticRequest,
    setDemand,
    start,
    state,
    mirroredState,
    subscribe,
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
      applySocketMessage,
      applySnapshot,
    };
  }
  window.CncTelemetry = api;
}());
