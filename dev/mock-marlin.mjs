const NUMBER_WORD_RE = /([XYZFSPRT])\s*(-?\d+(?:\.\d+)?)/gi;

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
    this.failCommands = new Set((config.failCommands || []).map((command) => String(command).toUpperCase()));
    this.maxFeedrates = { x: 100, y: 100, z: 5, ...(config.maxFeedrates || {}) };
    this.stepsPerMm = { x: 100, y: 100, z: 400, ...(config.stepsPerMm || {}) };
    this.maxAccelerations = { x: 1000, y: 1000, z: 100, ...(config.maxAccelerations || {}) };
    this.accelerations = { p: 500, r: 500, t: 800, ...(config.accelerations || {}) };
    this.softwareEndstops = true;
    this.eepromSaves = 0;
    this.machinePosition = { x: 0, y: 0, z: 0 };
    this.g92Offset = { x: 0, y: 0, z: 0 };
    this.units = 'mm';
    this.absolute = true;
    this.workspace = 'G54';
    this.feed = 0;
    this.feedOverride = 100;
    this.spindleOff = true;
    this.realtimeHold = config.realtimeHold !== false;
    this.realtimeHeld = false;
    this.lastCommand = '';
    this.endstops = { xMin: 'open', xMax: 'open', yMin: 'open', yMax: 'open', zMin: 'open', zMax: 'open' };
    this.log = [];
    this.simulateTimeout = Boolean(config.simulateTimeout);
    this.malformedM114Count = Number(config.malformedM114Count || 0);
    this.controllerResetDetected = Boolean(config.controllerResetDetected);
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
    if (this.simulateTimeout) {
      return { ok: false, timeout: true, error: 'Marlin did not respond within timeout', controllerState: 'unresponsive', failedCommand: command };
    }
    if (this.failCommands.has(upper)) return this.error(`Injected failure for ${command}`);
    if (upper === 'P000') {
      if (!this.realtimeHold) return this.error('Realtime hold is unavailable');
      this.realtimeHeld = true;
      return this.response('<Hold|Mock>');
    }
    if (upper === 'R000') {
      if (!this.realtimeHeld) return this.error('Realtime hold is not active');
      this.realtimeHeld = false;
      return this.response('<Run|Mock>');
    }

    const machineCoordinates = /\bG53\b/.test(upper);
    if (machineCoordinates && !options.allowMachineCoordinates) {
      return this.error('Unexpected G53 machine-coordinate command in mock mode');
    }
    if (/\bG28\b/.test(upper)) {
      if (!this.allowHoming) return this.error('Unexpected G28 homing command in mock mode');
      for (const axis of ['x', 'y', 'z']) {
        if (upper === 'G28' || Object.hasOwn(args, axis.toUpperCase())) {
          this.machinePosition[axis] = axis === 'z' ? this.machine.zMax : this.machine[`${axis}Min`];
        }
      }
      return this.response('Homing simulated\nok');
    }
    if (/\bM115\b/.test(upper)) {
      const m = this.machine;
      const resetHeader = this.controllerResetDetected ? 'start\necho:Marlin 2.1.1\n' : '';
      return this.response(`${resetHeader}FIRMWARE_NAME:MockMarlin 2.1.1 SOURCE_CODE_URL:local PROTOCOL_VERSION:1.0 MACHINE_TYPE:DEV-MOCK EXTRUDER_COUNT:0\nCap:EEPROM:1\nCap:AUTOREPORT_POS:1\nCap:EMERGENCY_PARSER:1\nCap:REALTIME_REPORTING:${this.realtimeHold ? 1 : 0}\nCap:SDCARD:1\nCap:MOTION_MODES:1\nCap:ARCS:1\narea:{full:{min:{x:${m.xMin.toFixed(4)},y:${m.yMin.toFixed(4)},z:${m.zMin.toFixed(4)}},max:{x:${m.xMax.toFixed(4)},y:${m.yMax.toFixed(4)},z:${m.zMax.toFixed(4)}}},work:{min:{x:${m.xMin.toFixed(4)},y:${m.yMin.toFixed(4)},z:${m.zMin.toFixed(4)}},max:{x:${m.xMax.toFixed(4)},y:${m.yMax.toFixed(4)},z:${m.zMax.toFixed(4)}}}}\nok`);
    }
    if (/\bM114\b/.test(upper)) {
      if (this.malformedM114Count > 0) {
        this.malformedM114Count -= 1;
        return this.response('X:INVALID Y:INVALID Z:INVALID Count X:0 Y:0 Z:0\nok');
      }
      const p = this.position;
      return this.response(`X:${p.x.toFixed(4)} Y:${p.y.toFixed(4)} Z:${p.z.toFixed(4)} Count X:${Math.round(this.machinePosition.x * this.stepsPerMm.x)} Y:${Math.round(this.machinePosition.y * this.stepsPerMm.y)} Z:${Math.round(this.machinePosition.z * this.stepsPerMm.z)}\nok`);
    }
    if (/\bM119\b/.test(upper)) {
      const lines = Object.entries(this.endstops).map(([name, state]) => `${name}: ${state}`).join('\n');
      return this.response(`Reporting endstop status\n${lines}\nok`);
    }
    if (/\bM503\b/.test(upper)) {
      const max = this.maxFeedrates;
      const steps = this.stepsPerMm;
      const accel = this.maxAccelerations;
      const work = this.accelerations;
      return this.response(`echo:Steps per unit:\n  M92 X${steps.x.toFixed(2)} Y${steps.y.toFixed(2)} Z${steps.z.toFixed(2)} E100.00\necho:Maximum feedrates (units/s):\n  M203 X${max.x.toFixed(2)} Y${max.y.toFixed(2)} Z${max.z.toFixed(2)} E25.00\necho:Maximum Acceleration (units/s2):\n  M201 X${accel.x.toFixed(0)} Y${accel.y.toFixed(0)} Z${accel.z.toFixed(0)} E1000\necho:Acceleration (units/s2):\n  M204 P${work.p.toFixed(0)} R${work.r.toFixed(0)} T${work.t.toFixed(0)}\nok`);
    }
    if (/\bM211\b/.test(upper)) return this.response(`Software Endstops: ${this.softwareEndstops ? 'On' : 'Off'}\nok`);
    if (/\bM500\b/.test(upper)) {
      this.eepromSaves += 1;
      return this.response('echo:Settings Stored\nok');
    }
    if (/\bM92\b/.test(upper)) {
      for (const axis of ['X', 'Y', 'Z']) if (Number.isFinite(args[axis])) this.stepsPerMm[axis.toLowerCase()] = args[axis];
      return this.response('ok');
    }
    if (/\bM203\b/.test(upper)) {
      for (const axis of ['X', 'Y', 'Z']) if (Number.isFinite(args[axis])) this.maxFeedrates[axis.toLowerCase()] = args[axis];
      return this.response('ok');
    }
    if (/\bM201\b/.test(upper)) {
      for (const axis of ['X', 'Y', 'Z']) if (Number.isFinite(args[axis])) this.maxAccelerations[axis.toLowerCase()] = args[axis];
      return this.response('ok');
    }
    if (/\bM204\b/.test(upper)) {
      for (const field of ['P', 'R', 'T']) if (Number.isFinite(args[field])) this.accelerations[field.toLowerCase()] = args[field];
      return this.response('ok');
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
    if (/\bG38\.2\b/.test(upper)) {
      if (!Number.isFinite(args.Z) || args.Z >= 0) return this.error('Mock G38.2 requires a negative Z probe distance');
      const maximumTravel = Math.abs(args.Z) * (this.units === 'inch' ? 25.4 : 1);
      const contactTravel = Math.min(maximumTravel, 1);
      const contactZ = this.machinePosition.z - contactTravel;
      if (contactZ < this.machine.zMin) return this.error('Mock probe target is outside Z limits');
      this.machinePosition.z = contactZ;
      if (Number.isFinite(args.F)) this.feed = args.F;
      return this.response('echo:Mock touch plate triggered\nok');
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
