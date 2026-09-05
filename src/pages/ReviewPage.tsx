import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Heart, HelpCircle, TriangleAlert } from "lucide-react";
import { Navigate, useParams } from "react-router-dom";
import type {
  AttemptResponse,
  QuestionScope,
  ReviewQuestionView,
  ReviewRatingResponse,
} from "../../shared/types";
import { EmptyState, Loading } from "../components/Loading";
import { QuestionCard } from "../components/QuestionCard";
import { api, errorMessage } from "../lib/api";

export function ReviewPage() {
  const { mode } = useParams();
  const [scope, setScope] = useState<QuestionScope>("技能");
  const [status, setStatus] = useState("unmastered");
  const [roundFilter, setRoundFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [snapshot, setSnapshot] = useState<{ dueCount: number; questions: ReviewQuestionView[] } | null>(null);
  const [ratings, setRatings] = useState<Record<number, "hard" | "good">>({});
  const pageSize = scope === "技能" ? 20 : 1;
  const review = useQuery({
    queryKey: ["review", mode, scope, status, roundFilter],
    queryFn: () =>
      api<{ dueCount: number; questions: ReviewQuestionView[] }>(
        `/review?mode=${mode}&scope=${encodeURIComponent(scope)}&status=${status}&round=${roundFilter}`,
      ),
    enabled: mode === "wrong" || mode === "favorite",
  });
  const rate = useMutation({
    mutationFn: ({ attemptId, rating }: { attemptId: number; rating: "hard" | "good" }) =>
      api<ReviewRatingResponse>(`/review/attempts/${attemptId}/rating`, {
        method: "POST",
        body: JSON.stringify({ rating }),
      }),
    onSuccess: (response, variables) => {
      setRatings((current) => ({ ...current, [variables.attemptId]: response.rating }));
    },
  });

  useEffect(() => {
    setPage(1);
    setSnapshot(null);
  }, [scope, mode, status, roundFilter]);
  useEffect(() => {
    if (review.data && !snapshot) setSnapshot(review.data);
  }, [review.data, snapshot]);

  if (mode !== "wrong" && mode !== "favorite") return <Navigate to="/review/wrong" replace />;
  if (!snapshot) {
    if (review.isPending) return <Loading label="正在整理专项题目" />;
    if (review.isError) return <p className="page-error">{errorMessage(review.error)}</p>;
  }

  const data = snapshot ?? review.data!;
  const totalPages = Math.max(1, Math.ceil(data.questions.length / pageSize));
  const visible = data.questions.slice((page - 1) * pageSize, page * pageSize);
  const Icon = mode === "wrong" ? TriangleAlert : Heart;
  const title = mode === "wrong" ? "错题复习" : "收藏题目";
  const isWrongMode = mode === "wrong";

  return (
    <div className="study-page">
      <header className="study-heading">
        <div className="section-heading">
          <Icon aria-hidden="true" />
          <div><p className="eyebrow">专项复习</p><h1>{title}</h1></div>
        </div>
        <div className="segmented-control" aria-label="选择题库">
          {(["技能", "处方审核"] as const).map((item) => (
            <button
              type="button"
              aria-pressed={scope === item}
              className={scope === item ? "active" : ""}
              onClick={() => setScope(item)}
              key={item}
            >{item}</button>
          ))}
        </div>
      </header>
      <div className="review-summary">
        <p className="result-count">
          共 {data.questions.length} 道题
          {isWrongMode && data.dueCount > 0 && ` · 今日到期 ${data.dueCount} 题`}
        </p>
        {isWrongMode && (
          <>
            <label>
              <span className="sr-only">错题范围</span>
              <select value={roundFilter} onChange={(event) => setRoundFilter(event.target.value)}>
                <option value="all">全部轮次</option>
                <option value="current">本轮错题</option>
              </select>
            </label>
            <label>
              <span className="sr-only">错题掌握状态</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="unmastered">待巩固</option>
                <option value="mastered">已掌握</option>
                <option value="all">全部错题</option>
              </select>
            </label>
          </>
        )}
      </div>
      {visible.length ? (
        <section className="question-list">
          {visible.map((question, index) => (
            <QuestionCard
              question={question}
              number={(page - 1) * pageSize + index + 1}
              key={question.id}
              {...(isWrongMode
                ? {
                    freshAttempt: true,
                    allowRetry: false,
                    submitAnswer: (answer: string[]) =>
                      api<AttemptResponse>(`/questions/${question.id}/attempt?channel=review`, {
                        method: "POST",
                        body: JSON.stringify({ answer }),
                      }),
                    renderResultActions: (result: AttemptResponse) => {
                      const lastAnswer = question.history?.lastAnswer ?? [];
                      const rated = ratings[result.attemptId];
                      return (
                        <div className="review-result-actions">
                          {lastAnswer.length > 0 && (
                            <p className="rating-status">上次作答：{lastAnswer.join("；")}</p>
                          )}
                          {result.isCorrect === false && (
                            <p className="rating-status">已按“重来”加入复习计划</p>
                          )}
                          {result.isCorrect === true && (rated ? (
                            <p className="rating-status">
                              掌握度：{rated === "good" ? "确定" : "不确定"}
                            </p>
                          ) : (
                            <div className="confidence-rating">
                              <span>这题是否真正掌握？</span>
                              <div>
                                <button
                                  className="secondary-button"
                                  type="button"
                                  disabled={rate.isPending}
                                  onClick={() => rate.mutate({ attemptId: result.attemptId, rating: "hard" })}
                                >
                                  <HelpCircle aria-hidden="true" />不确定
                                </button>
                                <button
                                  className="success-button"
                                  type="button"
                                  disabled={rate.isPending}
                                  onClick={() => rate.mutate({ attemptId: result.attemptId, rating: "good" })}
                                >
                                  <Check aria-hidden="true" />确定
                                </button>
                              </div>
                              {rate.isError && <span className="form-error">{errorMessage(rate.error)}</span>}
                            </div>
                          ))}
                        </div>
                      );
                    },
                  }
                : {})}
            />
          ))}
        </section>
      ) : (
        <EmptyState>{isWrongMode ? "当前没有待巩固的题目" : "当前题库还没有收藏"}</EmptyState>
      )}
      {totalPages > 1 && (
        <footer className="pagination">
          <button className="secondary-button" type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>
            <ChevronLeft />上一页
          </button>
          <span>{page} / {totalPages}</span>
          <button className="secondary-button" type="button" disabled={page === totalPages} onClick={() => setPage((value) => value + 1)}>
            下一页<ChevronRight />
          </button>
        </footer>
      )}
    </div>
  );
}
