import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 5, idle_timeout: 20, connect_timeout: 10 });
  return { client, db: drizzle(client) };
}

export type Database = ReturnType<typeof createDatabase>['db'];
