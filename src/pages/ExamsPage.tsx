import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FileCheck2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import type { ExamCurrentResponse, ExamListResponse } from "../../shared/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState, Loading } from "../components/Loading";
import { api, errorMessage } from "../lib/api";
import { examDate, examDuration } from "../lib/exam";

export function ExamsPage() {
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const exams = useQuery({
    queryKey: ["exams"],
    queryFn: () => api<ExamListResponse>("/exams"),
  });
  const start = useMutation({
    mutationFn: () => api<ExamCurrentResponse>("/exams", { method: "POST" }),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: ["exams"], exact: true });
      queryClient.removeQueries({ queryKey: ["exams", "current"], exact: true });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      navigate(response.exam ? "/exams/active" : response.autoSubmittedId ? `/exams/${response.autoSubmittedId}` : "/exams", {
        state: !response.exam && response.autoSubmittedId ? { autoSubmitted: true } : undefined,
      });
    },
  });

  if (exams.isPending) return <Loading label="正在整理考试记录" />;
  if (exams.isError) return <p className="page-error">{errorMessage(exams.error)}</p>;
  const { stats, activeId } = exams.data;

  return (
    <div className="study-page exam-list-page">
      <header className="study-heading">
        <div className="section-heading">
          <FileCheck2 aria-hidden="true" />
          <div><p className="eyebrow">考试刷题</p><h1>考试记录</h1></div>
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={start.isPending}
          onClick={() => (activeId ? start.mutate() : setConfirming(true))}
        >{start.isPending ? "正在进入..." : activeId ? "继续考试" : "开始考试"}</button>
      </header>
      <ConfirmDialog
        open={confirming}
        title="确认开始考试？"
        description="20 分钟 50 题，开始后计时不会暂停，中途离开也会继续走表。"
        confirmText="开始考试"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          start.mutate();
        }}
      />
      {start.isError && <p className="form-error">{errorMessage(start.error)}</p>}
      <dl className="exam-stats">
        <div><dt>考试次数</dt><dd>{stats.count}</dd></div>
        <div><dt>最高分</dt><dd>{stats.best} / 100</dd></div>
        <div><dt>最近 5 次平均分</dt><dd>{stats.recentAverage} / 100</dd></div>
      </dl>
      <section className="exam-history" aria-label="历次成绩">
        <h2>历次成绩</h2>
        {exams.data.exams.length ? exams.data.exams.map((exam) => (
          <Link className="exam-history-row" to={`/exams/${exam.id}`} key={exam.id}>
            <strong>{examDate(exam.submittedAt ?? exam.startedAt)}</strong>
            <span>用时 {examDuration(exam.durationMs ?? 0)}</span>
            <span className="exam-history-score">{exam.score} / 100</span>
            <span>正确率 {exam.accuracy}%</span>
            <ArrowRight aria-hidden="true" />
          </Link>
        )) : <EmptyState>还没有考试记录</EmptyState>}
      </section>
    </div>
  );
}
