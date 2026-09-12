import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type {
  AttemptResponse, ExamCurrentResponse, ExamListResponse, ExamQuestionView,
  ExamResultResponse, QuestionView,
} from "../../shared/types";
import { db } from "../db/client";
import { examItems, examPapers, questions, questionTags } from "../db/schema";
import { isAnswerCorrect, parseStringArray } from "../lib/answers";
import { type AppEnv, requireAuth } from "../lib/auth";
import {
  completedExams, EXAM_KINDS, type ExamPaper, examSummary, paperItems,
  settleActiveExam, settleExam,
} from "../lib/exam";
import { readJsonBody } from "../lib/validation";
import { loadQuestionViews, shuffle, shuffledOptions } from "./study";

const exam = new Hono<AppEnv>();
exam.use("*", requireAuth);

function ownedPaper(userId: number, id: number, submit = false) {
  if (!Number.isInteger(id) || id < 1) return undefined;
  return db.transaction((tx) => {
    const paper = tx.select().from(examPapers)
      .where(and(eq(examPapers.id, id), eq(examPapers.userId, userId))).get();
    return paper ? settleExam(tx, paper, Date.now(), submit) : undefined;
  });
}

function readExamAnswer(body: Record<string, unknown>) {
  if (!body || !Array.isArray(body.answer) || !body.answer.every((item) => typeof item === "string")) {
    return null;
  }
  return body.answer as string[];
}

function isExamStartConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? error.code : undefined;
  return code === "SQLITE_BUSY"
    || /^UNIQUE constraint failed: (?:exam_papers\.user_id, exam_papers\.current_key|index ['"]exam_papers_user_current_unique['"])$/.test(error.message)
    || (error.cause !== error && isExamStartConflict(error.cause));
}

function toExamQuestions(paper: ExamPaper, views: QuestionView[]): ExamQuestionView[] {
  const items = paperItems(paper.id);
  const byId = new Map(views.map((view) => [view.id, view]));
  const completed = paper.status === "completed";
  const solutions = completed && items.length
    ? db.select({ id: questions.id, correctAnswerJson: questions.correctAnswerJson, analysisText: questions.analysisText })
        .from(questions).where(inArray(questions.id, items.map((item) => item.questionId))).all()
    : [];
  const solutionById = new Map(solutions.map((row) => [row.id, {
    correctAnswers: parseStringArray(row.correctAnswerJson), analysisText: row.analysisText,
  }]));
  return items.flatMap((item) => {
    const view = byId.get(item.questionId);
    if (!view) return [];
    return [{
      ...view,
      kind: item.kind,
      options: parseStringArray(item.optionsJson),
      history: null,
      pendingAttempt: undefined,
      solution: completed ? solutionById.get(item.questionId) : undefined,
      position: item.position,
      answer: parseStringArray(item.answerJson),
      isCorrect: completed ? item.isCorrect : null,
      corrected: completed && item.correctedAt !== null,
    }];
  });
}

async function currentResponse(userId: number, paper: ExamPaper | null, autoSubmittedId: number | null): Promise<ExamCurrentResponse> {
  if (!paper) return { serverNow: Date.now(), exam: null, questions: [], autoSubmittedId };
  const views = await loadQuestionViews(userId, paperItems(paper.id).map((item) => item.questionId));
  const state = db.transaction((tx) => {
    const row = tx.select().from(examPapers)
      .where(and(eq(examPapers.id, paper.id), eq(examPapers.userId, userId))).get();
    const serverNow = Date.now();
    const current = row ? settleExam(tx, row, serverNow) : null;
    return {
      current, serverNow,
      autoSubmittedId: row?.status === "active" && current?.status === "completed" ? row.id : autoSubmittedId,
    };
  });
  if (!state.current || state.current.status === "completed") {
    return { serverNow: state.serverNow, exam: null, questions: [], autoSubmittedId: state.autoSubmittedId };
  }
  return {
    serverNow: state.serverNow, exam: examSummary(state.current),
    questions: toExamQuestions(state.current, views), autoSubmittedId: state.autoSubmittedId,
  };
}

async function resultResponse(paper: ExamPaper): Promise<ExamResultResponse> {
  const views = await loadQuestionViews(paper.userId, paperItems(paper.id).map((item) => item.questionId));
  return { serverNow: Date.now(), exam: examSummary(paper), questions: toExamQuestions(paper, views) };
}

exam.get("/", (c) => {
  const userId = c.get("user").id;
  const { active } = settleActiveExam(userId);
  const papers = completedExams(userId);
  const recent = papers.slice(0, 5);
  const result: ExamListResponse = {
    exams: papers.map((paper) => examSummary(paper)),
    stats: {
      count: papers.length,
      best: papers.reduce((best, paper) => Math.max(best, paper.score), 0),
      recentAverage: recent.length ? Math.round(recent.reduce((sum, paper) => sum + paper.score, 0) / recent.length * 10) / 10 : 0,
    },
    activeId: active?.id ?? null,
  };
  return c.json(result);
});

exam.post("/", async (c) => {
  const userId = c.get("user").id;
  let started: { paper: ExamPaper | null; autoSubmittedId: number | null };
  try {
    started = db.transaction((tx) => {
      const existing = tx.select().from(examPapers)
        .where(and(eq(examPapers.userId, userId), eq(examPapers.status, "active"))).get();
      const now = Date.now();
      const settled = existing ? settleExam(tx, existing, now) : null;
      if (settled?.status === "active") return { paper: settled, autoSubmittedId: null };
      if (settled?.status === "completed") return { paper: null, autoSubmittedId: settled.id };
      const pool = tx.selectDistinct({
        id: questions.id, kind: questions.kind, stem: questions.stem, optionsJson: questions.optionsJson,
      }).from(questions).innerJoin(questionTags, eq(questionTags.questionId, questions.id))
        .where(and(eq(questionTags.tag, "技能"), inArray(questions.kind, EXAM_KINDS.map((row) => row.kind)))).all();
      const selected = EXAM_KINDS.flatMap(({ kind, total }) => {
        const candidates = pool.filter((question) => question.kind === kind);
        return candidates.length >= total
          ? shuffle(candidates).slice(0, total).map((question) => ({ ...question, kind }))
          : [];
      });
      if (selected.length !== 50) return { paper: null, autoSubmittedId: null };
      const startedAt = Date.now();
      const paper = tx.insert(examPapers).values({
        userId, startedAt, deadline: startedAt + 20 * 60 * 1000, createdAt: startedAt,
      }).returning().get();
      tx.insert(examItems).values(selected.map((question, index) => ({
        paperId: paper.id, position: index + 1, questionId: question.id, kind: question.kind,
        optionsJson: JSON.stringify(shuffledOptions(question.stem, parseStringArray(question.optionsJson))),
      }))).run();
      return { paper, autoSubmittedId: null };
    });
  } catch (error) {
    if (!isExamStartConflict(error)) throw error;
    try {
      const active = db.select().from(examPapers)
        .where(and(eq(examPapers.userId, userId), eq(examPapers.status, "active"))).get();
      if (active) return c.json(await currentResponse(userId, active, null));
    } catch (fallbackError) {
      if (!isExamStartConflict(fallbackError)) throw fallbackError;
    }
    return c.json({ error: "考试正在创建，请稍后重试" }, 409);
  }
  if (!started.paper && started.autoSubmittedId) {
    return c.json(await currentResponse(userId, null, started.autoSubmittedId));
  }
  if (!started.paper) return c.json({ error: "技能题库数量不足，无法开考" }, 409);
  return c.json(await currentResponse(userId, started.paper, started.autoSubmittedId));
});

exam.get("/current", async (c) => {
  const userId = c.get("user").id;
  const { active, autoSubmittedId } = settleActiveExam(userId);
  return c.json(await currentResponse(userId, active, autoSubmittedId));
});

exam.put("/:id/answers/:questionId", async (c) => {
  const userId = c.get("user").id;
  const id = Number(c.req.param("id"));
  const questionId = Number(c.req.param("questionId"));
  const paper = ownedPaper(userId, id);
  if (!paper) return c.json({ error: "考试不存在" }, 404);
  if (paper.status === "completed") return c.json({ error: "考试已结束" }, 409);
  const body = await readJsonBody(c.req.raw);
  const answer = readExamAnswer(body);
  const outcome = db.transaction((tx) => {
    const current = tx.select().from(examPapers)
      .where(and(eq(examPapers.id, id), eq(examPapers.userId, userId))).get();
    if (!current) return "missing";
    if (settleExam(tx, current, Date.now()).status === "completed") return "ended";
    if (!answer) return "invalid";
    if (!Number.isInteger(questionId) || questionId < 1) return "question";
    const item = tx.select().from(examItems)
      .where(and(eq(examItems.paperId, id), eq(examItems.questionId, questionId))).get();
    if (!item) return "question";
    if (item.kind !== "Checkbox" && answer.length > 1) return "invalid";
    if (answer.some((value) => !parseStringArray(item.optionsJson).includes(value))) return "options";
    tx.update(examItems).set({ answerJson: JSON.stringify(answer) }).where(eq(examItems.id, item.id)).run();
    return "saved";
  });
  if (outcome === "missing") return c.json({ error: "考试不存在" }, 404);
  if (outcome === "ended") return c.json({ error: "考试已结束" }, 409);
  if (outcome === "question") return c.json({ error: "题目不在该考试中" }, 404);
  if (outcome === "invalid") return c.json({ error: "答案格式不正确" }, 400);
  if (outcome === "options") return c.json({ error: "答案不在可选项中" }, 400);
  return c.json({ saved: true });
});

exam.post("/:id/submit", async (c) => {
  const paper = ownedPaper(c.get("user").id, Number(c.req.param("id")), true);
  if (!paper) return c.json({ error: "考试不存在" }, 404);
  return c.json(await resultResponse(paper));
});

exam.get("/:id", async (c) => {
  const paper = ownedPaper(c.get("user").id, Number(c.req.param("id")));
  if (!paper) return c.json({ error: "考试不存在" }, 404);
  if (paper.status === "active") return c.json({ error: "考试进行中" }, 409);
  return c.json(await resultResponse(paper));
});

exam.post("/wrong-attempt/:questionId", async (c) => {
  const userId = c.get("user").id;
  settleActiveExam(userId);
  const questionId = Number(c.req.param("questionId"));
  if (!Number.isInteger(questionId) || questionId < 1) return c.json({ error: "考试错题不存在" }, 404);
  const body = await readJsonBody(c.req.raw);
  const answer = readExamAnswer(body);
  settleActiveExam(userId);
  const wrong = db.select({ item: examItems, question: questions }).from(examItems)
    .innerJoin(examPapers, eq(examPapers.id, examItems.paperId))
    .innerJoin(questions, eq(questions.id, examItems.questionId))
    .where(and(eq(examPapers.userId, userId), eq(examItems.questionId, questionId), eq(examItems.isCorrect, false)))
    .orderBy(desc(examPapers.submittedAt), desc(examPapers.id)).limit(1).get();
  if (!wrong) return c.json({ error: "考试错题不存在" }, 404);
  if (!answer) return c.json({ error: "答案格式不正确" }, 400);
  if (!answer.length || (wrong.item.kind !== "Checkbox" && answer.length !== 1)) {
    return c.json({ error: "请先完成作答" }, 400);
  }
  const options = parseStringArray(wrong.item.optionsJson);
  if (answer.some((value) => !options.includes(value))) return c.json({ error: "答案不在可选项中" }, 400);
  const correctAnswers = parseStringArray(wrong.question.correctAnswerJson);
  const isCorrect = isAnswerCorrect(answer, correctAnswers);
  if (isCorrect) {
    db.update(examItems).set({ correctedAt: Date.now() }).where(and(
      eq(examItems.questionId, questionId), eq(examItems.isCorrect, false), isNull(examItems.correctedAt),
      inArray(examItems.paperId, db.select({ id: examPapers.id }).from(examPapers).where(eq(examPapers.userId, userId))),
    )).run();
  }
  const result: AttemptResponse = {
    attemptId: 0, isCorrect, history: null, correctAnswers, analysisText: wrong.question.analysisText,
  };
  return c.json(result);
});

export default exam;
