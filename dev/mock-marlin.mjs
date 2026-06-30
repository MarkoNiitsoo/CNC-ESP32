const NUMBER_WORD_RE = /([XYZFS])\s*(-?\d+(?:\.\d+)?)/gi;

function stripComments(command) {
  return String(command || '').replace(/\([^)]*\)/g, '').replace(/;.*/, '').trim();
}

function words(command) {
  const result = {};
  for (const match of command.matchAll(NUMBER_WORD_RE)) result[match[1].toUpperCase()] = Number(match[2]);
  return result;
}

export class MockMarlin {
  constructor(config = {}) {
    this.machine = {
      xMin: 0, xMax: 1625, yMin: 0, yMax: 5800, zMin: -30, zMax: 120,
      ...(config.machine || {}),
    };
    this.allowHoming = Boolean(config.allowHoming);
    this.machinePosition = { x: 0, y: 0, z: 0 };
    this.g92Offset = { x: 0, y: 0, z: 0 };
    this.units = 'mm';
    this.absolute = true;
    this.workspace = 'G54';
    this.feed = 0;
    this.feedOverride = 100;
    this.spindleOff = true;
    this.lastCommand = '';
    this.endstops = { xMin: 'open', xMax: 'open', yMin: 'open', yMax: 'open', zMin: 'open', zMax: 'open' };
    this.log = [];
  }

  get position() {
    return {
      x: this.machinePosition.x - this.g92Offset.x,
      y: this.machinePosition.y - this.g92Offset.y,
      z: this.machinePosition.z - this.g92Offset.z,
    };
  }

  addLog(direction, text, options = {}) {
    this.log.push({
      time: String(Date.now()), direction, priority: Boolean(options.priority), text: String(text),
      level: options.level || 'info',
    });
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }

  response(text = 'ok') {
    this.addLog('rx', text);
    return { ok: true, response: text.endsWith('ok') ? text : `${text}\nok` };
  }

  error(message) {
    const response = `Error: ${message}`;
    this.addLog('rx', response, { level: 'error' });
    return { ok: false, error: message, response };
  }

  execute(rawCommand, options = {}) {
    const command = stripComments(rawCommand);
    if (!command) return this.response('ok');
    this.lastCommand = command;
    this.addLog('tx', command, options);
    const upper = command.toUpperCase();
    const args = words(upper);

    const machineCoordinates = /\bG53\b/.test(upper);
    if (machineCoordinates && !options.allowMachineCoordinates) {
      return this.error('Unexpected G53 machine-coordinate command in mock mode');
    }
    if (/\bG28\b/.test(upper)) {
      if (!this.allowHoming) return this.error('Unexpected G28 homing command in mock mode');
      for (const axis of ['x', 'y', 'z']) {
        if (upper === 'G28' || Object.hasOwn(args, axis.toUpperCase())) this.machinePosition[axis] = this.machine[`${axis}Min`];
      }
      return this.response('Homing simulated\nok');
    }
    if (/\bM115\b/.test(upper)) return this.response('FIRMWARE_NAME:MockMarlin CNC-ESP32 SOURCE_CODE_URL:local PROTOCOL_VERSION:1.0\nok');
    if (/\bM114\b/.test(upper)) {
      const p = this.position;
      return this.response(`X:${p.x.toFixed(4)} Y:${p.y.toFixed(4)} Z:${p.z.toFixed(4)} Count X:0 Y:0 Z:0\nok`);
    }
    if (/\bM119\b/.test(upper)) {
      const lines = Object.entries(this.endstops).map(([name, state]) => `${name}: ${state}`).join('\n');
      return this.response(`Reporting endstop status\n${lines}\nok`);
    }
    if (/\bM5\b/.test(upper)) {
      this.spindleOff = true;
      return this.response('ok');
    }
    if (/\bM3\b|\bM4\b/.test(upper)) {
      this.spindleOff = false;
      return this.response('Mock spindle/laser enabled (no hardware)\nok');
    }
    if (/\bM220\b/.test(upper)) {
      if (!Number.isFinite(args.S) || args.S < 10 || args.S > 200) return this.error('M220 percent must be 10..200');
      this.feedOverride = Math.round(args.S);
      return this.response('ok');
    }
    if (/\bM400\b|\bM410\b/.test(upper)) return this.response('ok');
    if (/\bG20\b/.test(upper)) {
      this.units = 'inch';
      return this.response('Warning: mock switched to inches\nok');
    }
    if (/\bG21\b/.test(upper)) {
      this.units = 'mm';
      return this.response('ok');
    }
    if (/\bG90\b/.test(upper)) {
      this.absolute = true;
      return this.response('ok');
    }
    if (/\bG91\b/.test(upper)) {
      this.absolute = false;
      return this.response('ok');
    }
    if (/\bG17\b/.test(upper)) return this.response('ok');
    const workspace = upper.match(/\bG5(?:4|5|6|7|8|9(?:\.[123])?)\b/)?.[0];
    if (workspace) {
      this.workspace = workspace;
      return this.response(workspace === 'G54' ? 'G54 default workspace selected\nok' : `Warning: ${workspace} selected\nok`);
    }
    if (/\bG92\b/.test(upper)) {
      for (const axis of ['x', 'y', 'z']) {
        const key = axis.toUpperCase();
        if (Number.isFinite(args[key])) this.g92Offset[axis] = this.machinePosition[axis] - args[key];
      }
      return this.response('ok');
    }
    if (/\bG0?0\b|\bG0?1\b/.test(upper)) {
      const scale = this.units === 'inch' ? 25.4 : 1;
      const target = { ...this.machinePosition };
      for (const axis of ['x', 'y', 'z']) {
        const key = axis.toUpperCase();
        if (!Number.isFinite(args[key])) continue;
        const value = args[key] * scale;
        target[axis] = machineCoordinates ? value : this.absolute ? this.g92Offset[axis] + value : target[axis] + value;
      }
      if (Number.isFinite(args.F)) this.feed = args.F * scale;
      for (const axis of ['x', 'y', 'z']) {
        const min = this.machine[`${axis}Min`];
        const max = this.machine[`${axis}Max`];
        if (target[axis] < min || target[axis] > max) {
          return this.error(`Mock soft limit exceeded: ${axis.toUpperCase()} ${target[axis].toFixed(3)} outside ${min}..${max}`);
        }
      }
      this.machinePosition = target;
      return this.response('ok');
    }
    return this.response(`echo:Mock ignored unsupported command ${command}\nok`);
  }
}
