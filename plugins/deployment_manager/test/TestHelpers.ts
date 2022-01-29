import * as os from 'os';
import * as path from 'path';

// Just a fast, boring random algo to generate tmp directories
function fakeRandom() {
  return Math.random().toString(36).substr(2, 5);
}

export function tempDir(): string {
  return path.join(os.tmpdir(), fakeRandom());
}
