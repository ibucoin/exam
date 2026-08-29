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

export interface SkillGroupResponse {
  group: number;
  groupSize: number;
  totalGroups: number;
  totalQuestions: number;
  questions: QuestionView[];
}

export interface ValidationQuestion {
  itemId: number;
  position: number;
  question: QuestionView;
  answer: string[] | null;
  result: AttemptResponse | null;
  rating: FsrsRating | null;
}

export interface SkillRandomResponse {
  roundId: number;
  status: "active" | "completed";
  questions: ValidationQuestion[];
  answered: number;
  correct: number;
  accuracy: number;
  dueRemaining: number;
  stableMastered: number;
}

export interface ValidationRatingResponse {
  rating: Exclude<FsrsRating, "again">;
  status: "active" | "completed";
}

export interface PrescriptionResponse {
  index: number;
  totalQuestions: number;
  previousId: number | null;
  nextId: number | null;
  question: QuestionView;
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
  skillValidation: {
    reviewed: number;
    correct: number;
    accuracy: number;
    due: number;
    stableMastered: number;
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
