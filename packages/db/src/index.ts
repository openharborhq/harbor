import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export * from "./schema/index";
export { schema };

export type Db = ReturnType<typeof createDb>;

export function createDb(url: string) {
  const client = postgres(url, { max: 10, prepare: true });
  return drizzle(client, { schema });
}
