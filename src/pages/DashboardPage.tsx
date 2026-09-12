import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  ClipboardCheck,
  FileCheck2,
  Heart,
  History,
  Search,
  TriangleAlert,
} from "lucide-react";
import { Link } from "react-router-dom";
import type {
  DashboardResponse,
  QuestionScope,
  RoundSummary,
  ScopeStats,
} from "../../shared/types";
import { Loading } from "../components/Loading";
import { api, errorMessage } from "../lib/api";
import { examDate } from "../lib/exam";

function ScopePanel({
  title,
  icon: Icon,
  stats,
  round,
  scope,
  continueTo,
  accent,
}: {
  title: string;
  icon: typeof BookOpen;
  stats: ScopeStats;
  round: RoundSummary;
  scope: QuestionScope;
  continueTo: string;
  accent: "green" | "coral";
}) {
  const queryClient = useQueryClient();
  const startRound = useMutation({
    mutationFn: () =>
      api<RoundSummary>("/rounds/start", {
        method: "POST",
        body: JSON.stringify({ scope }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
      void queryClient.invalidateQueries({ queryKey: ["prescription"] });
      void queryClient.invalidateQueries({ queryKey: ["rounds"] });
    },
  });
  const progress = round.total ? Math.round((round.answered / round.total) * 100) : 0;
  return (
    <article className={`scope-panel ${accent}`}>
      <header>
        <span className="scope-icon"><Icon aria-hidden="true" /></span>
        <div>
          <h2>{title}</h2>
          <p>第 {round.roundNo} 轮 · {round.answered} / {round.total} 题已作答</p>
        </div>
        <strong>{progress}%</strong>
      </header>
      <div className="progress-track" aria-label={`本轮进度 ${progress}%`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <dl className="metrics">
        <div><dt>本轮正确率</dt><dd>{round.accuracy}%</dd></div>
        <div><dt>当前掌握</dt><dd>{stats.mastered}</dd></div>
        <div><dt>待巩固</dt><dd>{stats.unmastered}</dd></div>
        <div><dt>已收藏</dt><dd>{stats.favorites}</dd></div>
      </dl>
      {round.status === "completed" ? (
        <button
          className="primary-button"
          type="button"
          disabled={startRound.isPending}
          onClick={() => {
            if (window.confirm(`第 ${round.roundNo} 轮已完成，确定开启第 ${round.roundNo + 1} 轮吗？`)) {
              startRound.mutate();
            }
          }}
        >
          {startRound.isPending ? "开启中..." : `开启第 ${round.roundNo + 1} 轮`}
        </button>
      ) : (
        <Link className="panel-link" to={continueTo}>
          继续复习 <ArrowRight aria-hidden="true" />
        </Link>
      )}
      {startRound.isError && <p className="form-error">{errorMessage(startRound.error)}</p>}
    </article>
  );
}

export function DashboardPage({ userId }: { userId: number }) {
  const dashboard = useQuery({
    queryKey: ["dashboard", userId],
    queryFn: () => api<DashboardResponse>("/dashboard"),
  });
  if (dashboard.isPending) return <Loading label="正在整理复习进度" />;
  if (dashboard.isError) return <p className="page-error">{errorMessage(dashboard.error)}</p>;

  const { skill, prescription, skillRound, prescriptionRound, review, progress, exam } = dashboard.data;
  const skillTarget = `/skills/${progress.lastSkillGroup}${
    progress.lastSkillQuestionId ? `#question-${progress.lastSkillQuestionId}` : ""
  }`;
  const prescriptionTarget = progress.lastPrescriptionQuestionId
    ? `/prescriptions/${progress.lastPrescriptionQuestionId}`
    : "/prescriptions";

  return (
    <div className="dashboard-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">今日复习</p>
          <h1>学习总览</h1>
        </div>
      </header>
      <section className="scope-grid" aria-label="题库进度">
        <ScopePanel
          title="技能题库"
          icon={BookOpen}
          stats={skill}
          round={skillRound}
          scope="技能"
          continueTo={skillTarget}
          accent="green"
        />
        <ScopePanel
          title="处方审核"
          icon={ClipboardCheck}
          stats={prescription}
          round={prescriptionRound}
          scope="处方审核"
          continueTo={prescriptionTarget}
          accent="coral"
        />
      </section>
      <section className="validation-panel" aria-label="每日复习">
        <header>
          <span className="scope-icon"><BrainCircuit aria-hidden="true" /></span>
          <div>
            <h2>每日复习</h2>
            <p>错题按记忆状态排序，到期优先</p>
          </div>
        </header>
        <dl className="validation-metrics">
          <div><dt>今日到期</dt><dd>{review.due}</dd></div>
          <div><dt>待巩固错题</dt><dd>{review.wrongUnmastered}</dd></div>
          <div><dt>稳定掌握</dt><dd>{review.stableMastered}</dd></div>
        </dl>
        <Link className="panel-link" to="/review/wrong">
          开始复习 <ArrowRight aria-hidden="true" />
        </Link>
      </section>
      <section className="exam-dashboard" aria-label="考试进度">
        <header>
          <span className="scope-icon"><FileCheck2 aria-hidden="true" /></span>
          <div>
            <h2>考试刷题</h2>
            <p>{exam.lastScore === null ? "还没考过" : `最近一次 ${exam.lastScore} / 100 · ${examDate(exam.lastSubmittedAt!)}`}</p>
          </div>
        </header>
        <dl className="exam-dashboard-metrics">
          <div><dt>考试次数</dt><dd>{exam.count}</dd></div>
          <div><dt>最高分</dt><dd>{exam.best} / 100</dd></div>
          <div><dt>未订正考试错题</dt><dd>{exam.wrongPending}</dd></div>
        </dl>
        <Link className="panel-link" to="/exams">{exam.activeId ? "继续考试" : "开始考试"} <ArrowRight aria-hidden="true" /></Link>
      </section>
      <section className="quick-section">
        <h2>专项复习</h2>
        <div className="quick-links">
          <Link to="/rounds"><History aria-hidden="true" /><span>轮次历史</span><ArrowRight /></Link>
          <Link to="/review/wrong"><TriangleAlert aria-hidden="true" /><span>错题复习</span><ArrowRight /></Link>
          <Link to="/review/favorite"><Heart aria-hidden="true" /><span>收藏题目</span><ArrowRight /></Link>
          <Link to="/search"><Search aria-hidden="true" /><span>搜索题库</span><ArrowRight /></Link>
        </div>
      </section>
    </div>
  );
}
