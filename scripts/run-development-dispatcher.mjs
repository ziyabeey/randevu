import { readFileSync } from 'node:fs';
import path from 'node:path';
import { deriveEffectiveState } from './development-dispatcher.mjs';

function readInput(target) {
  if (!target || target === '-') return readFileSync(0, 'utf8');
  return readFileSync(path.resolve(process.cwd(), target), 'utf8');
}

const target = process.argv[2] ?? '-';
const snapshot = JSON.parse(readInput(target));
console.log(JSON.stringify(deriveEffectiveState(snapshot), null, 2));
