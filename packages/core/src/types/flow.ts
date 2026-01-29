/**
 * Flow status for draft/publish lifecycle.
 */
export type FlowStatus = 'draft' | 'published' | 'archived';

/**
 * Visual metadata for editor positioning.
 */
export interface FlowVisualMetadata {
  /** Node positions by step ID */
  nodes: Record<string, { x: number; y: number; width?: number; height?: number }>;
  /** Canvas state */
  canvas?: {
    zoom: number;
    offsetX: number;
    offsetY: number;
  };
  /** Optional styling overrides by step */
  styles?: Record<string, { color?: string; icon?: string }>;
}

/**
 * A Flow is a predefined workflow definition.
 */
export interface Flow {
  /** Unique identifier (kebab-case) */
  readonly id: string;

  /** Semantic version */
  readonly version: string;

  /** Human-readable name */
  readonly name?: string;

  /** Starting step ID */
  readonly initialStepId: string;

  /** Step definitions */
  readonly steps: Record<string, Step>;

  /** Flow lifecycle status (defaults to 'published' for backward compatibility) */
  readonly status?: FlowStatus;

  /** Visual editor metadata (node positions, canvas state) */
  readonly visual?: FlowVisualMetadata;

  /** Description for documentation/UI */
  readonly description?: string;

  /** Tags for organization/filtering */
  readonly tags?: string[];
}

/**
 * A Step is a single unit of work.
 */
export interface Step {
  /** Must match the key in Flow.steps */
  readonly id: string;

  /** Handler type (e.g., "http", "delay", "branch") */
  readonly type: string;

  /** Handler-specific config (opaque to core) */
  readonly config: Record<string, unknown>;

  /** How to get input from context */
  readonly input: InputSelector;

  /** Where to store output (dot notation ok) */
  readonly outputKey?: string;

  /** What happens after this step */
  readonly transitions: StepTransitions;

  /** Optional display name */
  readonly name?: string;
}

/**
 * How to extract input from execution context.
 */
export type InputSelector =
  | { type: 'key'; key: string }              // context[key]
  | { type: 'keys'; keys: string[] }          // pick multiple keys
  | { type: 'path'; path: string }            // dot notation: "a.b.c"
  | { type: 'template'; template: unknown }   // ${path} interpolation
  | { type: 'full' }                          // entire context
  | { type: 'static'; value: unknown };       // hardcoded value

/**
 * Transition rules after step execution.
 */
export interface StepTransitions {
  /** Next step on success (null = complete) */
  readonly onSuccess?: string | null;

  /** Next step on failure (null = fail execution) */
  readonly onFailure?: string | null;

  /** Next step when resuming from wait */
  readonly onResume?: string;
}
