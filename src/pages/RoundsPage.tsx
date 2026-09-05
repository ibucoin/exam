import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronLeft, ChevronRight, ClipboardCheck, History } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type {
  RoundArchiveResponse,
  RoundScopeOverview,
  RoundsOverviewResponse,
} from "../../shared/types";
import { EmptyState, Loading } from "../components/Loading";
import { QuestionCard } from "../components/QuestionCard";
import { api, errorMessage } from "../lib/api";
import { toRoundResult } from "./SkillGroupPage";

const kindLabels = {
  Radio: "单选",
  Checkbox: "多选",
  Judge: "判断",
  FillBlank: "处方审核",
};

function formatDate(timestamp: number | null) {
  return timestamp ? new Date(timestamp).toLocaleDateString("zh-CN") : "—";
}

function ScopeRounds({ overview, icon: Icon }: { overview: RoundScopeOverview; icon: typeof BookOpen }) {
  return (
    <section className="rounds-section">
      <div className="section-heading">
        <Icon aria-hidden="true" />
        <div>
          <p className="eyebrow">{overview.scope === "技能" ? "技能题库" : "处方审核"}</p>
          <h2>轮次对比</h2>
        </div>
      </div>
      <div className="rounds-list">
        {overview.rounds.map((round) => (
          <Link className="round-row" to={`/rounds/${round.id}`} key={round.id}>
            <strong>第 {round.roundNo} 轮</strong>
            <span className={`round-status ${round.status}`}>
              {round.status === "completed" ? "已完成" : "进行中"}
            </span>
            <span className="round-progress">
              {round.answered} / {round.total} 题 · 答对 {round.correct}
            </span>
            <span className="round-accuracy">
              <span className="round-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, round.accuracy)}%` }} />
              </span>
              {round.accuracy}%
            </span>
            <span className="round-date">{round.status === "completed" ? formatDate(round.completedAt) : `始于 ${formatDate(round.createdAt)}`}</span>
          </Link>
        ))}
      </div>
      {overview.repeatedWrong.length > 0 && (
        <div className="repeated-wrong">
          <h3>反复出错（连错 2 轮以上）</h3>
          <div className="search-results">
            {overview.repeatedWrong.map((question) => (
              <Link
                className="search-result"
                to={
                  overview.scope === "技能"
                    ? `/skills/${question.group ?? 1}#question-${question.id}`
                    : `/prescriptions/${question.id}`
                }
                key={question.id}
              >
                <div className="search-result-meta">
                  <span>{kindLabels[question.kind]}</span>
                  <span>错于第 {question.wrongRounds.join("、")} 轮</span>
                </div>
                <p>{question.stem}</p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function RoundsPage() {
  const overview = useQuery({
    queryKey: ["rounds", "overview"],
    queryFn: () => api<RoundsOverviewResponse>("/rounds/overview"),
  });
  if (overview.isPending) return <Loading label="正在整理轮次数据" />;
  if (overview.isError) return <p className="page-error">{errorMessage(overview.error)}</p>;

  return (
    <div className="study-page">
      <header className="study-heading">
        <div className="section-heading">
          <History aria-hidden="true" />
          <div><p className="eyebrow">复习轮次</p><h1>轮次历史</h1></div>
        </div>
      </header>
      <ScopeRounds overview={overview.data.skill} icon={BookOpen} />
      <ScopeRounds overview={overview.data.prescription} icon={ClipboardCheck} />
    </div>
  );
}

export function RoundArchivePage() {
  const roundId = Number(useParams().id);
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const archive = useQuery({
    queryKey: ["rounds", roundId, page],
    queryFn: () => api<RoundArchiveResponse>(`/rounds/${roundId}/questions?page=${page}`),
    enabled: Number.isInteger(roundId) && roundId > 0,
  });
  if (archive.isPending) return <Loading label="正在加载轮次存档" />;
  if (archive.isError) return <p className="page-error">{errorMessage(archive.error)}</p>;

  const data = archive.data;
  const setPage = (next: number) => setSearchParams({ page: String(next) });
  const answered = data.questions.filter((question) => question.roundAnswer);

  return (
    <div className="study-page">
      <header className="study-heading">
        <div>
          <p className="eyebrow">
            {data.scope === "技能" ? "技能题库" : "处方审核"} · 轮次存档
          </p>
          <h1>第 {data.round.roundNo} 轮</h1>
          <p>
            {data.round.status === "completed" ? "已完成" : "进行中"} ·{" "}
            {data.round.answered} / {data.round.total} 题 · 正确率 {data.round.accuracy}%
          </p>
        </div>
        <Link className="secondary-button" to="/rounds"><History />轮次历史</Link>
      </header>
      {answered.length === 0 && <EmptyState>本页题目在该轮尚未作答</EmptyState>}
      <section className="question-list">
        {data.questions.map((question, index) =>
          question.roundAnswer ? (
            <QuestionCard
              key={`${data.round.id}-${question.id}`}
              question={question}
              number={(data.page - 1) * data.pageSize + index + 1}
              initialAnswer={question.roundAnswer.answer}
              initialResult={toRoundResult(question)}
              allowRetry={false}
            />
          ) : (
            <article className="question-card round-unanswered" key={question.id}>
              <header className="question-header">
                <div className="question-meta">
                  <span className="question-number">{(data.page - 1) * data.pageSize + index + 1}</span>
                  <span className="kind-label">{kindLabels[question.kind]}</span>
                  <span className="unmastered-label">本轮未作答</span>
                </div>
              </header>
              <div className="question-stem">{question.stem}</div>
            </article>
          ),
        )}
      </section>
      {data.totalPages > 1 && (
        <footer className="pagination">
          <button className="secondary-button" type="button" disabled={data.page === 1} onClick={() => setPage(data.page - 1)}>
            <ChevronLeft />上一页
          </button>
          <span>{data.page} / {data.totalPages}</span>
          <button className="secondary-button" type="button" disabled={data.page === data.totalPages} onClick={() => setPage(data.page + 1)}>
            下一页<ChevronRight />
          </button>
        </footer>
      )}
    </div>
  );
}
