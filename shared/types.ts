export type UserRole = "admin" | "user";
export type QuestionKind = "Radio" | "Checkbox" | "Judge" | "FillBlank";
export type QuestionScope = "技能" | "处方审核";
export type FsrsRating = "again" | "hard" | "good";

export interface CurrentUser {
  id: number;
  username: string;
  role: UserRole;
  mustChangePassword: boolean;
}

export interface QuestionHistory {
  firstAttemptCorrect: boolean;
  lastAttemptCorrect: boolean;
  mastered: boolean;
  attemptCount: number;
  lastAnswer: string[];
}

export interface QuestionSolution {
  correctAnswers: string[];
  analysisText: string;
}

export interface QuestionView {
  id: number;
  externalId: string;
  kind: QuestionKind;
  stem: string;
  options: string[];
  history: QuestionHistory | null;
  isFavorite: boolean;
  note: string;
  solution?: QuestionSolution;
  pendingAttempt?: {
    attemptId: number;
    answer: string[];
  };
}

export interface RoundAnswerView {
  attemptId: number;
  answer: string[];
  isCorrect: boolean | null;
  answeredAt: number;
}

export interface RoundQuestionView extends QuestionView {
  roundAnswer: RoundAnswerView | null;
}

export interface RoundSummary {
  id: number;
  roundNo: number;
  status: "active" | "completed";
  total: number;
  answered: number;
  correct: number;
  accuracy: number;
  createdAt: number;
  completedAt: number | null;
}

export interface RepeatedWrongQuestion {
  id: number;
  kind: QuestionKind;
  stem: string;
  wrongRounds: number[];
  group: number | null;
}

export interface RoundScopeOverview {
  scope: QuestionScope;
  rounds: RoundSummary[];
  repeatedWrong: RepeatedWrongQuestion[];
}

export interface RoundsOverviewResponse {
  skill: RoundScopeOverview;
  prescription: RoundScopeOverview;
}

export interface RoundArchiveResponse {
  round: RoundSummary;
  scope: QuestionScope;
  page: number;
  pageSize: number;
  totalPages: number;
  questions: RoundQuestionView[];
}

export interface SkillGroupResponse {
  group: number;
  groupSize: number;
  totalGroups: number;
  totalQuestions: number;
  round: RoundSummary;
  groupAnswered: number[];
  questions: RoundQuestionView[];
}

export interface PrescriptionResponse {
  index: number;
  totalQuestions: number;
  previousId: number | null;
  nextId: number | null;
  round: RoundSummary;
  question: RoundQuestionView;
}

export interface ReviewQuestionView extends QuestionView {
  due: number | null;
}

export interface ReviewResponse {
  dueCount: number;
  questions: ReviewQuestionView[];
}

export interface ReviewRatingResponse {
  rating: Exclude<FsrsRating, "again">;
}

export interface AttemptResponse extends QuestionSolution {
  attemptId: number;
  isCorrect: boolean | null;
  history: QuestionHistory | null;
}

export interface ScopeStats {
  total: number;
  answered: number;
  firstCorrect: number;
  firstAccuracy: number;
  mastered: number;
  unmastered: number;
  favorites: number;
}

export interface DashboardResponse {
  skill: ScopeStats;
  prescription: ScopeStats;
  skillRound: RoundSummary;
  prescriptionRound: RoundSummary;
  review: {
    due: number;
    stableMastered: number;
    wrongUnmastered: number;
  };
  progress: {
    lastSkillGroup: number;
    lastSkillQuestionId: number | null;
    lastPrescriptionQuestionId: number | null;
  };
}

export interface SearchResult {
  id: number;
  kind: QuestionKind;
  scope: QuestionScope;
  stem: string;
  isFavorite: boolean;
  history: QuestionHistory | null;
  group: number | null;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
}

export interface AdminUser {
  id: number;
  username: string;
  role: UserRole;
  mustChangePassword: boolean;
  isDisabled: boolean;
  createdAt: number;
}

export interface ApiError {
  error: string;
}
