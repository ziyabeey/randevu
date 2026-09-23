const TASK_PATTERNS = [
  /\bDEV-ENGINE-\d{1,3}\b/i,
  /\bF\d{2}-\d{2}\b/i,
  /\bS\d{2}\b/i,
  /\bKC-\d{2}\b/i,
];

export const JANITOR_CHOICES = Object.freeze({
  KEEP: 'KEEP',
  CLOSE_CANDIDATE: 'CLOSE_CANDIDATE',
  REBASE_CANDIDATE: 'REBASE_CANDIDATE',
  REVIEW_CAPACITY: 'REVIEW_CAPACITY',
});

function text(value) {
  return String(value ?? '');
}

function lower(value) {
  return text(value).toLocaleLowerCase('tr-TR');
}

function unique(values) {
  return [...new Set(values)];
}

export function janitorMergedHistoryLimit(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return 20;
  return Math.min(parsed, 20);
}

function filesFor(pull) {
  return (pull?.files ?? []).map((file) => text(file?.path)).filter(Boolean);
}

function taskKeyFromText(value) {
  for (const pattern of TASK_PATTERNS) {
    const match = text(value).match(pattern);
    if (match) return match[0].toUpperCase();
  }
  return null;
}

export function janitorTaskKey(pull) {
  const direct = taskKeyFromText(pull?.title);
  if (direct) return direct;
  for (const file of filesFor(pull)) {
    const fromPath = taskKeyFromText(file);
    if (fromPath) return fromPath;
  }
  return null;
}

export function janitorDocsOnly(pull, config = {}) {
  const files = filesFor(pull);
  if (files.length === 0 || pull?.filesTruncated === true) return false;
  const patterns = (config.docsOnlyPatterns ?? []).map(lower);
  return files.every((file) => {
    const normalized = lower(file);
    return patterns.some((pattern) => pattern === '.md'
      ? normalized.endsWith('.md')
      : normalized === pattern || normalized.startsWith(pattern));
  });
}

function fileOverlap(left, right) {
  const rightFiles = new Set(filesFor(right));
  return filesFor(left).filter((file) => rightFiles.has(file));
}

function sameFileSet(left, right) {
  const a = filesFor(left).sort();
  const b = filesFor(right).sort();
  return a.length > 0 && a.length === b.length && a.every((value, index) => value === b[index]);
}

function after(left, right) {
  const a = Date.parse(left ?? '');
  const b = Date.parse(right ?? '');
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
}

export function hasReviewQuotaSignal(pull) {
  return (pull?.comments ?? []).some((comment) => {
    const author = lower(comment?.author);
    const body = lower(comment?.body);
    return (author.includes('codex') || author.includes('chatgpt'))
      && (body.includes('usage limits for code reviews')
        || body.includes('code review') && body.includes('usage limit')
        || body.includes('add credits') && body.includes('code review'));
  });
}

function candidate(pr, status, reason, extras = {}) {
  const allowedChoices = status === 'SUPERSEDED_CANDIDATE' || status === 'DUPLICATE_CANDIDATE'
    ? ['KEEP', 'CLOSE_CANDIDATE']
    : status === 'STALE_BASE'
      ? ['KEEP', 'REBASE_CANDIDATE']
      : status === 'REVIEW_CAPACITY_DEGRADED'
        ? ['KEEP', 'REVIEW_CAPACITY']
        : ['KEEP'];
  return {
    prNumber: pr.number,
    title: text(pr.title).slice(0, 240),
    url: pr.url ?? null,
    headSha: pr.headSha ?? null,
    baseSha: pr.baseSha ?? null,
    draft: pr.draft === true,
    taskKey: janitorTaskKey(pr),
    status,
    reason,
    allowedChoices,
    ...extras,
  };
}

export function buildJanitorCandidates(remote = {}, config = {}) {
  if (config.janitorEnabled === false || remote.available === false || remote.complete === false) return [];
  const pulls = Array.isArray(remote.pulls) ? remote.pulls : [];
  const merged = Array.isArray(remote.recentMergedPulls) ? remote.recentMergedPulls : [];
  const docsPulls = pulls.filter((pr) => janitorDocsOnly(pr, config));
  const result = [];

  for (const pr of pulls) {
    const taskKey = janitorTaskKey(pr);
    if (janitorDocsOnly(pr, config)) {
      const mergedMatches = merged
        .filter((item) => taskKey && janitorTaskKey(item) === taskKey)
        .map((item) => ({
          item,
          overlap: fileOverlap(pr, item),
        }))
        .filter(({ item, overlap }) => item.filesTruncated !== true
          && overlap.length > 0
          && after(item.mergedAt, pr.createdAt ?? pr.updatedAt))
        .sort((left, right) => text(right.item.mergedAt).localeCompare(text(left.item.mergedAt)));

      if (mergedMatches.length > 0) {
        const strongest = mergedMatches[0];
        result.push(candidate(
          pr,
          'SUPERSEDED_CANDIDATE',
          `A newer merged PR for ${taskKey} overlaps this documentation surface.`,
          {
            confidence: sameFileSet(pr, strongest.item) ? 'high' : 'medium',
            mergedEvidence: {
              prNumber: strongest.item.number,
              title: strongest.item.title,
              mergedAt: strongest.item.mergedAt,
              overlapFiles: strongest.overlap,
              url: strongest.item.url ?? null,
            },
          },
        ));
        continue;
      }

      const duplicateMatches = docsPulls
        .filter((other) => other.number !== pr.number
          && taskKey
          && janitorTaskKey(other) === taskKey
          && sameFileSet(pr, other)
          && after(other.createdAt ?? other.updatedAt, pr.createdAt ?? pr.updatedAt))
        .sort((left, right) => text(right.createdAt ?? right.updatedAt)
          .localeCompare(text(left.createdAt ?? left.updatedAt)));

      if (duplicateMatches.length > 0) {
        const newer = duplicateMatches[0];
        result.push(candidate(
          pr,
          'DUPLICATE_CANDIDATE',
          `A newer open docs PR for ${taskKey} targets the same file set.`,
          {
            confidence: 'medium',
            duplicateEvidence: {
              prNumber: newer.number,
              title: newer.title,
              url: newer.url ?? null,
            },
          },
        ));
        continue;
      }

      if (pr.baseSha && remote.mainSha && pr.baseSha !== remote.mainSha) {
        result.push(candidate(
          pr,
          'STALE_BASE',
          'Docs-only PR base differs from current main and no newer overlapping merge was found.',
          { confidence: 'low' },
        ));
        continue;
      }
    }

    if (hasReviewQuotaSignal(pr)) {
      result.push(candidate(
        pr,
        'REVIEW_CAPACITY_DEGRADED',
        'A code-review provider reported quota exhaustion; treat review coverage as degraded, not as a code failure.',
        { confidence: 'high' },
      ));
    }
  }

  return result.sort((left, right) => left.prNumber - right.prNumber);
}

// Lists the exact keys instead of a concrete example: the local 3B model copied
// the sample verbatim and answered only that PR (1/7 coverage, fail-closed).
export function janitorSystemPrompt(candidates) {
  const keys = (candidates ?? []).map((item) => item.prNumber);
  return [
    'Repo hijyeni sınıflandır.',
    'Her satırın status ve allowedChoices alanı deterministik sınırdır.',
    'Kanıt icat etme ve allowedChoices dışına çıkma.',
    'CLOSE_CANDIDATE yalnız superseded/duplicate adaylarında bir insan inceleme önerisidir; hiçbir şeyi kapatmaz.',
    'REVIEW_CAPACITY kod hatası değildir.',
    `Her satır için tam bir karar ver; toplam ${keys.length} anahtar: ${keys.join(', ')}.`,
    'Yalnız JSON döndür: {"choices":{"<prNumber>":"<allowedChoices içinden biri>"}}.',
  ].join(' ');
}

export function validateJanitorChoices(value, candidates) {
  const known = new Map((candidates ?? []).map((item) => [item.prNumber, item]));
  let submitted;
  if (Array.isArray(value?.choices)) {
    submitted = value.choices;
  } else if (value?.choices && typeof value.choices === 'object') {
    submitted = Object.entries(value.choices).map(([prNumber, choice]) => ({
      prNumber: Number(prNumber),
      choice,
    }));
  } else {
    throw new Error('Janitor response does not contain keyed choices');
  }

  const seen = new Set();
  const choices = submitted.map((item) => {
    const prNumber = Number(item?.prNumber);
    const choice = text(item?.choice).toUpperCase();
    const entry = known.get(prNumber);
    if (!Number.isSafeInteger(prNumber) || !entry) {
      throw new Error(`Janitor returned an unknown PR: ${item?.prNumber}`);
    }
    if (seen.has(prNumber)) throw new Error(`Janitor returned duplicate coverage for PR #${prNumber}`);
    seen.add(prNumber);
    if (!Object.hasOwn(JANITOR_CHOICES, choice) || !entry.allowedChoices.includes(choice)) {
      throw new Error(`Janitor choice ${choice} is outside the deterministic allowance for PR #${prNumber}`);
    }
    return {
      prNumber,
      choice,
      label: JANITOR_CHOICES[choice],
      advisoryOnly: true,
    };
  });

  if (choices.length !== known.size || seen.size !== known.size) {
    throw new Error(`Janitor returned ${choices.length}/${known.size} choices`);
  }
  return {
    available: true,
    choices,
    summary: `${choices.length} repo-hygiene candidate(s) reviewed without write authority.`,
    advisoryOnly: true,
    stale: false,
  };
}

export function janitorFingerprintInput(candidates = [], promptVersion = 1) {
  return {
    promptVersion,
    candidates: candidates.map((item) => ({
      prNumber: item.prNumber,
      title: item.title,
      headSha: item.headSha,
      status: item.status,
      taskKey: item.taskKey,
      reason: item.reason,
      confidence: item.confidence ?? null,
      allowedChoices: unique(item.allowedChoices).sort(),
      mergedEvidence: item.mergedEvidence
        ? {
          prNumber: item.mergedEvidence.prNumber,
          title: item.mergedEvidence.title,
          mergedAt: item.mergedEvidence.mergedAt,
          overlapFiles: [...item.mergedEvidence.overlapFiles].sort(),
          url: item.mergedEvidence.url ?? null,
        }
        : null,
      duplicateEvidence: item.duplicateEvidence
        ? {
          prNumber: item.duplicateEvidence.prNumber,
          title: item.duplicateEvidence.title,
          url: item.duplicateEvidence.url ?? null,
        }
        : null,
    })),
  };
}
