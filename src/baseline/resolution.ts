export type CandidateOrigin = 'override' | 'saved-file';

export interface Candidate {
  readonly path: string;
  readonly origin: CandidateOrigin;
}

export interface PlanInput {
  readonly filePath: string;
  readonly override: string | undefined;
}

export type AttemptOutcome = 'ok' | 'missing' | 'same-as-file';

export interface Attempt {
  readonly candidate: Candidate;
  readonly outcome: AttemptOutcome;
}

export interface Resolution {
  readonly filePath: string;
  readonly baseline: Candidate | undefined;
  readonly attempts: readonly Attempt[];
}

export function planBaseline(input: PlanInput): readonly Candidate[] {
  if (input.override !== undefined && input.override.trim() !== '') {
    return [{ path: input.override, origin: 'override' }];
  }
  return [{ path: input.filePath, origin: 'saved-file' }];
}

export async function resolveBaseline(
  input: PlanInput,
  exists: (path: string) => Promise<boolean>,
): Promise<Resolution> {
  const attempts: Attempt[] = [];

  for (const candidate of planBaseline(input)) {
    if (candidate.origin === 'override' && candidate.path === input.filePath) {
      attempts.push({ candidate, outcome: 'same-as-file' });
      continue;
    }
    if (!(await exists(candidate.path))) {
      attempts.push({ candidate, outcome: 'missing' });
      continue;
    }
    attempts.push({ candidate, outcome: 'ok' });
    return { filePath: input.filePath, baseline: candidate, attempts };
  }

  return { filePath: input.filePath, baseline: undefined, attempts };
}

export function describeResolution(resolution: Resolution): string {
  const lines = [`baseline for ${resolution.filePath}`];
  for (const attempt of resolution.attempts) {
    const { candidate, outcome } = attempt;
    lines.push(`  ${candidate.origin}: ${candidate.path} — ${describeOutcome(outcome)}`);
  }
  return lines.join('\n');
}

export function describeFailure(resolution: Resolution): string {
  const failed = resolution.attempts[0];
  if (failed === undefined) return 'no baseline candidates';
  return `${failed.candidate.path} — ${describeOutcome(failed.outcome)}`;
}

/**
 * Lives here rather than in the shared errors module: it is a fact about baselines,
 * and the shared module has no business knowing what a baseline is.
 */
export class BaselineUnresolvedError extends Error {
  readonly resolution: Resolution;

  constructor(resolution: Resolution) {
    super(`no baseline for ${resolution.filePath}: ${describeFailure(resolution)}`);
    this.name = 'BaselineUnresolvedError';
    this.resolution = resolution;
  }
}

function describeOutcome(outcome: AttemptOutcome): string {
  switch (outcome) {
    case 'ok':
      return 'found';
    case 'missing':
      return 'no such file';
    case 'same-as-file':
      return 'resolves to the edited file itself';
  }
}
