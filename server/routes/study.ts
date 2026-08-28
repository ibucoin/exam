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
  ScopeStats,
  SearchResponse,
  SearchResult,
  SkillGroupResponse,
  SkillRandomResponse,
} from "../../shared/types";
import { db } from "../db/client";
import {
  attempts,
  favorites,
  questions,
  questionNotes,
  questionStates,
  questionTags,
  userProgress,
} from "../db/schema";
import { type AppEnv, requireAuth } from "../lib/auth";
import { readJsonBody } from "../lib/validation";

const GROUP_SIZE = 20;
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

function updateQuestionState(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
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

study.get("/skills/random", async (c) => {
  const ids = await db
    .select({ id: questions.id })
    .from(questions)
    .innerJoin(questionTags, eq(questionTags.questionId, questions.id))
    .where(eq(questionTags.tag, "技能"))
    .orderBy(sql`RANDOM()`)
    .limit(GROUP_SIZE);
  const result: SkillRandomResponse = {
    questions: await loadQuestionViews(
      c.get("user").id,
      ids.map((row) => row.id),
    ),
  };
  return c.json(result);
});

study.get("/skills/:group", async (c) => {
  const group = Number(c.req.param("group"));
  if (!Number.isInteger(group) || group < 1) {
    return c.json({ error: "题组不存在" }, 404);
  }

  const totalRow = await db
    .select({ total: count() })
    .from(questionTags)
    .where(eq(questionTags.tag, "技能"));
  const totalQuestions = totalRow[0]?.total ?? 0;
  const totalGroups = Math.ceil(totalQuestions / GROUP_SIZE);
  if (group > totalGroups) {
    return c.json({ error: "题组不存在" }, 404);
  }

  const ids = await db
    .select({ id: questions.id })
    .from(questions)
    .innerJoin(questionTags, eq(questionTags.questionId, questions.id))
    .where(eq(questionTags.tag, "技能"))
    .orderBy(asc(questions.id))
    .limit(GROUP_SIZE)
    .offset((group - 1) * GROUP_SIZE);
  const result: SkillGroupResponse = {
    group,
    groupSize: GROUP_SIZE,
    totalGroups,
    totalQuestions,
    questions: await loadQuestionViews(
      c.get("user").id,
      ids.map((row) => row.id),
    ),
  };
  return c.json(result);
});

study.get("/prescriptions/:id?", async (c) => {
  const ids = await db
    .select({ id: questions.id })
    .from(questions)
    .innerJoin(questionTags, eq(questionTags.questionId, questions.id))
    .where(eq(questionTags.tag, "处方审核"))
    .orderBy(asc(questions.id));
  const requestedIndex = Number(c.req.query("index"));
  let requestedId = ids[0]?.id;
  if (Number.isInteger(requestedIndex) && requestedIndex > 0) {
    requestedId = ids[requestedIndex - 1]?.id;
  } else if (c.req.param("id")) {
    requestedId = Number(c.req.param("id"));
  }
  const index = ids.findIndex((row) => row.id === requestedId);
  if (index < 0) {
    return c.json({ error: "题目不存在" }, 404);
  }
  const loaded = await loadQuestionViews(c.get("user").id, [ids[index].id]);
  const result: PrescriptionResponse = {
    index: index + 1,
    totalQuestions: ids.length,
    previousId: ids[index - 1]?.id ?? null,
    nextId: ids[index + 1]?.id ?? null,
    question: loaded[0],
  };
  return c.json(result);
});

study.post("/questions/:id/attempt", async (c) => {
  const questionId = Number(c.req.param("id"));
  const body = await readJsonBody(c.req.raw);
  if (!Number.isInteger(questionId) || !Array.isArray(body.answer)) {
    return c.json({ error: "答案格式不正确" }, 400);
  }
  const answer = body.answer.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
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

  const normalize = (items: string[]) => [...new Set(items)].sort();
  const submitted = normalize(answer);
  const expected = normalize(correctAnswers);
  const isCorrect =
    submitted.length === expected.length &&
    submitted.every((item, index) => item === expected[index]);
  let attemptId = 0;
  db.transaction((tx) => {
    const inserted = tx
      .insert(attempts)
      .values({
        userId,
        questionId,
        answerJson,
        isCorrect,
        assessedAt: Date.now(),
      })
      .returning({ id: attempts.id })
      .all();
    attemptId = inserted[0].id;
    updateQuestionState(tx, userId, questionId, answerJson, isCorrect);
  });
  const result: AttemptResponse = {
    attemptId,
    isCorrect,
    history: await getHistory(userId, questionId),
    ...solution,
  };
  return c.json(result, 201);
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
    const updated = tx
      .update(attempts)
      .set({ isCorrect, assessedAt: Date.now() })
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

interface StatsRow {
  total: number;
  answered: number;
  firstCorrect: number;
  mastered: number;
  unmastered: number;
  favorites: number;
}

async function scopeStats(userId: number, scope: QuestionScope): Promise<ScopeStats> {
  const row = await db.get<StatsRow>(sql`
    SELECT
      COUNT(q.id) AS total,
      COUNT(qs.question_id) AS answered,
      COALESCE(SUM(CASE WHEN qs.first_attempt_correct = 1 THEN 1 ELSE 0 END), 0) AS firstCorrect,
      COALESCE(SUM(CASE WHEN qs.mastered = 1 THEN 1 ELSE 0 END), 0) AS mastered,
      COALESCE(SUM(CASE WHEN qs.mastered = 0 THEN 1 ELSE 0 END), 0) AS unmastered,
      COALESCE(SUM(CASE WHEN f.question_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS favorites
    FROM questions q
    INNER JOIN question_tags qt ON qt.question_id = q.id AND qt.tag = ${scope}
    LEFT JOIN question_states qs ON qs.question_id = q.id AND qs.user_id = ${userId}
    LEFT JOIN favorites f ON f.question_id = q.id AND f.user_id = ${userId}
  `);
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
  const progress = await db.query.userProgress.findFirst({
    where: eq(userProgress.userId, userId),
  });
  const result: DashboardResponse = {
    skill: await scopeStats(userId, "技能"),
    prescription: await scopeStats(userId, "处方审核"),
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

  const base = db
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
    .where(and(...conditions));
  const rows = await base
    .orderBy(asc(questions.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const totalRows = await db
    .select({ total: count() })
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
    .where(and(...conditions));
  const results: SearchResult[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind as QuestionKind,
    scope: row.scope as QuestionScope,
    stem: row.stem,
    isFavorite: row.favoriteUserId !== null,
    history: toHistory(row),
    group: row.group,
  }));
  const response: SearchResponse = { results, total: totalRows[0]?.total ?? 0 };
  return c.json(response);
});

study.get("/review", async (c) => {
  const userId = c.get("user").id;
  const mode = c.req.query("mode");
  const scope = c.req.query("scope") as QuestionScope;
  const status = c.req.query("status") ?? "unmastered";
  if (!['wrong', 'favorite'].includes(mode ?? '') || !['技能', '处方审核'].includes(scope)) {
    return c.json({ error: "复习筛选不正确" }, 400);
  }
  const conditions = [eq(questionTags.tag, scope)];
  if (mode === "favorite") {
    conditions.push(isNotNull(favorites.questionId));
  } else {
    conditions.push(eq(questionStates.firstAttemptCorrect, false));
    if (status === "unmastered") conditions.push(eq(questionStates.mastered, false));
    if (status === "mastered") conditions.push(eq(questionStates.mastered, true));
  }
  const rows = await db
    .select({ id: questions.id })
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
    .where(and(...conditions))
    .orderBy(asc(questions.id));
  return c.json(await loadQuestionViews(userId, rows.map((row) => row.id)));
});

export default study;
