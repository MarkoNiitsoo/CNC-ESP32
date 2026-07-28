import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const telemetry = await readFile(new URL('../../www/telemetry.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../../www/app.js', import.meta.url), 'utf8');
const files = await readFile(new URL('../../www/files.js', import.meta.url), 'utf8');
const machineBar = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');
const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const firmware = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');
const htmlFiles = await Promise.all(['index.html', 'files.html', 'preview.html'].map((name) =>
  readFile(new URL(`../../www/${name}`, import.meta.url), 'utf8')));

describe('shared browser telemetry', () => {
  it('deduplicates in-flight requests and keeps low idle rates for demand-driven channels', () => {
    expect(telemetry).toContain('if (inFlight.has(name)) return inFlight.get(name)');
    expect(telemetry).toContain("health: { url: '/api/health', idleMs: 30000, activeMs: 30000, always: false }");
    expect(telemetry).toContain("job: { url: '/api/job/status', idleMs: 10000, activeMs: 1000, always: false }");
  });

  it('keeps telemetry demand-driven across app, machine bar, and preview', () => {
    expect(telemetry).toContain("log: { url: '/api/marlin/log'");
    expect(telemetry).toContain('always: false');
    expect(app).toContain("setDemand('health', 'app-view', viewName === 'settings')");
    expect(app).toContain("setDemand('job', 'app-view', viewName === 'job')");
    expect(app).toContain("setDemand('log', 'app-log-view'");
    expect(machineBar).toContain("setDemand('health', 'machine-drawer', STATE.drawerOpen)");
    expect(machineBar).toContain("setDemand('job', 'machine-drawer', STATE.drawerOpen)");
    expect(machineBar).toContain("setDemand('log', 'machine-drawer'");
    expect(machineBar).toContain("setDemand('jog', 'machine-drawer'");
    expect(preview).toContain("setDemand('job', 'preview-page', true)");
    expect(preview).toContain("setDemand('health', 'preview-page', true)");
    expect(telemetry).toContain("`${config.url}?after=${logCursor}`");
    expect(telemetry).toContain("subscribe: { log: isWanted('log') }");
    expect(telemetry).toContain('entries: [...byId.values()]');
  });

  it('loads one shared controller before page consumers', () => {
    for (const html of htmlFiles) {
      expect(html.indexOf('/telemetry.js')).toBeGreaterThan(-1);
      expect(html.indexOf('/telemetry.js')).toBeLessThan(html.indexOf('/machine-bar.js'));
    }
    expect(machineBar).toContain("subscribe('job'");
    expect(app).toContain("subscribe('job'");
    expect(preview).toContain("subscribe('job'");
    expect(preview).not.toMatch(/jobRunPollTimer = setInterval/);
  });

  it('does not auto-request health or job on telemetry start without demand', () => {
    const startBlock = telemetry.slice(
      telemetry.indexOf('function start()'),
      telemetry.indexOf("document.addEventListener('visibilitychange'"),
    );
    expect(startBlock).not.toContain("request('job')");
    expect(startBlock).not.toContain("request('health')");
    expect(startBlock).toContain('if (isWanted(name)) request(name).catch(() => {})');
  });

  it('opens the WebSocket only when a socket-capable demand exists', () => {
    expect(telemetry).toContain("function wantsSocket() {");
    expect(telemetry).toContain("return isWanted('job') || isWanted('jog') || isWanted('log');");
    expect(telemetry).toMatch(/function connectSocket\(\) \{[\s\S]*!wantsSocket\(\)/);
    expect(telemetry).toContain("if (started && wantsSocket()) connectSocket();");
    expect(telemetry).toContain("else if (started && !wantsSocket() && socket) socket.close();");
  });

  it('keeps the Files entrypoint free of unrelated telemetry demand at startup', () => {
    expect(files).toContain('loadPath(currentPath);');
    expect(files).not.toContain("setDemand('job'");
    expect(files).not.toContain("setDemand('health'");
    expect(files).not.toContain("request('job')");
    expect(files).not.toContain("request('health')");
  });

  it('uses revisioned WebSocket deltas with HTTP fallback', () => {
    expect(telemetry).toContain('getWebSocketUrl()');
    expect(telemetry).toContain("msgType === 'snapshot'");
    expect(telemetry).toContain("msgType === 'patch'");
    expect(telemetry).toContain("emit('position', message.data.position)");
    expect(telemetry).toContain('lastStateRevision');
    expect(telemetry).toMatch(/socketConnected[\s\S]*name === 'job' \|\| name === 'jog'/);
    expect(telemetry).toContain("schedule('job')");
    expect(preview).toContain("subscribe('motion', handleMotionTelemetry)");
    expect(preview).toContain('requestAnimationFrame(frame)');
    expect(preview).toContain('commandedPositionAtCommand');
  });

  it('keeps cutting independent from browser WebSocket delivery', () => {
    const producer = firmware.slice(firmware.indexOf('void stageTelemetryUpdates()'), firmware.indexOf('void handleTelemetrySocket('));
    expect(producer).not.toContain('telemetrySocket.broadcastTXT');
    expect(producer).not.toContain('telemetrySocket.sendTXT');
    expect(firmware).toContain('xSemaphoreTake(telemetryStateMutex, 0)');
    expect(firmware).toContain('xQueueSend(motionEventQueue, &ev, 0)');
    expect(firmware).toContain('xQueueSend(logEventQueue, &ev, 0)');
    expect(firmware).toContain('xTaskCreatePinnedToCore(telemetryNetworkTask');
    expect(telemetry).toMatch(/socketConnected[\s\S]*name === 'job' \|\| name === 'jog'/);
    expect(telemetry).toContain("schedule('job')");
    expect(telemetry).toContain('window.CncTelemetry = api;');
  });

  it('never stops a firmware-owned recovery stream when the browser is hidden', () => {
    const visibilityHandler = preview.slice(
      preview.indexOf("document.addEventListener('visibilitychange'"),
      preview.indexOf("addEventListener('cnc-motion-settings-change'"),
    );
    expect(visibilityHandler).not.toContain('cancelToollessResumeFromControl');
    expect(visibilityHandler).not.toContain('/api/job/stop');
    expect(visibilityHandler).toContain('must never issue motion control');
    expect(visibilityHandler).toContain('motionResyncPending = true');
    expect(visibilityHandler).toContain('stopMotionAnimation()');
  });

  it('drops stale telemetry but keeps legitimate long motion animation', () => {
    expect(preview).toContain('const MAX_MOTION_ANIMATION_AGE_MS = 1000');
    expect(preview).toMatch(/estimatedFirmwareUptimeMs\(\) - Number\(event\.sentAtMs\) > MAX_MOTION_ANIMATION_AGE_MS/);
    expect(preview).toContain('const MAX_MOTION_ANIMATION_SEGMENTS = 128');
    expect(preview).toContain('motionAnimationQueue.length <= MAX_MOTION_ANIMATION_SEGMENTS');
    expect(preview).not.toContain('duration > MAX_MOTION_ANIMATION_AGE_MS');
    expect(preview).toMatch(/if \(motionResyncPending\)[\s\S]*lastMotionSequence = Number\(data\.currentLineNumber\)[\s\S]*stopMotionAnimation\(\)/);
  });

  it('uses a recovery-specific command model for Production Resume animation', () => {
    expect(preview).toContain('let recoveryMotionSegments = null');
    expect(preview).toContain("jobRunStatus?.streamMode === 'production-resume'");
    expect(preview).toContain('initialPosition: productionResumePlan?.resumePoint');
    expect(preview).toContain('recoveryMotionSegments = toolpath.parseGCodeToToolpath');
  });

  it('animates Aircut from the exact one-pass commands sent to firmware', () => {
    expect(preview).toContain('function activeAnimationSegments()');
    expect(preview).toContain('activeTestMotion?.segments');
    expect(preview).toContain('jobRunStatus?.streamMode === activeTestMotion.mode');
    expect(preview).toContain("toolpath.parseGCodeToToolpath(`${commands.join('\\n')}\\n`");
    expect(preview).toContain('activeTestMotion = { mode, path, segments: animationModel.segments }');
    expect(preview).toContain('const streamSegments = activeAnimationSegments();');
    expect(preview).toMatch(/commandedPositionAtCommand\(\s*activeAnimationSegments\(\)/);
  });
});
