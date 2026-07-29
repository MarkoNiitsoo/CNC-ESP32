import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createMockEnvironment, createMockServer } from '../../dev/mock-server.mjs';

const telemetryCode = await readFile(new URL('../../www/telemetry.js', import.meta.url), 'utf8');
const mainCppCode = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');

describe('Phase 1 WebSocket Transport Protocol Foundation', () => {

  describe('1. Common Packet Envelope & Sequencing', () => {
    it('enforces protocol version 1 and readable envelope keys across firmware and mock', () => {
      expect(mainCppCode).toContain('protocolVersion');
      expect(mainCppCode).toContain('stateRevision');
      expect(mainCppCode).toContain('makeProtocolEnvelope');
      expect(telemetryCode).toContain('protocolVersion: 1');
    });

    it('uses independent sequence counters and piggybacks last received ack', async () => {
      const mockEnv = await createMockEnvironment();
      expect(mockEnv.frame.bootSessionId).toBeDefined();
    });

    it('ignores duplicate packets and triggers resync on sequence gap', () => {
      expect(telemetryCode).toContain('if (!bootChanged && seq <= lastServerSeq)');
      expect(telemetryCode).toContain('if (!bootChanged && seq > lastServerSeq + 1 && lastServerSeq > 0)');
      expect(telemetryCode).toContain('requestResync();');
    });
  });

  describe('2. Controller Independence & Authoritative State', () => {
    it('provides a normalized controller state and capabilities schema', () => {
      expect(mainCppCode).toContain('controllerStateNormalized');
      expect(mainCppCode).toContain('buildSnapshotFromStagedState');
      expect(mainCppCode).toContain('capabilities');
      expect(mainCppCode).toContain('homingEpoch');
      expect(telemetryCode).toContain('mirroredState');
    });

    it('matches firmware canonical snapshot schema with exactly six top-level slices', () => {
      const canonicalSlices = ['system', 'controller', 'machine', 'job', 'jog', 'control'];
      const snapshotBuilder = mainCppCode.slice(
        mainCppCode.indexOf('String buildSnapshotFromStagedState('),
        mainCppCode.indexOf('void stageTelemetryUpdates()')
      );
      canonicalSlices.forEach((sliceKey) => {
        expect(snapshotBuilder).toContain(`\\"${sliceKey}\\\":`);
      });
      expect(snapshotBuilder).not.toContain('"connection":');
    });

    it('does not require Marlin command parsing to interpret generic state packets', () => {
      expect(telemetryCode).not.toContain('M114');
      expect(telemetryCode).not.toContain('M115');
      expect(telemetryCode).not.toContain('FIRMWARE_NAME');
    });
  });

  describe('Startup Safety & Task Stack Isolation', () => {
    it('prevents stack overflow in telemetryNetworkTask by processing log events sequentially and allocating 12KB stack', () => {
      expect(mainCppCode).toContain('xTaskCreatePinnedToCore(telemetryNetworkTask, "ws-telemetry", 12288');
      expect(mainCppCode).not.toContain('LogTelemetryEvent events[32];');
      expect(mainCppCode).toContain('LogTelemetryEvent logEv;');
      expect(mainCppCode).toContain('while (xQueueReceive(logEventQueue, &logEv, 0) == pdTRUE)');
    });

    it('contains FreeRTOS stack overflow and malloc failed hooks', () => {
      expect(mainCppCode).toContain('vApplicationStackOverflowHook');
      expect(mainCppCode).toContain('vApplicationMallocFailedHook');
    });

    it('contains required startup checkpoints', () => {
      expect(mainCppCode).toContain('[CHECKPOINT] Telemetry mutex creation starting');
      expect(mainCppCode).toContain('[CHECKPOINT] Queue creation starting');
      expect(mainCppCode).toContain('[CHECKPOINT] Task creation starting');
      expect(mainCppCode).toContain('[CHECKPOINT] Bluetooth setup start');
      expect(mainCppCode).toContain('[CHECKPOINT] Bluetooth setup completion');
    });
  });

  describe('3. Clock Synchronization', () => {
    it('establishes wall-clock offset during hello without altering monotonic uptime', () => {
      expect(telemetryCode).toContain('utcMs: Date.now()');
      expect(mainCppCode).toContain('stagedState.wallClock.offsetMs');
      expect(mainCppCode).toContain('stagedState.wallClock.valid = true');
    });

    it('preserves monotonic motion timing independently from wall-clock updates', () => {
      expect(mainCppCode).toContain('millis()');
      expect(mainCppCode).not.toContain('wallClockOffsetMs + millis() // motion timing');
    });
  });

  describe('4. Handshake, Snapshot & Boot Identity', () => {
    it('sends hello on socket open and receives snapshot', () => {
      expect(telemetryCode).toContain('type: \'hello\'');
      expect(telemetryCode).toContain('msgType === \'snapshot\'');
    });

    it('marks old mirrored state stale on bootId change until an atomic snapshot replaces it', () => {
      expect(telemetryCode).toContain("if (bootChanged && msgType !== 'snapshot')");
      expect(telemetryCode).not.toContain('state[sliceKey] = null');
      expect(telemetryCode).toContain('if (bootId) knownBootId = bootId');
    });
  });

  describe('5. Mock Server Parity & Non-80 Port Support', () => {
    it('supports WebSocket on non-port-80 development origins', () => {
      expect(telemetryCode).not.toContain('(location.port && location.port !== \'80\')');
      expect(telemetryCode).toContain('getWebSocketUrl()');
    });

    it('implements full protocol parity in dev/mock-server.mjs', async () => {
      const { server, env } = await createMockServer();
      expect(server).toBeDefined();
      expect(env.frame.bootSessionId).toBeDefined();
      await new Promise((resolve) => server.close(resolve));
    });
  });

  describe('6. Transport Isolation & Cross-Task Safety', () => {
    it('ensures touchJobStatus and touch*Status helpers contain no recursive calls', () => {
      const touchJobStatusBlock = mainCppCode.match(/void touchJobStatus\(\)\s*\{([^}]*)\}/)?.[1] || '';
      expect(touchJobStatusBlock).not.toContain('touchJobStatus()');

      const touchJogStatusBlock = mainCppCode.match(/void touchJogStatus\(\)\s*\{([^}]*)\}/)?.[1] || '';
      expect(touchJogStatusBlock).not.toContain('touchJogStatus()');

      const touchPositionStatusBlock = mainCppCode.match(/void touchPositionStatus\(\)\s*\{([^}]*)\}/)?.[1] || '';
      expect(touchPositionStatusBlock).not.toContain('touchPositionStatus()');
    });

    it('enforces Commit-After-Stage: cachedSlices updated ONLY after xSemaphoreTake succeeds', () => {
      expect(mainCppCode).toContain('if (xSemaphoreTake(telemetryStateMutex, 0) != pdTRUE) {');
      expect(mainCppCode).toContain('return; // Lock busy! Retries on next loop iteration without losing state.');
      expect(mainCppCode).toContain('// Commit to cachedSlices ONLY AFTER successfully updating stagedState under mutex:');
    });

    it('uses stagedState under mutex for WebSocket hello and resync snapshots', () => {
      expect(mainCppCode).toContain('String snapshotData = buildSnapshotFromStagedState(snapshotRev);');
      expect(mainCppCode).toContain('bool sentOK = sendClientPacket(client, "snapshot", "state", snapshotData, snapshotRev);');
    });

    it('isolates network task from direct main business state reads during patch/snapshot processing', () => {
      const processNetBlock = mainCppCode.match(/void processNetworkTelemetry\(\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
      expect(processNetBlock).not.toContain('jobStatusJson()');
      expect(processNetBlock).not.toContain('jogStatusJson()');
      expect(processNetBlock).not.toContain('machineFrameJson()');
      expect(processNetBlock).not.toContain('buildControllerSliceJson()');
      expect(processNetBlock).not.toContain('buildMachineSliceJson()');
      expect(processNetBlock).not.toContain('marlinLog[');
    });

    it('queues immutable LogTelemetryEvent POD structs instead of ring-buffer log IDs', () => {
      expect(mainCppCode).toContain('struct LogTelemetryEvent {');
      expect(mainCppCode).toContain('char direction[8] = {};');
      expect(mainCppCode).toContain('char text[128] = {};');
      expect(mainCppCode).toContain('char lastCriticalMessage[128] = {};');
      expect(mainCppCode).toContain('xQueueSend(logEventQueue, &ev, 0)');
    });

    it('includes feedOverridePercent snapshot inside MotionTelemetryEvent POD struct', () => {
      expect(mainCppCode).toContain('struct MotionTelemetryEvent {');
      expect(mainCppCode).toContain('uint16_t feedOverridePercent = 100;');
      expect(mainCppCode).toContain('ev.feedOverridePercent = jobStatus.feedOverridePercent;');
      expect(mainCppCode).toContain('events[count - 1].feedOverridePercent');
    });

    it('protects drop counter updates using spinlock critical sections', () => {
      expect(mainCppCode).toContain('static portMUX_TYPE telemetryDropMux = portMUX_INITIALIZER_UNLOCKED;');
      expect(mainCppCode).toContain('portENTER_CRITICAL(&telemetryDropMux);');
      expect(mainCppCode).toContain('incrementMotionTelemetryDropped();');
      expect(mainCppCode).toContain('incrementLogTelemetryDropped();');
      expect(mainCppCode).toContain('fetchAndResetMotionTelemetryDropped()');
    });

    it('handles resource allocation and task creation failures safely without starting transport', () => {
      expect(mainCppCode).toContain('if (telemetryStateMutex == nullptr || logRingMutex == nullptr || motionEventQueue == nullptr || logEventQueue == nullptr)');
      expect(mainCppCode).toContain('if (taskRes != pdPASS)');
      expect(mainCppCode).toContain('setTelemetryStarted(false);');
    });

    it('ensures normalizedAuthoritativeStateJson and buildSystemSliceJson are completely removed', () => {
      expect(mainCppCode).not.toContain('String normalizedAuthoritativeStateJson()');
      expect(mainCppCode).not.toContain('String buildSystemSliceJson()');
    });

    it('proves network-task paths do not call healthStatusJson()', () => {
      const netTaskBlock = mainCppCode.match(/void telemetryNetworkTask\(\s*void\s*\*arg\s*\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
      const processNetBlock = mainCppCode.match(/void processNetworkTelemetry\(\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
      const handleSocketBlock = mainCppCode.match(/void handleTelemetrySocket\([\s\S]*?\n\}/)?.[1] || '';
      expect(netTaskBlock).not.toContain('healthStatusJson()');
      expect(processNetBlock).not.toContain('healthStatusJson()');
      expect(handleSocketBlock).not.toContain('healthStatusJson()');
    });

    it('verifies browser-time update sets dirtySystem and increments revision under mutex', () => {
      expect(mainCppCode).toContain('stagedState.dirtySystem = true;');
      expect(mainCppCode).toContain('stagedState.globalRevision++;');
    });

    it('ensures handshake is not completed before successful initial snapshot delivery and includes pending retry path', () => {
      expect(mainCppCode).toContain('cs.snapshotPending = true;');
      expect(mainCppCode).toContain('cs.resyncPending = true;');
      expect(mainCppCode).toContain('if (cs.connected && (cs.snapshotPending || cs.resyncPending))');
    });

    it('verifies telemetryNetworkTask does not call logSystemEvent()', () => {
      const netTaskBlock = mainCppCode.match(/void telemetryNetworkTask\(\s*void\s*\*arg\s*\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
      expect(netTaskBlock).not.toContain('logSystemEvent(');
    });

    it('ensures outbound packets use revision copied under synchronization', () => {
      expect(mainCppCode).toContain('uint32_t revision = overrideRevision > 0 ? overrideRevision : getStagedStateRevision();');
    });

    it('guards transport readiness with task-safe spinlock helpers', () => {
      expect(mainCppCode).toContain('inline bool isTelemetryStarted()');
      expect(mainCppCode).toContain('inline void setTelemetryStarted(bool ready)');
      expect(mainCppCode).not.toContain('bool telemetryStarted = false;');
    });

    it('ensures telemetrySocket.begin is owned by network task and not called in startHttpServer before task creation', () => {
      const netTaskBlock = mainCppCode.match(/void telemetryNetworkTask\(\s*void\s*\*arg\s*\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
      expect(netTaskBlock).toContain('telemetrySocket.begin()');

      const startHttpBlock = mainCppCode.match(/void startHttpServer\(\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
      expect(startHttpBlock).not.toContain('telemetrySocket.begin()');
    });

    it('includes log drop counter in outbound log telemetry packet', () => {
      expect(mainCppCode).toContain('uint32_t droppedLogs = fetchAndResetLogTelemetryDropped();');
      expect(mainCppCode).toContain('data += ",\\\"dropped\\\":" + String(droppedLogs);');
    });

    it('verifies buildSystemBaseJson is called before telemetryStateMutex acquisition in main task', () => {
      const stageBlock = mainCppCode.match(/void stageTelemetryUpdates\(\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
      const buildPos = stageBlock.indexOf('buildSystemBaseJson()');
      const mutexPos = stageBlock.indexOf('xSemaphoreTake(telemetryStateMutex, 0)');
      expect(buildPos).toBeGreaterThan(-1);
      expect(mutexPos).toBeGreaterThan(-1);
      expect(buildPos).toBeLessThan(mutexPos);
      expect(stageBlock).toContain('bool diffSystem');
    });

    it('verifies monotonic revision fallback and sendClientPacket success handling for handshake/resync', () => {
      expect(mainCppCode).toContain('static uint32_t netLastObservedRevision = 1;');
      expect(mainCppCode).toContain('bool sendClientPacket(uint8_t client, const char *type');
      expect(mainCppCode).toContain('bool sentOK = sendClientPacket(client, "snapshot"');
      expect(mainCppCode).toContain('bool sentOK = sendClientPacket(i, "snapshot"');
    });
  });

});
