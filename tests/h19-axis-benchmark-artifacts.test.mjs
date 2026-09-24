import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const labelsPath = 'docs/development-engine/benchmarks/h19-axis.v0.1.json';
const inputsPath = 'docs/development-engine/benchmarks/h19-axis-inputs.v0.1.json';

test('committed H19 shadow labels and blinded inputs have exact opaque-key provenance', () => {
  const labels = readJson(labelsPath);
  const inputs = readJson(inputsPath);
  assert.equal(labels.case_count, 16);
  assert.equal(labels.cases.length, 16);
  assert.equal(inputs.cases.length, 16);

  const inputByKey = new Map(inputs.cases.map((entry) => [entry.case_key, entry]));
  assert.equal(inputByKey.size, 16);

  for (const label of labels.cases) {
    const input = inputByKey.get(label.case_key);
    assert.ok(input, 'missing blinded input for ' + label.case_key);
    assert.equal(input.source_head_sha, label.source_head_sha, label.case_key + ' head provenance drift');
    assert.equal(input.source_parent_sha, label.source_parent_sha, label.case_key + ' parent provenance drift');
    assert.ok(Array.isArray(input.files) && input.files.length > 0, label.case_key + ' has no model-visible production diff');
  }
});

test('committed blinded inputs contain no H19 or axis-pair labels', () => {
  const inputs = readJson(inputsPath);
  const forbidden = /\\bH19\\b|EXP-H19|exp\\/h19|\\bD[0-5]\\s*[x×]\\s*D[0-5]\\b/i;
  for (const entry of inputs.cases) {
    const state = JSON.stringify({ files: entry.files });
    assert.doesNotMatch(state, forbidden, entry.case_key + ' leaks benchmark labels');
  }
});
