import { readFile } from 'node:fs/promises';
import { declarativeRule, validateDeclarativeCard } from './declarative.mjs';

export async function loadRuleCard(file) {
  const card = validateDeclarativeCard(JSON.parse(await readFile(file, 'utf8')));
  return { metadata: card, rule: declarativeRule(card), file };
}

export async function loadRuleCards(files = []) {
  const rows = [];
  for (const file of files) rows.push(await loadRuleCard(file));
  return rows;
}
