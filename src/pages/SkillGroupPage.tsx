import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Shuffle } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import type { DashboardResponse, SkillGroupResponse } from "../../shared/types";
import { Loading } from "../components/Loading";
import { QuestionCard } from "../components/QuestionCard";
import { api, errorMessage } from "../lib/api";

export function SkillRedirect() {
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardResponse>("/dashboard"),
  });
  if (dashboard.isPending) return <Loading />;
  if (dashboard.isError) return <p className="page-error">{errorMessage(dashboard.error)}</p>;
  return <Navigate to={`/skills/${dashboard.data.progress.lastSkillGroup}`} replace />;
}

export function SkillGroupPage() {
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
  const answered = data.questions.filter((question) => question.history).length;
  const scrollToQuestion = (id: number) => {
    document.getElementById(`question-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    saveProgress.mutate(id);
  };

  return (
    <div className="study-page">
      <header className="study-heading">
        <div>
          <p className="eyebrow">技能题库</p>
          <h1>第 {data.group} 组</h1>
          <p>本组已作答 {answered} / {data.questions.length}</p>
        </div>
        <div className="study-heading-actions">
          <Link className="secondary-button" to="/skills/random"><Shuffle />随机验证</Link>
          <div className="group-switcher">
            <Link
              className={`icon-button ${data.group === 1 ? "disabled" : ""}`}
              to={data.group > 1 ? `/skills/${data.group - 1}` : "#"}
              aria-label="上一组"
            ><ChevronLeft /></Link>
            <label>
              <span className="sr-only">选择题组</span>
              <select value={data.group} onChange={(event) => navigate(`/skills/${event.target.value}`)}>
                {Array.from({ length: data.totalGroups }, (_, index) => (
                  <option value={index + 1} key={index + 1}>第 {index + 1} 组</option>
                ))}
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
            className={`${question.history ? "answered" : ""} ${
              question.history && !question.history.mastered ? "wrong" : ""
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
            key={question.id}
            question={question}
            number={index + 1}
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
