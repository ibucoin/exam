import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { AttemptResponse, PrescriptionResponse } from "../../shared/types";
import { Loading } from "../components/Loading";
import { QuestionCard } from "../components/QuestionCard";
import { api, errorMessage } from "../lib/api";
import { toRoundResult } from "./SkillGroupPage";

export function PrescriptionPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const id = useParams().id;
  const [searchParams] = useSearchParams();
  const indexParam = searchParams.get("index");
  const [jumpIndex, setJumpIndex] = useState("");
  const path = id ? `/prescriptions/${id}` : `/prescriptions${indexParam ? `?index=${indexParam}` : ""}`;
  const questionQuery = useQuery({
    queryKey: ["prescription", id ?? "first", indexParam],
    queryFn: () => api<PrescriptionResponse>(path),
  });
  const saveProgress = useMutation({
    mutationFn: (questionId: number) =>
      api<void>("/progress", {
        method: "PATCH",
        body: JSON.stringify({ lastPrescriptionQuestionId: questionId }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  useEffect(() => {
    if (questionQuery.data) saveProgress.mutate(questionQuery.data.question.id);
  }, [questionQuery.data?.question.id]);

  if (questionQuery.isPending) return <Loading label="正在加载处方审核题" />;
  if (questionQuery.isError) return <p className="page-error">{errorMessage(questionQuery.error)}</p>;
  const data = questionQuery.data;
  const question = data.question;

  return (
    <div className="study-page prescription-page">
      <header className="study-heading">
        <div>
          <p className="eyebrow">处方审核 · 第 {data.round.roundNo} 轮</p>
          <h1>案例 {data.index}</h1>
          <p>
            共 {data.totalQuestions} 道案例 · 本轮 {data.round.answered} /{" "}
            {data.round.total}，正确率 {data.round.accuracy}%
          </p>
          {data.round.firstPendingAssessId !== null && (
            <p className="round-pending-assess">
              还有 {data.round.pendingAssess} 道已作答但未自评，自评后本轮才算完成
              {data.round.firstPendingAssessId !== question.id && (
                <Link to={`/prescriptions/${data.round.firstPendingAssessId}`}>去自评</Link>
              )}
            </p>
          )}
        </div>
        <form
          className="jump-form"
          onSubmit={(event) => {
            event.preventDefault();
            const target = Number(jumpIndex);
            if (target >= 1 && target <= data.totalQuestions) navigate(`/prescriptions?index=${target}`);
          }}
        >
          <label>
            <span className="sr-only">跳转到题号</span>
            <input
              type="number"
              min={1}
              max={data.totalQuestions}
              value={jumpIndex}
              placeholder="题号"
              onChange={(event) => setJumpIndex(event.target.value)}
            />
          </label>
          <button className="secondary-button" type="submit">跳转</button>
        </form>
      </header>
      <QuestionCard
        key={`${data.round.id}-${question.id}`}
        question={question}
        number={data.index}
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
      />
      <footer className="study-footer prescription-navigation">
        {data.previousId ? (
          <Link className="secondary-button" to={`/prescriptions/${data.previousId}`}><ChevronLeft />上一题</Link>
        ) : <span />}
        <span>{data.index} / {data.totalQuestions}</span>
        {data.nextId ? (
          <Link className="primary-button" to={`/prescriptions/${data.nextId}`}>下一题<ChevronRight /></Link>
        ) : <span />}
      </footer>
    </div>
  );
}
