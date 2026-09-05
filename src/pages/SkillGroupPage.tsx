import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import type {
  AttemptResponse,
  DashboardResponse,
  RoundQuestionView,
  SkillGroupResponse,
} from "../../shared/types";
import { Loading } from "../components/Loading";
import { QuestionCard } from "../components/QuestionCard";
import { api, errorMessage } from "../lib/api";

export function SkillRedirect({ userId }: { userId: number }) {
  const dashboard = useQuery({
    queryKey: ["dashboard", userId],
    queryFn: () => api<DashboardResponse>("/dashboard"),
  });
  if (dashboard.isPending) return <Loading />;
  if (dashboard.isError) return <p className="page-error">{errorMessage(dashboard.error)}</p>;
  return <Navigate to={`/skills/${dashboard.data.progress.lastSkillGroup}`} replace />;
}

export function toRoundResult(question: RoundQuestionView): AttemptResponse | null {
  if (!question.roundAnswer || !question.solution) return null;
  return {
    attemptId: question.roundAnswer.attemptId,
    isCorrect: question.roundAnswer.isCorrect,
    history: question.history,
    ...question.solution,
  };
}

export function SkillGroupPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const group = Number(useParams().group);
  const groupQuery = useQuery({
    queryKey: ["skills", group],
    queryFn: () => api<SkillGroupResponse>(`/skills/${group}`),
    enabled: Number.isInteger(group) && group > 0,
  });
  const saveProgress = useMutation({
    mutationFn: (questionId?: number) =>
      api<void>("/progress", {
        method: "PATCH",
        body: JSON.stringify({
          lastSkillGroup: group,
          ...(questionId ? { lastSkillQuestionId: questionId } : {}),
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  useEffect(() => {
    if (!groupQuery.data) return;
    saveProgress.mutate();
    const hash = window.location.hash.slice(1);
    if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
  }, [groupQuery.data?.group]);

  if (groupQuery.isPending) return <Loading label="正在加载技能题组" />;
  if (groupQuery.isError) return <p className="page-error">{errorMessage(groupQuery.error)}</p>;

  const data = groupQuery.data;
  const answered = data.questions.filter((question) => question.roundAnswer).length;
  const scrollToQuestion = (id: number) => {
    document.getElementById(`question-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    saveProgress.mutate(id);
  };

  return (
    <div className="study-page">
      <header className="study-heading">
        <div>
          <p className="eyebrow">技能题库 · 第 {data.round.roundNo} 轮</p>
          <h1>第 {data.group} 组</h1>
          <p>
            本组已作答 {answered} / {data.questions.length} · 本轮 {data.round.answered} /{" "}
            {data.round.total}，正确率 {data.round.accuracy}%
          </p>
        </div>
        <div className="study-heading-actions">
          <Link className="secondary-button" to="/rounds"><History />轮次历史</Link>
          <div className="group-switcher">
            <Link
              className={`icon-button ${data.group === 1 ? "disabled" : ""}`}
              to={data.group > 1 ? `/skills/${data.group - 1}` : "#"}
              aria-label="上一组"
            ><ChevronLeft /></Link>
            <label>
              <span className="sr-only">选择题组</span>
              <select value={data.group} onChange={(event) => navigate(`/skills/${event.target.value}`)}>
                {Array.from({ length: data.totalGroups }, (_, index) => {
                  const size = Math.min(
                    data.groupSize,
                    data.totalQuestions - index * data.groupSize,
                  );
                  const remaining = size - (data.groupAnswered[index] ?? 0);
                  return (
                    <option value={index + 1} key={index + 1}>
                      第 {index + 1} 组 {remaining ? `剩 ${remaining}/${size}` : "✓"}
                    </option>
                  );
                })}
              </select>
            </label>
            <Link
              className={`icon-button ${data.group === data.totalGroups ? "disabled" : ""}`}
              to={data.group < data.totalGroups ? `/skills/${data.group + 1}` : "#"}
              aria-label="下一组"
            ><ChevronRight /></Link>
          </div>
        </div>
      </header>
      <nav className="question-navigator" aria-label="本组题目">
        {data.questions.map((question, index) => (
          <button
            type="button"
            key={question.id}
            className={`${question.roundAnswer ? "answered" : ""} ${
              question.roundAnswer?.isCorrect === false ? "wrong" : ""
            }`}
            onClick={() => scrollToQuestion(question.id)}
          >
            {index + 1}
          </button>
        ))}
      </nav>
      <section className="question-list">
        {data.questions.map((question, index) => (
          <QuestionCard
            key={`${data.round.id}-${question.id}`}
            question={question}
            number={index + 1}
            freshAttempt={!question.roundAnswer}
            initialAnswer={question.roundAnswer?.answer ?? null}
            initialResult={toRoundResult(question)}
            allowRetry={false}
            submitAnswer={(answer) =>
              api<AttemptResponse>(`/rounds/questions/${question.id}/answer`, {
                method: "POST",
                body: JSON.stringify({ answer }),
              })
            }
            onAnswered={(id) => saveProgress.mutate(id)}
          />
        ))}
      </section>
      <footer className="study-footer">
        {data.group > 1 && <Link className="secondary-button" to={`/skills/${data.group - 1}`}><ChevronLeft />上一组</Link>}
        {data.group < data.totalGroups && <Link className="primary-button" to={`/skills/${data.group + 1}`}>下一组<ChevronRight /></Link>}
      </footer>
    </div>
  );
}
