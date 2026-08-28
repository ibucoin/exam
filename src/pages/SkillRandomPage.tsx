import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Shuffle } from "lucide-react";
import { Link } from "react-router-dom";
import type { SkillRandomResponse } from "../../shared/types";
import { Loading } from "../components/Loading";
import { QuestionCard } from "../components/QuestionCard";
import { api, errorMessage } from "../lib/api";

export function SkillRandomPage() {
  const [round, setRound] = useState(1);
  const [results, setResults] = useState<Record<number, boolean>>({});
  const questions = useQuery({
    queryKey: ["skill-random", round],
    queryFn: () => api<SkillRandomResponse>("/skills/random"),
  });

  if (questions.isPending) return <Loading label="正在随机抽取技能题" />;
  if (questions.isError) return <p className="page-error">{errorMessage(questions.error)}</p>;

  const answered = Object.keys(results).length;
  const correct = Object.values(results).filter(Boolean).length;
  const accuracy = answered ? Math.round((correct / answered) * 100) : 0;
  const startNextRound = () => {
    setResults({});
    setRound((current) => current + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="study-page">
      <header className="study-heading">
        <div>
          <p className="eyebrow">技能题库</p>
          <h1>随机验证</h1>
          <p>本轮随机抽取 {questions.data.questions.length} 题</p>
        </div>
        <div className="study-heading-actions">
          <Link className="secondary-button" to="/skills"><BookOpen />分组刷题</Link>
          <button className="primary-button" type="button" onClick={startNextRound}>
            <Shuffle />换一组
          </button>
        </div>
      </header>

      <section className="random-summary" aria-live="polite">
        <div><span>已完成</span><strong>{answered} / {questions.data.questions.length}</strong></div>
        <div><span>答对</span><strong>{correct}</strong></div>
        <div><span>本轮正确率</span><strong>{accuracy}%</strong></div>
      </section>

      <nav className="question-navigator" aria-label="本轮题目">
        {questions.data.questions.map((question, index) => {
          const result = results[question.id];
          return (
            <button
              type="button"
              key={question.id}
              className={`${result !== undefined ? "answered" : ""} ${result === false ? "wrong" : ""}`}
              onClick={() => document.getElementById(`question-${question.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              {index + 1}
            </button>
          );
        })}
      </nav>

      <section className="question-list">
        {questions.data.questions.map((question, index) => (
          <QuestionCard
            key={`${round}-${question.id}`}
            question={question}
            number={index + 1}
            freshAttempt
            onAnswered={(questionId, isCorrect) => {
              if (isCorrect !== null) {
                setResults((current) => ({ ...current, [questionId]: isCorrect }));
              }
            }}
          />
        ))}
      </section>
    </div>
  );
}
