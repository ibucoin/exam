import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
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

export const fsrsCards = sqliteTable(
  "fsrs_cards",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    due: integer("due").notNull(),
    stability: real("stability").notNull(),
    difficulty: real("difficulty").notNull(),
    elapsedDays: integer("elapsed_days").notNull(),
    scheduledDays: integer("scheduled_days").notNull(),
    learningSteps: integer("learning_steps").notNull(),
    reps: integer("reps").notNull(),
    lapses: integer("lapses").notNull(),
    state: integer("state").notNull(),
    lastReview: integer("last_review"),
    lastRating: integer("last_rating").notNull(),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.questionId] }),
    index("fsrs_cards_user_due_idx").on(table.userId, table.due),
  ],
);

export const validationRounds = sqliteTable(
  "validation_rounds",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["active", "completed", "abandoned"] })
      .notNull()
      .default("active"),
    currentKey: integer("current_key", { mode: "boolean" }).default(true),
    createdAt: integer("created_at").notNull().default(now),
    completedAt: integer("completed_at"),
  },
  (table) => [
    uniqueIndex("validation_rounds_user_current_unique").on(
      table.userId,
      table.currentKey,
    ),
  ],
);

export const validationRoundItems = sqliteTable(
  "validation_round_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roundId: integer("round_id")
      .notNull()
      .references(() => validationRounds.id, { onDelete: "cascade" }),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    optionsJson: text("options_json").notNull(),
    attemptId: integer("attempt_id").references(() => attempts.id, {
      onDelete: "set null",
    }),
    isCorrect: integer("is_correct", { mode: "boolean" }),
    rating: integer("rating"),
    ratedAt: integer("rated_at"),
  },
  (table) => [
    uniqueIndex("validation_round_items_position_unique").on(
      table.roundId,
      table.position,
    ),
    uniqueIndex("validation_round_items_question_unique").on(
      table.roundId,
      table.questionId,
    ),
  ],
);

export const fsrsReviewLogs = sqliteTable(
  "fsrs_review_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    roundItemId: integer("round_item_id").references(
      () => validationRoundItems.id,
      { onDelete: "cascade" },
    ),
    attemptId: integer("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    state: integer("state").notNull(),
    due: integer("due").notNull(),
    stability: real("stability").notNull(),
    difficulty: real("difficulty").notNull(),
    elapsedDays: integer("elapsed_days").notNull(),
    lastElapsedDays: integer("last_elapsed_days").notNull(),
    scheduledDays: integer("scheduled_days").notNull(),
    learningSteps: integer("learning_steps").notNull(),
    reviewedAt: integer("reviewed_at").notNull(),
  },
  (table) => [
    index("fsrs_review_logs_user_question_idx").on(
      table.userId,
      table.questionId,
    ),
  ],
);

export const studyRounds = sqliteTable(
  "study_rounds",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope", { enum: ["技能", "处方审核"] }).notNull(),
    roundNo: integer("round_no").notNull(),
    status: text("status", { enum: ["active", "completed"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull().default(now),
    completedAt: integer("completed_at"),
  },
  (table) => [
    uniqueIndex("study_rounds_user_scope_no_unique").on(
      table.userId,
      table.scope,
      table.roundNo,
    ),
  ],
);

export const roundAnswers = sqliteTable(
  "round_answers",
  {
    roundId: integer("round_id")
      .notNull()
      .references(() => studyRounds.id, { onDelete: "cascade" }),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    attemptId: integer("attempt_id").references(() => attempts.id, {
      onDelete: "set null",
    }),
    answerJson: text("answer_json").notNull(),
    isCorrect: integer("is_correct", { mode: "boolean" }),
    answeredAt: integer("answered_at").notNull().default(now),
  },
  (table) => [
    primaryKey({ columns: [table.roundId, table.questionId] }),
    index("round_answers_attempt_idx").on(table.attemptId),
  ],
);

export const examPapers = sqliteTable(
  "exam_papers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["active", "completed"] })
      .notNull()
      .default("active"),
    currentKey: integer("current_key", { mode: "boolean" }).default(true),
    startedAt: integer("started_at").notNull(),
    deadline: integer("deadline").notNull(),
    submittedAt: integer("submitted_at"),
    score: integer("score").notNull().default(0),
    createdAt: integer("created_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("exam_papers_user_current_unique").on(table.userId, table.currentKey),
  ],
);

export const examItems = sqliteTable(
  "exam_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    paperId: integer("paper_id")
      .notNull()
      .references(() => examPapers.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["Radio", "Checkbox", "Judge"] }).notNull(),
    optionsJson: text("options_json").notNull(),
    answerJson: text("answer_json").notNull().default("[]"),
    isCorrect: integer("is_correct", { mode: "boolean" }),
    correctedAt: integer("corrected_at"),
  },
  (table) => [
    uniqueIndex("exam_items_position_unique").on(table.paperId, table.position),
    uniqueIndex("exam_items_question_unique").on(table.paperId, table.questionId),
    index("exam_items_paper_id_idx").on(table.paperId),
  ],
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
