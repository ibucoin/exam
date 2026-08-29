import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  ClipboardCheck,
  Heart,
  Search,
  TriangleAlert,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { DashboardResponse, ScopeStats } from "../../shared/types";
import { Loading } from "../components/Loading";
import { api, errorMessage } from "../lib/api";

function ScopePanel({
  title,
  icon: Icon,
  stats,
  continueTo,
  accent,
}: {
  title: string;
  icon: typeof BookOpen;
  stats: ScopeStats;
  continueTo: string;
  accent: "green" | "coral";
}) {
  const progress = stats.total ? Math.round((stats.answered / stats.total) * 100) : 0;
  return (
    <article className={`scope-panel ${accent}`}>
      <header>
        <span className="scope-icon"><Icon aria-hidden="true" /></span>
        <div>
          <h2>{title}</h2>
          <p>{stats.answered} / {stats.total} 题已作答</p>
        </div>
        <strong>{progress}%</strong>
      </header>
      <div className="progress-track" aria-label={`完成进度 ${progress}%`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <dl className="metrics">
        <div><dt>首次正确率</dt><dd>{stats.firstAccuracy}%</dd></div>
        <div><dt>当前掌握</dt><dd>{stats.mastered}</dd></div>
        <div><dt>待巩固</dt><dd>{stats.unmastered}</dd></div>
        <div><dt>已收藏</dt><dd>{stats.favorites}</dd></div>
      </dl>
      <Link className="panel-link" to={continueTo}>
        继续复习 <ArrowRight aria-hidden="true" />
      </Link>
    </article>
  );
}

export function DashboardPage() {
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardResponse>("/dashboard"),
  });
  if (dashboard.isPending) return <Loading label="正在整理复习进度" />;
  if (dashboard.isError) return <p className="page-error">{errorMessage(dashboard.error)}</p>;

  const { skill, prescription, skillValidation, progress } = dashboard.data;
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
          continueTo={skillTarget}
          accent="green"
        />
        <ScopePanel
          title="处方审核"
          icon={ClipboardCheck}
          stats={prescription}
          continueTo={prescriptionTarget}
          accent="coral"
        />
      </section>
      <section className="validation-panel" aria-label="技能验证进度">
        <header>
          <span className="scope-icon"><BrainCircuit aria-hidden="true" /></span>
          <div>
            <h2>技能随机验证</h2>
            <p>按记忆状态安排到期题目</p>
          </div>
        </header>
        <dl className="validation-metrics">
          <div><dt>验证次数</dt><dd>{skillValidation.reviewed}</dd></div>
          <div><dt>验证正确率</dt><dd>{skillValidation.accuracy}%</dd></div>
          <div><dt>当前到期</dt><dd>{skillValidation.due}</dd></div>
          <div><dt>稳定掌握</dt><dd>{skillValidation.stableMastered}</dd></div>
        </dl>
        <Link className="panel-link" to="/skills/random">
          开始验证 <ArrowRight aria-hidden="true" />
        </Link>
      </section>
      <section className="quick-section">
        <h2>专项复习</h2>
        <div className="quick-links">
          <Link to="/review/wrong"><TriangleAlert aria-hidden="true" /><span>错题复习</span><ArrowRight /></Link>
          <Link to="/review/favorite"><Heart aria-hidden="true" /><span>收藏题目</span><ArrowRight /></Link>
          <Link to="/search"><Search aria-hidden="true" /><span>搜索题库</span><ArrowRight /></Link>
        </div>
      </section>
    </div>
  );
}
