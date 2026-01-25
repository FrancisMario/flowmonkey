/**
 * Local type declarations for Ajv JSON Schema validator.
 * This helps VS Code's language server find types when running
 * across the Windows-WSL boundary with pnpm symlinks.
 */
declare module 'ajv' {
  export interface ErrorObject {
    keyword: string;
    instancePath: string;
    schemaPath: string;
    params: Record<string, unknown>;
    message?: string;
    data?: unknown;
  }

  export interface ValidateFunction<T = unknown> {
    (data: unknown): data is T;
    errors?: ErrorObject[] | null;
  }

  export interface Options {
    strict?: boolean | 'log';
    allErrors?: boolean;
    verbose?: boolean;
    formats?: Record<string, unknown>;
    coerceTypes?: boolean | 'array';
    useDefaults?: boolean | 'empty';
    removeAdditional?: boolean | 'all' | 'failing';
    addUsedSchema?: boolean;
  }

  export default class Ajv {
    constructor(options?: Options);
    compile<T = unknown>(schema: object): ValidateFunction<T>;
    addFormat(name: string, format: unknown): this;
    addKeyword(definition: object): this;
  }
}

declare module 'ajv-formats' {
  import type Ajv from 'ajv';
  
  export default function addFormats(ajv: Ajv, formats?: string[] | object): Ajv;
}
