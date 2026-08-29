import { count } from "drizzle-orm";
import { db, migrateDatabase } from "./client";
import { questions, users } from "./schema";
import { validatePassword, validateUsername } from "../lib/validation";

export async function initializeDatabase() {
  migrateDatabase();
  const questionCount = await db.select({ total: count() }).from(questions);
  if (!questionCount[0]?.total) {
    throw new Error("题库为空，请确认 DATABASE_PATH 指向 questions.sqlite3");
  }

  const userCount = await db.select({ total: count() }).from(users);
  if (userCount[0]?.total) return;

  const username = validateUsername(process.env.ADMIN_USERNAME);
  const password = validatePassword(process.env.ADMIN_PASSWORD);
  const passwordHash = await Bun.password.hash(password, {
    algorithm: "argon2id",
  });
  await db.insert(users).values({
    username,
    passwordHash,
    role: "admin",
    mustChangePassword: false,
  });
}
