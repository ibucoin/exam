import { count, eq } from "drizzle-orm";
import { db, migrateDatabase, restoreQuestionTagsFromSeed } from "./client";
import { questions, questionTags, users } from "./schema";
import { validatePassword, validateUsername } from "../lib/validation";

export async function initializeDatabase() {
  migrateDatabase();
  restoreQuestionTagsFromSeed();
  const questionCount = await db.select({ total: count() }).from(questions);
  if (!questionCount[0]?.total) {
    throw new Error("题库为空，请确认 DATABASE_PATH 指向 questions.sqlite3");
  }
  for (const scope of ["技能", "处方审核"] as const) {
    const result = await db
      .select({ total: count() })
      .from(questionTags)
      .where(eq(questionTags.tag, scope));
    if (!result[0]?.total) throw new Error(`${scope}题库为空，请检查 question_tags`);
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
