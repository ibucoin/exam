import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  Check,
  CheckCircle2,
  FileText,
  RotateCcw,
  Save,
  Send,
  X,
  XCircle,
} from "lucide-react";
import type {
  AttemptResponse,
  QuestionHistory,
  QuestionView,
} from "../../shared/types";
import { api, errorMessage } from "../lib/api";

const kindLabels = {
  Radio: "单选题",
  Checkbox: "多选题",
  Judge: "判断题",
  FillBlank: "处方审核",
};

function refreshStudyData(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  void queryClient.invalidateQueries({ queryKey: ["skills"] });
  void queryClient.invalidateQueries({ queryKey: ["rounds"] });
  void queryClient.invalidateQueries({ queryKey: ["prescription"] });
  void queryClient.invalidateQueries({ queryKey: ["review"] });
  void queryClient.invalidateQueries({ queryKey: ["search"] });
}

export function QuestionCard({
  question,
  number,
  onAnswered,
  freshAttempt = false,
  initialAnswer,
  initialResult,
  submitAnswer,
  allowRetry = true,
  hideNoteUntilAnswered = false,
  renderResultActions,
}: {
  question: QuestionView;
  number: number;
  onAnswered?: (questionId: number, isCorrect: boolean | null) => void;
  freshAttempt?: boolean;
  initialAnswer?: string[] | null;
  initialResult?: AttemptResponse | null;
  submitAnswer?: (answer: string[]) => Promise<AttemptResponse>;
  allowRetry?: boolean;
  hideNoteUntilAnswered?: boolean;
  renderResultActions?: (result: AttemptResponse) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const previous = question.history;
  const derivedResult: AttemptResponse | null = initialResult ?? (!freshAttempt && question.solution
    ? {
        attemptId: question.pendingAttempt?.attemptId ?? 0,
        isCorrect: question.pendingAttempt ? null : (previous?.lastAttemptCorrect ?? null),
        history: previous,
        ...question.solution,
      }
    : null);
  const derivedAnswer = initialAnswer ?? (
    freshAttempt ? [] : (question.pendingAttempt?.answer ?? previous?.lastAnswer ?? [])
  );
  const [selected, setSelected] = useState<string[]>(
    derivedAnswer,
  );
  const [draft, setDraft] = useState(
    derivedAnswer[0] ?? "",
  );
  const [result, setResult] = useState<AttemptResponse | null>(derivedResult);
  const [favorite, setFavorite] = useState(question.isFavorite);
  const [note, setNote] = useState(question.note);
  const [savedNote, setSavedNote] = useState(question.note);

  useEffect(() => setFavorite(question.isFavorite), [question.isFavorite]);
  useEffect(() => {
    setSelected(derivedAnswer);
    setDraft(derivedAnswer[0] ?? "");
    setResult(derivedResult);
  }, [question.id, initialResult?.attemptId]);
  useEffect(() => {
    setNote(question.note);
    setSavedNote(question.note);
  }, [question.id, question.note]);

  const submit = useMutation({
    mutationFn: (answer: string[]) =>
      submitAnswer
        ? submitAnswer(answer)
        : api<AttemptResponse>(`/questions/${question.id}/attempt`, {
            method: "POST",
            body: JSON.stringify({ answer }),
          }),
    onSuccess: (response) => {
      setResult(response);
      onAnswered?.(question.id, response.isCorrect);
      refreshStudyData(queryClient);
    },
  });
  const assess = useMutation({
    mutationFn: (isCorrect: boolean) =>
      api<QuestionHistory>(`/attempts/${result?.attemptId}/assess`, {
        method: "POST",
        body: JSON.stringify({ isCorrect }),
      }),
    onSuccess: (history) => {
      setResult((current) =>
        current ? { ...current, isCorrect: history.lastAttemptCorrect, history } : current,
      );
      onAnswered?.(question.id, history.lastAttemptCorrect);
      refreshStudyData(queryClient);
    },
  });
  const toggleFavorite = useMutation({
    mutationFn: (next: boolean) =>
      api<void>(`/questions/${question.id}/favorite`, {
        method: "PUT",
        body: JSON.stringify({ favorite: next }),
      }),
    onMutate: (next) => setFavorite(next),
    onError: () => setFavorite((current) => !current),
    onSuccess: () => refreshStudyData(queryClient),
  });
  const saveNote = useMutation({
    mutationFn: () =>
      api<{ note: string }>(`/questions/${question.id}/note`, {
        method: "PUT",
        body: JSON.stringify({ note }),
      }),
    onSuccess: (response) => {
      setNote(response.note);
      setSavedNote(response.note);
    },
  });

  const startAgain = () => {
    setSelected([]);
    setDraft("");
    setResult(null);
    submit.reset();
    assess.reset();
  };
  const answer = question.kind === "FillBlank" ? [draft.trim()] : selected;

  return (
    <article className="question-card" id={`question-${question.id}`} data-question-id={question.id}>
      <header className="question-header">
        <div className="question-meta">
          <span className="question-number">{number}</span>
          <span className="kind-label">{kindLabels[question.kind]}</span>
          {question.history && (
            <span className={question.history.mastered ? "mastered-label" : "unmastered-label"}>
              {question.history.mastered ? "已掌握" : "待巩固"}
            </span>
          )}
        </div>
        <button
          className={`icon-button favorite-button ${favorite ? "active" : ""}`}
          type="button"
          title={favorite ? "取消收藏" : "收藏题目"}
          aria-pressed={favorite}
          disabled={toggleFavorite.isPending}
          onClick={() => toggleFavorite.mutate(!favorite)}
        >
          <Bookmark aria-hidden="true" fill={favorite ? "currentColor" : "none"} />
          <span className="sr-only">{favorite ? "取消收藏" : "收藏题目"}</span>
        </button>
      </header>

      <div className="question-stem">{question.stem}</div>

      {!result && question.kind === "FillBlank" && (
        <label className="answer-editor">
          <span>你的审核意见</span>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="填写处方问题、分析依据和干预意见"
            rows={8}
          />
        </label>
      )}

      {question.kind !== "FillBlank" && (!result || result.isCorrect === false) && (
        <div className="options" role={question.kind === "Checkbox" ? "group" : "radiogroup"}>
          {question.options.map((option) => {
            const checked = selected.includes(option);
            const correct = result?.correctAnswers.includes(option) ?? false;
            const incorrect = Boolean(result && checked && !correct);
            return (
              <label
                className={`option ${checked ? "selected" : ""} ${correct ? "correct" : ""} ${incorrect ? "incorrect" : ""}`}
                key={option}
              >
                <input
                  type={question.kind === "Checkbox" ? "checkbox" : "radio"}
                  name={`question-${question.id}`}
                  checked={checked}
                  disabled={Boolean(result)}
                  onChange={() => {
                    if (question.kind === "Checkbox") {
                      setSelected((current) =>
                        current.includes(option)
                          ? current.filter((item) => item !== option)
                          : [...current, option],
                      );
                    } else {
                      setSelected([option]);
                    }
                  }}
                />
                <span className="option-control" aria-hidden="true">
                  {checked && <Check />}
                </span>
                <span>{option}</span>
              </label>
            );
          })}
        </div>
      )}

      {!result && (
        <div className="question-actions">
          <button
            className="primary-button"
            type="button"
            disabled={!answer[0] || submit.isPending}
            onClick={() => submit.mutate(answer)}
          >
            <Send aria-hidden="true" />
            {submit.isPending ? "提交中..." : "提交答案"}
          </button>
          {submit.isError && <span className="form-error">{errorMessage(submit.error)}</span>}
        </div>
      )}

      {result && (
        <div className="answer-feedback" aria-live="polite">
          {result.isCorrect !== null && (
            <div className={`result-banner ${result.isCorrect ? "correct" : "incorrect"}`}>
              {result.isCorrect ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
              <strong>{result.isCorrect ? "回答正确" : "回答错误"}</strong>
            </div>
          )}
          {question.kind === "FillBlank" && (
            <div className="submitted-answer">
              <h3>你的答案</h3>
              <p>{draft || question.pendingAttempt?.answer[0] || previous?.lastAnswer[0]}</p>
            </div>
          )}
          {result.correctAnswers.length > 0 && (
            <div className="solution-block">
              <h3>正确答案</h3>
              <p>{result.correctAnswers.join("；")}</p>
            </div>
          )}
          <div className="solution-block">
            <h3>{question.kind === "FillBlank" ? "参考解析" : "答案解析"}</h3>
            <p>{result.analysisText || "本题暂无解析"}</p>
          </div>

          {question.kind === "FillBlank" && result.isCorrect === null && (
            <div className="self-assessment">
              <span>对照解析完成自评</span>
              <div>
                <button
                  className="success-button"
                  type="button"
                  disabled={assess.isPending}
                  onClick={() => assess.mutate(true)}
                >
                  <Check aria-hidden="true" />答对
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={assess.isPending}
                  onClick={() => assess.mutate(false)}
                >
                  <X aria-hidden="true" />答错
                </button>
              </div>
              {assess.isError && <span className="form-error">{errorMessage(assess.error)}</span>}
            </div>
          )}
          {renderResultActions?.(result)}
          {allowRetry && result.isCorrect !== null && (
            <button className="secondary-button" type="button" onClick={startAgain}>
              <RotateCcw aria-hidden="true" />再答一次
            </button>
          )}
        </div>
      )}

      {(!hideNoteUntilAnswered || result) && <details className="question-note" open={Boolean(savedNote) || undefined}>
        <summary>
          <FileText aria-hidden="true" />
          <span>个人备注</span>
          {savedNote && <span className="note-status">已记录</span>}
        </summary>
        <textarea
          value={note}
          maxLength={20_000}
          rows={5}
          placeholder="记录查到的资料和理解要点"
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="note-actions">
          <span>{note.length} / 20000</span>
          {saveNote.isError && <span className="form-error">{errorMessage(saveNote.error)}</span>}
          <button
            className="secondary-button"
            type="button"
            disabled={note === savedNote || saveNote.isPending}
            onClick={() => saveNote.mutate()}
          >
            <Save aria-hidden="true" />
            {saveNote.isPending ? "保存中..." : "保存备注"}
          </button>
        </div>
      </details>}
    </article>
  );
}
