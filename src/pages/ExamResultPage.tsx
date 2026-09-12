import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileCheck2 } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";
import type { AttemptResponse, ExamQuestionView, ExamResultResponse } from "../../shared/types";
import { EmptyState, Loading } from "../components/Loading";
import { QuestionCard } from "../components/QuestionCard";
import { api, errorMessage } from "../lib/api";
import { examDate, examDuration } from "../lib/exam";

const kindLabels = { Radio: "单选", Checkbox: "多选", Judge: "判断" };
type ResultFilter = "all" | "wrong" | "unanswered";

function QuestionReview({ question }: { question: ExamQuestionView }) {
  const result: AttemptResponse = {
    attemptId: 0,
    isCorrect: question.isCorrect,
    history: null,
    correctAnswers: question.solution?.correctAnswers ?? [],
    analysisText: question.solution?.analysisText ?? "",
  };
  return (
    <div className="exam-review-item">
      <div className="exam-review-label">
        <span className={question.isCorrect === null ? "exam-unanswered-label" : question.isCorrect ? "exam-correct-label" : "exam-wrong-label"}>
          {question.isCorrect === null ? "未作答" : question.isCorrect ? "答对" : "答错"}
        </span>
      </div>
      <QuestionCard
        question={question}
        number={question.position}
        initialAnswer={question.answer}
        initialResult={result}
        allowRetry={false}
        renderAnswer={() => (
          <div className="exam-your-answer">你的答案：{question.answer.length ? question.answer.join("；") : "未作答"}</div>
        )}
      />
    </div>
  );
}

export function ExamResultPage() {
  const id = Number(useParams().id);
  const location = useLocation();
  const notice = location.state as { autoSubmitted?: boolean; unsavedCount?: number } | null;
  const [filter, setFilter] = useState<ResultFilter>("all");
  const result = useQuery({
    queryKey: ["exams", id],
    queryFn: () => api<ExamResultResponse>(`/exams/${id}`),
    enabled: Number.isInteger(id) && id > 0,
  });
  if (!Number.isInteger(id) || id < 1) return <p className="page-error">考试编号不正确</p>;
  if (result.isPending) return <Loading label="正在加载考试成绩" />;
  if (result.isError) return <p className="page-error">{errorMessage(result.error)}</p>;

  const { exam, questions } = result.data;
  const visible = questions.filter((question) => filter === "all" ||
    (filter === "wrong" ? question.isCorrect === false : question.isCorrect === null));
  return (
    <div className="study-page exam-result-page">
      <header className="study-heading">
        <div className="section-heading">
          <FileCheck2 aria-hidden="true" />
          <div><p className="eyebrow">{examDate(exam.submittedAt ?? exam.startedAt)}</p><h1>考试成绩</h1></div>
        </div>
        <Link className="secondary-button" to="/exams">考试记录</Link>
      </header>
      {notice?.autoSubmitted && (
        <p className="exam-timeout-notice" role="alert">
          考试已超时，系统已自动交卷。
          {Boolean(notice.unsavedCount) && `有 ${notice.unsavedCount} 题答案未能保存，成绩按服务端已保存的答案计算。`}
        </p>
      )}
      <section className="exam-result-summary" aria-label="成绩汇总">
        <div className="exam-score"><span>总分</span><strong>{exam.score}<small> / 100</small></strong></div>
        <dl>
          <div><dt>用时</dt><dd>{examDuration(exam.durationMs ?? 0)}</dd></div>
          <div><dt>正确率</dt><dd>{exam.accuracy}%</dd></div>
          <div><dt>未作答</dt><dd>{exam.unanswered} 题</dd></div>
        </dl>
      </section>
      <section className="exam-breakdown" aria-label="题型得分">
        <h2>题型明细</h2>
        <div className="exam-breakdown-list">
          {exam.breakdown.map((row) => (
            <div key={row.kind}>
              <strong>{kindLabels[row.kind]}</strong>
              <b>{row.score} / {row.fullScore}</b>
              <span>对 {row.correct} · 错 {row.wrong} · 未答 {row.unanswered}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="exam-review" aria-label="逐题回顾">
        <div className="exam-review-heading">
          <h2>逐题回顾</h2>
          <div className="segmented-control" aria-label="筛选回顾题目">
            {([ ["all", "全部"], ["wrong", "只看错题"], ["unanswered", "只看未答"] ] as const).map(([value, label]) => (
              <button key={value} type="button" className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
            ))}
          </div>
        </div>
        {visible.length ? <div className="question-list">{visible.map((question) => <QuestionReview key={`${exam.id}-${question.id}`} question={question} />)}</div>
          : <EmptyState>没有符合筛选条件的题目</EmptyState>}
      </section>
    </div>
  );
}
