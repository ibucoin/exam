import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  sql,
} from "drizzle-orm";
import { Hono } from "hono";
import type {
  AttemptResponse,
  DashboardResponse,
  PrescriptionResponse,
  QuestionHistory,
  QuestionKind,
  QuestionScope,
  QuestionView,
  RepeatedWrongQuestion,
  ReviewQuestionView,
  ReviewResponse,
  RoundArchiveResponse,
  RoundQuestionView,
  RoundScopeOverview,
  RoundsOverviewResponse,
  RoundSummary,
  ScopeStats,
  SearchResponse,
  SearchResult,
  SkillGroupResponse,
} from "../../shared/types";
import { db } from "../db/client";
import {
  attempts,
  favorites,
  fsrsCards,
  fsrsReviewLogs,
  questions,
  questionNotes,
  questionStates,
  questionTags,
  roundAnswers,
  studyRounds,
  userProgress,
} from "../db/schema";
import { type AppEnv, requireAuth } from "../lib/auth";
import { FSRS_STABLE_DAYS, Rating, scheduleQuestion } from "../lib/fsrs";
import { readJsonBody } from "../lib/validation";

const GROUP_SIZE = 20;
const SCOPES = ["技能", "处方审核"] as const;
const study = new Hono<AppEnv>();
study.use("*", requireAuth);

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toHistory(row: {
  firstAttemptCorrect: boolean | null;
  lastAttemptCorrect: boolean | null;
  mastered: boolean | null;
  attemptCount: number | null;
  lastAnswerJson: string | null;
}): QuestionHistory | null {
  if (
    row.firstAttemptCorrect === null ||
    row.lastAttemptCorrect === null ||
    row.mastered === null ||
    row.attemptCount === null ||
    row.lastAnswerJson === null
  ) {
    return null;
  }
  return {
    firstAttemptCorrect: row.firstAttemptCorrect,
    lastAttemptCorrect: row.lastAttemptCorrect,
    mastered: row.mastered,
    attemptCount: row.attemptCount,
    lastAnswer: parseStringArray(row.lastAnswerJson),
  };
}

async function loadQuestionViews(userId: number, questionIds: number[]) {
  if (!questionIds.length) return [];
  const rows = await db
    .select({
      id: questions.id,
      externalId: questions.externalId,
      kind: questions.kind,
      stem: questions.stem,
      optionsJson: questions.optionsJson,
      correctAnswerJson: questions.correctAnswerJson,
      analysisText: questions.analysisText,
      firstAttemptCorrect: questionStates.firstAttemptCorrect,
      lastAttemptCorrect: questionStates.lastAttemptCorrect,
      mastered: questionStates.mastered,
      attemptCount: questionStates.attemptCount,
      lastAnswerJson: questionStates.lastAnswerJson,
      favoriteUserId: favorites.userId,
      note: questionNotes.content,
    })
    .from(questions)
    .leftJoin(
      questionStates,
      and(
        eq(questionStates.questionId, questions.id),
        eq(questionStates.userId, userId),
      ),
    )
    .leftJoin(
      favorites,
      and(eq(favorites.questionId, questions.id), eq(favorites.userId, userId)),
    )
    .leftJoin(
      questionNotes,
      and(
        eq(questionNotes.questionId, questions.id),
        eq(questionNotes.userId, userId),
      ),
    )
    .where(inArray(questions.id, questionIds));

  const pendingRows = await db
    .select({
      id: attempts.id,
      questionId: attempts.questionId,
      answerJson: attempts.answerJson,
    })
    .from(attempts)
    .where(
      and(
        eq(attempts.userId, userId),
        inArray(attempts.questionId, questionIds),
        isNull(attempts.isCorrect),
      ),
    )
    .orderBy(desc(attempts.id));
  const pendingByQuestion = new Map<
    number,
    { attemptId: number; answer: string[] }
  >();
  for (const pending of pendingRows) {
    if (!pendingByQuestion.has(pending.questionId)) {
      pendingByQuestion.set(pending.questionId, {
        attemptId: pending.id,
        answer: parseStringArray(pending.answerJson),
      });
    }
  }

  const byId = new Map<number, QuestionView>();
  for (const row of rows) {
    const history = toHistory(row);
    const pendingAttempt = pendingByQuestion.get(row.id);
    byId.set(row.id, {
      id: row.id,
      externalId: row.externalId,
      kind: row.kind as QuestionKind,
      stem: row.stem,
      options: parseStringArray(row.optionsJson),
      history,
      isFavorite: row.favoriteUserId !== null,
      note: row.note ?? "",
      ...(history || pendingAttempt
        ? {
            solution: {
              correctAnswers: parseStringArray(row.correctAnswerJson),
              analysisText: row.analysisText,
            },
          }
        : {}),
      ...(pendingAttempt ? { pendingAttempt } : {}),
    });
  }
  return questionIds.flatMap((id) => {
    const question = byId.get(id);
    return question ? [question] : [];
  });
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function updateQuestionState(
  tx: Transaction,
  userId: number,
  questionId: number,
  answerJson: string,
  isCorrect: boolean,
) {
  const now = Date.now();
  tx
    .insert(questionStates)
    .values({
      userId,
      questionId,
      firstAttemptCorrect: isCorrect,
      lastAttemptCorrect: isCorrect,
      mastered: isCorrect,
      attemptCount: 1,
      lastAnswerJson: answerJson,
      lastAnsweredAt: now,
    })
    .onConflictDoUpdate({
      target: [questionStates.userId, questionStates.questionId],
      set: {
        lastAttemptCorrect: isCorrect,
        mastered: isCorrect,
        attemptCount: sql`${questionStates.attemptCount} + 1`,
        lastAnswerJson: answerJson,
        lastAnsweredAt: now,
      },
    })
    .run();
}

async function getHistory(userId: number, questionId: number) {
  const row = await db.query.questionStates.findFirst({
    where: and(
      eq(questionStates.userId, userId),
      eq(questionStates.questionId, questionId),
    ),
  });
  return row
    ? {
        firstAttemptCorrect: row.firstAttemptCorrect,
        lastAttemptCorrect: row.lastAttemptCorrect,
        mastered: row.mastered,
        attemptCount: row.attemptCount,
        lastAnswer: parseStringArray(row.lastAnswerJson),
      }
    : null;
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function shuffledOptions(
  stem: string,
  options: string[],
  random?: () => number,
) {
  const text = `${stem}\n${options.join("\n")}`;
  const dependsOnOrder =
    /(?:^|[^a-z])(?:[A-ZＡ-Ｚ]\s*(?:、|,|，|和|或|及|\/|\+)\s*)+[A-ZＡ-Ｚ](?:[^a-z]|$)/i.test(text) ||
    /(以上|上述).*(选项|说法|答案|均|都)|(?:均|都).*(正确|错误|符合|不符合)/.test(text);
  return dependsOnOrder ? options : shuffle(options, random);
}

function isScope(value: unknown): value is QuestionScope {
  return value === "技能" || value === "处方审核";
}

function completeRoundIfDone(
  tx: Transaction,
  roundId: number,
  scope: QuestionScope,
  now: number,
) {
  const total = tx
    .select({ total: count() })
    .from(questionTags)
    .where(eq(questionTags.tag, scope))
    .get();
  const done = tx
    .select({ total: count() })
    .from(roundAnswers)
    .where(
      and(eq(roundAnswers.roundId, roundId), isNotNull(roundAnswers.isCorrect)),
    )
    .get();
  if ((total?.total ?? 0) > 0 && (done?.total ?? 0) >= (total?.total ?? 0)) {
    tx.update(studyRounds)
      .set({ status: "completed", completedAt: now })
      .where(and(eq(studyRounds.id, roundId), eq(studyRounds.status, "active")))
      .run();
    return true;
  }
  return false;
}

type StudyRound = typeof studyRounds.$inferSelect;

function latestRound(userId: number, scope: QuestionScope) {
  return db
    .select()
    .from(studyRounds)
    .where(and(eq(studyRounds.userId, userId), eq(studyRounds.scope, scope)))
    .orderBy(desc(studyRounds.roundNo))
    .limit(1)
    .get();
}

function ensureRound(userId: number, scope: QuestionScope): StudyRound {
  const existing = latestRound(userId, scope);
  if (existing) return existing;
  try {
    return db.transaction((tx) => {
      const now = Date.now();
      const round = tx
        .insert(studyRounds)
        .values({ userId, scope, roundNo: 1, createdAt: now })
        .returning()
        .get();
      tx.run(sql`
        INSERT INTO round_answers (round_id, question_id, attempt_id, answer_json, is_correct, answered_at)
        SELECT ${round.id}, a.question_id, a.id, a.answer_json, a.is_correct, a.created_at
        FROM attempts a
        INNER JOIN question_tags qt ON qt.question_id = a.question_id AND qt.tag = ${scope}
        WHERE a.user_id = ${userId}
          AND a.id = (
            SELECT MIN(a2.id) FROM attempts a2
            WHERE a2.user_id = ${userId} AND a2.question_id = a.question_id
          )
      `);
      completeRoundIfDone(tx, round.id, scope, now);
      return tx
        .select()
        .from(studyRounds)
        .where(eq(studyRounds.id, round.id))
        .get()!;
    });
  } catch {
    return latestRound(userId, scope)!;
  }
}

async function roundSummary(round: StudyRound): Promise<RoundSummary> {
  const [row] = await db.all<{
    total: number;
    answered: number;
    correct: number;
    pendingAssess: number;
    firstPendingAssessId: number | null;
  }>(sql`
    SELECT
      (SELECT COUNT(*) FROM question_tags WHERE tag = ${round.scope}) AS total,
      (SELECT COUNT(*) FROM round_answers WHERE round_id = ${round.id} AND is_correct IS NOT NULL) AS answered,
      (SELECT COUNT(*) FROM round_answers WHERE round_id = ${round.id} AND is_correct = 1) AS correct,
      (SELECT COUNT(*) FROM round_answers WHERE round_id = ${round.id} AND is_correct IS NULL) AS pendingAssess,
      (SELECT MIN(question_id) FROM round_answers WHERE round_id = ${round.id} AND is_correct IS NULL) AS firstPendingAssessId
  `);
  const answered = Number(row?.answered ?? 0);
  const correct = Number(row?.correct ?? 0);
  return {
    id: round.id,
    roundNo: round.roundNo,
    status: round.status,
    total: Number(row?.total ?? 0),
    answered,
    correct,
    accuracy: answered ? Math.round((correct / answered) * 1000) / 10 : 0,
    pendingAssess: Number(row?.pendingAssess ?? 0),
    firstPendingAssessId: row?.firstPendingAssessId ?? null,
    createdAt: round.createdAt,
    completedAt: round.completedAt,
  };
}

async function toRoundQuestions(
  round: StudyRound,
  views: QuestionView[],
): Promise<RoundQuestionView[]> {
  const ids = views.map((view) => view.id);
  const answerRows = ids.length
    ? await db
        .select()
        .from(roundAnswers)
        .where(
          and(
            eq(roundAnswers.roundId, round.id),
            inArray(roundAnswers.questionId, ids),
          ),
        )
    : [];
  const byQuestion = new Map(answerRows.map((row) => [row.questionId, row]));
  return views.map((view) => {
    const row = byQuestion.get(view.id);
    const options =
      round.roundNo > 1 && view.kind !== "FillBlank"
        ? shuffledOptions(
            view.stem,
            view.options,
            seededRandom(round.id * 1_000_003 + view.id),
          )
        : view.options;
    if (!row) {
      return {
        ...view,
        options,
        solution: undefined,
        pendingAttempt: undefined,
        roundAnswer: null,
      };
    }
    return {
      ...view,
      options,
      pendingAttempt: undefined,
      roundAnswer: {
        attemptId: row.attemptId ?? 0,
        answer: parseStringArray(row.answerJson),
        isCorrect: row.isCorrect,
        answeredAt: row.answeredAt,
      },
    };
  });
}

async function scopeQuestionIds(scope: QuestionScope) {
  const rows = await db
    .select({ id: questions.id })
    .from(questions)
    .innerJoin(questionTags, eq(questionTags.questionId, questions.id))
    .where(eq(questionTags.tag, scope))
    .orderBy(asc(questions.id));
  return rows.map((row) => row.id);
}

function isAnswerCorrect(answer: string[], correctAnswers: string[]) {
  const normalize = (items: string[]) => [...new Set(items)].sort();
  const submitted = normalize(answer);
  const expected = normalize(correctAnswers);
  return (
    submitted.length === expected.length &&
    submitted.every((item, index) => item === expected[index])
  );
}

function readAnswer(body: Record<string, unknown>) {
  if (!Array.isArray(body.answer)) return null;
  return body.answer.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

study.get("/skills/:group", async (c) => {
  const group = Number(c.req.param("group"));
  if (!Number.isInteger(group) || group < 1) {
    return c.json({ error: "题组不存在" }, 404);
  }
  const ids = await scopeQuestionIds("技能");
  const totalGroups = Math.ceil(ids.length / GROUP_SIZE);
  if (group > totalGroups) {
    return c.json({ error: "题组不存在" }, 404);
  }

  const userId = c.get("user").id;
  const round = ensureRound(userId, "技能");
  const pageIds = ids.slice((group - 1) * GROUP_SIZE, group * GROUP_SIZE);
  const views = await loadQuestionViews(userId, pageIds);
  const answeredRows = await db
    .select({ questionId: roundAnswers.questionId })
    .from(roundAnswers)
    .where(eq(roundAnswers.roundId, round.id));
  const answeredSet = new Set(answeredRows.map((row) => row.questionId));
  const groupAnswered = Array.from({ length: totalGroups }, (_, index) =>
    ids
      .slice(index * GROUP_SIZE, (index + 1) * GROUP_SIZE)
      .filter((id) => answeredSet.has(id)).length,
  );
  const result: SkillGroupResponse = {
    group,
    groupSize: GROUP_SIZE,
    totalGroups,
    totalQuestions: ids.length,
    round: await roundSummary(round),
    groupAnswered,
    questions: await toRoundQuestions(round, views),
  };
  return c.json(result);
});

study.get("/prescriptions/:id?", async (c) => {
  const ids = await scopeQuestionIds("处方审核");
  const requestedIndex = Number(c.req.query("index"));
  let requestedId = ids[0];
  if (Number.isInteger(requestedIndex) && requestedIndex > 0) {
    requestedId = ids[requestedIndex - 1];
  } else if (c.req.param("id")) {
    requestedId = Number(c.req.param("id"));
  }
  const index = ids.findIndex((id) => id === requestedId);
  if (index < 0) {
    return c.json({ error: "题目不存在" }, 404);
  }
  const userId = c.get("user").id;
  const round = ensureRound(userId, "处方审核");
  const loaded = await loadQuestionViews(userId, [ids[index]]);
  const [question] = await toRoundQuestions(round, loaded);
  const result: PrescriptionResponse = {
    index: index + 1,
    totalQuestions: ids.length,
    previousId: ids[index - 1] ?? null,
    nextId: ids[index + 1] ?? null,
    round: await roundSummary(round),
    question,
  };
  return c.json(result);
});

study.post("/rounds/questions/:id/answer", async (c) => {
  const questionId = Number(c.req.param("id"));
  const body = await readJsonBody(c.req.raw);
  const answer = Number.isInteger(questionId) ? readAnswer(body) : null;
  if (!answer) {
    return c.json({ error: "答案格式不正确" }, 400);
  }
  const row = await db
    .select({ question: questions, tag: questionTags.tag })
    .from(questions)
    .innerJoin(questionTags, eq(questionTags.questionId, questions.id))
    .where(
      and(eq(questions.id, questionId), inArray(questionTags.tag, SCOPES)),
    )
    .get();
  if (!row || !isScope(row.tag)) {
    return c.json({ error: "题目不存在" }, 404);
  }
  const question = row.question;
  if (!answer.length || (question.kind !== "Checkbox" && answer.length !== 1)) {
    return c.json({ error: "请先完成作答" }, 400);
  }
  const options = parseStringArray(question.optionsJson);
  if (question.kind !== "FillBlank" && answer.some((item) => !options.includes(item))) {
    return c.json({ error: "答案不在可选项中" }, 400);
  }

  const userId = c.get("user").id;
  const round = ensureRound(userId, row.tag);
  if (round.status !== "active") {
    return c.json({ error: "本轮已完成，请先开启下一轮" }, 409);
  }

  const answerJson = JSON.stringify(answer);
  const correctAnswers = parseStringArray(question.correctAnswerJson);
  const isCorrect =
    question.kind === "FillBlank"
      ? null
      : isAnswerCorrect(answer, correctAnswers);
  let attemptId = 0;
  let duplicate = false;
  db.transaction((tx) => {
    const existing = tx
      .select({ questionId: roundAnswers.questionId })
      .from(roundAnswers)
      .where(
        and(
          eq(roundAnswers.roundId, round.id),
          eq(roundAnswers.questionId, questionId),
        ),
      )
      .get();
    if (existing) {
      duplicate = true;
      return;
    }
    const now = Date.now();
    const attempt = tx
      .insert(attempts)
      .values({
        userId,
        questionId,
        answerJson,
        isCorrect,
        ...(isCorrect === null ? {} : { assessedAt: now }),
      })
      .returning({ id: attempts.id })
      .get();
    attemptId = attempt.id;
    tx.insert(roundAnswers)
      .values({
        roundId: round.id,
        questionId,
        attemptId,
        answerJson,
        isCorrect,
        answeredAt: now,
      })
      .run();
    if (isCorrect !== null) {
      updateQuestionState(tx, userId, questionId, answerJson, isCorrect);
      completeRoundIfDone(tx, round.id, round.scope, now);
    }
  });
  if (duplicate) {
    return c.json({ error: "本轮该题已经作答" }, 409);
  }
  const result: AttemptResponse = {
    attemptId,
    isCorrect,
    history: await getHistory(userId, questionId),
    correctAnswers,
    analysisText: question.analysisText,
  };
  return c.json(result, 201);
});

study.post("/rounds/start", async (c) => {
  const body = await readJsonBody(c.req.raw);
  if (!isScope(body.scope)) {
    return c.json({ error: "题库范围不正确" }, 400);
  }
  const userId = c.get("user").id;
  const current = ensureRound(userId, body.scope);
  if (current.status !== "completed") {
    return c.json({ error: "当前轮次尚未完成，刷完全部题目后才能开启下一轮" }, 409);
  }
  const round = db
    .insert(studyRounds)
    .values({
      userId,
      scope: body.scope,
      roundNo: current.roundNo + 1,
      createdAt: Date.now(),
    })
    .returning()
    .get();
  return c.json(await roundSummary(round), 201);
});

async function scopeRoundsOverview(
  userId: number,
  scope: QuestionScope,
): Promise<RoundScopeOverview> {
  ensureRound(userId, scope);
  const roundRows = await db
    .select()
    .from(studyRounds)
    .where(and(eq(studyRounds.userId, userId), eq(studyRounds.scope, scope)))
    .orderBy(asc(studyRounds.roundNo));
  const rounds = await Promise.all(roundRows.map((round) => roundSummary(round)));

  const wrongRows = await db
    .select({
      questionId: roundAnswers.questionId,
      roundNo: studyRounds.roundNo,
    })
    .from(roundAnswers)
    .innerJoin(studyRounds, eq(studyRounds.id, roundAnswers.roundId))
    .where(
      and(
        eq(studyRounds.userId, userId),
        eq(studyRounds.scope, scope),
        eq(roundAnswers.isCorrect, false),
      ),
    );
  const wrongByQuestion = new Map<number, number[]>();
  for (const row of wrongRows) {
    const list = wrongByQuestion.get(row.questionId) ?? [];
    list.push(row.roundNo);
    wrongByQuestion.set(row.questionId, list);
  }
  const repeatedIds = [...wrongByQuestion.entries()]
    .filter(([, roundNos]) => roundNos.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
    .slice(0, 100)
    .map(([questionId]) => questionId);
  let repeatedWrong: RepeatedWrongQuestion[] = [];
  if (repeatedIds.length) {
    const scopeIds = scope === "技能" ? await scopeQuestionIds(scope) : [];
    const questionRows = await db
      .select({ id: questions.id, kind: questions.kind, stem: questions.stem })
      .from(questions)
      .where(inArray(questions.id, repeatedIds));
    const byId = new Map(questionRows.map((row) => [row.id, row]));
    repeatedWrong = repeatedIds.flatMap((id) => {
      const question = byId.get(id);
      if (!question) return [];
      const position = scopeIds.indexOf(id);
      return [{
        id,
        kind: question.kind as QuestionKind,
        stem: question.stem,
        wrongRounds: [...new Set(wrongByQuestion.get(id))].sort((a, b) => a - b),
        group: position >= 0 ? Math.floor(position / GROUP_SIZE) + 1 : null,
      }];
    });
  }
  return { scope, rounds, repeatedWrong };
}

study.get("/rounds/overview", async (c) => {
  const userId = c.get("user").id;
  const result: RoundsOverviewResponse = {
    skill: await scopeRoundsOverview(userId, "技能"),
    prescription: await scopeRoundsOverview(userId, "处方审核"),
  };
  return c.json(result);
});

study.get("/rounds/:id/questions", async (c) => {
  const roundId = Number(c.req.param("id"));
  if (!Number.isInteger(roundId)) {
    return c.json({ error: "轮次不存在" }, 404);
  }
  const userId = c.get("user").id;
  const round = await db.query.studyRounds.findFirst({
    where: and(eq(studyRounds.id, roundId), eq(studyRounds.userId, userId)),
  });
  if (!round) {
    return c.json({ error: "轮次不存在" }, 404);
  }
  const ids = await scopeQuestionIds(round.scope);
  const totalPages = Math.max(1, Math.ceil(ids.length / GROUP_SIZE));
  const page = Math.min(totalPages, Math.max(1, Number(c.req.query("page")) || 1));
  const pageIds = ids.slice((page - 1) * GROUP_SIZE, page * GROUP_SIZE);
  const views = await loadQuestionViews(userId, pageIds);
  const result: RoundArchiveResponse = {
    round: await roundSummary(round),
    scope: round.scope,
    page,
    pageSize: GROUP_SIZE,
    totalPages,
    questions: await toRoundQuestions(round, views),
  };
  return c.json(result);
});

study.post("/questions/:id/attempt", async (c) => {
  const questionId = Number(c.req.param("id"));
  const body = await readJsonBody(c.req.raw);
  const answer = Number.isInteger(questionId) ? readAnswer(body) : null;
  if (!answer) {
    return c.json({ error: "答案格式不正确" }, 400);
  }
  const question = await db.query.questions.findFirst({
    where: eq(questions.id, questionId),
  });
  if (!question) {
    return c.json({ error: "题目不存在" }, 404);
  }
  if (!answer.length || (question.kind !== "Checkbox" && answer.length !== 1)) {
    return c.json({ error: "请先完成作答" }, 400);
  }

  const options = parseStringArray(question.optionsJson);
  if (question.kind !== "FillBlank" && answer.some((item) => !options.includes(item))) {
    return c.json({ error: "答案不在可选项中" }, 400);
  }

  const userId = c.get("user").id;
  const answerJson = JSON.stringify(answer);
  const correctAnswers = parseStringArray(question.correctAnswerJson);
  const solution = {
    correctAnswers,
    analysisText: question.analysisText,
  };

  if (question.kind === "FillBlank") {
    const inserted = await db
      .insert(attempts)
      .values({ userId, questionId, answerJson, isCorrect: null })
      .returning({ id: attempts.id });
    const result: AttemptResponse = {
      attemptId: inserted[0].id,
      isCorrect: null,
      history: await getHistory(userId, questionId),
      ...solution,
    };
    return c.json(result, 201);
  }

  const isCorrect = isAnswerCorrect(answer, correctAnswers);
  const withFsrs = c.req.query("channel") === "review";
  let attemptId = 0;
  db.transaction((tx) => {
    const now = Date.now();
    const inserted = tx
      .insert(attempts)
      .values({
        userId,
        questionId,
        answerJson,
        isCorrect,
        assessedAt: now,
      })
      .returning({ id: attempts.id })
      .all();
    attemptId = inserted[0].id;
    updateQuestionState(tx, userId, questionId, answerJson, isCorrect);
    if (withFsrs && !isCorrect) {
      scheduleQuestion(tx, {
        userId,
        questionId,
        roundItemId: null,
        attemptId,
        rating: Rating.Again,
        now,
      });
    }
  });
  const result: AttemptResponse = {
    attemptId,
    isCorrect,
    history: await getHistory(userId, questionId),
    ...solution,
  };
  return c.json(result, 201);
});

study.post("/review/attempts/:id/rating", async (c) => {
  const attemptId = Number(c.req.param("id"));
  const body = await readJsonBody(c.req.raw);
  const rating = body.rating === "hard"
    ? Rating.Hard
    : body.rating === "good"
      ? Rating.Good
      : null;
  if (!Number.isInteger(attemptId) || rating === null) {
    return c.json({ error: "掌握程度不正确" }, 400);
  }
  const userId = c.get("user").id;
  const attempt = await db.query.attempts.findFirst({
    where: and(eq(attempts.id, attemptId), eq(attempts.userId, userId)),
  });
  if (!attempt) {
    return c.json({ error: "作答记录不存在" }, 404);
  }
  if (attempt.isCorrect !== true) {
    return c.json({ error: "只有答对的题目可以确认掌握程度" }, 409);
  }
  const rated = await db.query.fsrsReviewLogs.findFirst({
    where: eq(fsrsReviewLogs.attemptId, attemptId),
  });
  if (rated) {
    return c.json({ error: "该题已经完成评分" }, 409);
  }
  db.transaction((tx) => {
    scheduleQuestion(tx, {
      userId,
      questionId: attempt.questionId,
      roundItemId: null,
      attemptId,
      rating,
      now: Date.now(),
    });
  });
  return c.json({ rating: body.rating });
});

study.post("/attempts/:id/assess", async (c) => {
  const attemptId = Number(c.req.param("id"));
  const body = await readJsonBody(c.req.raw);
  if (!Number.isInteger(attemptId) || typeof body.isCorrect !== "boolean") {
    return c.json({ error: "自评结果不正确" }, 400);
  }
  const isCorrect = body.isCorrect;
  const userId = c.get("user").id;
  const attempt = await db.query.attempts.findFirst({
    where: and(eq(attempts.id, attemptId), eq(attempts.userId, userId)),
  });
  if (!attempt) {
    return c.json({ error: "作答记录不存在" }, 404);
  }
  if (attempt.isCorrect !== null) {
    return c.json({ error: "该作答已经完成自评" }, 409);
  }

  const changed = db.transaction((tx) => {
    const now = Date.now();
    const updated = tx
      .update(attempts)
      .set({ isCorrect, assessedAt: now })
      .where(and(eq(attempts.id, attemptId), isNull(attempts.isCorrect)))
      .returning({ id: attempts.id })
      .all();
    if (!updated.length) return false;
    updateQuestionState(
      tx,
      userId,
      attempt.questionId,
      attempt.answerJson,
      isCorrect,
    );
    const roundRow = tx
      .select({
        roundId: roundAnswers.roundId,
        questionId: roundAnswers.questionId,
        scope: studyRounds.scope,
      })
      .from(roundAnswers)
      .innerJoin(studyRounds, eq(studyRounds.id, roundAnswers.roundId))
      .where(
        and(
          eq(roundAnswers.attemptId, attemptId),
          eq(studyRounds.userId, userId),
        ),
      )
      .get();
    if (roundRow) {
      tx.update(roundAnswers)
        .set({ isCorrect })
        .where(
          and(
            eq(roundAnswers.roundId, roundRow.roundId),
            eq(roundAnswers.questionId, roundRow.questionId),
          ),
        )
        .run();
      completeRoundIfDone(tx, roundRow.roundId, roundRow.scope, now);
    }
    return true;
  });
  if (!changed) {
    return c.json({ error: "该作答已经完成自评" }, 409);
  }
  return c.json(await getHistory(userId, attempt.questionId));
});

study.put("/questions/:id/favorite", async (c) => {
  const questionId = Number(c.req.param("id"));
  const body = await readJsonBody(c.req.raw);
  if (!Number.isInteger(questionId) || typeof body.favorite !== "boolean") {
    return c.json({ error: "收藏参数不正确" }, 400);
  }
  const userId = c.get("user").id;
  if (body.favorite) {
    await db
      .insert(favorites)
      .values({ userId, questionId })
      .onConflictDoNothing();
  } else {
    await db
      .delete(favorites)
      .where(
        and(eq(favorites.userId, userId), eq(favorites.questionId, questionId)),
      );
  }
  return c.body(null, 204);
});

study.put("/questions/:id/note", async (c) => {
  const questionId = Number(c.req.param("id"));
  const body = await readJsonBody(c.req.raw);
  if (!Number.isInteger(questionId) || typeof body.note !== "string") {
    return c.json({ error: "备注格式不正确" }, 400);
  }
  if (body.note.length > 20_000) {
    return c.json({ error: "备注不能超过 20000 字" }, 400);
  }
  const question = await db.query.questions.findFirst({
    where: eq(questions.id, questionId),
  });
  if (!question) {
    return c.json({ error: "题目不存在" }, 404);
  }

  const userId = c.get("user").id;
  if (!body.note.trim()) {
    await db
      .delete(questionNotes)
      .where(
        and(
          eq(questionNotes.userId, userId),
          eq(questionNotes.questionId, questionId),
        ),
      );
    return c.json({ note: "" });
  }

  await db
    .insert(questionNotes)
    .values({ userId, questionId, content: body.note })
    .onConflictDoUpdate({
      target: [questionNotes.userId, questionNotes.questionId],
      set: { content: body.note, updatedAt: Date.now() },
    });
  return c.json({ note: body.note });
});

study.patch("/progress", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const updates: Partial<typeof userProgress.$inferInsert> = { updatedAt: Date.now() };
  if (body.lastSkillGroup !== undefined) {
    if (!Number.isInteger(body.lastSkillGroup) || Number(body.lastSkillGroup) < 1) {
      return c.json({ error: "技能题组不正确" }, 400);
    }
    updates.lastSkillGroup = Number(body.lastSkillGroup);
  }
  if (body.lastSkillQuestionId !== undefined) {
    updates.lastSkillQuestionId = Number(body.lastSkillQuestionId) || null;
  }
  if (body.lastPrescriptionQuestionId !== undefined) {
    updates.lastPrescriptionQuestionId = Number(body.lastPrescriptionQuestionId) || null;
  }
  await db
    .insert(userProgress)
    .values({ userId: c.get("user").id, ...updates })
    .onConflictDoUpdate({
      target: userProgress.userId,
      set: updates,
    });
  return c.body(null, 204);
});

async function scopeStats(userId: number, scope: QuestionScope): Promise<ScopeStats> {
  const [row] = await db
    .select({
      total: count(questions.id),
      answered: count(questionStates.questionId),
      firstCorrect: sql<number>`COALESCE(SUM(CASE WHEN ${questionStates.firstAttemptCorrect} = 1 THEN 1 ELSE 0 END), 0)`,
      mastered: sql<number>`COALESCE(SUM(CASE WHEN ${questionStates.mastered} = 1 THEN 1 ELSE 0 END), 0)`,
      unmastered: sql<number>`COALESCE(SUM(CASE WHEN ${questionStates.mastered} = 0 THEN 1 ELSE 0 END), 0)`,
      favorites: sql<number>`COALESCE(SUM(CASE WHEN ${favorites.questionId} IS NOT NULL THEN 1 ELSE 0 END), 0)`,
    })
    .from(questions)
    .innerJoin(
      questionTags,
      and(eq(questionTags.questionId, questions.id), eq(questionTags.tag, scope)),
    )
    .leftJoin(
      questionStates,
      and(
        eq(questionStates.questionId, questions.id),
        eq(questionStates.userId, userId),
      ),
    )
    .leftJoin(
      favorites,
      and(eq(favorites.questionId, questions.id), eq(favorites.userId, userId)),
    );
  const answered = Number(row?.answered ?? 0);
  const firstCorrect = Number(row?.firstCorrect ?? 0);
  return {
    total: Number(row?.total ?? 0),
    answered,
    firstCorrect,
    firstAccuracy: answered ? Math.round((firstCorrect / answered) * 1000) / 10 : 0,
    mastered: Number(row?.mastered ?? 0),
    unmastered: Number(row?.unmastered ?? 0),
    favorites: Number(row?.favorites ?? 0),
  };
}

study.get("/dashboard", async (c) => {
  const userId = c.get("user").id;
  const now = Date.now();
  const progress = await db.query.userProgress.findFirst({
    where: eq(userProgress.userId, userId),
  });
  const [reviewRow] = await db.all<{
    due: number;
    stableMastered: number;
    wrongUnmastered: number;
  }>(sql`
    SELECT
      (SELECT COUNT(*) FROM fsrs_cards c
       INNER JOIN question_states qs
         ON qs.user_id = c.user_id AND qs.question_id = c.question_id
       WHERE c.user_id = ${userId} AND c.due <= ${now} AND qs.mastered = 0) AS due,
      (SELECT COUNT(*) FROM fsrs_cards WHERE user_id = ${userId} AND stability >= ${FSRS_STABLE_DAYS} AND due > ${now}) AS stableMastered,
      (SELECT COUNT(*) FROM question_states qs
       WHERE qs.user_id = ${userId} AND qs.mastered = 0
         AND EXISTS (
           SELECT 1 FROM attempts a
           WHERE a.user_id = ${userId} AND a.question_id = qs.question_id AND a.is_correct = 0
         )) AS wrongUnmastered
  `);
  const result: DashboardResponse = {
    skill: await scopeStats(userId, "技能"),
    prescription: await scopeStats(userId, "处方审核"),
    skillRound: await roundSummary(ensureRound(userId, "技能")),
    prescriptionRound: await roundSummary(ensureRound(userId, "处方审核")),
    review: {
      due: Number(reviewRow?.due ?? 0),
      stableMastered: Number(reviewRow?.stableMastered ?? 0),
      wrongUnmastered: Number(reviewRow?.wrongUnmastered ?? 0),
    },
    progress: {
      lastSkillGroup: progress?.lastSkillGroup ?? 1,
      lastSkillQuestionId: progress?.lastSkillQuestionId ?? null,
      lastPrescriptionQuestionId: progress?.lastPrescriptionQuestionId ?? null,
    },
  };
  return c.json(result);
});

study.get("/search", async (c) => {
  const userId = c.get("user").id;
  const query = (c.req.query("q") ?? "").trim();
  const scope = c.req.query("scope") as QuestionScope | undefined;
  const kind = c.req.query("kind") as QuestionKind | undefined;
  const filter = c.req.query("filter") ?? "all";
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const pageSize = 30;
  const conditions = [inArray(questionTags.tag, ["技能", "处方审核"] as const)];
  if (query) conditions.push(like(questions.stem, `%${query}%`));
  if (scope === "技能" || scope === "处方审核") {
    conditions.push(eq(questionTags.tag, scope));
  }
  if (["Radio", "Checkbox", "Judge", "FillBlank"].includes(kind ?? "")) {
    conditions.push(eq(questions.kind, kind!));
  }
  if (filter === "wrong") conditions.push(eq(questionStates.mastered, false));
  if (filter === "favorite") conditions.push(isNotNull(favorites.questionId));

  const rows = await db
    .select({
      id: questions.id,
      kind: questions.kind,
      scope: questionTags.tag,
      stem: questions.stem,
      favoriteUserId: favorites.userId,
      firstAttemptCorrect: questionStates.firstAttemptCorrect,
      lastAttemptCorrect: questionStates.lastAttemptCorrect,
      mastered: questionStates.mastered,
      attemptCount: questionStates.attemptCount,
      lastAnswerJson: questionStates.lastAnswerJson,
      total: sql<number>`COUNT(*) OVER ()`,
      group: sql<number | null>`CASE WHEN ${questionTags.tag} = '技能' THEN
        CAST(((SELECT COUNT(*) FROM questions q2 INNER JOIN question_tags qt2 ON qt2.question_id = q2.id WHERE qt2.tag = '技能' AND q2.id <= ${questions.id}) - 1) / ${GROUP_SIZE} AS INTEGER) + 1
        ELSE NULL END`,
    })
    .from(questions)
    .innerJoin(questionTags, eq(questionTags.questionId, questions.id))
    .leftJoin(
      questionStates,
      and(
        eq(questionStates.questionId, questions.id),
        eq(questionStates.userId, userId),
      ),
    )
    .leftJoin(
      favorites,
      and(eq(favorites.questionId, questions.id), eq(favorites.userId, userId)),
    )
    .where(and(...conditions))
    .orderBy(asc(questions.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const results: SearchResult[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind as QuestionKind,
    scope: row.scope as QuestionScope,
    stem: row.stem,
    isFavorite: row.favoriteUserId !== null,
    history: toHistory(row),
    group: row.group,
  }));
  const response: SearchResponse = {
    results,
    total: Number(rows[0]?.total ?? 0),
  };
  return c.json(response);
});

study.get("/review", async (c) => {
  const userId = c.get("user").id;
  const mode = c.req.query("mode");
  const scope = c.req.query("scope") as QuestionScope;
  const status = c.req.query("status") ?? "unmastered";
  const roundFilter = c.req.query("round") ?? "all";
  if (!["wrong", "favorite"].includes(mode ?? "") || !isScope(scope)) {
    return c.json({ error: "复习筛选不正确" }, 400);
  }
  const now = Date.now();
  const conditions = [eq(questionTags.tag, scope)];
  if (mode === "favorite") {
    conditions.push(isNotNull(favorites.questionId));
  } else {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM attempts wrong_attempt
        WHERE wrong_attempt.user_id = ${userId}
          AND wrong_attempt.question_id = ${questions.id}
          AND wrong_attempt.is_correct = 0
      )`,
    );
    if (status === "unmastered") conditions.push(eq(questionStates.mastered, false));
    if (status === "mastered") conditions.push(eq(questionStates.mastered, true));
    if (roundFilter === "current") {
      const round = ensureRound(userId, scope);
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM round_answers ra
          WHERE ra.round_id = ${round.id}
            AND ra.question_id = ${questions.id}
            AND ra.is_correct = 0
        )`,
      );
    }
  }
  const rows = await db
    .select({ id: questions.id, due: fsrsCards.due })
    .from(questions)
    .innerJoin(questionTags, eq(questionTags.questionId, questions.id))
    .leftJoin(
      questionStates,
      and(eq(questionStates.questionId, questions.id), eq(questionStates.userId, userId)),
    )
    .leftJoin(
      favorites,
      and(eq(favorites.questionId, questions.id), eq(favorites.userId, userId)),
    )
    .leftJoin(
      fsrsCards,
      and(eq(fsrsCards.questionId, questions.id), eq(fsrsCards.userId, userId)),
    )
    .where(and(...conditions))
    .orderBy(
      sql`CASE WHEN ${fsrsCards.due} IS NOT NULL AND ${fsrsCards.due} <= ${now} THEN 0 ELSE 1 END`,
      sql`COALESCE(${fsrsCards.due}, 9007199254740991)`,
      asc(questions.id),
    );
  const dueById = new Map(rows.map((row) => [row.id, row.due]));
  const views = await loadQuestionViews(userId, rows.map((row) => row.id));
  const result: ReviewResponse = {
    dueCount: rows.filter((row) => row.due !== null && row.due <= now).length,
    questions: views.map((view): ReviewQuestionView => ({
      ...view,
      due: dueById.get(view.id) ?? null,
    })),
  };
  return c.json(result);
});

export default study;
