import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Heart, TriangleAlert } from "lucide-react";
import { Navigate, useParams } from "react-router-dom";
import type { QuestionScope, QuestionView } from "../../shared/types";
import { EmptyState, Loading } from "../components/Loading";
import { QuestionCard } from "../components/QuestionCard";
import { api, errorMessage } from "../lib/api";

export function ReviewPage() {
  const { mode } = useParams();
  const [scope, setScope] = useState<QuestionScope>("技能");
  const [status, setStatus] = useState("unmastered");
  const [page, setPage] = useState(1);
  const pageSize = scope === "技能" ? 20 : 1;
  const review = useQuery({
    queryKey: ["review", mode, scope, status],
    queryFn: () =>
      api<QuestionView[]>(`/review?mode=${mode}&scope=${encodeURIComponent(scope)}&status=${status}`),
    enabled: mode === "wrong" || mode === "favorite",
  });

  useEffect(() => setPage(1), [scope, mode, status]);

  if (mode !== "wrong" && mode !== "favorite") return <Navigate to="/review/wrong" replace />;
  if (review.isPending) return <Loading label="正在整理专项题目" />;
  if (review.isError) return <p className="page-error">{errorMessage(review.error)}</p>;

  const totalPages = Math.max(1, Math.ceil(review.data.length / pageSize));
  const visible = review.data.slice((page - 1) * pageSize, page * pageSize);
  const Icon = mode === "wrong" ? TriangleAlert : Heart;
  const title = mode === "wrong" ? "错题复习" : "收藏题目";

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
        <p className="result-count">共 {review.data.length} 道题</p>
        {mode === "wrong" && (
          <label>
            <span className="sr-only">错题掌握状态</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="unmastered">待巩固</option>
              <option value="mastered">已掌握</option>
              <option value="all">全部错题</option>
            </select>
          </label>
        )}
      </div>
      {visible.length ? (
        <section className="question-list">
          {visible.map((question, index) => (
            <QuestionCard
              question={question}
              number={(page - 1) * pageSize + index + 1}
              key={question.id}
            />
          ))}
        </section>
      ) : (
        <EmptyState>{mode === "wrong" ? "当前没有待巩固的题目" : "当前题库还没有收藏"}</EmptyState>
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
