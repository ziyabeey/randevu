const REQUIRED_GATES = Object.freeze(['f09', 'f10', 's01']);

function normalize(input = {}) {
  return {
    mode: String(input.mode ?? ''),
    explicit: input.explicit === true,
    f09: input.f09 === true,
    f10: input.f10 === true,
    s01: input.s01 === true,
  };
}

export function decideS07C4(input) {
  const state = normalize(input);
  const missing = REQUIRED_GATES.filter((name) => !state[name]);

  if (state.mode !== 'deploy') {
    if (state.explicit) {
      return { action: 'fail', reason: `mode=${state.mode || 'unknown'}`, missing };
    }
    return { action: 'skip', reason: `mode=${state.mode || 'unknown'}`, missing };
  }

  if (missing.length) {
    const reason = `missing_gates=${missing.join(',')}`;
    return { action: state.explicit ? 'fail' : 'skip', reason, missing };
  }

  return { action: 'run', reason: state.explicit ? 'explicit' : 'triple_gate', missing: [] };
}

export function enforceS07C4(input, { log = console.log } = {}) {
  const decision = decideS07C4(input);

  if (decision.action === 'fail') {
    throw new Error(`S07_C4_BLOCKED reason=${decision.reason}`);
  }

  if (decision.action === 'skip') {
    log(`S07_C4_SKIPPED reason=${decision.reason}`);
    return false;
  }

  return true;
}
