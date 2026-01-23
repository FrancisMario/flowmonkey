import type { StepHandler } from '../interfaces/step-handler';
import { Result } from '../types/result';

export const echoHandler: StepHandler = {
  type: 'echo',
  async execute({ input }) {
    return Result.success(input);
  },
};

export const transformHandler: StepHandler = {
  type: 'transform',
  async execute({ input, step }) {
    const s = String(input);
    switch (step.config.transform) {
      case 'upper': return Result.success(s.toUpperCase());
      case 'lower': return Result.success(s.toLowerCase());
      case 'reverse': return Result.success(s.split('').reverse().join(''));
      default: return Result.failure('BAD_TRANSFORM', `Unknown: ${step.config.transform}`);
    }
  },
};

export const delayHandler: StepHandler = {
  type: 'delay',
  async execute() {
    // For testing with simulateTime, use immediate wake
    return Result.waitUntil(Date.now(), 'Delaying');
  },
};

export const failHandler: StepHandler = {
  type: 'fail',
  async execute({ step }) {
    return Result.failure(
      (step.config.code as string) ?? 'FAIL',
      (step.config.message as string) ?? 'Failed'
    );
  },
};

export const branchHandler: StepHandler = {
  type: 'branch',
  async execute({ context, step }) {
    const conditions = step.config.conditions as { path: string; eq: unknown; goto: string }[];
    for (const c of conditions) {
      if (getPath(context, c.path) === c.eq) {
        return { outcome: 'success', nextStepOverride: c.goto };
      }
    }
    const def = step.config.default as string | undefined;
    if (def) return { outcome: 'success', nextStepOverride: def };
    return Result.failure('NO_MATCH', 'No condition matched');
  },
};

export const setHandler: StepHandler = {
  type: 'set',
  async execute({ step }) {
    return Result.success(step.config.value);
  },
};

function getPath(obj: unknown, path: string): unknown {
  let c: any = obj;
  for (const p of path.split('.')) {
    if (c == null) return undefined;
    c = c[p];
  }
  return c;
}
