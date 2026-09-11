import { readFile } from 'node:fs/promises';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/report-npm-audit.mjs <npm-audit.json>');
  process.exit(2);
}

const audit = JSON.parse(await readFile(file, 'utf8'));
const vulnerabilities = audit.vulnerabilities ?? {};
const rows = Object.entries(vulnerabilities)
  .map(([name, value]) => ({
    name,
    severity: value?.severity ?? 'unknown',
    direct: Boolean(value?.isDirect),
    via: Array.isArray(value?.via)
      ? value.via.map((item) => typeof item === 'string' ? item : item?.title).filter(Boolean)
      : [],
    range: value?.range ?? '',
    fix: value?.fixAvailable ?? false,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const counts = audit.metadata?.vulnerabilities ?? {};
console.log(`npm audit summary: ${JSON.stringify(counts)}`);

for (const row of rows) {
  const fix = row.fix === true
    ? 'available'
    : row.fix && typeof row.fix === 'object'
      ? `${row.fix.name ?? row.name}@${row.fix.version ?? '?'}${row.fix.isSemVerMajor ? ' (major)' : ''}`
      : 'none';
  console.log(`- ${row.name}: severity=${row.severity}; direct=${row.direct}; range=${row.range}; fix=${fix}`);
  for (const title of row.via) console.log(`  via: ${title}`);
}
