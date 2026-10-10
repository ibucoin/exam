import { useEffect, useRef, useState } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, History, Send } from "lucide-react";
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

export function SkillRedirect({ userId, scope = "技能" }: { userId: number; scope?: "技能" | "静配规范" }) {
  const dashboard = useQuery({
    queryKey: ["dashboard", userId],
    queryFn: () => api<DashboardResponse>("/dashboard"),
  });
  if (dashboard.isPending) return <Loading />;
  if (dashboard.isError) return <p className="page-error">{errorMessage(dashboard.error)}</p>;
  const progress = dashboard.data.progress;
  const target = scope === "静配规范"
    ? `/training/${progress.lastTrainingGroup}${progress.lastTrainingQuestionId ? `#question-${progress.lastTrainingQuestionId}` : ""}`
    : `/skills/${progress.lastSkillGroup}`;
  return <Navigate to={target} replace />;
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

export function SkillGroupPage({ scope = "技能" }: { scope?: "技能" | "静配规范" }) {
  const bankPath = scope === "静配规范" ? "training" : "skills";
  const group = Number(useParams().group);
  const groupQuery = useQuery({
    queryKey: [bankPath, group],
    queryFn: () => api<SkillGroupResponse>(`/${bankPath}/${group}`),
    enabled: Number.isInteger(group) && group > 0,
  });
  if (groupQuery.isPending) return <Loading label={`正在加载${scope}题组`} />;
  if (!groupQuery.data) return <p className="page-error">{errorMessage(groupQuery.error)}</p>;

  return (
    <SkillGroupContent
      key={`${bankPath}-${group}-${groupQuery.data.round.id}`}
      scope={scope}
      bankPath={bankPath}
      data={groupQuery.data}
    />
  );
}

function SkillGroupContent({ scope, bankPath, data }: {
  scope: "技能" | "静配规范";
  bankPath: "skills" | "training";
  data: SkillGroupResponse;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isTraining = scope === "静配规范";
  const group = data.group;
  const roundId = data.round.id;
  const queryKey = [bankPath, group];
  const batchMutationKey = ["group-answers", bankPath, group, roundId];
  const batchPending = useIsMutating({ mutationKey: batchMutationKey }) > 0;
  const drafts = useRef<Record<number, string[]>>({});
  const [batchError, setBatchError] = useState<{ message: string; questionId?: number } | null>(null);
  const batchSubmit = useMutation({
    mutationKey: batchMutationKey,
    mutationFn: async (answers: { questionId: number; answer: string[] }[]) => {
      await queryClient.cancelQueries({ queryKey, exact: true });
      return api<SkillGroupResponse>(`/${bankPath}/${group}/answers`, {
        method: "POST",
        body: JSON.stringify({ roundId, answers }),
      });
    },
    onSuccess: async (response) => {
      if (response.round.id !== roundId) return;
      const cached = queryClient.getQueryData<SkillGroupResponse>(queryKey);
      if (cached && cached.round.id !== roundId) return;
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData<SkillGroupResponse>(queryKey, (current) =>
        current && current.round.id !== roundId ? current : response,
      );
      setBatchError(null);
      for (const key of ["dashboard", bankPath, "rounds", "review", "search"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (error) => setBatchError({ message: errorMessage(error) }),
  });
  const saveProgress = useMutation({
    mutationFn: (questionId?: number) =>
      api<void>("/progress", {
        method: "PATCH",
        body: JSON.stringify(isTraining ? {
          lastTrainingGroup: group,
          ...(questionId ? { lastTrainingQuestionId: questionId } : {}),
        } : {
          lastSkillGroup: group,
          ...(questionId ? { lastSkillQuestionId: questionId } : {}),
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const questionId = isTraining
      ? (data.questions.find((question) => `question-${question.id}` === hash) ?? data.questions[0])?.id
      : undefined;
    saveProgress.mutate(questionId);
    if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
  }, [scope, group, roundId]);

  const answered = data.questions.filter((question) => question.roundAnswer).length;
  const pending = data.questions.length - answered;
  const correct = data.questions.filter((question) => question.roundAnswer?.isCorrect === true).length;
  const accuracy = answered ? Math.round(correct / answered * 100) : 0;
  const scrollToQuestion = (id: number) => {
    document.getElementById(`question-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    saveProgress.mutate(id);
  };
  const submitGroup = () => {
    if (queryClient.isMutating({ mutationKey: batchMutationKey })) return;
    const current = queryClient.getQueryData<SkillGroupResponse>(queryKey);
    if (!current || current.round.id !== roundId) return;
    const pendingQuestions = current.questions.filter((question) => !question.roundAnswer);
    if (!pendingQuestions.length) return;
    const unanswered = pendingQuestions.filter((question) => !drafts.current[question.id]?.[0]?.trim());
    if (unanswered.length) {
      const first = unanswered[0];
      const number = current.questions.findIndex((question) => question.id === first.id) + 1;
      setBatchError({
        message: `还有 ${unanswered.length} 题未选择答案，请先完成第 ${number} 题。`,
        questionId: first.id,
      });
      scrollToQuestion(first.id);
      return;
    }
    setBatchError(null);
    batchSubmit.mutate(pendingQuestions.map((question) => ({
      questionId: question.id,
      answer: drafts.current[question.id],
    })));
  };

  return (
    <div className="study-page">
      <header className="study-heading">
        <div>
          <p className="eyebrow">{isTraining ? "静配规范" : "技能题库"} · 第 {data.round.roundNo} 轮</p>
          <h1>第 {data.group} 组</h1>
          {isTraining && <p>《医疗机构静脉用药集中调配与评价药师培训规范》考核题库 · 共 {data.totalQuestions} 题，{data.totalGroups} 组</p>}
          <p>
            本组已作答 {answered} / {data.questions.length} · 本轮 {data.round.answered} /{" "}
            {data.round.total}，正确率 {data.round.accuracy}%
          </p>
          <p>本组正确率 {accuracy}%（{correct} / {answered}）</p>
        </div>
        <div className="study-heading-actions">
          <Link className="secondary-button" to="/rounds"><History />轮次历史</Link>
          <div className="group-switcher">
            <Link
              className={`icon-button ${data.group === 1 ? "disabled" : ""}`}
              to={data.group > 1 ? `/${bankPath}/${data.group - 1}` : "#"}
              aria-label="上一组"
            ><ChevronLeft /></Link>
            <label>
              <span className="sr-only">选择题组</span>
              <select value={data.group} onChange={(event) => navigate(`/${bankPath}/${event.target.value}`)}>
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
              to={data.group < data.totalGroups ? `/${bankPath}/${data.group + 1}` : "#"}
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
            key={`${bankPath}-${group}-${roundId}-${question.id}`}
            question={question}
            number={index + 1}
            freshAttempt={!question.roundAnswer}
            initialAnswer={question.roundAnswer?.answer ?? null}
            initialResult={toRoundResult(question)}
            allowRetry={false}
            showSubmitButton={false}
            submissionDisabled={batchPending}
            onAnswerChange={(id, answer) => {
              drafts.current[id] = answer;
              if (batchError?.questionId === id && answer[0]?.trim()) setBatchError(null);
            }}
            renderAnswer={batchError?.questionId === question.id
              ? () => <p className="form-error" role="alert">{batchError.message}</p>
              : undefined}
          />
        ))}
      </section>
      {batchError && !batchError.questionId && <p className="form-error" role="alert">{batchError.message}</p>}
      <footer className="study-footer group-submit-footer">
        {data.group > 1 && <Link className="secondary-button" to={`/${bankPath}/${data.group - 1}`}><ChevronLeft />上一组</Link>}
        <button
          className="primary-button group-submit-button"
          type="button"
          disabled={!pending || batchPending}
          onClick={submitGroup}
        >
          <Send aria-hidden="true" />
          {batchPending ? "正在提交本组..." : `提交本组（待提交${pending}题）`}
        </button>
        {data.group < data.totalGroups && <Link className="primary-button" to={`/${bankPath}/${data.group + 1}`}>下一组<ChevronRight /></Link>}
      </footer>
    </div>
  );
}
