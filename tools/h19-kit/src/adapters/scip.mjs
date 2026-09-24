import { spawn } from 'node:child_process';

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 2000)}`));
    });
  });
}

export async function readScipJson({
  indexFile = 'index.scip',
  cwd = process.cwd(),
  executable = 'scip',
} = {}) {
  const { stdout } = await run(executable, ['print', '--json', indexFile], cwd);
  return JSON.parse(stdout);
}

export function normalizeScipIndex(raw = {}) {
  const documents = raw.documents ?? [];
  return {
    metadata: raw.metadata ?? {},
    documents: documents.map((doc) => ({
      path: doc.relativePath ?? doc.relative_path ?? '',
      language: doc.language ?? '',
      occurrences: (doc.occurrences ?? []).map((occ) => ({
        symbol: occ.symbol ?? '',
        symbolRoles: Number(occ.symbolRoles ?? occ.symbol_roles ?? 0),
        range: occ.singleLineRange ?? occ.single_line_range
          ?? occ.multiLineRange ?? occ.multi_line_range
          ?? occ.range ?? null,
      })),
      symbols: (doc.symbols ?? []).map((info) => ({
        symbol: info.symbol ?? '',
        displayName: info.displayName ?? info.display_name ?? '',
        kind: info.kind ?? null,
        enclosingSymbol: info.enclosingSymbol ?? info.enclosing_symbol ?? '',
        relationships: (info.relationships ?? []).map((rel) => ({
          symbol: rel.symbol ?? '',
          isReference: Boolean(rel.isReference ?? rel.is_reference),
          isImplementation: Boolean(rel.isImplementation ?? rel.is_implementation),
          isTypeDefinition: Boolean(rel.isTypeDefinition ?? rel.is_type_definition),
          isDefinition: Boolean(rel.isDefinition ?? rel.is_definition),
        })),
      })),
    })),
  };
}

export const SCIP_ROLES = Object.freeze({
  DEFINITION: 0x1,
  IMPORT: 0x2,
  WRITE: 0x4,
  READ: 0x8,
  GENERATED: 0x10,
  TEST: 0x20,
  FORWARD_DEFINITION: 0x40,
});

export function hasScipRole(value, role) {
  return (Number(value) & Number(role)) !== 0;
}
