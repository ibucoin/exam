import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, CheckCircle2, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Link } from "react-router-dom";
import type { QuestionKind, QuestionScope, SearchResponse } from "../../shared/types";
import { EmptyState, Loading } from "../components/Loading";
import { api, errorMessage } from "../lib/api";

interface Filters {
  q: string;
  scope: "" | QuestionScope;
  kind: "" | QuestionKind;
  filter: "all" | "wrong" | "favorite";
}

const initialFilters: Filters = { q: "", scope: "", kind: "", filter: "all" };
const kindLabels: Record<QuestionKind, string> = {
  Radio: "单选题",
  Checkbox: "多选题",
  Judge: "判断题",
  FillBlank: "处方审核",
};

export function SearchPage() {
  const [form, setForm] = useState<Filters>(initialFilters);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), filter: filters.filter });
  if (filters.q) params.set("q", filters.q);
  if (filters.scope) params.set("scope", filters.scope);
  if (filters.kind) params.set("kind", filters.kind);
  const search = useQuery({
    queryKey: ["search", filters, page],
    queryFn: () => api<SearchResponse>(`/search?${params}`),
  });

  const update = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const totalPages = search.data ? Math.max(1, Math.ceil(search.data.total / 30)) : 1;

  return (
    <div className="search-page">
      <header className="page-heading">
        <div><p className="eyebrow">全部题库</p><h1>搜索题目</h1></div>
      </header>
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setFilters(form);
        }}
      >
        <label className="search-input">
          <Search aria-hidden="true" />
          <input
            value={form.q}
            onChange={(event) => update("q", event.target.value)}
            placeholder="输入题干关键词"
          />
        </label>
        <select value={form.scope} onChange={(event) => update("scope", event.target.value as Filters["scope"])} aria-label="题库">
          <option value="">全部题库</option><option value="技能">技能</option><option value="处方审核">处方审核</option>
        </select>
        <select value={form.kind} onChange={(event) => update("kind", event.target.value as Filters["kind"])} aria-label="题型">
          <option value="">全部题型</option><option value="Radio">单选题</option><option value="Checkbox">多选题</option><option value="Judge">判断题</option><option value="FillBlank">处方审核</option>
        </select>
        <select value={form.filter} onChange={(event) => update("filter", event.target.value as Filters["filter"])} aria-label="学习状态">
          <option value="all">全部状态</option><option value="wrong">待巩固</option><option value="favorite">已收藏</option>
        </select>
        <button className="primary-button" type="submit"><Search />搜索</button>
      </form>

      {search.isPending ? <Loading /> : search.isError ? (
        <p className="page-error">{errorMessage(search.error)}</p>
      ) : search.data.results.length ? (
        <>
          <p className="result-count">找到 {search.data.total} 道题</p>
          <div className="search-results">
            {search.data.results.map((result) => {
              const target = result.scope === "技能" ? `/skills/${result.group}#question-${result.id}` : `/prescriptions/${result.id}`;
              return (
                <Link className="search-result" to={target} key={`${result.scope}-${result.id}`}>
                  <div className="search-result-meta">
                    <span>{result.scope}</span>
                    <span>{kindLabels[result.kind]}</span>
                    {result.history?.mastered && <span className="status-icon"><CheckCircle2 />已掌握</span>}
                    {result.isFavorite && <span className="status-icon"><Bookmark />已收藏</span>}
                  </div>
                  <p>{result.stem}</p>
                  <ChevronRight aria-hidden="true" />
                </Link>
              );
            })}
          </div>
          {totalPages > 1 && (
            <footer className="pagination">
              <button className="secondary-button" type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft />上一页</button>
              <span>{page} / {totalPages}</span>
              <button className="secondary-button" type="button" disabled={page === totalPages} onClick={() => setPage((value) => value + 1)}>下一页<ChevronRight /></button>
            </footer>
          )}
        </>
      ) : <EmptyState>没有符合条件的题目</EmptyState>}
    </div>
  );
}
