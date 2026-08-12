import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export * from './types';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the repo's supabase/migrations directory. */
export const MIGRATIONS_DIR = join(HERE, '..', '..', '..', 'supabase', 'migrations');

/** Migration file names in lexical (apply) order. */
export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** The concatenated SQL of every migration, in apply order. */
export function readAllMigrations(): string {
  return listMigrationFiles()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');
}
