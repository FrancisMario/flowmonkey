/**
 * Local type declarations for Vitest.
 * This helps VS Code's language server find types when running
 * across the Windows-WSL boundary with pnpm symlinks.
 */
declare module 'vitest' {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;

  export interface MockInstance<T extends (...args: any[]) => any = (...args: any[]) => any> {
    (...args: Parameters<T>): ReturnType<T>;
    mockReturnValue(value: ReturnType<T>): this;
    mockReturnValueOnce(value: ReturnType<T>): this;
    mockResolvedValue<U>(value: U): this;
    mockResolvedValueOnce<U>(value: U): this;
    mockRejectedValue(value: unknown): this;
    mockRejectedValueOnce(value: unknown): this;
    mockImplementation(fn: T): this;
    mockImplementationOnce(fn: T): this;
    mockClear(): this;
    mockReset(): this;
    mockRestore(): void;
    getMockName(): string;
    mockName(name: string): this;
    mock: {
      calls: Parameters<T>[];
      results: { type: 'return' | 'throw'; value: unknown }[];
      instances: unknown[];
      contexts: unknown[];
      lastCall?: Parameters<T>;
    };
  }

  export interface ExpectStatic {
    <T>(actual: T): Assertion<T>;
    any(constructor: unknown): unknown;
    anything(): unknown;
    arrayContaining<T>(arr: T[]): T[];
    objectContaining<T>(obj: T): T;
    stringContaining(str: string): string;
    stringMatching(regex: RegExp | string): string;
  }

  export interface Assertion<T> {
    toBe(expected: T): void;
    toEqual(expected: unknown): void;
    toStrictEqual(expected: unknown): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toBeNull(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toBeCloseTo(expected: number, numDigits?: number): void;
    toContain(expected: unknown): void;
    toHaveLength(expected: number): void;
    toHaveProperty(key: string, value?: unknown): void;
    toMatch(expected: RegExp | string): void;
    toMatchObject(expected: object): void;
    toThrow(expected?: string | RegExp | Error): void;
    toThrowError(expected?: string | RegExp | Error): void;
    toBeInstanceOf(expected: unknown): void;
    toHaveBeenCalled(): void;
    toHaveBeenCalledTimes(expected: number): void;
    toHaveBeenCalledWith(...args: unknown[]): void;
    resolves: Assertion<T>;
    rejects: Assertion<T>;
    not: Assertion<T>;
  }

  export const expect: ExpectStatic;

  export namespace vi {
    function fn<T extends (...args: any[]) => any = (...args: any[]) => any>(implementation?: T): MockInstance<T>;
    function spyOn<T, K extends keyof T>(object: T, method: K): MockInstance;
    function mock(path: string, factory?: () => unknown): void;
    function useFakeTimers(): void;
    function useRealTimers(): void;
    function advanceTimersByTime(ms: number): void;
    function advanceTimersByTimeAsync(ms: number): Promise<void>;
    function runAllTimers(): void;
    function clearAllMocks(): void;
    function resetAllMocks(): void;
    function restoreAllMocks(): void;
  }
}
