import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const source = readFileSync('www/preview.js', 'utf8');
const body = source.slice(source.indexOf('function originalZEnvelopeError('), source.indexOf('function availableWorkBounds('));
const make = frame => new Function('currentMachineFrame', `${body}; return originalZEnvelopeError;`)(frame);
const frame = { trusted: true, absoluteFromHome: true, workZeroValid: true, workZeroMachine: { z: -38 }, limits: { zMin: -70, zMax: 0 } };
it('allows original run Z inside the physical envelope', () => expect(make(frame)({ zMin: -5, zMax: 5 })).toBeNull());
it('reports original Z excess even when generated Safe Z can be capped', () => expect(make(frame)({ zMin: -5, zMax: 40 })).toContain('Original run Z'));
it('does not invent bounds without trusted frame', () => expect(make({ ...frame, trusted: false })({ zMin: -5, zMax: 40 })).toBeNull());
