import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };

export type Db = ReturnType<typeof createDb>;

export function createDb(url: string) {
  const client = postgres(url, { max: 10, prepare: true, onnotice: () => {} });
  return drizzle(client, { schema });
}

/** Apply pending migrations. Serialised by an advisory lock so api and worker can both call it at boot. */
export async function runMigrations(db: Db): Promise<void> {
  const migrationsFolder = path.join(__dirname, "..", "migrations");
  await db.execute(`select pg_advisory_lock(7211337)`);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await db.execute(`select pg_advisory_unlock(7211337)`);
  }
}

export async function closeDb(db: Db): Promise<void> {
  await db.$client.end({ timeout: 5 });
}
