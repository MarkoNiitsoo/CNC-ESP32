(function () {
  if (window.CncTelemetry) return;

  const ACTIVE_JOB_STATES = new Set(['PREPARING', 'RUNNING', 'PAUSING', 'PAUSED', 'RESUMING', 'STOPPING']);
  const channels = {
    health: { url: '/api/health', idleMs: 30000, activeMs: 30000, always: true },
    job: { url: '/api/job/status', idleMs: 10000, activeMs: 1000, always: true },
    log: { url: '/api/marlin/log', idleMs: 5000, activeMs: 2000, always: false },
    jog: { url: '/api/jog/status', idleMs: 2000, activeMs: 1000, always: false },
  };
  const state = {};
  const inFlight = new Map();
  const timers = new Map();
  const demand = new Map();
  let started = false;
  let socket = null;
  let socketConnected = false;
  let reconnectTimer = null;
  let reconnectDelayMs = 1000;
  let lastRevision = 0;
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
    state[name] = data;
    window.dispatchEvent(new CustomEvent(`cnc-telemetry-${name}`, { detail: data }));
  }

  function isActive() {
    return ACTIVE_JOB_STATES.has(String(state.job?.state || ''));
  }

  function isWanted(name) {
    return channels[name]?.always || (demand.get(name)?.size || 0) > 0;
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
    sendSocketDemand();
    if (enabled) request(name).catch(() => {});
    schedule(name);
  }

  function sendSocketDemand() {
    if (!socketConnected || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ subscribe: { log: isWanted('log') } }));
  }

  function subscribe(name, listener) {
    const eventName = `cnc-telemetry-${name}`;
    const handler = (event) => listener(event.detail);
    window.addEventListener(eventName, handler);
    if (state[name]) listener(state[name]);
    return () => window.removeEventListener(eventName, handler);
  }

  function applySocketMessage(message) {
    if (!message || Number(message.revision) <= lastRevision) return;
    lastRevision = Number(message.revision);
    if (message.type === 'snapshot') {
      if (message.data?.job) emit('job', message.data.job);
      if (message.data?.jog) emit('jog', message.data.jog);
      if (message.data?.position) emit('position', message.data.position);
      return;
    }
    if (message.type === 'delta' && (channels[message.channel] || message.channel === 'position') && message.data) {
      emit(message.channel, message.data);
    }
  }

  function connectSocket() {
    if (!started || document.hidden || socket || (location.port && location.port !== '80')) return;
    try {
      socket = new WebSocket(`ws://${location.hostname}:81/`);
    } catch (err) {
      socket = null;
      return;
    }
    socket.addEventListener('open', () => {
      socketConnected = true;
      reconnectDelayMs = 1000;
      ['job', 'jog'].forEach((name) => {
        clearTimeout(timers.get(name));
        timers.delete(name);
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
    request('job').catch(() => {});
    request('health').catch(() => {});
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
    connectSocket();
    Object.keys(channels).forEach((name) => {
      if (isWanted(name)) request(name).catch(() => {});
    });
  });

  window.CncTelemetry = { request, setDemand, start, state, subscribe };
}());
