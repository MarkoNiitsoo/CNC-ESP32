import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const firmware = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');

describe('active and interrupted job file locks', () => {
  it('locks the stream, job JSON, bound active run, and their containing directories', () => {
    const helper = firmware.slice(
      firmware.indexOf('bool mutationPathTouchesLockedFile('),
      firmware.indexOf('void rejectLockedFileMutation('),
    );
    expect(helper).toContain('jobStatus.gcodePath');
    expect(helper).toContain('jobStatus.jobPath');
    expect(helper).toContain('jobStatus.authorizationActiveRunPath');
    expect(helper).toContain('recoveryCheckpointGcodePath');
    expect(helper).toContain('recoveryCheckpointJobPath');
    expect(helper).toContain('recoveryCheckpointActiveRunPath');
    expect(helper).toContain('locked.startsWith(normalized + "/")');
  });

  it('rejects upload, delete, and rename mutations while leaving unrelated files manageable', () => {
    const upload = firmware.slice(firmware.indexOf('void handleUploadData()'), firmware.indexOf('void handleDelete()'));
    const remove = firmware.slice(firmware.indexOf('void handleDelete()'), firmware.indexOf('void handleMkdir()'));
    const rename = firmware.slice(firmware.indexOf('void handleRename()'), firmware.indexOf('void handleCommand()'));
    expect(upload).toContain('mutationPathTouchesLockedFile(uploadTargetPath)');
    expect(remove).toContain('mutationPathTouchesLockedFile(path)');
    expect(rename).toContain('mutationPathTouchesLockedFile(from)');
    expect(rename).toContain('mutationPathTouchesLockedFile(to)');
    expect(firmware).toContain('sendJsonError(423');
  });

  it('never deletes a pre-existing target merely because an upload was aborted', () => {
    expect(firmware).toContain('bool uploadTargetOpened = false');
    expect(firmware).toMatch(/UPLOAD_FILE_ABORTED[\s\S]*if \(uploadTargetOpened && uploadTargetPath\.length\(\) > 0\)/);
  });
});
