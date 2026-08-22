import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const firmware = readFileSync(new URL('../../src/main.cpp', import.meta.url), 'utf8');

function blockBetween(startMarker, endMarker) {
  const start = firmware.indexOf(startMarker);
  expect(start, `missing ${startMarker}`).toBeGreaterThan(-1);
  const end = firmware.indexOf(endMarker, start);
  expect(end, `missing ${endMarker}`).toBeGreaterThan(-1);
  return firmware.slice(start, end);
}

describe('cooperative WS job.start (Phase 3D)', () => {
  it('dispatches job.start through the shared admission core with deferred completion', () => {
    const dispatch = blockBetween('void processWsCommandQueue()', 'bool telemetryHasLogSubscriber()');
    expect(dispatch).toContain('strcmp(entry.action, "job.start") == 0');
    expect(dispatch).toContain('admitJobStart(String(entry.payloadJson), &entry)');
    expect(dispatch).toContain('completionDeferred = result.ok;');
  });

  it('keeps the HTTP route on the same admission core', () => {
    const handler = blockBetween('void handleJobStart() {', 'MachineOperationResult performJobPause() {');
    expect(handler).toContain('admitJobStart(server.hasArg("plain") ? server.arg("plain") : "", nullptr)');
    expect(handler).toContain('sendJsonError(result.httpStatus, result.message)');
    expect(handler).toContain('server.send(200, "application/json", jobStatusJson())');
    expect(firmware).toContain('operatorRoute("/api/job/start", HTTP_POST, handleJobStart)');
  });

  it('preserves the full validation contract in the shared core', () => {
    const core = blockBetween(
      'MachineOperationResult admitJobStart(const String &body, const WsCommandEntry *entry) {',
      'void handleJobStart() {');
    for (const marker of [
      'ensureControllerCommunicationActive',
      'SD card is not mounted',
      'another job is already active',
      'machineOperationActive()',
      'use_manual_work_frame',
      'requestedBootSessionId != bootSessionId',
      'machineFrame.homingEpoch',
      'machineFrame.workZeroMachineX) > 0.05f',
      'validateSafeWorkZ(safeStartZ, true',
      'isPathUnderRoot(gcodePath, "/gcode")',
      'SD_MMC.exists(gcodePath)',
      'loadJobExecutionAuthorization',
      'loadProjectSafeZ',
      'validateJobExecutionAuthorization',
      'jobStatus.state = JobRunnerState::Preparing',
      'jobStatus.authorizationActiveRunPath = gcodePath',
      'jobStatus.resetFeedOverrideAfterJob = authorization.resetFeedAfterJob',
    ]) {
      expect(core).toContain(marker);
    }
  });

  it('enforces checkpoint-before-motion and fails terminally without a checkpoint', () => {
    const core = blockBetween(
      'MachineOperationResult admitJobStart(const String &body, const WsCommandEntry *entry) {',
      'void handleJobStart() {');
    const checkpoint = core.indexOf('beginPersistentJobCheckpoint()');
    const preamble = core.indexOf('runJobStartPreamble(');
    expect(checkpoint).toBeGreaterThan(-1);
    expect(preamble).toBeGreaterThan(checkpoint);
    // A checkpoint failure errors the job terminally and never enqueues motion.
    expect(core).toContain('setJobError("could not persist the active-job checkpoint")');
    expect(core).toContain('"PERSISTENCE_ERROR"');
  });

  it('binds the WS command only after successful admission', () => {
    const core = blockBetween(
      'MachineOperationResult admitJobStart(const String &body, const WsCommandEntry *entry) {',
      'void handleJobStart() {');
    const bind = core.indexOf('jobStartCommand.active = true;');
    expect(bind).toBeGreaterThan(core.indexOf('runJobStartPreamble(requestedFeedOverridePercent)'));
    expect(core).toContain('strncpy(jobStartCommand.commandId, entry->commandId');
    expect(core).toContain('jobStartCommand.connectionGeneration = entry->connectionGeneration');
  });

  it('publishes exactly one terminal result, cleared only after publication', () => {
    const complete = blockBetween(
      'void completeJobStartCommand(bool ok, const char *code, const String &message) {',
      'MachineOperationResult admitJobStart(const String &body');
    expect(complete).toContain('if (!jobStartCommand.active) return;');
    const publish = complete.indexOf('finishWsCommand(jobStartCommand.commandId');
    const clear = complete.indexOf('jobStartCommand = JobStartCommandState();');
    expect(publish).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(publish);
    expect(complete.indexOf('queueWsCommandResult(jobStartCommand.clientId')).toBeGreaterThan(publish);
  });

  it('completes on RUNNING, on preamble failure, on job error, and on Stop preemption', () => {
    const finish = blockBetween('void finishPrioritySequence()', 'void processPriorityCommands()');
    expect(finish).toContain(
      'completeJobStartCommand(true, "OK", "start preamble complete; job is RUNNING")');

    const priorityError = blockBetween('void processPriorityCommands()', 'void sendJogCommand(');
    expect(priorityError).toContain('const bool startPreparation = jobStatus.state == JobRunnerState::Preparing;');
    expect(priorityError).toContain('completeJobStartCommand(false, "EXECUTION_FAILED"');

    const setError = blockBetween('void setJobError(const String &message, bool resetFeedOverride) {', 'void sendImmediateJobSafetyM5(');
    expect(setError).toContain('if (jobStartCommandActive()) {');

    const stop = blockBetween('MachineOperationResult performJobStop() {', 'void handleJobStop()');
    const cancel = stop.indexOf('completeJobStartCommand(false, "ABORTED_BY_STOP"');
    expect(cancel).toBeGreaterThan(-1);
    // Stop cancels the start command before the machine-operation preemption
    // and before the quickstop sequence replaces the preamble queue.
    expect(cancel).toBeLessThan(stop.indexOf('if (machineOperationActive())'));
    expect(cancel).toBeLessThan(stop.indexOf('startImmediateStopPrioritySequence();'));
  });
});
