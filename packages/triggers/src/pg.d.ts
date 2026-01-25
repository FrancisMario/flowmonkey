/**
 * Local type declarations for pg (node-postgres).
 * This helps VS Code's language server find types when running
 * across the Windows-WSL boundary with pnpm symlinks.
 * 
 * The actual types are provided by @types/pg.
 * We only declare the subset we use.
 */
declare module 'pg' {
  export interface QueryResult<R = any> {
    command: string;
    rowCount: number | null;
    oid: number;
    fields: FieldDef[];
    rows: R[];
  }

  export interface FieldDef {
    name: string;
    tableID: number;
    columnID: number;
    dataTypeID: number;
    dataTypeSize: number;
    dataTypeModifier: number;
    format: string;
  }

  export interface QueryConfig<I = any[]> {
    text: string;
    values?: I;
    name?: string;
    rowMode?: 'array';
    types?: any;
  }

  export interface PoolClient {
    query<R = any, I = any[]>(
      queryTextOrConfig: string | QueryConfig<I>,
      values?: I
    ): Promise<QueryResult<R>>;
    release(err?: Error | boolean): void;
  }

  export interface Pool {
    query<R = any, I = any[]>(
      queryTextOrConfig: string | QueryConfig<I>,
      values?: I
    ): Promise<QueryResult<R>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
    on(event: 'error', listener: (err: Error, client: PoolClient) => void): this;
    on(event: 'connect', listener: (client: PoolClient) => void): this;
  }

  export interface PoolConfig {
    connectionString?: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  }
}
