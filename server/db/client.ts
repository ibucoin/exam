import { Database } from "bun:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

const databasePath = process.env.DATABASE_PATH ?? "./questions.sqlite3";
const sqlite = new Database(databasePath, { create: true });

sqlite.exec("PRAGMA foreign_keys = ON");
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA busy_timeout = 5000");

export const db = drizzle(sqlite, { schema });

export function migrateDatabase() {
  const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
  migrate(db, { migrationsFolder });
}
