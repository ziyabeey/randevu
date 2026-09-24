#!/usr/bin/env node
// Aday R0 yorumlarını referans etiketle işaretler ve üretimdeki regex kararını ekler.
//
// Referans etiket (incelemeyi yazanın kendi kararı):
//   Copilot: başlıktaki durum — 🟢 Approval recommended → temiz,
//            🟡 Changes recommended → degisiklik_gerekli, 🔵 Needs a closer look → insan_bakmali
//   Ekip R0: "VERDICT:" satırı (** ve ` temizlenerek) — ACCEPTABLE / NO FINDINGS / PASS → temiz,
//            BLOCKER / FINDINGS / NOT ACCEPTABLE / INCOMPLETE → degisiklik_gerekli
//
// Üretim kararı: scripts/prepare-development-review-observation.mjs r0Receipt() içindeki
// üç regex'in birebir kopyası (satır 328-331).

import { readFileSync, writeFileSync } from 'node:fs';

const rows = readFileSync(new URL('candidates.jsonl', import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);

function referenceLabel(row) {
  if (/copilot/i.test(row.author)) {
    const heading = row.body.match(/^###\s*(.+)$/m)?.[1] ?? '';
    if (/approval recommended/i.test(heading)) return 'temiz';
    if (/changes recommended/i.test(heading)) return 'degisiklik_gerekli';
    if (/needs a closer look/i.test(heading)) return 'insan_bakmali';
    return null;
  }
  const verdict = row.body.match(/verdict\s*:\s*([^\n]+)/i)?.[1].replace(/[*`]/g, '').trim().toUpperCase() ?? '';
  if (/^(NOT ACCEPTABLE|BLOCKER|FINDINGS|INCOMPLETE)/.test(verdict)) return 'degisiklik_gerekli';
  if (/^(ACCEPTABLE|NO FINDINGS|PASS)/.test(verdict)) return 'temiz';
  return null;
}

function productionClean(body) {
  const structuredCleanVerdict = /verdict\s*:\s*(?:no\s+findings|acceptable)/i.test(body);
  const nativeNoFindings = /\*\*findings:\**\s*none/i.test(body);
  const claimsUnresolved = /unresolved[^\n]*(?:issue|finding|remain)|(?:issue|finding)[^\n]*remain[^\n]*unresolved/i.test(body);
  return structuredCleanVerdict || (nativeNoFindings && !claimsUnresolved);
}

const labeled = rows.map((row) => ({ ...row, label: referenceLabel(row), regexClean: productionClean(row.body) }));
const unlabeled = labeled.filter((r) => !r.label);
if (unlabeled.length) console.error(`Etiketlenemeyen ${unlabeled.length}:`, unlabeled.map((r) => r.id).join(', '));
writeFileSync(new URL('labeled.jsonl', import.meta.url), labeled.filter((r) => r.label).map((r) => JSON.stringify(r)).join('\n') + '\n');

const ok = labeled.filter((r) => r.label);
const source = (r) => (/copilot/i.test(r.author) ? 'copilot' : 'ekip');
console.log('kaynak   etiket               n   regex=temiz  regex=temiz-değil');
for (const src of ['copilot', 'ekip']) for (const label of ['temiz', 'degisiklik_gerekli', 'insan_bakmali']) {
  const group = ok.filter((r) => source(r) === src && r.label === label);
  if (!group.length) continue;
  const clean = group.filter((r) => r.regexClean).length;
  console.log(`${src.padEnd(8)} ${label.padEnd(20)} ${String(group.length).padStart(3)}   ${String(clean).padStart(10)}  ${String(group.length - clean).padStart(16)}`);
}
const falseBlock = ok.filter((r) => r.label === 'temiz' && !r.regexClean);
const missed = ok.filter((r) => r.label !== 'temiz' && r.regexClean);
console.log(`\nSahte bloklayıcı (temiz ama regex "temiz değil"): ${falseBlock.length}`);
console.log(`Kaçan sorun (sorun var ama regex "temiz"): ${missed.length}`);
for (const r of missed) console.log(`  #${r.pr} ${r.id} [${r.label}] ${JSON.stringify(r.body.match(/^###\s*(.+)$/m)?.[1] ?? '')} ${JSON.stringify((r.body.split('\n').find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('<')) ?? '').slice(0, 140))}`);
