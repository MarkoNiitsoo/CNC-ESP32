import { assertCanUseActiveRunForExecution, getActiveRun } from '../www/lib/job-active-run.js';

const ACTIVE_STATES = new Set(['PREPARING', 'RUNNING', 'PAUSING', 'PAUSED', 'RESUMING', 'STOPPING']);

function cleanLine(line) {
  return String(line || '').replace(/\([^)]*\)/g, '').replace(/;.*/, '').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockJobRunner {
  constructor({ sd, marlin, lineDelayMs = 20 } = {}) {
    this.sd = sd;
    this.marlin = marlin;
    this.lineDelayMs = Math.max(0, Number(lineDelayMs) || 0);
    this.runToken = 0;
    this.status = this.emptyStatus();
  }

  emptyStatus() {
    return {
      state: 'IDLE', gcodePath: '', jobPath: '', startMode: '', safeStartZ: 15,
      allowedWorkspaceCommands: false, fileSize: 0, currentByteOffset: 0, progressPercent: 0,
      sentLineCount: 0, acknowledgedLineCount: 0, currentLineNumber: 0,
      pauseRequested: false, stopRequested: false, priorityCommandInProgress: false,
      feedOverridePercent: this?.marlin?.feedOverride || 100,
      lastCommand: '', lastSentCommand: '', lastResponse: '', lastMarlinResponse: '', lastError: '',
      lastPriorityCommand: '', lastPriorityResponse: '', lastPriorityError: '',
      lastFeedOverrideCommand: '', lastFeedOverrideResponse: '', lastFeedOverrideError: '',
      streamingPausedReason: '', uptimeMs: 0,
    };
  }

  snapshot(message = '') {
    const status = { ...this.status, position: { ...this.marlin.position }, uptimeMs: Date.now() };
    if (message) return { ...status, ok: true, message };
    return status;
  }

  isActive() {
    return ACTIVE_STATES.has(this.status.state);
  }

  runCommand(command, { priority = false } = {}) {
    const result = this.marlin.execute(command, { priority });
    if (priority) {
      this.status.lastPriorityCommand = command;
      this.status.lastPriorityResponse = result.response || '';
      this.status.lastPriorityError = result.error || '';
    } else {
      this.status.lastCommand = command;
      this.status.lastSentCommand = command;
      this.status.lastResponse = result.response || '';
      this.status.lastMarlinResponse = result.response || '';
    }
    return result;
  }

  async start(request = {}) {
    if (this.isActive()) throw new Error('another job is already active');
    const job = JSON.parse(await this.sd.readText(request.jobPath));
    const active = getActiveRun(job);
    const execution = assertCanUseActiveRunForExecution(job, { requireArm: true });
    if (!execution.ok) throw new Error(execution.message);
    if (active.path !== request.gcodePath) throw new Error('requested path is not the armed active run path');
    if (request.activeRunMode && active.mode !== request.activeRunMode) throw new Error('active run mode changed after arm');
    if (job.arm?.activeRunPath && job.arm.activeRunPath !== active.path) throw new Error('active run path changed after arm');
    if (request.activeRunFingerprint && job.arm?.activeRunFingerprint &&
        request.activeRunFingerprint !== job.arm.activeRunFingerprint) {
      throw new Error('active run fingerprint changed after arm');
    }

    const text = await this.sd.readText(active.path);
    const bytes = Buffer.byteLength(text);
    const startMode = request.startMode || job.startMode || 'apply_current_position_as_work_zero';
    if (!['apply_current_position_as_work_zero', 'use_active_work_zero'].includes(startMode)) {
      throw new Error('invalid startMode');
    }
    const safeStartZ = Number.isFinite(Number(request.safeStartZ)) ? Number(request.safeStartZ) : Number(job.safeStartZ || 15);
    const feed = Math.max(10, Math.min(200, Math.round(Number(job.feedOverride?.startPercent || 100))));
    this.status = {
      ...this.emptyStatus(), state: 'PREPARING', gcodePath: active.path, jobPath: request.jobPath,
      startMode, safeStartZ, allowedWorkspaceCommands: Boolean(job.allowedWorkspaceCommands),
      fileSize: bytes, feedOverridePercent: feed,
    };

    const preamble = ['M5', 'G21', 'G90', 'G54', `M220 S${feed}`, 'M400', 'M114'];
    if (startMode === 'apply_current_position_as_work_zero') preamble.push('G92 X0 Y0 Z0', 'M114');
    preamble.push(`G0 Z${safeStartZ.toFixed(3)} F400`, 'M400');
    for (const command of preamble) {
      const result = this.runCommand(command);
      if (!result.ok) return this.fail(result.error);
    }

    this.status.state = 'RUNNING';
    const token = ++this.runToken;
    this.stream(text, token, Boolean(job.feedOverride?.resetTo100AfterJob ?? true));
    return this.snapshot();
  }

  async stream(text, token, resetFeed) {
    const lines = String(text).split(/\r?\n/);
    let offset = 0;
    let commandLineNumber = 0;
    for (let index = 0; index < lines.length; index += 1) {
      if (token !== this.runToken || this.status.stopRequested) return;
      while (this.status.state === 'PAUSED' || this.status.state === 'PAUSING') {
        if (token !== this.runToken || this.status.stopRequested) return;
        await sleep(5);
      }
      if (this.status.state !== 'RUNNING' && this.status.state !== 'RESUMING') return;
      const original = lines[index];
      const command = cleanLine(original);
      const lineBytes = Buffer.byteLength(original) + (index < lines.length - 1 ? 1 : 0);
      offset += lineBytes;
      this.status.currentByteOffset = Math.min(offset, this.status.fileSize);
      this.status.progressPercent = this.status.fileSize ? this.status.currentByteOffset * 100 / this.status.fileSize : 0;
      if (!command) continue;
      commandLineNumber += 1;
      this.status.currentLineNumber = commandLineNumber;

      const workspace = command.toUpperCase().match(/\bG5(?:4|5|6|7|8|9(?:\.[123])?)\b/)?.[0];
      if (workspace && workspace !== 'G54' && !this.status.allowedWorkspaceCommands) {
        this.fail('Non-default workspace command found. This may conflict with captured work zero.');
        return;
      }
      const result = this.runCommand(command);
      this.status.sentLineCount += 1;
      if (!result.ok) {
        this.fail(result.error);
        return;
      }
      this.status.acknowledgedLineCount += 1;
      if (this.lineDelayMs) await sleep(this.lineDelayMs);
    }
    if (token !== this.runToken) return;
    this.status.currentByteOffset = this.status.fileSize;
    this.status.progressPercent = 100;
    this.status.state = 'COMPLETED';
    if (resetFeed) this.setFeedOverride(100, { allowDuringTransition: true });
  }

  fail(message) {
    this.status.state = 'ERROR';
    this.status.lastError = String(message || 'mock job error');
    this.status.streamingPausedReason = this.status.lastError;
    return this.snapshot();
  }

  pause() {
    if (this.status.state !== 'RUNNING') throw new Error('job is not running');
    this.status.state = 'PAUSING';
    this.status.pauseRequested = true;
    this.status.streamingPausedReason = 'Pause requested. Streaming stopped.';
    this.runCommand('M5', { priority: true });
    this.runCommand('M400', { priority: true });
    this.status.state = 'PAUSED';
    return this.snapshot('Pause requested. Streaming stopped.');
  }

  resume() {
    if (this.status.state !== 'PAUSED') throw new Error('job is not paused');
    this.status.state = 'RESUMING';
    this.status.pauseRequested = false;
    this.status.streamingPausedReason = '';
    this.status.state = 'RUNNING';
    return this.snapshot('Resume requested.');
  }

  stop() {
    if (!this.isActive()) throw new Error('job is not active');
    this.status.state = 'STOPPING';
    this.status.stopRequested = true;
    this.status.pauseRequested = false;
    this.status.streamingPausedReason = 'Stop requested. Streaming stopped.';
    this.runToken += 1;
    this.runCommand('M5', { priority: true });
    this.runCommand('M410', { priority: true });
    this.status.state = 'STOPPED';
    return this.snapshot('Stop requested. Streaming stopped.');
  }

  setFeedOverride(percent, { allowDuringTransition = false } = {}) {
    const value = Number(percent);
    if (!Number.isInteger(value) || value < 10 || value > 200) throw new Error('feed override percent must be between 10 and 200');
    if (!allowDuringTransition && ['PREPARING', 'STOPPING'].includes(this.status.state)) {
      throw new Error('feed override rejected while job is preparing or stopping');
    }
    const command = `M220 S${value}`;
    const result = this.marlin.execute(command, { priority: true });
    this.status.feedOverridePercent = value;
    this.status.lastFeedOverrideCommand = command;
    this.status.lastFeedOverrideResponse = result.response || '';
    this.status.lastFeedOverrideError = result.error || '';
    if (!result.ok) throw new Error(result.error);
    return this.snapshot('Feed override requested.');
  }
}
