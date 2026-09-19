import { readFileSync } from 'node:fs';
import path from 'node:path';
import { deriveDispatcherResult } from './development-dispatcher.mjs';

function readInput(target) {
  if (!target || target === '-') return readFileSync(0, 'utf8');
  return readFileSync(path.resolve(process.cwd(), target), 'utf8');
}

const target = process.argv[2] ?? '-';
const observation = JSON.parse(readInput(target));
console.log(JSON.stringify(deriveDispatcherResult(observation), null, 2));
