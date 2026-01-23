import type { InputSelector } from '../types/flow';

/**
 * Resolve input from context based on selector.
 */
export function resolveInput(selector: InputSelector, context: Record<string, unknown>): unknown {
  switch (selector.type) {
    case 'key':
      return context[selector.key];

    case 'keys': {
      const result: Record<string, unknown> = {};
      for (const k of selector.keys) {
        if (k in context) result[k] = context[k];
      }
      return result;
    }

    case 'path':
      return getPath(context, selector.path);

    case 'template':
      return interpolate(selector.template, context);

    case 'full':
      return { ...context };

    case 'static':
      return selector.value;
  }
}

function getPath(obj: unknown, path: string): unknown {
  let current: any = obj;
  for (const part of path.split('.')) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function interpolate(template: unknown, context: Record<string, unknown>): unknown {
  if (typeof template === 'string') {
    const full = template.match(/^\$\{([^}]+)\}$/);
    if (full) return getPath(context, full[1]);
    return template.replace(/\$\{([^}]+)\}/g, (_, p) => {
      const v = getPath(context, p);
      return v === undefined ? '' : String(v);
    });
  }

  if (Array.isArray(template)) {
    return template.map(t => interpolate(t, context));
  }

  if (template && typeof template === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) {
      result[k] = interpolate(v, context);
    }
    return result;
  }

  return template;
}
