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
    log: { entries: [], nextId: 0, lastCritical: null },
  };

  const inFlight = new Map();
  const demand = new Map();
  let started = false;
  let socket = null;
  let socketConnected = false;
  let transportStatus = 'connecting'; // 'connecting', 'synchronized', 'reconnecting', 'stale', 'failed'
  let reconnectTimer = null;
  let reconnectDelayMs = 1000;
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

  function emit(name, data) {
    if (name === 'log') {
      const existing = Array.isArray(state.log?.entries) ? state.log.entries : [];
      const incoming = Array.isArray(data.entries) ? data.entries : [];
      const byId = new Map(existing.map((entry) => [Number(entry.id), entry]));
      
      // Check for gap in log entry IDs if logCursor is active
      if (incoming.length > 0) {
        const minIncomingId = Math.min(...incoming.map(e => Number(e.id)));
        if (logCursor > 0 && minIncomingId > logCursor + 1) {
          requestResync();
        }
      }

      incoming.forEach((entry) => byId.set(Number(entry.id), entry));
      data = {
        ...state.log,
        ...data,
        entries: [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id)).slice(-80),
      };
      logCursor = Math.max(logCursor, Number(data.nextId) || 0);
    }
    const oldSlice = state[name];
    if (isSliceEqual(oldSlice, data)) return;

    state[name] = data;
    if (mirroredState[name] !== undefined) {
      mirroredState[name] = data;
    }
    window.dispatchEvent(new CustomEvent(`cnc-telemetry-${name}`, { detail: data }));
  }

  function accept(name, data) {
    emit(name, data);
  }

  async function request(name) {
    // One-shot manual diagnostic read helper (no recurring polling schedule)
    const endpoints = {
      health: '/api/health',
      job: '/api/job/status',
      log: `/api/marlin/log?after=${logCursor}`,
      jog: '/api/jog/status',
    };
    const url = endpoints[name];
    if (!url) throw new Error(`Unknown diagnostic slice: ${name}`);
    if (inFlight.has(name)) return inFlight.get(name);

    const pending = fetch(url)
      .then(readJson)
      .then((data) => {
        emit(name, data);
        return data;
      })
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
    updateTransportStatus('stale');
    sendSocketPacket({
      protocolVersion: 1,
      type: 'resync',
      knownBootId,
      lastStateRevision,
    });
  }

  function applySocketMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.protocolVersion && Number(message.protocolVersion) !== 1) return;

    const seq = Number(message.seq || 0);
    const ack = Number(message.ack || 0);
    const bootId = message.bootId || null;
    const stateRevision = Number(message.stateRevision || message.revision || 0);
    const msgType = message.type;

    if (bootId && knownBootId && bootId !== knownBootId) {
      ['system', 'controller', 'machine', 'job', 'jog', 'control'].forEach((sliceKey) => {
        state[sliceKey] = null;
        if (mirroredState[sliceKey] !== undefined) {
          mirroredState[sliceKey] = null;
        }
      });
      lastServerSeq = 0;
      lastStateRevision = 0;
      updateTransportStatus('reconnecting');
    }
    if (bootId) knownBootId = bootId;

    if (seq > 0) {
      if (seq <= lastServerSeq) {
        return; // Every duplicate sequence is ignored without exception.
      }
      if (seq > lastServerSeq + 1 && lastServerSeq > 0) {
        requestResync();
        return;
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
      updateTransportStatus('stale', message.error || 'protocol error');
      window.dispatchEvent(new CustomEvent('cnc-telemetry-protocol-error', { detail: message }));
      return;
    }

    if (msgType === 'snapshot') {
      const canonicalKeys = ['system', 'controller', 'machine', 'job', 'jog', 'control'];
      if (message.state) {
        canonicalKeys.forEach((sliceKey) => {
          const val = message.state[sliceKey] !== undefined ? message.state[sliceKey] : null;
          emit(sliceKey, val);
        });
      } else if (message.data) {
        Object.keys(message.data).forEach((sliceKey) => {
          emit(sliceKey, message.data[sliceKey]);
        });
      }
      updateTransportStatus('synchronized');
      return;
    }

    if (msgType === 'sync') {
      return;
    }

    if (msgType === 'patch' || msgType === 'delta') {
      if (transportStatus !== 'synchronized' && transportStatus !== 'stale') {
        // Do not apply patches before initial snapshot synchronization
        return;
      }
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

    if (msgType === 'event') {
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
      updateTransportStatus('reconnecting');
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
      updateTransportStatus('reconnecting');
      scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      socket?.close();
    });
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectSocket, reconnectDelayMs);
    reconnectDelayMs = Math.min(10000, reconnectDelayMs * 2);
  }

  function start() {
    if (started) return;
    started = true;
    connectSocket();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(reconnectTimer);
      socket?.close();
      return;
    }
    connectSocket();
  });

  const api = {
    accept,
    request,
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
    };
  }
  window.CncTelemetry = api;
}());

