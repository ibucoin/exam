import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock3, Send } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { ExamCurrentResponse, ExamQuestionView, ExamResultResponse, ExamSummary } from "../../shared/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Loading } from "../components/Loading";
import { ApiRequestError, api, errorMessage } from "../lib/api";

const kindLabels = { Radio: "单选题", Checkbox: "多选题", Judge: "判断题" };
const sectionIndexes = ["一", "二", "三"];

function examSections(breakdown: ExamSummary["breakdown"]) {
  let position = 1;
  return breakdown.map((row, index) => {
    const section = {
      position,
      title: `${sectionIndexes[index] ?? index + 1}、${kindLabels[row.kind]}（${row.total} 题，每题 ${row.fullScore / row.total} 分）`,
    };
    position += row.total;
    return section;
  });
}

function ExamQuestion({ question, answer, unsaved, disabled, onChange }: {
  question: ExamQuestionView;
  answer: string[];
  unsaved: boolean;
  disabled: boolean;
  onChange: (answer: string[]) => void;
}) {
  return (
    <article className="question-card exam-question" id={`question-${question.id}`}>
      <header className="question-header">
        <div className="question-meta">
          <span className="question-number">{question.position}</span>
          <span className="kind-label">{kindLabels[question.kind as keyof typeof kindLabels]}</span>
          {unsaved && <span className="exam-wrong-label" role="status">未保存</span>}
        </div>
      </header>
      <div className="question-stem">{question.stem}</div>
      <div className="options" role={question.kind === "Checkbox" ? "group" : "radiogroup"}>
        {question.options.map((option) => {
          const checked = answer.includes(option);
          return (
            <label className={`option ${checked ? "selected" : ""}`} key={option}>
              <input
                type={question.kind === "Checkbox" ? "checkbox" : "radio"}
                name={`exam-question-${question.id}`}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(question.kind === "Checkbox"
                  ? checked ? answer.filter((item) => item !== option) : [...answer, option]
                  : [option])}
              />
              <span className="option-control" aria-hidden="true">{checked && <Check />}</span>
              <span>{option}</span>
            </label>
          );
        })}
      </div>
    </article>
  );
}

function ExamSession({ data, ended }: {
  data: ExamCurrentResponse & { exam: NonNullable<ExamCurrentResponse["exam"]> };
  ended: boolean;
}) {
  const { exam, questions, serverNow } = data;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<number, string[]>>(() =>
    Object.fromEntries(questions.map((question) => [question.id, question.answer])));
  const [offset, setOffset] = useState(() => serverNow - Date.now());
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((exam.deadline - serverNow) / 1000)));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [saveErrors, setSaveErrors] = useState<Record<number, unknown>>({});
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const pending = useRef(new Map<number, string[]>());
  const queues = useRef(new Map<number, Promise<void>>());
  const saveController = useRef(new AbortController());
  const submitted = useRef(false);
  const autoAttempted = useRef(false);
  const endedRef = useRef(ended);
  endedRef.current = endedRef.current || ended;
  const expired = () => endedRef.current || Date.now() + offset >= exam.deadline;
  const answered = questions.filter((question) => (answers[question.id] ?? []).length > 0).length;
  const failedIds = Object.keys(saveErrors);

  const save = (id: number, answer: string[]) => {
    const previous = queues.current.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      if (expired()) throw new Error("考试已结束，答案未能保存");
      const request = async () => {
        try {
          await api<{ saved: true }>(`/exams/${exam.id}/answers/${id}`, {
            method: "PUT", body: JSON.stringify({ answer }), signal: saveController.current.signal,
          });
        } catch (error) {
          if (error instanceof ApiRequestError && error.status === 409) {
            endedRef.current = true;
            setRemaining(0);
          }
          throw error;
        }
      };
      try {
        await request();
      } catch (error) {
        if (expired()) throw error;
        await request();
      }
      if (pending.current.get(id) === answer) {
        pending.current.delete(id);
        setSaveErrors((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      }
    });
    queues.current.set(id, next);
    void next.catch((error) => {
      if (pending.current.get(id) === answer) {
        setSaveErrors((current) => ({ ...current, [id]: error }));
      }
    });
    return next;
  };
  const flush = () => Promise.allSettled(queues.current.values());
  const waitForSaves = async (timeout: number) => {
    let timer: number | undefined;
    try {
      return await Promise.race([
        flush().then(() => true),
        new Promise<false>((resolve) => { timer = window.setTimeout(() => resolve(false), timeout); }),
      ]);
    } finally {
      window.clearTimeout(timer);
    }
  };
  const retrySave = async () => {
    if (expired() || retrying || submitted.current) return;
    setRetrying(true);
    try {
      await Promise.allSettled([...pending.current].map(([id, answer]) => save(id, answer)));
    } finally {
      setRetrying(false);
    }
  };
  const submit = async (automatic = false) => {
    if (submitted.current) return;
    submitted.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const finished = await waitForSaves(automatic ? 1500 : Math.max(0, exam.deadline - Date.now() - offset));
      automatic = automatic || !finished || expired();
      if (automatic) saveController.current.abort();
      if (!automatic && pending.current.size) {
        throw new Error(`还有 ${pending.current.size} 题答案未保存，请重试保存后再交卷`);
      }
      const result = await api<ExamResultResponse>(`/exams/${exam.id}/submit`, { method: "POST" });
      const unsavedCount = [...pending.current].filter(([id, answer]) => {
        const saved = result.questions.find((question) => question.id === id)?.answer;
        return !saved || saved.length !== answer.length || answer.some((value) => !saved.includes(value));
      }).length;
      void queryClient.invalidateQueries({ queryKey: ["exams"], exact: true });
      queryClient.removeQueries({ queryKey: ["exams", "current"], exact: true });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["review"] });
      navigate(`/exams/${exam.id}`, { replace: true, state: automatic ? { autoSubmitted: true, unsavedCount } : undefined });
    } catch (error) {
      setSubmitError(error);
      submitted.current = false;
      if (automatic && expired()) autoAttempted.current = true;
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => { setOffset(serverNow - Date.now()); }, [serverNow]);
  useEffect(() => {
    const tick = () => {
      const timeLeft = exam.deadline - (Date.now() + offset);
      if (endedRef.current) saveController.current.abort();
      setRemaining(endedRef.current ? 0 : Math.max(0, Math.ceil(timeLeft / 1000)));
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [exam.deadline, offset]);
  useEffect(() => {
    if ((remaining === 0 || ended) && !autoAttempted.current && !submitted.current) {
      autoAttempted.current = true;
      void submit(true);
    }
  }, [remaining, ended, submitting]);

  const updateAnswer = (question: ExamQuestionView, answer: string[]) => {
    if (submitted.current || expired()) return;
    setAnswers((current) => ({ ...current, [question.id]: answer }));
    pending.current.set(question.id, answer);
    save(question.id, answer);
  };
  const seconds = Math.floor(remaining % 60);
  const minutes = Math.floor(remaining / 60);
  const sections = examSections(exam.breakdown);

  return (
    <div className="study-page exam-active-page">
      <header className="study-heading">
        <div><p className="eyebrow">考试刷题</p><h1>正在考试</h1></div>
      </header>
      <div className={`exam-timer ${remaining <= 60 ? "exam-timer-warning" : ""}`} role="timer" aria-label="考试剩余时间">
        <span><Clock3 aria-hidden="true" />剩余 <strong>{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</strong></span>
        <span>已答 {answered}/{exam.total}</span>
      </div>
      {failedIds.length > 0 && (
        <div className="exam-submit-error" role="alert">
          <span>{failedIds.length} 题答案未保存：{errorMessage(saveErrors[Number(failedIds[0])])}</span>
          <button className="secondary-button" type="button" disabled={retrying || submitting || remaining === 0 || ended} onClick={() => void retrySave()}>
            {retrying ? "保存中..." : "重试保存"}
          </button>
        </div>
      )}
      {submitError !== null && (
        <div className="exam-submit-error" role="alert">
          <span>{errorMessage(submitError)}</span>
          <button className="secondary-button" type="button" disabled={submitting} onClick={() => void submit()}>重试交卷</button>
        </div>
      )}
      <section className="question-list" aria-label="考试题目">
        {questions.map((question) => {
          const section = sections.find((item) => item.position === question.position);
          return (
            <div key={question.id}>
              {section && <h2 className="exam-section-title">{section.title}</h2>}
              <ExamQuestion question={question} answer={answers[question.id] ?? []} unsaved={saveErrors[question.id] !== undefined}
                disabled={submitting || remaining === 0 || ended} onChange={(answer) => updateAnswer(question, answer)} />
            </div>
          );
        })}
      </section>
      <footer className="study-footer exam-submit-footer">
        <span>已答 {answered} / {exam.total} 题</span>
        <button className="primary-button" type="button" disabled={submitting} onClick={() => {
          if (failedIds.length) {
            setSubmitError(new Error(`还有 ${failedIds.length} 题答案未保存，请重试保存后再交卷`));
            return;
          }
          if (answered < exam.total) setConfirmingSubmit(true);
          else void submit();
        }}><Send aria-hidden="true" />{submitting ? "交卷中..." : "交卷"}</button>
      </footer>
      <ConfirmDialog
        open={confirmingSubmit}
        title="确认交卷？"
        description={`还有 ${exam.total - answered} 题未作答，交卷后不能再作答。`}
        confirmText="确认交卷"
        cancelText="继续答题"
        onCancel={() => setConfirmingSubmit(false)}
        onConfirm={() => {
          setConfirmingSubmit(false);
          void submit();
        }}
      />
    </div>
  );
}

export function ExamPage() {
  const navigate = useNavigate();
  const lastActive = useRef<ExamCurrentResponse | null>(null);
  const current = useQuery({
    queryKey: ["exams", "current"],
    queryFn: () => api<ExamCurrentResponse>("/exams/current"),
    refetchOnWindowFocus: false,
  });
  if (current.data?.exam) lastActive.current = current.data;
  const settledSession = Boolean(!current.data?.exam && current.data?.autoSubmittedId && current.data.autoSubmittedId === lastActive.current?.exam?.id);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void current.refetch(); };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [current.refetch]);
  useEffect(() => {
    if (current.data && !current.data.exam && !settledSession) {
      navigate(current.data.autoSubmittedId ? `/exams/${current.data.autoSubmittedId}` : "/exams", {
        replace: true, state: current.data.autoSubmittedId ? { autoSubmitted: true } : undefined,
      });
    }
  }, [current.data, navigate, settledSession]);

  if (current.isPending) return <Loading label="正在加载试卷" />;
  if (current.isError && !current.data) return <p className="page-error">{errorMessage(current.error)}</p>;
  const session = settledSession ? lastActive.current : current.data;
  if (!session?.exam) return <Loading label="正在进入考试记录" />;
  return <ExamSession key={session.exam.id} ended={settledSession} data={session as ExamCurrentResponse & { exam: NonNullable<ExamCurrentResponse["exam"]> }} />;
}
