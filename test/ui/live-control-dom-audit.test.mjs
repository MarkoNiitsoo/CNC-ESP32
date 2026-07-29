import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const [indexHtml, previewHtml, appCode, previewCode, machineBarCode] = await Promise.all([
  readFile(new URL('../../www/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../../www/preview.html', import.meta.url), 'utf8'),
  readFile(new URL('../../www/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../../www/preview.js', import.meta.url), 'utf8'),
  readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8'),
]);

function selectorBindings(code) {
  const bindings = new Map();
  for (const match of code.matchAll(/const\s+(\w+)\s*=\s*document\.querySelector\('([^']+)'\)/g)) {
    bindings.set(match[1], match[2]);
  }
  for (const match of code.matchAll(/const\s+(\w+)\s*=\s*\[\.\.\.document\.querySelectorAll\('([^']+)'\)\]/g)) {
    bindings.set(match[1], match[2]);
  }
  return bindings;
}

function tagsForSelector(html, selector) {
  const tags = html.match(/<(?:button|input|select)\b[^>]*>/gi) || [];
  if (selector.startsWith('#')) {
    const id = selector.slice(1);
    return tags.filter((tag) => new RegExp(`\\bid=["']${id}["']`).test(tag));
  }
  const data = selector.match(/^\[([a-z0-9-]+)\]$/i)?.[1];
  return data ? tags.filter((tag) => new RegExp(`\\b${data}(?:\\s|=|>)`, 'i').test(`${tag}>`)) : [];
}

function boundMachineMutationSelectors(code, handlerTokens) {
  const bindings = selectorBindings(code);
  const selectors = new Set();
  for (const [variable, selector] of bindings) {
    const eventPattern = new RegExp(`${variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\??\\.addEventListener`, 'g');
    for (const match of code.matchAll(eventPattern)) {
      const lineEnd = code.indexOf('\n', match.index);
      const firstLine = code.slice(match.index, lineEnd < 0 ? code.length : lineEnd);
      const snippet = firstLine.trimEnd().endsWith('{')
        ? code.slice(match.index, match.index + 500)
        : firstLine;
      if (handlerTokens.some((token) => snippet.includes(token))) selectors.add(selector);
    }
    const holdPattern = new RegExp(`installCriticalHold\\(${variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},\\s*([\\w]+)`, 'g');
    for (const match of code.matchAll(holdPattern)) {
      if (handlerTokens.includes(match[1])) selectors.add(selector);
    }
  }
  return selectors;
}

function expectGuarded(html, selector) {
  let tags = tagsForSelector(html, selector);
  if (!tags.length && selector.startsWith('#')) {
    const id = selector.slice(1);
    const form = html.match(new RegExp(`<form\\b[^>]*\\bid=["']${id}["'][^>]*>[\\s\\S]*?<\\/form>`, 'i'))?.[0];
    if (form) tags = (form.match(/<button\b[^>]*type=["']submit["'][^>]*>/gi) || []);
  }
  expect(tags.length, `actual DOM control ${selector} should exist`).toBeGreaterThan(0);
  for (const tag of tags) {
    expect(
      /\bdata-requires-live-control(?:\s|=|>)/i.test(`${tag}>`)
        || /\bdata-safety-exception(?:\s|=|>)/i.test(`${tag}>`),
      `${selector} must be guarded or an explicit safety exception: ${tag}`,
    ).toBe(true);
  }
}

function selectorExists(html, selector) {
  if (tagsForSelector(html, selector).length) return true;
  if (!selector.startsWith('#')) return false;
  return new RegExp(`<form\\b[^>]*\\bid=["']${selector.slice(1)}["']`, 'i').test(html);
}

describe('actual machine-mutation DOM audit', () => {
  it('derives Preview mutation controls from their real handler bindings and audits actual HTML', () => {
    const mutationHandlers = [
      'setWorkZeroWithCapture', 'setZZeroWithCapture', 'probeTouchPlateZZero',
      'cnc-home-machine-request', 'restoreHistoryZero', 'runInterruptedWorkZeroRestore',
      'sendBoundingBoxTrace', 'sendAircutToolpath', 'sendSelectedDryRun',
      'runMotionOnlyRecoveryMove', 'startToollessResume', 'prepareProductionResume',
      'startProductionHold', 'setToolChangeManualZ', 'completeToolChange',
      'setLiveFeedOverride', 'reviewAndStartJobRun', 'pauseJobRun', 'resumeJobRun', 'stopJobRun',
      'dismissFirmwareRecoveryCheckpoint',
    ];
    const selectors = boundMachineMutationSelectors(previewCode, mutationHandlers);
    const actualSelectors = [...selectors].filter((selector) => selectorExists(previewHtml, selector));
    expect(actualSelectors.length).toBeGreaterThanOrEqual(20);
    for (const selector of actualSelectors) expectGuarded(previewHtml, selector);

    for (const selector of ['[data-feed-live]', '[data-feed-delta]']) expectGuarded(previewHtml, selector);
    expectGuarded(previewHtml, '#stop-job');
    expect(tagsForSelector(previewHtml, '#stop-job')[0]).toContain('data-safety-exception');
  });

  it('derives Index firmware/machine mutation controls from app bindings and audits actual HTML', () => {
    const mutationHandlers = [
      'saveDeviceSettings', 'restartDevice', 'loadMachineInfo', 'sendDiagnostic',
      'refreshMachineConfiguration', 'applyMachineGroup', 'saveToolChangeSettings',
    ];
    const selectors = boundMachineMutationSelectors(appCode, mutationHandlers);
    for (const selector of selectors) {
      if (selectorExists(indexHtml, selector)) expectGuarded(indexHtml, selector);
    }

    const machineForms = indexHtml.match(/<form\b[^>]*data-machine-group[^>]*>[\s\S]*?<\/form>/gi) || [];
    expect(machineForms).toHaveLength(4);
    machineForms.forEach((form) => {
      expect(form).toMatch(/<button\b[^>]*type="submit"[^>]*data-requires-live-control/);
    });
  });

  it('audits generated machine-bar handlers plus dynamic readiness/recovery controls', () => {
    const generated = machineBarCode.slice(
      machineBarCode.indexOf('root.innerHTML = `'),
      machineBarCode.indexOf('document.body.prepend(root)'),
    );
    const mutationHandlers = new Set([
      'pauseOrResumeJob', 'stopJob', 'restoreJogZ', 'refreshPosition',
      'setWorkZero', 'setZZero', 'touchPlateZZero', 'captureAndSetWorkZero',
      'captureAndSetZZero', 'home',
    ]);
    for (const match of machineBarCode.matchAll(/button\('([^']+)',\s*([A-Za-z]\w*)/g)) {
      if (!mutationHandlers.has(match[2])) continue;
      const tags = tagsForSelector(generated, `#${match[1]}`);
      expect(tags.length, `generated control #${match[1]} should exist`).toBe(1);
      expect(`${tags[0]}>`).toMatch(/data-requires-live-control|data-safety-exception/);
    }
    for (const selector of [
      '[data-mb-goto-zero]', '[data-mb-feed]', '[data-mb-feed-delta]',
      '[data-mb-jog-direction]', '#mb-jog-center', '#mb-jog-z-slider',
    ]) expectGuarded(generated, selector);

    expect(previewCode).toMatch(/function workflowButton[\s\S]*setAttribute\('data-requires-live-control'/);
    expect(previewCode).toMatch(/data-recovery-fix="home" data-requires-live-control/);
    expect(previewCode).toMatch(/data-recovery-fix="restore" data-requires-live-control/);
    expect(previewCode).toMatch(/class="restore-history-zero" data-requires-live-control/);
  });
});

describe('socket-authoritative command source audit', () => {
  it('permits authoritative machine-bar writes only in socket application/subscriber paths', () => {
    expect(machineBarCode).not.toMatch(/apiPost\([\s\S]{0,180}STATE\.(?:job|jog|position|frame|controller)\s*=/);
    expect(machineBarCode).not.toContain("publishPosition('M114')");
    expect(machineBarCode).not.toContain("publishPosition('JOG_CMD')");
    expect(machineBarCode).toMatch(/subscribe\('job'[\s\S]{0,80}STATE\.job = data/);
    expect(machineBarCode).toMatch(/subscribe\('jog'[\s\S]{0,80}STATE\.jog = data/);
    expect(machineBarCode).toMatch(/subscribe\('controller'[\s\S]{0,80}STATE\.controller = data/);
    expect(machineBarCode).toMatch(/subscribe\('machine'[\s\S]{0,120}applyMachineSlice\(data\)/);
  });

  it('keeps Preview live state on socket/event paths and uses bounded confirmations', () => {
    expect(previewCode).not.toMatch(/currentMachineFrame\s*=\s*data\.frame/);
    expect(previewCode).not.toMatch(/liveToolPosition\s*=\s*parseM114/);
    expect(previewCode).not.toMatch(/jobRunStatus\s*=\s*\{[\s\S]{0,160}START_REJECTED/);
    expect(previewCode).not.toContain('applyJobRunStatus(started)');
    expect(previewCode).toContain('waitForSocketSlice(');
    expect(previewCode).toContain('waitForMachineFrame(');
    expect(previewCode).toContain("description: 'Production Resume stream state'");
    expect(previewCode).toContain('test-motion stream state');
    expect(machineBarCode).toContain('Command accepted, but live-state confirmation timed out');
  });
});
