import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const questions = sqliteTable("questions", {
  id: integer("id").primaryKey(),
  firstCollectionId: integer("first_collection_id").notNull(),
  position: integer("position").notNull(),
  externalId: text("external_id").notNull(),
  kind: text("kind").notNull(),
  stem: text("stem").notNull(),
  optionsJson: text("options_json").notNull(),
  correctAnswerJson: text("correct_answer_json").notNull(),
  analysisText: text("analysis_text").notNull(),
  rawQuestionJson: text("raw_question_json").notNull(),
  fingerprint: text("fingerprint").notNull(),
  capturedAt: text("captured_at").notNull(),
});

export const questionTags = sqliteTable("question_tags", {
  questionId: integer("question_id").notNull(),
  tag: text("tag").notNull(),
});
