import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, HelpCircle, Shuffle } from "lucide-react";
import { Link } from "react-router-dom";
import type {
  AttemptResponse,
  FsrsRating,
  SkillRandomResponse,
  ValidationRatingResponse,
} from "../../shared/types";
import { Loading } from "../components/Loading";
import { QuestionCard } from "../components/QuestionCard";
import { api, errorMessage } from "../lib/api";

export function SkillRandomPage() {
  const queryClient = useQueryClient();
  const round = useQuery({
    queryKey: ["skill-random"],
    queryFn: () => api<SkillRandomResponse>("/skills/random"),
  });
  const nextRound = useMutation({
    mutationFn: () => api<SkillRandomResponse>("/skills/random/next", { method: "POST" }),
    onSuccess: (response) => {
      queryClient.setQueryData(["skill-random"], response);
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  });
  const rate = useMutation({
    mutationFn: ({ itemId, rating }: { itemId: number; rating: Exclude<FsrsRating, "again"> }) =>
      api<ValidationRatingResponse>(`/skills/random/items/${itemId}/rating`, {
        method: "POST",
        body: JSON.stringify({ rating }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["skill-random"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  if (round.isPending) return <Loading label="正在生成验证题组" />;
  if (round.isError) return <p className="page-error">{errorMessage(round.error)}</p>;

  const data = round.data;
  const pendingRatings = data.questions.filter(
    (item) => item.result?.isCorrect && item.rating === null,
  ).length;
  const startNextRound = () => {
    if (
      data.status === "active" &&
      !window.confirm("本轮尚未完成，换组后将无法继续。确定换一组吗？")
    ) {
      return;
    }
    nextRound.mutate();
  };

  return (
    <div className="study-page">
      <header className="study-heading">
        <div>
          <p className="eyebrow">技能题库</p>
          <h1>随机验证</h1>
          <p>
            {data.status === "completed"
              ? "本轮验证已完成"
              : pendingRatings
                ? `还有 ${pendingRatings} 题待确认掌握度`
                : `本轮共 ${data.questions.length} 题`}
          </p>
        </div>
        <div className="study-heading-actions">
          <Link className="secondary-button" to="/skills"><BookOpen />分组刷题</Link>
          <button
            className="primary-button"
            type="button"
            disabled={nextRound.isPending}
            onClick={startNextRound}
          >
            <Shuffle />{nextRound.isPending ? "生成中..." : "换一组"}
          </button>
        </div>
      </header>

      {nextRound.isError && <p className="page-error">{errorMessage(nextRound.error)}</p>}
      <section className="random-summary validation-summary" aria-live="polite">
        <div><span>已作答</span><strong>{data.answered} / {data.questions.length}</strong></div>
        <div><span>答对</span><strong>{data.correct}</strong></div>
        <div><span>本轮正确率</span><strong>{data.accuracy}%</strong></div>
        <div><span>当前到期</span><strong>{data.dueRemaining}</strong></div>
        <div><span>稳定掌握</span><strong>{data.stableMastered}</strong></div>
      </section>

      <nav className="question-navigator" aria-label="本轮题目">
        {data.questions.map((item) => (
          <button
            type="button"
            key={item.itemId}
            className={`${item.result ? "answered" : ""} ${item.result?.isCorrect === false ? "wrong" : ""}`}
            onClick={() => document.getElementById(`question-${item.question.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            {item.position}
          </button>
        ))}
      </nav>

      <section className="question-list">
        {data.questions.map((item) => (
          <QuestionCard
            key={`${data.roundId}-${item.itemId}`}
            question={item.question}
            number={item.position}
            initialAnswer={item.answer}
            initialResult={item.result}
            allowRetry={false}
            hideNoteUntilAnswered
            submitAnswer={(answer): Promise<AttemptResponse> =>
              api(`/skills/random/items/${item.itemId}/answer`, {
                method: "POST",
                body: JSON.stringify({ answer }),
              })
            }
            renderResultActions={(result) => {
              if (result.isCorrect === false) {
                return <p className="rating-status">已按“重来”加入复习计划</p>;
              }
              if (item.rating) {
                return (
                  <p className="rating-status">
                    掌握度：{item.rating === "good" ? "确定" : item.rating === "hard" ? "不确定" : "重来"}
                  </p>
                );
              }
              return (
                <div className="confidence-rating">
                  <span>这题是否真正掌握？</span>
                  <div>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={rate.isPending}
                      onClick={() => rate.mutate({ itemId: item.itemId, rating: "hard" })}
                    >
                      <HelpCircle aria-hidden="true" />不确定
                    </button>
                    <button
                      className="success-button"
                      type="button"
                      disabled={rate.isPending}
                      onClick={() => rate.mutate({ itemId: item.itemId, rating: "good" })}
                    >
                      <Check aria-hidden="true" />确定
                    </button>
                  </div>
                  {rate.isError && <span className="form-error">{errorMessage(rate.error)}</span>}
                </div>
              );
            }}
          />
        ))}
      </section>
    </div>
  );
}
