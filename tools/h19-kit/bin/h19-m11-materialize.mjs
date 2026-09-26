#!/usr/bin/env node
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { materializeM11Development, validateM11SourcePath } from '../src/experiments/m11-materializer.mjs';

const args = process.argv.slice(2);
if (args.length < 3 || args.length > 4) {
  process.stderr.write('Usage: node h19-m11-materialize.mjs INVENTORY_JSON EXPECTED_SHA256 SOURCE_ROOT [OBSERVATIONS_JSON]\n');
  process.exitCode = 1;
} else {
  try {
    const [inventoryPath, expectedInventorySha256, sourceRoot, observationPath] = args;
    const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
    const observations = observationPath ? JSON.parse(await readFile(observationPath, 'utf8')) : null;
    const root = await realpath(sourceRoot);
    const readSource = async (relative) => {
      validateM11SourcePath(relative);
      const resolved = await realpath(path.join(root, relative));
      const rel = path.relative(root, resolved);
      if (rel.startsWith(`..${path.sep}`) || rel === '..' || path.isAbsolute(rel)) {
        throw new Error('source resolves outside the source root');
      }
      return readFile(resolved);
    };
    const result = await materializeM11Development({ inventory, expectedInventorySha256, readSource, observations });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof SyntaxError ? 'invalid JSON input'
      : error.code ? 'input file unavailable' : error.message;
    process.stderr.write(`M11 materialization failed: ${message}\n`);
    process.exitCode = 1;
  }
}
