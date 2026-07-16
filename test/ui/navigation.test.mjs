import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../../www/app.js', import.meta.url), 'utf8');

describe('files-first navigation', () => {
  it('redirects preview to Files when path is absent or cannot be opened', () => {
    expect(preview).toContain("window.location.replace('/#files')");
    expect(preview).toMatch(/if \(!filePath\)[\s\S]*redirectToFiles\(\)/);
    expect(preview).toMatch(/if \(!res\.ok\)[\s\S]*redirectToFiles\(filePath\)/);
    expect(preview).toMatch(/loadPreview\(\)[\s\S]*loadFirmwareRecoveryCheckpoint\(\)[\s\S]*redirectToFiles\(filePath\)/);
  });

  it('does not expose an empty Job section and clears stale file pointers', () => {
    expect(app).toMatch(/requested === 'job' && !currentJob \? 'files'/);
    expect(app).toMatch(/target === 'job' && !currentJob[\s\S]*replaceState\(null, '', '#files'\)/);
    expect(app).toMatch(/async function validateCurrentJobFile[\s\S]*saveCurrentJob\(null\)/);
    expect(app).not.toContain('<h2>No Current Job</h2>');
  });

  it('resolves the initial route before loading view data', () => {
    const initBlock = app.slice(
      app.indexOf('async function init()'),
      app.indexOf('async function ensureViewData('),
    );
    expect(app).toContain('async function resolveInitialView()');
    expect(app).toContain('const initialView = await resolveInitialView();');
    expect(app).toContain('showView(initialView);');
    expect(app).toContain('await ensureViewData(initialView);');
    expect(initBlock).toMatch(/resolveInitialView\(\)[\s\S]*showView\(initialView\)[\s\S]*ensureViewData\(initialView\)/);
    expect(initBlock).not.toContain('await loadFiles()');
    expect(initBlock).not.toContain('await loadJobMeta()');
    expect(initBlock).not.toContain('await refreshJobStatus()');
    expect(initBlock).not.toContain('await refreshHealth()');
  });

  it('keeps file and job fetching scoped to route activation instead of settings startup', () => {
    expect(app).toContain("if (!bootingInitialRoute && viewName === 'files')");
    expect(app).toContain("if (!bootingInitialRoute && viewName === 'job')");
    expect(app).toContain('async function ensureFilesViewData');
    expect(app).toContain('async function ensureJobViewData');
    expect(app).toContain("if (viewName === 'settings' && !machineSettingsLoaded)");
    expect(app).toContain("setDemand('health', 'app-view', viewName === 'settings')");
    expect(app).toContain("setDemand('job', 'app-view', viewName === 'job')");
    expect(app).toMatch(/if \(viewName === 'settings'\)[\s\S]*await refreshHealth\(\)/);
    expect(app).not.toContain("showView('files');\n  await loadFiles();\n  showView('settings');");
  });
});
