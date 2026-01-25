/**
 * Local type declarations for cron-parser.
 * This helps VS Code's language server find types when running
 * across the Windows-WSL boundary with pnpm symlinks.
 * 
 * The actual types are provided by the cron-parser package itself.
 */
declare module 'cron-parser' {
  export interface CronExpression {
    next(): CronDate;
    prev(): CronDate;
    hasNext(): boolean;
    hasPrev(): boolean;
    reset(date?: Date): void;
    fields: CronFields;
  }

  export interface CronDate {
    getTime(): number;
    toDate(): Date;
    toJSON(): string;
    toString(): string;
  }

  export interface CronFields {
    readonly second: readonly number[];
    readonly minute: readonly number[];
    readonly hour: readonly number[];
    readonly dayOfMonth: readonly (number | 'L')[];
    readonly month: readonly number[];
    readonly dayOfWeek: readonly number[];
  }

  export interface ParserOptions {
    currentDate?: Date | string | number;
    startDate?: Date | string | number;
    endDate?: Date | string | number;
    iterator?: boolean;
    utc?: boolean;
    tz?: string;
  }

  export function parseExpression(
    expression: string,
    options?: ParserOptions
  ): CronExpression;
}
