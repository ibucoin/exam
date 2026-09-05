import { and, eq } from "drizzle-orm";
import {
  createEmptyCard,
  fsrs,
  Rating,
  type Card,
  type Grade,
} from "ts-fsrs";
import { db } from "../db/client";
import { fsrsCards, fsrsReviewLogs } from "../db/schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const FSRS_STABLE_DAYS = 30;

const scheduler = fsrs({
  request_retention: 0.9,
  enable_fuzz: true,
  enable_short_term: false,
  learning_steps: [],
  relearning_steps: [],
});

function storedCard(row: typeof fsrsCards.$inferSelect): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    scheduled_days: row.scheduledDays,
    learning_steps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    ...(row.lastReview === null ? {} : { last_review: new Date(row.lastReview) }),
  };
}

export function scheduleQuestion(
  tx: Transaction,
  {
    userId,
    questionId,
    roundItemId,
    attemptId,
    rating,
    now,
  }: {
    userId: number;
    questionId: number;
    roundItemId: number | null;
    attemptId: number;
    rating: Grade;
    now: number;
  },
) {
  const existing = tx
    .select()
    .from(fsrsCards)
    .where(
      and(eq(fsrsCards.userId, userId), eq(fsrsCards.questionId, questionId)),
    )
    .get();
  const { card, log } = scheduler.next(
    existing ? storedCard(existing) : createEmptyCard(new Date(now)),
    new Date(now),
    rating,
  );

  tx.insert(fsrsCards)
    .values({
      userId,
      questionId,
      due: card.due.getTime(),
      stability: card.stability,
      difficulty: card.difficulty,
      elapsedDays: card.elapsed_days,
      scheduledDays: card.scheduled_days,
      learningSteps: card.learning_steps,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      lastReview: card.last_review?.getTime() ?? null,
      lastRating: rating,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [fsrsCards.userId, fsrsCards.questionId],
      set: {
        due: card.due.getTime(),
        stability: card.stability,
        difficulty: card.difficulty,
        elapsedDays: card.elapsed_days,
        scheduledDays: card.scheduled_days,
        learningSteps: card.learning_steps,
        reps: card.reps,
        lapses: card.lapses,
        state: card.state,
        lastReview: card.last_review?.getTime() ?? null,
        lastRating: rating,
        updatedAt: now,
      },
    })
    .run();

  tx.insert(fsrsReviewLogs)
    .values({
      userId,
      questionId,
      roundItemId,
      attemptId,
      rating: log.rating,
      state: log.state,
      due: log.due.getTime(),
      stability: log.stability,
      difficulty: log.difficulty,
      elapsedDays: log.elapsed_days,
      lastElapsedDays: log.last_elapsed_days,
      scheduledDays: log.scheduled_days,
      learningSteps: log.learning_steps,
      reviewedAt: log.review.getTime(),
    })
    .run();

  return card;
}

export { Rating };
