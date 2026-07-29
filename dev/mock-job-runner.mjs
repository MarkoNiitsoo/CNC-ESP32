import { createHash } from 'node:crypto';
import { assertCanUseActiveRunForExecution, getActiveRun, getActiveRunFingerprint } from '../www/lib/job-active-run.js';
import { migrateProjectSafeZ } from '../www/lib/job-safe-z.js';

const ACTIVE_STATES = new Set(['PREPARING', 'RUNNING', 'PAUSING', 'PAUSED_INTACT', 'PAUSED', 'RESUMING', 'STOPPING']);

function cleanLine(line) {
  return String(line || '').replace(/\([^)]*\)/g, '').replace(/;.*/, '').trim();
}

function toolNumberFromCommand(command) {
  const match = String(command || '').toUpperCase().match(/(?:^|\s)T\s*(\d+)(?=\s|$|M)/);
  return match ? Number(match[1]) : null;
}

function isM6(command) {
  return /(?:^|\s)M0*6(?=\s|$)/i.test(String(command || ''));
}

function isStandaloneToolSelect(command) {
  return /^T\s*\d+$/i.test(String(command || '').trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockJobRunner {
  constructor({ sd, marlin, frame, toolChangeSettings, lineDelayMs = 20, realtimeHold = true, controllerState = 'connected' } = {}) {
    this.sd = sd;
    this.marlin = marlin;
    this.frame = frame;
    this.toolChangeSettings = toolChangeSettings || {};
    this.lineDelayMs = Math.max(0, Number(lineDelayMs) || 0);
    this.realtimeHold = realtimeHold !== false;
    this.controllerState = controllerState;
    this.runToken = 0;
    this.status = this.emptyStatus();
  }

  emptyStatus() {
    return {
      state: 'IDLE', gcodePath: '', jobPath: '', startMode: '', safeStartZ: 15,
      streamMode: 'job',
      allowedWorkspaceCommands: false, fileSize: 0, currentByteOffset: 0,
      lastAcknowledgedByteOffset: 0, progressPercent: 0,
      sentLineCount: 0, acknowledgedLineCount: 0, currentLineNumber: 0,
      lastAcknowledgedLineNumber: 0,
      pauseRequested: false, stopRequested: false, priorityCommandInProgress: false,
      pauseMode: 'none', realtimeHoldSupported: this?.realtimeHold !== false,
      realtimeHoldActive: false, directResumeValid: false, recoveryRequired: false,
      cutterState: 'unknown',
      feedOverridePercent: this?.marlin?.feedOverride || 100,
      toolChangePending: false, toolChangeReady: false, toolChangeZZeroCompleted: false,
      toolChangeParked: false, toolChangeToolConfirmed: false, toolChangeRouterReadyConfirmed: false,
      toolChangePhase: 'NONE',
      selectedToolNumber: -1, activeToolNumber: -1, toolChangeToolNumber: -1,
      toolChangeLine: 0, toolChangeCommand: '', toolChangeHandling: 'pause',
      toolChangeZZeroMethod: 'manual', toolChangeReturnPositionCaptured: false,
      toolChangeReturnPosition: null,
      lastCommand: '', lastSentCommand: '', lastResponse: '', lastMarlinResponse: '', lastError: '',
      errorCode: '', ackWatchdog: {
        waiting: false, timeoutMs: 0, inactivityTimeoutMs: 0,
        hardTimeoutMs: 0, estimatedCommandDurationMs: 0, elapsedMs: 0,
      },
      communicationLoss: null,
      lastPriorityCommand: '', lastPriorityResponse: '', lastPriorityError: '',
      stopEmergencyParserDetected: true, stopWarning: '',
      lastFeedOverrideCommand: '', lastFeedOverrideResponse: '', lastFeedOverrideError: '',
      streamingPausedReason: '', uptimeMs: 0,
      controllerState: this?.controllerState || 'connected',
    };
  }

  snapshot(message = '') {
    const status = { ...this.status, controllerState: this.controllerState, position: { ...this.marlin.position }, uptimeMs: Date.now() };
    if (message) return { ...status, ok: true, message };
    return status;
  }

  controllerSlice() {
    const isConnected = (this.controllerState === 'connected');
    return {
      type: 'Marlin',
      identity: 'MockMarlin 2.1.1',
      connected: isConnected,
      state: this.controllerState,
      communication: {
        state: this.controllerState,
        lastSuccessfulResponseMs: Date.now(),
        lastTimeoutMs: this.lastTimeoutMs || 0,
        lastFailedCommand: this.lastFailedCommand || '',
        lastError: this.lastError || '',
      },
    };
  }

  isActive() {
    return ACTIVE_STATES.has(this.status.state);
  }

  assertControllerCommunication() {
    if (this.controllerState === 'unresponsive') {
      throw new Error('Marlin is not responding. Machine commands are blocked until controller communication is restored.');
    }
    if (this.controllerState === 'recovering') {
      throw new Error('Controller communication recovery is in progress. Machine commands are blocked.');
    }
    if (this.controllerState === 'waiting') {
      throw new Error('Marlin is processing a synchronous command. Second command rejected.');
    }
  }

  async recoverController() {
    this.controllerState = 'recovering';
    const m115 = this.marlin.execute('M115', { priority: true });
    if (!m115.ok || (!m115.response.includes('FIRMWARE_NAME') && !m115.response.includes('Marlin'))) {
      this.controllerState = 'unresponsive';
      return { ok: false, error: 'M115 recovery probe failed to return Marlin identity content', controllerState: 'unresponsive' };
    }
    if (this.marlin.controllerResetDetected || m115.response.includes('start') || m115.response.includes('RESET')) {
      if (this.frame) {
        this.frame.machineValid = false;
        this.frame.absoluteFromHome = false;
        this.frame.manualWorkFrameValid = false;
        this.frame.workZeroValid = false;
        this.frame.homedX = false;
        this.frame.homedY = false;
        this.frame.homedZ = false;
        this.frame.homingSessionId = '';
        this.frame.homingEpoch = 0;
        this.frame.trusted = false;
        this.frame.revision = (this.frame.revision || 0) + 1;
      }
    }
    const m114 = this.marlin.execute('M114', { priority: true });
    if (!m114.ok || m114.response.includes('INVALID')) {
      this.controllerState = 'unresponsive';
      return { ok: false, error: 'M114 position probe failed during recovery', controllerState: 'unresponsive' };
    }
    this.controllerState = 'connected';
    return { ok: true, message: 'Controller communication restored.', controllerState: 'connected' };
  }

  runCommand(command, { priority = false, allowMachineCoordinates = false } = {}) {
    const upper = String(command || '').trim().toUpperCase();
    if (!priority && upper !== 'M410' && upper !== 'M5') {
      this.assertControllerCommunication();
    }
    const result = this.marlin.execute(command, { priority, allowMachineCoordinates });
    if (result.timeout) {
      this.controllerState = 'unresponsive';
    }
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

  safeZLimits() {
    const machine = this.marlin.machine;
    const zero = this.frame?.absoluteFromHome && this.frame?.workZeroValid
      ? this.frame.workZeroMachine
      : null;
    const workMin = zero ? machine.zMin - Number(zero.z) : machine.zMin;
    const workMax = zero ? machine.zMax - Number(zero.z) : machine.zMax;
    return { workMin, workMax, liftMin: Math.max(workMin, Number(this.marlin.position.z)) };
  }

  assertSafeZ(value) {
    const safeZ = Number(value);
    const limits = this.safeZLimits();
    if (!Number.isFinite(safeZ) || safeZ < limits.liftMin || safeZ > limits.workMax) {
      throw new Error(`Safe Z ${safeZ} is outside the current work-frame lift range ${limits.liftMin}..${limits.workMax} mm`);
    }
    return safeZ;
  }

  assertProjectSafeZ(job, requestedValue) {
    const safeZ = job?.projectSafeZ || {};
    const version = Number(safeZ.version || 1);
    if (version >= 2) {
      if (safeZ.resolved !== true) throw new Error(safeZ.errors?.[0] || 'Project Safe Z is unresolved');
      const programSafeZ = Number(safeZ.programSafeZ);
      const extraClearanceMm = Number(safeZ.extraClearanceMm);
      const effectiveSafeZ = Number(safeZ.effectiveSafeZ);
      if (!Number.isFinite(programSafeZ)) throw new Error('programSafeZ is missing or invalid');
      if (!Number.isFinite(extraClearanceMm) || extraClearanceMm < 0) throw new Error('extraClearanceMm must be non-negative');
      if (!Number.isFinite(effectiveSafeZ)) throw new Error('effectiveSafeZ is missing or invalid');
      if (Math.abs(effectiveSafeZ - (programSafeZ + extraClearanceMm)) > 0.001) {
        throw new Error('Project Safe Z effectiveSafeZ does not match programSafeZ + extraClearanceMm');
      }
      const requested = Number(requestedValue);
      if (!Number.isFinite(requested) || Math.abs(requested - effectiveSafeZ) > 0.001) {
        throw new Error('requested Safe Z does not match project metadata');
      }
      return this.assertSafeZ(requested);
    }

    const projectSafeZ = migrateProjectSafeZ(job, { frame: this.frame });
    if (!projectSafeZ.resolved) throw new Error(projectSafeZ.errors[0] || 'Project Safe Z is unresolved');
    const requested = Number(requestedValue);
    if (!Number.isFinite(requested) || Math.abs(requested - projectSafeZ.effectiveSafeZ) > 0.001) {
      throw new Error('requested Safe Z does not match project metadata');
    }
    return this.assertSafeZ(requested);
  }

  handleToolChange(command) {
    const requested = toolNumberFromCommand(command);
    if (requested !== null) this.status.selectedToolNumber = requested;
    this.status.toolChangePending = true;
    this.status.toolChangeReady = false;
    this.status.toolChangeZZeroCompleted = false;
    this.status.toolChangeParked = false;
    this.status.toolChangeToolConfirmed = false;
    this.status.toolChangeRouterReadyConfirmed = false;
    this.status.toolChangePhase = 'TOOL_CHANGE_REQUESTED';
    this.status.toolChangeToolNumber = this.status.selectedToolNumber;
    this.status.toolChangeLine = this.status.currentLineNumber;
    this.status.toolChangeCommand = command;
    this.status.toolChangeHandling = this.toolChangeSettings.handling === 'park' ? 'park' : 'pause';
    this.status.toolChangeZZeroMethod = this.toolChangeSettings.zZeroMethod === 'touchplate' ? 'touchplate' : 'manual';
    this.status.state = 'PAUSING';
    this.status.pauseRequested = true;
    this.status.streamingPausedReason = 'M6 received. Finishing queued motion before tool change.';
    for (const priorityCommand of ['M400', 'M5']) {
      const result = this.runCommand(priorityCommand, { priority: true });
      if (!result.ok) return this.fail(result.error);
    }
    if (this.status.toolChangeHandling === 'park') {
      if (!this.frame.absoluteFromHome) {
        this.status.toolChangeHandling = 'pause';
      } else {
        this.status.toolChangePhase = 'PARKING_FOR_TOOL_CHANGE';
        this.status.toolChangeReturnPosition = { ...this.marlin.position };
        this.status.toolChangeReturnPositionCaptured = true;
        const settings = this.toolChangeSettings;
        const commands = [
          'M114', 'G21', 'G90', `G53 G0 Z${Number(settings.parkMachineZ).toFixed(3)} F400`, 'M400',
          `G53 G0 X${Number(settings.parkMachineX).toFixed(3)} Y${Number(settings.parkMachineY).toFixed(3)} F3000`,
          'M400', 'G54',
        ];
        for (const priorityCommand of commands) {
          const result = this.runCommand(priorityCommand, { priority: true, allowMachineCoordinates: true });
          if (!result.ok) return this.fail(result.error);
        }
        this.status.toolChangeParked = true;
      }
    }
    this.status.state = 'PAUSED';
    this.status.toolChangeReady = true;
    this.status.toolChangePhase = 'WAITING_FOR_TOOL';
    this.status.pauseRequested = false;
    const tool = this.status.toolChangeToolNumber >= 0 ? `T${this.status.toolChangeToolNumber}` : 'the requested tool';
    this.status.streamingPausedReason = `M6 tool change: install ${tool}, set Z zero, then confirm the change.`;
    return this.snapshot();
  }

  async start(request = {}) {
    this.assertControllerCommunication();
    if (this.isActive()) throw new Error('another job is already active');
    const job = JSON.parse(await this.sd.readText(request.jobPath));
    const active = getActiveRun(job);
    const execution = assertCanUseActiveRunForExecution(job, { requireArm: false });
    if (!execution.ok) throw new Error(execution.message);
    if (job.startAuthorizationToken !== 'AUTHORIZED') throw new Error('job JSON has no valid start authorization');
    if (active.path !== request.gcodePath) throw new Error('requested path is not the authorized active run path');
    if (request.activeRunMode && active.mode !== request.activeRunMode) throw new Error('active run mode changed after authorization');

    const text = await this.sd.readText(active.path);
    const bytes = Buffer.byteLength(text);
    const fingerprint = getActiveRunFingerprint(job);
    const actualHash = createHash('sha256').update(Buffer.from(text)).digest('hex');
    const identityMatches = active.sizeBytes === bytes && request.activeRunSizeBytes === bytes &&
      request.activeRunFingerprint === fingerprint && fingerprint === actualHash;
    const start = job.startAuthorization || {};
    const arm = job.arm || {};
    const verification = job.verificationDecision || {};
    if (!identityMatches || start.state !== 'authorized' || start.activeRunMode !== active.mode ||
        start.activeRunPath !== active.path || start.activeRunFingerprint !== fingerprint || start.activeRunSizeBytes !== bytes ||
        arm.state !== 'ARMED' || arm.activeRunMode !== active.mode || arm.activeRunPath !== active.path ||
        arm.activeRunFingerprint !== fingerprint || arm.activeRunSizeBytes !== bytes ||
        verification.result !== 'complete' || !['bounds', 'aircut', 'skipped'].includes(verification.type) ||
        verification.activeRunPath !== active.path || verification.activeRunFingerprint !== fingerprint ||
        verification.activeRunSizeBytes !== bytes) {
      throw new Error('requested file does not match the authorized active run identity');
    }
    if (job.activeWorkZeroId !== request.workZeroId || start.workZeroId !== request.workZeroId ||
        Number(start.homingEpoch || 0) !== Number(request.homingEpoch || 0) ||
        String(start.homingSessionId || '') !== String(request.homingSessionId || '')) {
      throw new Error('authorized work-zero or homing identity changed');
    }
    const startMode = request.startMode || job.startMode || 'use_active_work_zero';
    if (!['use_active_work_zero', 'use_manual_work_frame'].includes(startMode)) throw new Error('invalid start mode');
    if (startMode === 'use_manual_work_frame') {
      if (!this.frame?.manualWorkFrameValid || !this.frame?.workZeroValid || request.bootSessionId !== this.frame.bootSessionId) {
        throw new Error('manual work frame expired');
      }
    } else {
      const zero = this.frame?.workZeroMachine;
      if (!this.frame?.trusted || !zero || Number(request.homingEpoch) !== Number(this.frame.homingEpoch) ||
          !request.workZeroId || ['x', 'y', 'z'].some((axis) => Math.abs(Number(request[`workZeroMachine${axis.toUpperCase()}`]) - Number(zero[axis])) > 0.05)) {
        throw new Error('active work zero does not match the homed machine frame');
      }
    }
    const safeStartZ = this.assertProjectSafeZ(job, request.safeStartZ);
    const feed = Math.max(10, Math.min(200, Math.round(Number(job.feedOverride?.startPercent || 100))));
    this.status = {
      ...this.emptyStatus(), state: 'PREPARING', gcodePath: active.path, jobPath: request.jobPath,
      startMode, safeStartZ, allowedWorkspaceCommands: Boolean(job.allowedWorkspaceCommands),
      fileSize: bytes, feedOverridePercent: feed,
    };

    const preamble = ['M5', 'G21', 'G90', 'G54', `M220 S${feed}`, 'M400', 'M114'];
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

  async startTestMotion(request = {}) {
    this.assertControllerCommunication();
    if (this.isActive()) throw new Error('another job is already active');
    const mode = String(request.mode || '');
    const path = String(request.path || '');
    const safeZ = Number(request.safeZ);
    if (!['aircut', 'toolless', 'bounds'].includes(mode)) throw new Error('test motion mode must be aircut, toolless, or bounds');
    if (!path.startsWith('/jobs/generated/')) throw new Error('test motion path must be under /jobs/generated');
    const job = JSON.parse(await this.sd.readText(request.jobPath));
    this.assertProjectSafeZ(job, safeZ);

    let startX = null;
    let startY = null;
    let startZ = null;
    if (mode === 'bounds') {
      const pos = request.startPosition;
      if (!pos || typeof pos !== 'object') {
        throw new Error('bounds startPosition (x, y, z) is required and must be finite');
      }
      const px = pos.x;
      const py = pos.y;
      const pz = pos.z;
      if (px === null || px === undefined || py === null || py === undefined || pz === null || pz === undefined) {
        throw new Error('bounds startPosition (x, y, z) is required and must be finite');
      }
      startX = Number(px);
      startY = Number(py);
      startZ = Number(pz);
      if (!Number.isFinite(startX) || !Number.isFinite(startY) || !Number.isFinite(startZ)) {
        throw new Error('bounds startPosition (x, y, z) is required and must be finite');
      }
    }

    const text = await this.sd.readText(path);
    const commands = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
    if (!commands.length || commands.length > 20000 || commands[0].toUpperCase() !== 'M5' ||
        commands.at(-1).toUpperCase() !== 'M400') {
      throw new Error('test motion file must start with M5, contain motion, and end with M400');
    }
    const allowedExact = new Set(['M5', 'M400', 'G21', 'G90', 'G54']);
    let hasMotion = false;
    for (const command of commands) {
      const upper = command.toUpperCase();
      if (allowedExact.has(upper)) continue;
      const words = upper.split(/\s+/);
      const code = words[0];
      if (!['G0', 'G1', 'G2', 'G3'].includes(code)) throw new Error(`test motion contains forbidden or unsupported command: ${code}`);
      hasMotion = true;
      const allowedLetters = new Set(code === 'G2' || code === 'G3' ? ['X', 'Y', 'Z', 'I', 'J', 'R', 'F'] : ['X', 'Y', 'Z', 'F']);
      if (words.slice(1).some((word) => !allowedLetters.has(word[0]) || !Number.isFinite(Number(word.slice(1))))) {
        throw new Error('test motion contains unsupported word');
      }
      if (mode === 'aircut') {
        const zWord = words.find((word) => word.startsWith('Z'));
        if (zWord && Math.abs(Number(zWord.slice(1)) - safeZ) > 0.01) throw new Error('aircut Z command differs from configured Safe Z');
      }
    }
    if (!hasMotion) throw new Error('test motion file must contain motion');

    if (mode === 'bounds') {
      let g21Seen = false;
      let g90Seen = false;
      let g54Seen = false;
      let firstMotionSeen = false;
      let returnXySeen = false;
      let m400BeforeZRestorationSeen = false;
      let startZRestored = false;
      let finalM400Seen = false;

      for (const command of commands) {
        if (finalM400Seen) {
          throw new Error('bounds file contains additional commands after final M400');
        }
        const upper = command.split(';')[0].trim().toUpperCase();
        if (!upper) continue;

        if (upper === 'G21') g21Seen = true;
        else if (upper === 'G90') g90Seen = true;
        else if (upper === 'G54') g54Seen = true;

        const words = upper.split(/\s+/);
        const code = words[0];
        if (['G0', 'G1', 'G2', 'G3'].includes(code)) {
          if (!g21Seen || !g90Seen || !g54Seen) {
            throw new Error('bounds motion requires G21, G90, and G54 established before motion');
          }

          const getWord = (char) => {
            const w = words.find((item) => item.startsWith(char));
            return w && Number.isFinite(Number(w.slice(1))) ? Number(w.slice(1)) : null;
          };

          const valX = getWord('X');
          const valY = getWord('Y');
          const valZ = getWord('Z');

          const hasX = valX !== null;
          const hasY = valY !== null;
          const hasZ = valZ !== null;

          if (!firstMotionSeen) {
            if (code !== 'G0' || !hasZ || hasX || hasY || Math.abs(valZ - safeZ) > 0.001) {
              throw new Error(`first bounds motion must be Safe Z lift G0 Z${safeZ} without XY movement`);
            }
            firstMotionSeen = true;
            continue;
          }

          if (startZRestored) {
            throw new Error('bounds file contains motion after start Z restoration');
          }

          if (m400BeforeZRestorationSeen) {
            if (!hasZ || hasX || hasY || Math.abs(valZ - startZ) > 0.001) {
              throw new Error(`bounds Z restoration command must be G0 Z${startZ} without XY movement`);
            }
            startZRestored = true;
            continue;
          }

          if (hasZ && valZ < safeZ - 0.001) {
            throw new Error('bounds motion Z descends below Safe Z before start position restoration');
          }

          if (hasX && hasY && Math.abs(valX - startX) <= 0.001 && Math.abs(valY - startY) <= 0.001) {
            returnXySeen = true;
          }
        } else if (upper === 'M400') {
          if (startZRestored) {
            finalM400Seen = true;
          } else if (returnXySeen) {
            m400BeforeZRestorationSeen = true;
          }
        }
      }

      if (!firstMotionSeen) throw new Error('bounds file must contain initial Safe Z lift motion');
      if (!returnXySeen) throw new Error('bounds file must return to start X/Y before Z restoration');
      if (!m400BeforeZRestorationSeen) throw new Error('bounds file must separate return X/Y motion and Z restoration with M400');
      if (!startZRestored) throw new Error('bounds file must restore starting Z position');
      if (!finalM400Seen) throw new Error('bounds file must end with M400');
    }

    this.status = {
      ...this.emptyStatus(), state: 'RUNNING', gcodePath: path, startMode: 'validated_test_motion',
      streamMode: mode, safeStartZ: safeZ, fileSize: Buffer.byteLength(text),
    };
    const token = ++this.runToken;
    this.stream(text, token, false);
    return this.snapshot();
  }

  async startProductionResume(request = {}) {
    this.assertControllerCommunication();
    if (this.isActive()) throw new Error('another job or motion stream is already active');
    const path = String(request.path || '');
    if (!path.startsWith('/jobs/generated/') || !path.endsWith('.production-resume.gc')) {
      throw new Error('Production Resume path must be a generated .production-resume.gc file');
    }
    const job = JSON.parse(await this.sd.readText(request.jobPath));
    this.assertProjectSafeZ(job, request.safeZ);
    const event = [...(job.recoveryHistory || [])].reverse().find((item) => item.id === request.eventId);
    const authorization = job.productionResumeAuthorization;
    if (!event || event.type !== 'production-resume' || event.state !== 'started' ||
        event.runId !== request.interruptedRunId || event.activeRunPath !== request.activeRunPath ||
        event.activeRunMode !== request.activeRunMode || !event.phase1CompletedAt ||
        !event.manualRouterConfirmedAt || event.streamPath !== path) {
      throw new Error('Production Resume metadata no longer matches the prepared recovery');
    }
    if (!authorization?.authorized || authorization.eventId !== request.eventId ||
        authorization.interruptedRunId !== request.interruptedRunId ||
        authorization.activeRunPath !== request.activeRunPath ||
        authorization.activeRunMode !== request.activeRunMode || authorization.streamPath !== path) {
      throw new Error('Production Resume authorization is missing or stale');
    }
    if (request.activeRunFingerprint && event.activeRunFingerprint !== request.activeRunFingerprint) {
      throw new Error('Production Resume active run fingerprint changed');
    }

    const text = await this.sd.readText(path);
    const streamSizeBytes = Buffer.byteLength(text);
    const streamFingerprint = createHash('sha256').update(Buffer.from(text)).digest('hex');
    if (authorization.streamSizeBytes !== streamSizeBytes || request.streamSizeBytes !== streamSizeBytes ||
        authorization.streamFingerprint !== streamFingerprint || request.streamFingerprint !== streamFingerprint) {
      throw new Error('Production Resume stream identity changed after authorization');
    }
    const commands = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
    if (commands.length < 5 || commands.length > 20000 ||
        commands[0].toUpperCase() !== 'G21' || commands[1].toUpperCase() !== 'G90' ||
        commands[2].toUpperCase() !== 'G54' || commands.at(-1).toUpperCase() !== 'M400') {
      throw new Error('Production Resume must start G21/G90/G54, contain cutting motion, and end M400');
    }
    const exact = new Set(['G21', 'G90', 'G54', 'M400']);
    let hasCuttingMove = false;
    for (const command of commands) {
      const upper = command.toUpperCase();
      if (exact.has(upper)) continue;
      const words = upper.split(/\s+/);
      const code = words[0];
      if (!['G0', 'G1', 'G2', 'G3'].includes(code)) throw new Error(`Production Resume contains forbidden or unsupported command: ${code}`);
      hasCuttingMove ||= ['G1', 'G2', 'G3'].includes(code);
      const allowed = new Set(code === 'G2' || code === 'G3' ? ['X', 'Y', 'Z', 'I', 'J', 'R', 'F'] : ['X', 'Y', 'Z', 'F']);
      for (const word of words.slice(1)) {
        const value = Number(word.slice(1));
        if (!allowed.has(word[0]) || !Number.isFinite(value)) throw new Error('Production Resume contains unsupported word');
        if (word[0] === 'X' && (value < 0 || value > 1625)) throw new Error('Production Resume X is outside configured limits');
        if (word[0] === 'Y' && (value < 0 || value > 5800)) throw new Error('Production Resume Y is outside configured limits');
        if (word[0] === 'Z' && (value < -30 || value > 70)) throw new Error('Production Resume Z is outside configured limits');
      }
    }
    if (!hasCuttingMove) throw new Error('Production Resume file must contain cutting motion');

    const feed = Math.max(10, Math.min(200, Math.round(Number(job.feedOverride?.startPercent || 100))));
    if (this.simulateFeedOverrideError) {
      this.jobRunning = false;
      this.status = this.emptyStatus();
      throw new Error(`Production Resume failed during preamble M220 feed override (M220 S${feed}): ${this.simulateFeedOverrideError}`);
    }
    this.status = {
      ...this.emptyStatus(), state: 'RUNNING', gcodePath: path, jobPath: request.jobPath,
      startMode: 'prepared_production_resume', streamMode: 'production-resume',
      fileSize: Buffer.byteLength(text), feedOverridePercent: feed,
    };
    this.setFeedOverride(feed, { allowDuringTransition: true });
    const token = ++this.runToken;
    this.stream(text, token, Boolean(job.feedOverride?.resetTo100AfterJob ?? true));
    return this.snapshot();
  }

  async stream(text, token, resetFeed) {
    const rawLines = String(text).match(/[^\r\n]*(?:\r?\n|$)/g) || [];
    let offset = 0;
    let commandLineNumber = 0;
    for (let index = 0; index < rawLines.length; index += 1) {
      const lineWithTerminator = rawLines[index];
      if (lineWithTerminator === '' && index === rawLines.length - 1) continue;

      if (token !== this.runToken || this.status.stopRequested) return;
      while (this.status.state === 'PAUSED_INTACT' || this.status.state === 'PAUSED' || this.status.state === 'PAUSING') {
        if (token !== this.runToken || this.status.stopRequested) return;
        await sleep(5);
      }
      if (this.status.state !== 'RUNNING' && this.status.state !== 'RESUMING') return;

      const lineBytes = Buffer.byteLength(lineWithTerminator);
      offset += lineBytes;
      this.status.currentByteOffset = Math.min(offset, this.status.fileSize);

      const command = cleanLine(lineWithTerminator);
      if (!command) {
        this.status.lastAcknowledgedByteOffset = this.status.currentByteOffset;
        this.status.progressPercent = this.status.fileSize ? this.status.lastAcknowledgedByteOffset * 100 / this.status.fileSize : 0;
        continue;
      }

      commandLineNumber += 1;
      this.status.currentLineNumber = commandLineNumber;

      const workspace = command.toUpperCase().match(/\bG5(?:4|5|6|7|8|9(?:\.[123])?)\b/)?.[0];
      if (workspace && workspace !== 'G54' && !this.status.allowedWorkspaceCommands) {
        this.fail('Non-default workspace command found. This may conflict with captured work zero.');
        return;
      }

      if (isM6(command)) {
        this.status.lastCommand = command;
        this.handleToolChange(command);
        continue;
      }
      if (isStandaloneToolSelect(command)) {
        this.status.selectedToolNumber = toolNumberFromCommand(command) ?? -1;
        this.status.lastCommand = command;
        this.status.lastAcknowledgedByteOffset = this.status.currentByteOffset;
        this.status.lastAcknowledgedLineNumber = this.status.currentLineNumber;
        this.status.progressPercent = this.status.fileSize ? this.status.lastAcknowledgedByteOffset * 100 / this.status.fileSize : 0;
        continue;
      }
      const result = this.runCommand(command);
      this.status.sentLineCount += 1;
      if (!result.ok) {
        this.fail(result.error);
        return;
      }
      this.status.acknowledgedLineCount += 1;
      this.status.lastAcknowledgedByteOffset = this.status.currentByteOffset;
      this.status.lastAcknowledgedLineNumber = this.status.currentLineNumber;
      this.status.progressPercent = this.status.fileSize ? this.status.lastAcknowledgedByteOffset * 100 / this.status.fileSize : 0;
      if (this.lineDelayMs) await sleep(this.lineDelayMs);
    }
    if (token !== this.runToken) return;
    this.status.currentByteOffset = this.status.fileSize;
    this.status.lastAcknowledgedByteOffset = this.status.fileSize;
    this.status.lastAcknowledgedLineNumber = this.status.currentLineNumber;
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
    if (this.simulateP000Failure) {
      this.status.state = 'ERROR';
      this.status.errorCode = 'COMMUNICATION_LOST';
      this.status.communicationLostAtMs = Date.now();
      this.status.communicationLostCommand = 'P000';
      this.status.lastError = 'P000 realtime pause rejected: UART write failed';
      this.status.pauseRequested = false;
      this.status.directResumeValid = false;
      this.status.pauseRealtimeHold = false;
      this.status.streamingPausedReason = '';
      this.status.communicationLostWorkPositionValid = true;
      this.status.communicationLostMachinePositionValid = true;
      throw new Error(this.status.lastError);
    }
    this.status.state = 'PAUSING';
    this.status.pauseRequested = true;
    this.status.directResumeValid = true;
    this.status.cutterState = 'running_assumed';
    if (this.realtimeHold) {
      this.runCommand('P000', { priority: true });
      this.status.pauseMode = 'realtime';
      this.status.realtimeHoldActive = true;
    } else {
      this.status.pauseMode = 'boundary';
      this.status.streamingPausedReason = 'Pause pending at the next safely resumable command boundary; cutter remains running.';
      this.runCommand('M400', { priority: true });
    }
    this.status.state = 'PAUSED_INTACT';
    this.status.pauseRequested = false;
    this.status.streamingPausedReason = 'Motion held — cutter remains running. Direct Resume is valid until any manual movement.';
    return this.snapshot(this.realtimeHold
      ? 'Realtime hold requested with P000. Motion held — cutter remains running.'
      : 'Current command boundary reached. Motion held — cutter remains running.');
  }

  resume() {
    if (this.status.state === 'PAUSED' && this.status.toolChangePending) {
      throw new Error('complete the pending tool change before resuming');
    }
    if (this.status.state !== 'PAUSED_INTACT' || !this.status.directResumeValid) {
      throw new Error('direct Resume is unavailable; review Recovery');
    }
    if (this.simulateR000Failure) {
      this.status.lastError = 'R000 realtime resume rejected: UART write failed';
      throw new Error(this.status.lastError);
    }
    this.status.state = 'RESUMING';
    if (this.status.realtimeHoldActive) this.runCommand('R000', { priority: true });
    this.status.pauseRequested = false;
    this.status.streamingPausedReason = '';
    this.status.realtimeHoldActive = false;
    this.status.directResumeValid = false;
    this.status.pauseMode = 'none';
    this.status.state = 'RUNNING';
    return this.snapshot('Resume requested.');
  }

  interruptForManualMotion() {
    if (this.status.state === 'RECOVERY_REQUIRED') {
      return this.snapshot('Direct Resume is invalid. Manual movement may proceed through Recovery.');
    }
    if (this.status.state !== 'PAUSED_INTACT') throw new Error('job is not in PAUSED_INTACT');
    const accepted = this.stop({ manualMovement: true });
    return { ...accepted, message: 'Direct Resume invalidated. Wait for RECOVERY_REQUIRED before manual movement.' };
  }

  markToolChangeZZero(method = 'manual') {
    if (this.status.state === 'PAUSED' && this.status.toolChangePending && this.status.toolChangeReady) {
      this.status.toolChangeZZeroCompleted = true;
      this.status.toolChangeZZeroMethod = method === 'touchplate' ? 'touchplate' : 'manual';
      this.status.toolChangePhase = 'READY_TO_CONTINUE';
    }
  }

  completeToolChange({ confirmed = false, routerReady = false } = {}) {
    if (this.status.state !== 'PAUSED' || !this.status.toolChangePending || !this.status.toolChangeReady) {
      throw new Error('no completed M6 stop is waiting for confirmation');
    }
    if (!confirmed) throw new Error('confirmed true is required after the tool has been installed');
    if (!routerReady) throw new Error('routerReady true is required after verifying the router or spindle state');
    if (!this.status.toolChangeZZeroCompleted) throw new Error('set Z zero manually or with the configured touch plate before continuing');
    if (this.status.toolChangeHandling === 'park') {
      const target = this.status.toolChangeReturnPosition;
      if (!target || !this.frame.absoluteFromHome) throw new Error('the pre-park return position is unavailable');
      const settings = this.toolChangeSettings;
      const commands = [
        'G21', 'G90', `G53 G0 Z${Number(settings.parkMachineZ).toFixed(3)} F400`, 'M400', 'G54',
        `G0 X${target.x.toFixed(3)} Y${target.y.toFixed(3)} F3000`, 'M400',
        `G0 Z${target.z.toFixed(3)} F400`, 'M400', 'M114',
      ];
      for (const command of commands) {
        const result = this.runCommand(command, { priority: true, allowMachineCoordinates: true });
        if (!result.ok) throw new Error(result.error);
      }
    }
    this.status.activeToolNumber = this.status.toolChangeToolNumber;
    this.status.toolChangeToolConfirmed = true;
    this.status.toolChangeRouterReadyConfirmed = true;
    this.status.toolChangePhase = 'RESUMING';
    this.status.toolChangePending = false;
    this.status.toolChangeReady = false;
    this.status.pauseRequested = false;
    this.status.streamingPausedReason = '';
    this.status.lastAcknowledgedByteOffset = this.status.currentByteOffset;
    this.status.lastAcknowledgedLineNumber = this.status.currentLineNumber;
    this.status.progressPercent = this.status.fileSize ? this.status.lastAcknowledgedByteOffset * 100 / this.status.fileSize : 0;
    this.status.state = 'RUNNING';
    this.status.toolChangePhase = 'NONE';
    this.status.toolChangeParked = false;
    this.status.toolChangeToolConfirmed = false;
    this.status.toolChangeRouterReadyConfirmed = false;
    this.status.toolChangeZZeroCompleted = false;
    return this.snapshot('Tool change confirmed. Resume requested.');
  }

  stop({ manualMovement = false } = {}) {
    if (!this.isActive()) throw new Error('job is not active');
    this.status.state = 'STOPPING';
    this.status.stopRequested = true;
    this.status.pauseRequested = false;
    this.status.directResumeValid = false;
    this.status.recoveryRequired = true;
    this.status.toolChangePending = false;
    this.status.toolChangeReady = false;
    this.status.toolChangeZZeroCompleted = false;
    this.status.toolChangeParked = false;
    this.status.toolChangeToolConfirmed = false;
    this.status.toolChangeRouterReadyConfirmed = false;
    this.status.toolChangePhase = 'NONE';
    this.status.streamingPausedReason = 'Stop now requested. M410 quickstop was sent; M5 output shutdown will follow. Position is untrusted until Home All.';
    this.runToken += 1;
    Object.assign(this.frame, {
      machine: null, work: { x: 0, y: 0, z: 0 }, positionValid: false, workZeroMachine: null,
      homedAxes: { x: false, y: false, z: false }, absoluteFromHome: false,
      manualWorkFrameValid: false, workZeroValid: false, frameMode: 'untrusted',
      homeReference: null, trusted: false, revision: Number(this.frame.revision || 0) + 1,
    });
    const accepted = this.snapshot('Stop now requested. Position and recovery must be verified after M410 quickstop.');
    queueMicrotask(() => {
      for (const command of ['M410', 'M5']) {
        this.status.priorityCommandInProgress = true;
        const result = this.runCommand(command, { priority: true });
        this.status.priorityCommandInProgress = false;
        if (!result.ok) {
          this.status.state = 'ERROR';
          this.status.lastPriorityError = result.error || `Priority command failed: ${command}`;
          this.status.lastError = this.status.lastPriorityError;
          this.status.streamingPausedReason = this.status.lastError;
          return;
        }
      }
      this.status.state = manualMovement ? 'RECOVERY_REQUIRED' : 'STOPPED';
      this.status.stopRequested = false;
      this.status.streamingPausedReason = manualMovement
        ? 'Manual movement invalidated direct Resume. Review Recovery before continuing.'
        : 'Stopped now with M410 quickstop. Home All and verify recovery before further motion.';
    });
    return accepted;
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
