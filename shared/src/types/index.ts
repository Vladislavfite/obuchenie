import type { ContentItemType, AssignmentStatus, ModuleStatus } from '../constants/content.js';

/* ---------- Ответ API (§56 ТЗ) ---------- */

export interface ApiMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  [key: string]: unknown;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: ApiMeta;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/* ---------- Учебный контент ---------- */

export interface SlideItem {
  id: string;
  imageUrl: string;
  caption?: string;
  order: number;
}

export interface ContentPayloadText { html: string }
export interface ContentPayloadImage { url: string; fit?: 'contain' | 'cover'; caption?: string }
export interface ContentPayloadVideo {
  provider: 'youtube' | 'vimeo' | 'file';
  url: string;
  videoId?: string;
  caption?: string;
}
export interface ContentPayloadSlides { slides: SlideItem[] }
export interface ContentPayloadLive {
  provider: 'youtube' | 'zoom';
  url: string;
  joinUrl?: string;
  speaker?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  videoId?: string;
}
export interface ContentPayloadLink { url: string; label?: string; description?: string }

export type ContentPayload =
  | ContentPayloadText
  | ContentPayloadImage
  | ContentPayloadVideo
  | ContentPayloadSlides
  | ContentPayloadLive
  | ContentPayloadLink;

export interface ContentItem {
  id?: string;
  type: ContentItemType;
  title?: string | null;
  sortOrder: number;
  payload: ContentPayload;
  origin?: 'ai' | null;
}

/* ---------- Вопросы ---------- */

export interface QuestionOption {
  id?: string;
  sortOrder: number;
  text: string;
  isCorrect: boolean;
}

export interface QuestionMedia {
  type: 'none' | 'image';
  url?: string;
  fit?: 'contain' | 'cover';
  caption?: string;
}

export interface Question {
  id?: string;
  sortOrder: number;
  text: string;
  type: 'single' | 'multiple' | 'truefalse' | 'scenario';
  explanation?: string | null;
  sourceReference?: string | null;
  topic?: string | null;
  topicId?: string | null;
  difficulty: 'easy' | 'normal' | 'hard';
  isPractical: boolean;
  points: number;
  media?: QuestionMedia | null;
  imagePrompt?: string | null;
  timestampSec?: number | null;
  origin?: 'ai' | null;
  options: QuestionOption[];
}

/* ---------- Модуль и его версия ---------- */

export interface ModuleVersionContent {
  title: string;
  chapter?: string | null;
  description?: string | null;
  speaker?: string | null;
  accessCode?: string | null;
  passingScore: number;
  attemptLimit: number;
  isRequired: boolean;
  randomQuestions: boolean;
  questionCount: number;
  shuffleOptions: boolean;
  contentItems: ContentItem[];
  questions: Question[];
}

export interface ModuleVersion extends ModuleVersionContent {
  id: string;
  moduleId: string;
  version: number;
  status: ModuleStatus;
  contentHash: string;
  publishedAt?: string | null;
}

export interface TrainingModuleSummary {
  id: string;
  trainingId: string;
  slug: string;
  sortOrder: number;
  currentVersion: number;
  status: ModuleStatus;
  title: string;
  isRequired: boolean;
  passingScore: number;
  attemptLimit: number;
  publishedVersionId?: string | null;
}

export interface TrainingBlockSummary {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  icon?: string | null;
  status: ModuleStatus;
  isCore: boolean;
  sequential: boolean;
  prereqBlockId?: string | null;
  requiredPct: number;
  sortOrder: number;
  modules: TrainingModuleSummary[];
}

/* ---------- Попытки ---------- */

export interface AttemptAnswer {
  questionId: string;
  questionIndex: number;
  givenOptionIds: string[];
  isCorrect: boolean;
}

export interface Attempt {
  id: string;
  employeeId: string;
  moduleId: string;
  moduleVersionId: string;
  version: number;
  attemptNumber: number;
  startedAt: string;
  finishedAt?: string | null;
  durationSec?: number | null;
  score?: number | null;
  correctCount?: number | null;
  totalCount?: number | null;
  passingScore: number;
  passed?: boolean | null;
}

/* ---------- Назначения ---------- */

export interface Assignment {
  id: string;
  trainingId: string;
  employeeId: string;
  assignedAt: string;
  dueDate?: string | null;
  status: AssignmentStatus;
  priority: 'low' | 'normal' | 'high' | 'critical';
  isRequired: boolean;
  completedAt?: string | null;
}

/* ---------- Текущий пользователь ---------- */

export interface CurrentUser {
  user: {
    id: string;
    login: string;
    fullName: string;
    email: string | null;
    phone: string | null;
  };
  organization: { id: string; name: string };
  roles: string[];
  permissions: string[];
  cabinet: 'admin' | 'manager' | 'employee';
  employeeId: string | null;
  uiModules: Array<{ code: string; title: string; route: string; cabinet: string }>;
  customPages: Array<{ slug: string; title: string; cabinets: string[] }>;
  mustChangePassword: boolean;
}
