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
  ValidationQuestion,
} from "../../shared/types";
import { db } from "../db/client";
import {
  attempts,
  favorites,
  fsrsCards,
  questions,
  questionNotes,
  questionStates,
  questionTags,
  userProgress,
  validationRoundItems,
  validationRounds,
} from "../db/schema";
import { type AppEnv, requireAuth } from "../lib/auth";
import { FSRS_STABLE_DAYS, Rating, scheduleQuestion } from "../lib/fsrs";
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

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function shuffle<T>(items: T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function shuffledOptions(stem: string, options: string[]) {
  const text = `${stem}\n${options.join("\n")}`;
  const dependsOnOrder =
    /(?:^|[^a-z])(?:[A-ZＡ-Ｚ]\s*(?:、|,|，|和|或|及|\/|\+)\s*)+[A-ZＡ-Ｚ](?:[^a-z]|$)/i.test(text) ||
    /(以上|上述).*(选项|说法|答案|均|都)|(?:均|都).*(正确|错误|符合|不符合)/.test(text);
  return dependsOnOrder ? options : shuffle(options);
}

function createValidationRound(tx: Transaction, userId: number, now: number) {
  const candidates = tx
    .select({
      id: questions.id,
      stem: questions.stem,
      optionsJson: questions.optionsJson,
    })
    .from(questions)
    .innerJoin(questionTags, eq(questionTags.questionId, questions.id))
    .leftJoin(
      fsrsCards,
      and(eq(fsrsCards.questionId, questions.id), eq(fsrsCards.userId, userId)),
    )
    .leftJoin(
      questionStates,
      and(
        eq(questionStates.questionId, questions.id),
        eq(questionStates.userId, userId),
      ),
    )
    .where(eq(questionTags.tag, "技能"))
    .orderBy(
      sql`CASE
        WHEN ${fsrsCards.questionId} IS NOT NULL AND ${fsrsCards.due} <= ${now} THEN 0
        WHEN ${fsrsCards.questionId} IS NULL AND ${questionStates.lastAttemptCorrect} = 0 THEN 1
        WHEN ${fsrsCards.questionId} IS NULL THEN 2
        ELSE 3
      END`,
      sql`RANDOM()`,
    )
    .limit(GROUP_SIZE)
    .all();
  if (!candidates.length) return null;

  const inserted = tx
    .insert(validationRounds)
    .values({ userId, currentKey: true })
    .returning({ id: validationRounds.id })
    .get();
  tx.insert(validationRoundItems)
    .values(
      candidates.map((question, index) => ({
        roundId: inserted.id,
        questionId: question.id,
        position: index + 1,
        optionsJson: JSON.stringify(
          shuffledOptions(question.stem, parseStringArray(question.optionsJson)),
        ),
      })),
    )
    .run();
  return inserted.id;
}

function fsrsRating(value: number | null) {
  if (value === Rating.Again) return "again" as const;
  if (value === Rating.Hard) return "hard" as const;
  if (value === Rating.Good) return "good" as const;
  return null;
}

function completeValidationRound(tx: Transaction, roundId: number, now: number) {
  const pending = tx
    .select({ total: count() })
    .from(validationRoundItems)
    .where(
      and(
        eq(validationRoundItems.roundId, roundId),
        isNull(validationRoundItems.rating),
      ),
    )
    .get();
  if ((pending?.total ?? 0) > 0) return "active" as const;
  tx.update(validationRounds)
    .set({ status: "completed", completedAt: now })
    .where(eq(validationRounds.id, roundId))
    .run();
  return "completed" as const;
}

async function validationStats(userId: number, now: number) {
  const row = await db.get<{
    reviewed: number;
    correct: number;
    due: number;
    stableMastered: number;
  }>(sql`
    SELECT
      (SELECT COUNT(*)
       FROM validation_round_items item
       INNER JOIN validation_rounds round ON round.id = item.round_id
       WHERE round.user_id = ${userId} AND item.attempt_id IS NOT NULL) AS reviewed,
      (SELECT COUNT(*)
       FROM validation_round_items item
       INNER JOIN validation_rounds round ON round.id = item.round_id
       WHERE round.user_id = ${userId} AND item.is_correct = 1) AS correct,
      (SELECT COUNT(*) FROM fsrs_cards WHERE user_id = ${userId} AND due <= ${now}) AS due,
      (SELECT COUNT(*) FROM fsrs_cards WHERE user_id = ${userId} AND stability >= ${FSRS_STABLE_DAYS} AND due > ${now}) AS stableMastered
  `);
  const reviewed = Number(row?.reviewed ?? 0);
  const correct = Number(row?.correct ?? 0);
  return {
    reviewed,
    correct,
    accuracy: reviewed ? Math.round((correct / reviewed) * 1000) / 10 : 0,
    due: Number(row?.due ?? 0),
    stableMastered: Number(row?.stableMastered ?? 0),
  };
}

async function loadValidationRound(userId: number, roundId: number) {
  const round = await db.query.validationRounds.findFirst({
    where: and(
      eq(validationRounds.id, roundId),
      eq(validationRounds.userId, userId),
      eq(validationRounds.currentKey, true),
    ),
  });
  if (!round || round.status === "abandoned") return null;
  const items = await db
    .select()
    .from(validationRoundItems)
    .where(eq(validationRoundItems.roundId, round.id))
    .orderBy(asc(validationRoundItems.position));
  const attemptIds = items.flatMap((item) => item.attemptId === null ? [] : [item.attemptId]);
  const attemptRows = attemptIds.length
    ? await db
        .select({ id: attempts.id, answerJson: attempts.answerJson })
        .from(attempts)
        .where(and(eq(attempts.userId, userId), inArray(attempts.id, attemptIds)))
    : [];
  const answersByAttempt = new Map(
    attemptRows.map((attempt) => [attempt.id, parseStringArray(attempt.answerJson)]),
  );
  const views = await loadQuestionViews(
    userId,
    items.map((item) => item.questionId),
  );
  const byId = new Map(views.map((view) => [view.id, view]));
  const validationQuestions: ValidationQuestion[] = items.flatMap((item) => {
    const loaded = byId.get(item.questionId);
    if (!loaded) return [];
    const answered = item.attemptId !== null;
    const answer = item.attemptId === null ? null : answersByAttempt.get(item.attemptId) ?? [];
    const question = {
      ...loaded,
      options: parseStringArray(item.optionsJson),
      note: answered ? loaded.note : "",
      history: loaded.history
        ? { ...loaded.history, lastAnswer: answer ?? [] }
        : null,
      ...(!answered ? { solution: undefined, pendingAttempt: undefined } : {}),
    };
    return [{
      itemId: item.id,
      position: item.position,
      question,
      answer,
      result: answered && loaded.solution
        ? {
            attemptId: item.attemptId!,
            isCorrect: item.isCorrect,
            history: loaded.history,
            ...loaded.solution,
          }
        : null,
      rating: fsrsRating(item.rating),
    }];
  });
  const answered = validationQuestions.filter((item) => item.result).length;
  const correct = validationQuestions.filter((item) => item.result?.isCorrect).length;
  const stats = await validationStats(userId, Date.now());
  const result: SkillRandomResponse = {
    roundId: round.id,
    status: round.status,
    questions: validationQuestions,
    answered,
    correct,
    accuracy: answered ? Math.round((correct / answered) * 1000) / 10 : 0,
    dueRemaining: stats.due,
    stableMastered: stats.stableMastered,
  };
  return result;
}

study.get("/skills/random", async (c) => {
  const userId = c.get("user").id;
  let round = await db.query.validationRounds.findFirst({
    where: and(
      eq(validationRounds.userId, userId),
      eq(validationRounds.currentKey, true),
    ),
    orderBy: desc(validationRounds.id),
  });
  if (!round) {
    const roundId = db.transaction((tx) => createValidationRound(tx, userId, Date.now()));
    if (!roundId) return c.json({ error: "技能题库为空" }, 404);
    round = await db.query.validationRounds.findFirst({
      where: eq(validationRounds.id, roundId),
    });
  }
  const result = round ? await loadValidationRound(userId, round.id) : null;
  return result ? c.json(result) : c.json({ error: "验证轮次不存在" }, 404);
});

study.post("/skills/random/next", async (c) => {
  const userId = c.get("user").id;
  const roundId = db.transaction((tx) => {
    const current = tx
      .select()
      .from(validationRounds)
      .where(
        and(
          eq(validationRounds.userId, userId),
          eq(validationRounds.currentKey, true),
        ),
      )
      .get();
    if (current) {
      tx.update(validationRounds)
        .set({
          currentKey: null,
          ...(current.status === "active" ? { status: "abandoned" as const } : {}),
        })
        .where(eq(validationRounds.id, current.id))
        .run();
    }
    return createValidationRound(tx, userId, Date.now());
  });
  if (!roundId) return c.json({ error: "技能题库为空" }, 404);
  const result = await loadValidationRound(userId, roundId);
  return result ? c.json(result, 201) : c.json({ error: "创建验证轮次失败" }, 500);
});

study.post("/skills/random/items/:id/answer", async (c) => {
  const itemId = Number(c.req.param("id"));
  const body = await readJsonBody(c.req.raw);
  if (!Number.isInteger(itemId) || !Array.isArray(body.answer)) {
    return c.json({ error: "答案格式不正确" }, 400);
  }
  const answer = body.answer.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  const userId = c.get("user").id;
  const row = await db
    .select({
      item: validationRoundItems,
      round: validationRounds,
      question: questions,
    })
    .from(validationRoundItems)
    .innerJoin(validationRounds, eq(validationRounds.id, validationRoundItems.roundId))
    .innerJoin(questions, eq(questions.id, validationRoundItems.questionId))
    .where(
      and(
        eq(validationRoundItems.id, itemId),
        eq(validationRounds.userId, userId),
        eq(validationRounds.currentKey, true),
        eq(validationRounds.status, "active"),
      ),
    )
    .get();
  if (!row) return c.json({ error: "验证题目不存在" }, 404);
  if (row.item.attemptId !== null) return c.json({ error: "该题已经作答" }, 409);
  if (!answer.length || (row.question.kind !== "Checkbox" && answer.length !== 1)) {
    return c.json({ error: "请先完成作答" }, 400);
  }
  const options = parseStringArray(row.item.optionsJson);
  if (row.question.kind === "FillBlank" || answer.some((item) => !options.includes(item))) {
    return c.json({ error: "答案不在可选项中" }, 400);
  }

  const normalize = (items: string[]) => [...new Set(items)].sort();
  const expected = normalize(parseStringArray(row.question.correctAnswerJson));
  const submitted = normalize(answer);
  const isCorrect =
    submitted.length === expected.length &&
    submitted.every((item, index) => item === expected[index]);
  const answerJson = JSON.stringify(answer);
  let attemptId = 0;
  db.transaction((tx) => {
    const now = Date.now();
    const attempt = tx
      .insert(attempts)
      .values({ userId, questionId: row.question.id, answerJson, isCorrect, assessedAt: now })
      .returning({ id: attempts.id })
      .get();
    attemptId = attempt.id;
    updateQuestionState(tx, userId, row.question.id, answerJson, isCorrect);
    tx.update(validationRoundItems)
      .set({
        attemptId,
        isCorrect,
        ...(!isCorrect ? { rating: Rating.Again, ratedAt: now } : {}),
      })
      .where(eq(validationRoundItems.id, itemId))
      .run();
    if (!isCorrect) {
      scheduleQuestion(tx, {
        userId,
        questionId: row.question.id,
        roundItemId: itemId,
        attemptId,
        rating: Rating.Again,
        now,
      });
      completeValidationRound(tx, row.round.id, now);
    }
  });
  const result: AttemptResponse = {
    attemptId,
    isCorrect,
    history: await getHistory(userId, row.question.id),
    correctAnswers: expected,
    analysisText: row.question.analysisText,
  };
  return c.json(result, 201);
});

study.post("/skills/random/items/:id/rating", async (c) => {
  const itemId = Number(c.req.param("id"));
  const body = await readJsonBody(c.req.raw);
  const rating = body.rating === "hard"
    ? Rating.Hard
    : body.rating === "good"
      ? Rating.Good
      : null;
  if (!Number.isInteger(itemId) || rating === null) {
    return c.json({ error: "掌握程度不正确" }, 400);
  }
  const userId = c.get("user").id;
  const row = await db
    .select({ item: validationRoundItems, round: validationRounds })
    .from(validationRoundItems)
    .innerJoin(validationRounds, eq(validationRounds.id, validationRoundItems.roundId))
    .where(
      and(
        eq(validationRoundItems.id, itemId),
        eq(validationRounds.userId, userId),
        eq(validationRounds.currentKey, true),
        eq(validationRounds.status, "active"),
      ),
    )
    .get();
  if (!row) return c.json({ error: "验证题目不存在" }, 404);
  if (!row.item.isCorrect || row.item.attemptId === null) {
    return c.json({ error: "只有答对的题目可以确认掌握程度" }, 409);
  }
  if (row.item.rating !== null) return c.json({ error: "该题已经完成评分" }, 409);

  const status = db.transaction((tx) => {
    const now = Date.now();
    tx.update(validationRoundItems)
      .set({ rating, ratedAt: now })
      .where(eq(validationRoundItems.id, itemId))
      .run();
    scheduleQuestion(tx, {
      userId,
      questionId: row.item.questionId,
      roundItemId: itemId,
      attemptId: row.item.attemptId!,
      rating,
      now,
    });
    return completeValidationRound(tx, row.round.id, now);
  });
  return c.json({ rating: body.rating, status });
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
  const now = Date.now();
  const progress = await db.query.userProgress.findFirst({
    where: eq(userProgress.userId, userId),
  });
  const result: DashboardResponse = {
    skill: await scopeStats(userId, "技能"),
    prescription: await scopeStats(userId, "处方审核"),
    skillValidation: await validationStats(userId, now),
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
