import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Heart, HelpCircle, TriangleAlert } from "lucide-react";
import { Navigate, useParams } from "react-router-dom";
import type {
  AttemptResponse,
  ExamListResponse,
  QuestionScope,
  ReviewQuestionView,
  ReviewRatingResponse,
} from "../../shared/types";
import { EmptyState, Loading } from "../components/Loading";
import { QuestionCard } from "../components/QuestionCard";
import { api, errorMessage } from "../lib/api";
import { examDate } from "../lib/exam";

export function ReviewPage() {
  const { mode } = useParams();
  const [scope, setScope] = useState<QuestionScope>("技能");
  const [status, setStatus] = useState("unmastered");
  const [roundFilter, setRoundFilter] = useState("all");
  const [source, setSource] = useState<"study" | "exam">("study");
  const [examStatus, setExamStatus] = useState<"pending" | "all">("pending");
  const [examFilter, setExamFilter] = useState("all");
  const isExamWrong = mode === "wrong" && source === "exam";
  const examList = useQuery({
    queryKey: ["exams"],
    queryFn: () => api<ExamListResponse>("/exams"),
    enabled: isExamWrong,
  });
  const [page, setPage] = useState(1);
  const [snapshot, setSnapshot] = useState<{ dueCount: number; questions: ReviewQuestionView[] } | null>(null);
  const [ratings, setRatings] = useState<Record<number, "hard" | "good">>({});
  const pageSize = isExamWrong || scope === "技能" ? 20 : 1;
  const review = useQuery({
    queryKey: isExamWrong ? ["review", mode, "exam", examStatus, examFilter] : ["review", mode, scope, status, roundFilter],
    queryFn: () =>
      api<{ dueCount: number; questions: ReviewQuestionView[] }>(isExamWrong
        ? `/review?mode=wrong&source=exam&status=${examStatus}&exam=${examFilter}`
        : `/review?mode=${mode}&scope=${encodeURIComponent(scope)}&status=${status}&round=${roundFilter}`),
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
  }, [scope, mode, status, roundFilter, source, examStatus, examFilter]);
  useEffect(() => {
    if (review.data && !snapshot && !isExamWrong) setSnapshot(review.data);
  }, [review.data, snapshot, isExamWrong]);

  if (mode !== "wrong" && mode !== "favorite") return <Navigate to="/review/wrong" replace />;
  if (isExamWrong || !snapshot) {
    if (review.isPending) return <Loading label="正在整理专项题目" />;
    if (review.isError) return <p className="page-error">{errorMessage(review.error)}</p>;
  }

  const data = isExamWrong ? review.data! : snapshot ?? review.data!;
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
        {!isExamWrong && <div className="segmented-control" aria-label="选择题库">
          {(["技能", "处方审核"] as const).map((item) => (
            <button
              type="button"
              aria-pressed={scope === item}
              className={scope === item ? "active" : ""}
              onClick={() => setScope(item)}
              key={item}
            >{item}</button>
          ))}
        </div>}
      </header>
      {isWrongMode && (
        <div className="segmented-control exam-source-switch" aria-label="错题来源">
          <button type="button" className={source === "study" ? "active" : ""} aria-pressed={source === "study"} onClick={() => setSource("study")}>刷题错题</button>
          <button type="button" className={source === "exam" ? "active" : ""} aria-pressed={source === "exam"} onClick={() => setSource("exam")}>考试错题</button>
        </div>
      )}
      <div className={`review-summary ${isExamWrong ? "exam-review-filters" : ""}`}>
        <p className="result-count">
          共 {data.questions.length} 道题
          {isWrongMode && !isExamWrong && data.dueCount > 0 && ` · 今日到期 ${data.dueCount} 题`}
        </p>
        {isExamWrong && (
          <>
            <label>
              <span className="sr-only">考试错题状态</span>
              <select value={examStatus} onChange={(event) => setExamStatus(event.target.value as "pending" | "all")}>
                <option value="pending">待订正</option>
                <option value="all">全部</option>
              </select>
            </label>
            <label>
              <span className="sr-only">考试场次</span>
              <select value={examFilter} onChange={(event) => setExamFilter(event.target.value)}>
                <option value="all">全部场次</option>
                {examList.isPending && <option disabled>正在加载场次</option>}
                {examList.data?.exams.map((exam) => (
                  <option value={exam.id} key={exam.id}>{examDate(exam.submittedAt ?? exam.startedAt)} · {exam.score} 分</option>
                ))}
              </select>
            </label>
          </>
        )}
        {isExamWrong && examList.isError && <span className="form-error">{errorMessage(examList.error)}</span>}
        {isWrongMode && !isExamWrong && (
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
                      api<AttemptResponse>(isExamWrong
                        ? `/exams/wrong-attempt/${question.id}`
                        : `/questions/${question.id}/attempt?channel=review`, {
                        method: "POST",
                        body: JSON.stringify({ answer }),
                      }),
                    renderResultActions: isExamWrong ? undefined : (result: AttemptResponse) => {
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
        <EmptyState>{isExamWrong ? "当前没有待订正的考试错题" : isWrongMode ? "当前没有待巩固的题目" : "当前题库还没有收藏"}</EmptyState>
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
