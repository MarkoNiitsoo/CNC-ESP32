import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockSD } from './mock-sd.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sd = new MockSD(path.join(projectRoot, 'dev', 'mock-sd'));
await sd.reset();
console.log('Mock SD reset and sample G-code files restored.');
