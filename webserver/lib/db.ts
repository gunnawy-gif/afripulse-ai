import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const sql = neon(process.env.DATABASE_URL!);

let schemaApplied = false;

/** Applies schema.sql once per process. Safe to call from any route. */
export async function ensureSchema(): Promise<void> {
  if (schemaApplied) return;
  const ddl = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf8');
  // The Neon HTTP endpoint takes one statement per call; split the DDL up.
  for (const stmt of ddl.split(';')) {
    const trimmed = stmt.replace(/--[^\n]*\n/g, ' ').trim();
    if (trimmed) await sql.query(trimmed);
  }
  schemaApplied = true;
}

export type Row = Record<string, unknown>;

export async function one<T = Row>(query: string, params: unknown[]): Promise<T | null> {
  const rows = (await sql.query(query, params)) as unknown as T[];
  return rows[0] ?? null;
}

export async function many<T = Row>(query: string, params: unknown[]): Promise<T[]> {
  return (await sql.query(query, params)) as unknown as T[];
}
