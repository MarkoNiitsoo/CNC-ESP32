import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const telemetry = await readFile(new URL('../../www/telemetry.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../../www/app.js', import.meta.url), 'utf8');
const machineBar = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');
const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const htmlFiles = await Promise.all(['index.html', 'files.html', 'preview.html'].map((name) =>
  readFile(new URL(`../../www/${name}`, import.meta.url), 'utf8')));

describe('shared browser telemetry', () => {
  it('deduplicates in-flight requests and uses low idle rates', () => {
    expect(telemetry).toContain('if (inFlight.has(name)) return inFlight.get(name)');
    expect(telemetry).toContain("health: { url: '/api/health', idleMs: 30000");
    expect(telemetry).toContain("job: { url: '/api/job/status', idleMs: 10000, activeMs: 1000");
  });

  it('keeps log and jog channels demand-driven', () => {
    expect(telemetry).toContain("log: { url: '/api/marlin/log'");
    expect(telemetry).toContain('always: false');
    expect(app).toContain("setDemand('log', 'app-log-view'");
    expect(machineBar).toContain("setDemand('log', 'machine-drawer'");
    expect(machineBar).toContain("setDemand('jog', 'machine-drawer'");
    expect(telemetry).toContain("`${config.url}?after=${logCursor}`");
    expect(telemetry).toContain("socket.send(JSON.stringify({ subscribe: { log: isWanted('log') } }))");
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

  it('uses revisioned WebSocket deltas with HTTP fallback', () => {
    expect(telemetry).toContain('new WebSocket(`ws://${location.hostname}:81/`)');
    expect(telemetry).toContain("message.type === 'snapshot'");
    expect(telemetry).toContain("message.type === 'delta'");
    expect(telemetry).toContain("message.channel === 'position'");
    expect(telemetry).toContain("message.channel === 'motion'");
    expect(telemetry).toContain("emit('position', message.data.position)");
    expect(telemetry).toContain('Number(message.revision) <= lastRevision');
    expect(telemetry).toMatch(/socketConnected[\s\S]*name === 'job' \|\| name === 'jog'/);
    expect(telemetry).toContain("schedule('job')");
    expect(preview).toContain("subscribe('motion', handleMotionTelemetry)");
    expect(preview).toContain('requestAnimationFrame(frame)');
    expect(preview).toContain('commandedPositionAtCommand');
  });
});
