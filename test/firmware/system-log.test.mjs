import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const firmware = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');

describe('SD system diagnostics log', () => {
  it('writes bounded boot and network milestones without using the Marlin UART', () => {
    expect(firmware).toContain('kSdSystemLogPath = "/logs/system.log"');
    expect(firmware).toContain('kMaxSystemLogBytes = 128 * 1024');
    expect(firmware).toContain('kSdSystemLogPreviousPath = "/logs/system.previous.log"');
    expect(firmware).toContain('resetReasonName(esp_reset_reason())');
    expect(firmware).toContain('Persistent job checkpoint load starting');
    expect(firmware).toContain('SPIFFS mount starting');
    expect(firmware).toContain('WiFi setup starting');
    expect(firmware).toContain('mDNS setup starting');
    expect(firmware).toContain('HTTP server started port=80');
    expect(firmware).toContain('BOOT complete bluetooth=');
    expect(firmware).toContain('UART0 is reserved for Marlin');
  });

  it('logs every HTTP route while coalescing immediate identical polling requests', () => {
    expect(firmware).toContain('kRepeatedHttpLogIntervalMs = 5000');
    expect(firmware).toContain('void logHttpRequest()');
    expect(firmware).toContain('server.client().remoteIP().toString()');
    expect(firmware).toContain('void httpRoute(');
    expect(firmware).toContain('httpRoute("/api/health", HTTP_GET, handleHealth)');
    expect(firmware).toContain('logHttpRequest(); if (requireOperatorControl()) handleUploadComplete();');
    expect(firmware).toMatch(/void handleNotFound\(\) \{\s+logHttpRequest\(\)/);
    expect(firmware).not.toMatch(/logSystemEvent\([^\n]*(Cookie|pin|password)/i);
  });

  it('documents the unavoidable no-card logging boundary', () => {
    expect(firmware).toMatch(/void logSystemEvent[\s\S]*if \(!sdMounted\) return;/);
    expect(firmware).toContain('SD mounted type=');
  });
});
