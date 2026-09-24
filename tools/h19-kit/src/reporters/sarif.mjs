const level = (severity) => severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'note';

export function toSarif(findings = [], { toolName = 'H19 Kit', version = '0.0.1-alpha.0' } = {}) {
  const rules = new Map();
  for (const f of findings) {
    if (!rules.has(f.id)) rules.set(f.id, { id: f.id, shortDescription: { text: f.title } });
  }

  return {
    version: '2.1.0',
    '$schema': 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{
      tool: {
        driver: {
          name: toolName,
          version,
          informationUri: 'https://github.com/ziyabeey/randevu',
          rules: [...rules.values()],
        },
      },
      results: findings.map((f) => ({
        ruleId: f.id,
        level: level(f.severity),
        message: { text: f.title },
        ...(f.location?.path ? {
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: f.location.path },
              ...(f.location.line ? { region: { startLine: f.location.line } } : {}),
            },
          }],
        } : {}),
        properties: {
          source: f.source,
          action: f.action,
          evidenceIds: f.evidenceIds,
          ...f.metadata,
        },
      })),
    }],
  };
}
