import type { Flow } from '../types/flow';
import type { ValidationIssue } from '../types/errors';

export function validateFlow(flow: Flow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!flow.id) issues.push({ path: 'id', message: 'Required', severity: 'error' });
  if (!flow.version) issues.push({ path: 'version', message: 'Required', severity: 'error' });
  if (!flow.initialStepId) issues.push({ path: 'initialStepId', message: 'Required', severity: 'error' });

  const steps = Object.keys(flow.steps || {});
  if (steps.length === 0) {
    issues.push({ path: 'steps', message: 'At least one step required', severity: 'error' });
    return issues;
  }

  if (flow.initialStepId && !flow.steps[flow.initialStepId]) {
    issues.push({ path: 'initialStepId', message: `Step "${flow.initialStepId}" not found`, severity: 'error' });
  }

  for (const [id, step] of Object.entries(flow.steps)) {
    if (step.id !== id) {
      issues.push({ path: `steps.${id}.id`, message: `ID mismatch: "${step.id}" vs key "${id}"`, severity: 'error' });
    }
    if (!step.type) issues.push({ path: `steps.${id}.type`, message: 'Required', severity: 'error' });
    if (!step.input) issues.push({ path: `steps.${id}.input`, message: 'Required', severity: 'error' });

    const t = step.transitions;
    if (t?.onSuccess && !flow.steps[t.onSuccess]) {
      issues.push({ path: `steps.${id}.transitions.onSuccess`, message: `"${t.onSuccess}" not found`, severity: 'error' });
    }
    if (t?.onFailure && !flow.steps[t.onFailure]) {
      issues.push({ path: `steps.${id}.transitions.onFailure`, message: `"${t.onFailure}" not found`, severity: 'error' });
    }
    if (t?.onResume && !flow.steps[t.onResume]) {
      issues.push({ path: `steps.${id}.transitions.onResume`, message: `"${t.onResume}" not found`, severity: 'error' });
    }
  }

  return issues;
}
