(function () {
  if (window.CncTelemetry) return;

  const ACTIVE_JOB_STATES = new Set(['PREPARING', 'RUNNING', 'PAUSING', 'PAUSED', 'RESUMING', 'STOPPING']);
  const channels = {
    health: { url: '/api/health', idleMs: 30000, activeMs: 30000, always: false },
    job: { url: '/api/job/status', idleMs: 10000, activeMs: 1000, always: false },
    log: { url: '/api/marlin/log', idleMs: 5000, activeMs: 2000, always: false },
    jog: { url: '/api/jog/status', idleMs: 2000, activeMs: 1000, always: false },
  };
  const state = {};
  const mirroredState = {
    system: null,
    connection: { connected: false },
    controller: null,
    machine: null,
    job: null,
    jog: null,
    control: null,
    log: { entries: [], nextId: 0, lastCritical: null },
  };
  const inFlight = new Map();
  const timers = new Map();
  const demand = new Map();
  let started = false;
  let socket = null;
  let socketConnected = false;
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

  function emit(name, data) {
    if (name === 'log') {
      const existing = Array.isArray(state.log?.entries) ? state.log.entries : [];
      const incoming = Array.isArray(data.entries) ? data.entries : [];
      const byId = new Map(existing.map((entry) => [Number(entry.id), entry]));
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
    schedule(name);
  }

  function isActive() {
    return ACTIVE_JOB_STATES.has(String(state.job?.state || mirroredState.job?.state || ''));
  }

  function isWanted(name) {
    return channels[name]?.always || (demand.get(name)?.size || 0) > 0;
  }

  function wantsSocket() {
    return isWanted('job') || isWanted('jog') || isWanted('log');
  }

  function intervalFor(name) {
    const config = channels[name];
    return isActive() ? config.activeMs : config.idleMs;
  }

  function schedule(name) {
    clearTimeout(timers.get(name));
    timers.delete(name);
    if (!started || document.hidden || !isWanted(name)) return;
    if (socketConnected && (name === 'job' || name === 'jog')) return;
    timers.set(name, setTimeout(async () => {
      await request(name).catch(() => {});
      schedule(name);
    }, intervalFor(name)));
  }

  async function request(name) {
    const config = channels[name];
    if (!config) throw new Error(`Unknown telemetry channel: ${name}`);
    if (inFlight.has(name)) return inFlight.get(name);

    const url = name === 'log' ? `${config.url}?after=${logCursor}` : config.url;
    const pending = fetch(url)
      .then(readJson)
      .then((data) => {
        emit(name, data);
        return data;
      })
      .finally(() => {
        inFlight.delete(name);
        schedule(name);
      });
    inFlight.set(name, pending);
    return pending;
  }

  function setDemand(name, owner, enabled) {
    if (!channels[name] || channels[name].always) return;
    const owners = demand.get(name) || new Set();
    if (enabled) owners.add(owner);
    else owners.delete(owner);
    demand.set(name, owners);
    if (started && wantsSocket()) connectSocket();
    else if (started && !wantsSocket() && socket) socket.close();
    sendSocketDemand();
    if (enabled) request(name).catch(() => {});
    schedule(name);
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
        mirroredState.connection.lastError = 'received ACK for unsent packet';
        window.dispatchEvent(new CustomEvent('cnc-telemetry-protocol-error', { detail: { error: 'invalid future ACK' } }));
        window.dispatchEvent(new CustomEvent('cnc-telemetry-connection', { detail: mirroredState.connection }));
        requestResync();
        return;
      } else if (ack >= highestClientSeqAcknowledgedByESP) {
        highestClientSeqAcknowledgedByESP = ack;
      }
    }

    if (stateRevision > 0) {
      if (stateRevision < lastStateRevision && bootId === knownBootId) {
        mirroredState.connection.lastError = 'stateRevision regression detected';
        window.dispatchEvent(new CustomEvent('cnc-telemetry-protocol-error', { detail: { error: 'stateRevision regression detected' } }));
        window.dispatchEvent(new CustomEvent('cnc-telemetry-connection', { detail: mirroredState.connection }));
        requestResync();
        return;
      } else {
        lastStateRevision = stateRevision;
      }
    }

    if (msgType === 'protocol-error') {
      mirroredState.connection.lastError = message.error || 'protocol error';
      window.dispatchEvent(new CustomEvent('cnc-telemetry-protocol-error', { detail: message }));
      window.dispatchEvent(new CustomEvent('cnc-telemetry-connection', { detail: mirroredState.connection }));
      return;
    }

    if (msgType === 'snapshot') {
      const canonicalKeys = ['system', 'controller', 'machine', 'job', 'jog', 'control'];
      if (message.state) {
        canonicalKeys.forEach((sliceKey) => {
          const val = message.state[sliceKey] !== undefined ? message.state[sliceKey] : null;
          emit(sliceKey, val);
        });
      } else {
        if (message.data?.job) emit('job', message.data.job);
        if (message.data?.jog) emit('jog', message.data.jog);
        if (message.data?.position) emit('position', message.data.position);
      }
      return;
    }

    if (msgType === 'sync') {
      return;
    }

    if (msgType === 'patch' || msgType === 'delta') {
      if (message.patch) {
        const canonicalKeys = new Set(['system', 'controller', 'machine', 'job', 'jog', 'control']);
        Object.keys(message.patch).forEach((key) => {
          if (canonicalKeys.has(key)) {
            emit(key, message.patch[key]);
          }
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
    if (!started || document.hidden || socket || !wantsSocket()) return;
    try {
      socket = new WebSocket(getWebSocketUrl());
    } catch (err) {
      socket = null;
      return;
    }
    socket.addEventListener('open', () => {
      socketConnected = true;
      mirroredState.connection.connected = true;
      reconnectDelayMs = 1000;
      ['job', 'jog'].forEach((name) => {
        clearTimeout(timers.get(name));
        timers.delete(name);
      });

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
        // Ignore malformed telemetry; HTTP controls and fallback polling remain independent.
      }
    });
    socket.addEventListener('close', () => {
      socket = null;
      socketConnected = false;
      mirroredState.connection.connected = false;
      schedule('job');
      schedule('jog');
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectSocket, reconnectDelayMs);
      reconnectDelayMs = Math.min(10000, reconnectDelayMs * 2);
    });
    socket.addEventListener('error', () => socket?.close());
  }

  function start() {
    if (started) return;
    started = true;
    Object.keys(channels).forEach((name) => {
      if (isWanted(name)) request(name).catch(() => {});
    });
    connectSocket();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      clearTimeout(reconnectTimer);
      socket?.close();
      return;
    }
    Object.keys(channels).forEach((name) => {
      if (isWanted(name)) request(name).catch(() => {});
    });
    connectSocket();
  });

  const api = { accept, request, setDemand, start, state, mirroredState, subscribe };
  if (typeof window !== 'undefined' && window.CNC_TELEMETRY_TEST_MODE === true) {
    api.__test__ = {
      getClientSeq: () => clientSeq,
      getHighestClientSeqSuccessfullySent: () => highestClientSeqSuccessfullySent,
      getHighestClientSeqAcknowledgedByESP: () => highestClientSeqAcknowledgedByESP,
      getLastServerSeq: () => lastServerSeq,
      getLastStateRevision: () => lastStateRevision,
      getKnownBootId: () => knownBootId,
    };
  }
  window.CncTelemetry = api;
}());

