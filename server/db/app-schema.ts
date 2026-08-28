import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { questions } from "./source-schema";

const now = sql`(unixepoch() * 1000)`;

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
    mustChangePassword: integer("must_change_password", { mode: "boolean" })
      .notNull()
      .default(true),
    isDisabled: integer("is_disabled", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at").notNull().default(now),
  },
  (table) => [uniqueIndex("users_username_unique").on(table.username)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull().default(now),
    createdAt: integer("created_at").notNull().default(now),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const attempts = sqliteTable(
  "attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    answerJson: text("answer_json").notNull(),
    isCorrect: integer("is_correct", { mode: "boolean" }),
    createdAt: integer("created_at").notNull().default(now),
    assessedAt: integer("assessed_at"),
  },
  (table) => [
    index("attempts_user_question_idx").on(table.userId, table.questionId),
  ],
);

export const questionStates = sqliteTable(
  "question_states",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    firstAttemptCorrect: integer("first_attempt_correct", { mode: "boolean" })
      .notNull(),
    lastAttemptCorrect: integer("last_attempt_correct", { mode: "boolean" })
      .notNull(),
    mastered: integer("mastered", { mode: "boolean" }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(1),
    lastAnswerJson: text("last_answer_json").notNull(),
    lastAnsweredAt: integer("last_answered_at").notNull().default(now),
  },
  (table) => [primaryKey({ columns: [table.userId, table.questionId] })],
);

export const favorites = sqliteTable(
  "favorites",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
  },
  (table) => [primaryKey({ columns: [table.userId, table.questionId] })],
);

export const questionNotes = sqliteTable(
  "question_notes",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (table) => [primaryKey({ columns: [table.userId, table.questionId] })],
);

export const userProgress = sqliteTable("user_progress", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  lastSkillGroup: integer("last_skill_group").notNull().default(1),
  lastSkillQuestionId: integer("last_skill_question_id"),
  lastPrescriptionQuestionId: integer("last_prescription_question_id"),
  updatedAt: integer("updated_at").notNull().default(now),
});
