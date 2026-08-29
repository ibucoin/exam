import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
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

export function restoreQuestionTagsFromSeed() {
  const seedPath = process.env.SEED_DATABASE_PATH;
  if (!seedPath || !existsSync(seedPath) || resolve(seedPath) === resolve(databasePath)) return;

  sqlite.query("ATTACH DATABASE ? AS question_seed").run(seedPath);
  try {
    sqlite.exec(`
      INSERT OR IGNORE INTO main.question_tags (question_id, tag)
      SELECT seed_tags.question_id, seed_tags.tag
      FROM question_seed.question_tags seed_tags
      INNER JOIN main.questions question ON question.id = seed_tags.question_id
    `);
  } finally {
    sqlite.exec("DETACH DATABASE question_seed");
  }
}
