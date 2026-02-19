/**
 * FileWAL — JSONL-based write-ahead log on local disk.
 *
 * Append-only JSONL file for failed pipe writes.
 * Acked entries tracked in a separate `.acked` file.
 * Compact removes acked entries and rewrites the main file.
 *
 * Storage format:
 *   data/pipes.wal       — one JSON object per line (WALEntry)
 *   data/pipes.wal.acked — one ID per line (acked entry IDs)
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { WALEntry } from '../types/table';
import type { WriteAheadLog } from '../interfaces/write-ahead-log';

export class FileWAL implements WriteAheadLog {
  private readonly walPath: string;
  private readonly ackedPath: string;

  /**
   * @param dir - Directory for WAL files (created if missing)
   * @param filename - WAL filename (default: 'pipes.wal')
   */
  constructor(dir: string, filename = 'pipes.wal') {
    mkdirSync(dir, { recursive: true });
    this.walPath = join(dir, filename);
    this.ackedPath = join(dir, `${filename}.acked`);
  }

  async append(entry: WALEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n';
    appendFileSync(this.walPath, line, 'utf-8');
  }

  async readPending(limit = 100): Promise<WALEntry[]> {
    if (!existsSync(this.walPath)) return [];

    const ackedIds = this.loadAckedIds();
    const lines = readFileSync(this.walPath, 'utf-8').split('\n').filter(Boolean);
    const pending: WALEntry[] = [];

    for (const line of lines) {
      if (pending.length >= limit) break;
      try {
        const entry: WALEntry = JSON.parse(line);
        if (!ackedIds.has(entry.id)) {
          pending.push(entry);
        }
      } catch {
        // Skip malformed lines
      }
    }

    return pending;
  }

  async ack(id: string): Promise<void> {
    appendFileSync(this.ackedPath, id + '\n', 'utf-8');
  }

  async compact(): Promise<void> {
    if (!existsSync(this.walPath)) return;

    const ackedIds = this.loadAckedIds();
    if (ackedIds.size === 0) return;

    const lines = readFileSync(this.walPath, 'utf-8').split('\n').filter(Boolean);
    const remaining: string[] = [];

    for (const line of lines) {
      try {
        const entry: WALEntry = JSON.parse(line);
        if (!ackedIds.has(entry.id)) {
          remaining.push(line);
        }
      } catch {
        // Drop malformed lines during compaction
      }
    }

    // Rewrite WAL with only pending entries
    writeFileSync(this.walPath, remaining.length > 0 ? remaining.join('\n') + '\n' : '', 'utf-8');

    // Clear acked file
    if (existsSync(this.ackedPath)) {
      unlinkSync(this.ackedPath);
    }
  }

  // --- Private ---

  private loadAckedIds(): Set<string> {
    if (!existsSync(this.ackedPath)) return new Set();
    const content = readFileSync(this.ackedPath, 'utf-8');
    return new Set(content.split('\n').filter(Boolean));
  }
}
