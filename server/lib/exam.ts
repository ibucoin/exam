import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { DashboardResponse, ExamKindBreakdown, ExamRule, ExamSummary } from "../../shared/types";
import { db } from "../db/client";
import { examItems, examPapers, questions } from "../db/schema";
import { isAnswerCorrect, parseStringArray } from "./answers";

export type ExamPaper = typeof examPapers.$inferSelect;
export type ExamItem = typeof examItems.$inferSelect;
export type ExamTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const EXAM_KINDS = [
  { kind: "Radio", total: 50 },
  { kind: "Checkbox", total: 30 },
  { kind: "Judge", total: 20 },
] as const;
export const EXAM_POINT = 1;
export const EXAM_MINUTES = 20;
export const EXAM_TOTAL = EXAM_KINDS.reduce((sum, row) => sum + row.total, 0);
export const EXAM_FULL_SCORE = EXAM_TOTAL * EXAM_POINT;
export const EXAM_RULE: ExamRule = {
  minutes: EXAM_MINUTES,
  total: EXAM_TOTAL,
  point: EXAM_POINT,
  fullScore: EXAM_FULL_SCORE,
  kinds: EXAM_KINDS.map(({ kind, total }) => ({ kind, total })),
};

function examPoint(total: number) {
  return total > 0 ? EXAM_FULL_SCORE / total : EXAM_POINT;
}

export function paperItems(paperId: number) {
  return db.select().from(examItems)
    .where(eq(examItems.paperId, paperId))
    .orderBy(asc(examItems.position)).all();
}

export function settleExam(tx: ExamTransaction, paper: ExamPaper, now: number, submit = false): ExamPaper {
  if (paper.status !== "active" || (!submit && now <= paper.deadline)) return paper;
  const items = tx.select({ item: examItems, correctAnswerJson: questions.correctAnswerJson })
    .from(examItems)
    .innerJoin(questions, eq(questions.id, examItems.questionId))
    .where(eq(examItems.paperId, paper.id)).all();
  const point = examPoint(items.length);
  let score = 0;
  for (const { item, correctAnswerJson } of items) {
    const answer = parseStringArray(item.answerJson);
    const isCorrect = answer.length ? isAnswerCorrect(answer, parseStringArray(correctAnswerJson)) : null;
    if (isCorrect) score += point;
    tx.update(examItems).set({ isCorrect }).where(eq(examItems.id, item.id)).run();
  }
  return tx.update(examPapers)
    .set({ status: "completed", currentKey: null, submittedAt: Math.min(now, paper.deadline), score: Math.round(score) })
    .where(and(eq(examPapers.id, paper.id), eq(examPapers.status, "active")))
    .returning().get()!;
}

export function settleActiveExam(userId: number) {
  return db.transaction((tx) => {
    const paper = tx.select().from(examPapers)
      .where(and(eq(examPapers.userId, userId), eq(examPapers.status, "active"))).get();
    if (!paper) return { active: null, autoSubmittedId: null };
    const settled = settleExam(tx, paper, Date.now());
    return settled.status === "active"
      ? { active: settled, autoSubmittedId: null }
      : { active: null, autoSubmittedId: settled.id };
  });
}

export function examSummary(paper: ExamPaper, items = paperItems(paper.id)): ExamSummary {
  const completed = paper.status === "completed";
  const total = items.length || EXAM_TOTAL;
  const point = examPoint(total);
  const breakdown: ExamKindBreakdown[] = EXAM_KINDS.map(({ kind }) => {
    const rows = items.filter((item) => item.kind === kind);
    const correct = completed ? rows.filter((item) => item.isCorrect === true).length : 0;
    const wrong = completed ? rows.filter((item) => item.isCorrect === false).length : 0;
    return {
      kind,
      total: rows.length,
      correct,
      wrong,
      unanswered: rows.filter((item) => !parseStringArray(item.answerJson).length).length,
      score: correct * point,
      fullScore: rows.length * point,
    };
  }).filter((row) => row.total > 0);
  const correct = breakdown.reduce((sum, row) => sum + row.correct, 0);
  const wrong = breakdown.reduce((sum, row) => sum + row.wrong, 0);
  const unanswered = breakdown.reduce((sum, row) => sum + row.unanswered, 0);
  return {
    id: paper.id,
    status: paper.status,
    startedAt: paper.startedAt,
    deadline: paper.deadline,
    submittedAt: paper.submittedAt,
    durationMs: paper.submittedAt === null ? null : paper.submittedAt - paper.startedAt,
    total,
    answered: total - unanswered,
    correct, wrong, unanswered,
    score: paper.score,
    fullScore: EXAM_FULL_SCORE,
    accuracy: Math.round((correct / total) * 1000) / 10,
    breakdown,
  };
}

export function completedExams(userId: number) {
  return db.select().from(examPapers)
    .where(and(eq(examPapers.userId, userId), eq(examPapers.status, "completed")))
    .orderBy(desc(examPapers.submittedAt), desc(examPapers.id)).all();
}

export function examDashboard(userId: number): DashboardResponse["exam"] {
  const { active } = settleActiveExam(userId);
  const row = db.select({
    count: sql<number>`COUNT(*)`,
    best: sql<number>`COALESCE(MAX(${examPapers.score}), 0)`,
  }).from(examPapers)
    .where(and(eq(examPapers.userId, userId), eq(examPapers.status, "completed"))).get()!;
  const last = db.select().from(examPapers)
    .where(and(eq(examPapers.userId, userId), eq(examPapers.status, "completed")))
    .orderBy(desc(examPapers.submittedAt), desc(examPapers.id)).limit(1).get();
  const wrong = db.select({ count: sql<number>`COUNT(DISTINCT ${examItems.questionId})` })
    .from(examItems).innerJoin(examPapers, eq(examPapers.id, examItems.paperId))
    .where(and(
      eq(examPapers.userId, userId), eq(examItems.isCorrect, false), isNull(examItems.correctedAt),
    )).get()!;
  return {
    count: Number(row.count),
    best: Number(row.best),
    lastScore: last?.score ?? null,
    lastSubmittedAt: last?.submittedAt ?? null,
    activeId: active?.id ?? null,
    wrongPending: Number(wrong.count),
  };
}
