import { z } from 'zod';
import { LOGIN_RE } from '../domain/utils.js';

/* Общие схемы. Одни и те же правила во фронтенде и бэкенде: расхождение
   между клиентской и серверной валидацией — источник «формa отправилась,
   а сервер отказал без объяснения». */

export const uuidSchema = z.string().uuid('Некорректный идентификатор');

export const loginSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(LOGIN_RE, 'Логин: 3–32 символа, латиница, цифры, точка, дефис, подчёркивание');

export const passwordSchema = z
  .string()
  .min(8, 'Пароль должен содержать не менее 8 символов')
  .max(200, 'Слишком длинный пароль');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().max(64).optional(),
  search: z.string().max(200).optional(),
});

/* ---------- Авторизация ---------- */

export const loginBodySchema = z.object({
  login: z.string().trim().min(1, 'Укажите логин'),
  password: z.string().min(1, 'Укажите пароль'),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, 'Укажите текущий пароль'),
  newPassword: passwordSchema,
});

/* ---------- Оргструктура ---------- */

export const departmentSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название').max(200),
  code: z.string().trim().max(64).optional().nullable(),
  parentId: uuidSchema.optional().nullable(),
});

export const referenceSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название').max(200),
});

/* ---------- Пользователи ---------- */

export const createUserSchema = z.object({
  fullName: z.string().trim().min(1, 'Укажите фамилию, имя и отчество').max(200),
  login: loginSchema,
  password: passwordSchema,
  email: z.string().trim().email('Некорректный email').optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(40).optional().nullable(),
  roleCodes: z.array(z.string()).min(1, 'Выберите хотя бы одну роль'),
  departmentId: uuidSchema.optional().nullable(),
  positionId: uuidSchema.optional().nullable(),
});

export const createEmployeeSchema = z.object({
  fullName: z.string().trim().min(1, 'Укажите фамилию, имя и отчество').max(200),
  login: loginSchema,
  password: passwordSchema,
  email: z.string().trim().email('Некорректный email').optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(40).optional().nullable(),
  personnelNumber: z.string().trim().max(64).optional().nullable(),
  departmentId: uuidSchema.optional().nullable(),
  positionId: uuidSchema.optional().nullable(),
  professionId: uuidSchema.optional().nullable(),
  hiredAt: z.string().date().optional().nullable().or(z.literal('')),
  qualification: z.string().trim().max(200).optional().nullable(),
  employeeGroup: z.string().trim().max(120).optional().nullable(),
});

export const updateEmployeeSchema = createEmployeeSchema.partial().omit({ password: true, login: true });

/* ---------- Учебный контент ---------- */

const slideSchema = z.object({
  id: z.string().optional(),
  imageUrl: z.string().min(1, 'Укажите изображение слайда'),
  caption: z.string().max(500).optional().default(''),
  order: z.number().int().min(0).default(0),
});

export const contentItemSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    title: z.string().max(300).optional().nullable(),
    sortOrder: z.number().int().min(0),
    origin: z.enum(['ai']).optional().nullable(),
    payload: z.object({ html: z.string().max(500_000) }),
  }),
  z.object({
    type: z.literal('image'),
    title: z.string().max(300).optional().nullable(),
    sortOrder: z.number().int().min(0),
    origin: z.enum(['ai']).optional().nullable(),
    payload: z.object({
      url: z.string().min(1),
      fit: z.enum(['contain', 'cover']).default('contain'),
      caption: z.string().max(500).optional().default(''),
    }),
  }),
  z.object({
    type: z.literal('video'),
    title: z.string().max(300).optional().nullable(),
    sortOrder: z.number().int().min(0),
    origin: z.enum(['ai']).optional().nullable(),
    payload: z.object({
      provider: z.enum(['youtube', 'vimeo', 'file']),
      url: z.string().url('Некорректная ссылка'),
      videoId: z.string().max(64).optional().default(''),
      caption: z.string().max(500).optional().default(''),
    }),
  }),
  z.object({
    type: z.literal('slides'),
    title: z.string().max(300).optional().nullable(),
    sortOrder: z.number().int().min(0),
    origin: z.enum(['ai']).optional().nullable(),
    payload: z.object({ slides: z.array(slideSchema).max(200) }),
  }),
  z.object({
    type: z.literal('live'),
    title: z.string().max(300).optional().nullable(),
    sortOrder: z.number().int().min(0),
    origin: z.enum(['ai']).optional().nullable(),
    payload: z.object({
      provider: z.enum(['youtube', 'zoom']),
      url: z.string().url('Некорректная ссылка'),
      joinUrl: z.string().optional().default(''),
      speaker: z.string().max(200).optional().default(''),
      startsAt: z.string().optional().nullable(),
      endsAt: z.string().optional().nullable(),
      videoId: z.string().max(64).optional().default(''),
    }),
  }),
  z.object({
    type: z.literal('link'),
    title: z.string().max(300).optional().nullable(),
    sortOrder: z.number().int().min(0),
    origin: z.enum(['ai']).optional().nullable(),
    payload: z.object({
      url: z.string().url('Некорректная ссылка'),
      label: z.string().max(300).optional().default(''),
      description: z.string().max(1000).optional().default(''),
    }),
  }),
]);

export const questionOptionSchema = z.object({
  id: z.string().optional(),
  sortOrder: z.number().int().min(0),
  text: z.string().trim().min(1, 'Вариант ответа не может быть пустым').max(2000),
  isCorrect: z.boolean().default(false),
});

export const questionSchema = z.object({
  id: z.string().optional(),
  sortOrder: z.number().int().min(0),
  text: z.string().trim().min(1, 'Укажите текст вопроса').max(4000),
  type: z.enum(['single', 'multiple', 'truefalse', 'scenario']).default('single'),
  explanation: z.string().max(4000).optional().nullable(),
  sourceReference: z.string().max(500).optional().nullable(),
  topic: z.string().max(300).optional().nullable(),
  topicId: z.string().max(120).optional().nullable(),
  difficulty: z.enum(['easy', 'normal', 'hard']).default('normal'),
  isPractical: z.boolean().default(false),
  points: z.number().int().min(1).max(100).default(1),
  media: z
    .object({
      type: z.enum(['none', 'image']),
      url: z.string().optional().default(''),
      fit: z.enum(['contain', 'cover']).optional().default('contain'),
      caption: z.string().max(500).optional().default(''),
    })
    .optional()
    .nullable(),
  imagePrompt: z.string().max(2000).optional().nullable(),
  timestampSec: z.number().int().min(0).optional().nullable(),
  origin: z.enum(['ai']).optional().nullable(),
  options: z.array(questionOptionSchema).min(2, 'Нужно не менее двух вариантов').max(10),
});

export const trainingBlockSchema = z.object({
  title: z.string().trim().min(1, 'Укажите название обучения').max(300),
  description: z.string().max(4000).optional().nullable(),
  icon: z.string().max(64).optional().nullable(),
  sequential: z.boolean().default(true),
  prereqBlockId: uuidSchema.optional().nullable(),
  requiredPct: z.number().int().min(0).max(100).default(100),
  isCore: z.boolean().default(false),
});

export const moduleDraftSchema = z.object({
  title: z.string().trim().min(1, 'Укажите название модуля').max(300),
  chapter: z.string().max(300).optional().nullable(),
  description: z.string().max(4000).optional().nullable(),
  speaker: z.string().max(200).optional().nullable(),
  accessCode: z.string().max(32).optional().nullable(),
  passingScore: z.number().int().min(1).max(100).default(70),
  attemptLimit: z.number().int().min(0).max(20).default(0),
  isRequired: z.boolean().default(true),
  randomQuestions: z.boolean().default(false),
  questionCount: z.number().int().min(0).max(200).default(0),
  shuffleOptions: z.boolean().default(false),
  contentItems: z.array(contentItemSchema).max(100).default([]),
  questions: z.array(questionSchema).max(300).default([]),
});

/* ---------- Назначения ---------- */

export const assignmentSchema = z.object({
  trainingId: uuidSchema,
  employeeId: uuidSchema,
  dueDate: z.string().date().optional().nullable().or(z.literal('')),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  isRequired: z.boolean().default(true),
});

export const bulkAssignmentSchema = z.object({
  trainingId: uuidSchema,
  dueDate: z.string().date().optional().nullable().or(z.literal('')),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  isRequired: z.boolean().default(true),
  targets: z.object({
    employeeIds: z.array(uuidSchema).default([]),
    departmentIds: z.array(uuidSchema).default([]),
    positionIds: z.array(uuidSchema).default([]),
    professionIds: z.array(uuidSchema).default([]),
    groups: z.array(z.string().max(120)).default([]),
  }),
});

const ruleConditionSchema = z.object({
  field: z.enum(['department', 'position', 'profession', 'experience', 'qualification', 'permit', 'employee', 'group']),
  op: z.enum(['eq', 'in', 'gte', 'lte', 'exists']),
  value: z.union([z.string(), z.number(), z.array(z.string()), z.boolean()]),
});

export const assignmentRuleSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название правила').max(200),
  trainingId: uuidSchema,
  conditions: z.object({ all: z.array(ruleConditionSchema).min(1, 'Добавьте хотя бы одно условие') }),
  dueDays: z.number().int().min(1).max(3650).optional().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  isActive: z.boolean().default(true),
});

/* ---------- Тестирование ---------- */

export const startAttemptSchema = z.object({
  moduleId: uuidSchema,
  accessCode: z.string().max(32).optional().nullable(),
});

export const submitAnswerSchema = z.object({
  questionId: uuidSchema,
  optionIds: z.array(uuidSchema).max(10),
});

export const finishAttemptSchema = z.object({
  answers: z.array(submitAnswerSchema).max(300),
});

/* ---------- Лекции ---------- */

export const lectureSchema = z.object({
  kind: z.enum(['online', 'offline']),
  title: z.string().trim().min(1, 'Укажите название лекции').max(300),
  description: z.string().max(4000).optional().nullable(),
  lecturerName: z.string().max(200).optional().nullable(),
  trainingId: uuidSchema.optional().nullable(),
  startsAt: z.string().optional().nullable(),
  durationMin: z.number().int().min(1).max(1440).optional().nullable(),
  location: z.string().max(300).optional().nullable(),
  provider: z.enum(['youtube_live', 'zoom', 'external']).optional().nullable(),
  joinUrl: z.string().max(2000).optional().nullable(),
});

export const attendanceSchema = z.object({
  records: z.array(
    z.object({
      employeeId: uuidSchema,
      status: z.enum(['present', 'absent', 'late']),
    }),
  ),
});

/* ---------- Сертификаты и допуски ---------- */

export const certificateSchema = z.object({
  employeeId: uuidSchema,
  trainingId: uuidSchema,
  validUntil: z.string().date().optional().nullable().or(z.literal('')),
  score: z.number().int().min(0).max(100).optional().nullable(),
});

export const permitSchema = z.object({
  employeeId: uuidSchema,
  permitType: z.string().trim().min(1, 'Укажите тип допуска').max(200),
  basis: z.string().max(1000).optional().nullable(),
  certificateId: uuidSchema.optional().nullable(),
  issuedAt: z.string().date(),
  validUntil: z.string().date().optional().nullable().or(z.literal('')),
});

/* ---------- ИИ ---------- */

export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['anthropic', 'openai']),
  model: z.string().max(200).optional().nullable(),
  temperature: z.number().min(0).max(2).optional().nullable(),
  maxTokens: z.number().int().min(256).max(64000).default(16000),
  systemPrompt: z.string().max(20000).optional().nullable(),
  /* Ключ передаётся ТОЛЬКО в эту сторону и никогда не возвращается. */
  apiKey: z.string().max(400).optional().nullable(),
  allowedRoles: z.array(z.string()).default(['ADMIN', 'MANAGER']),
});

export const aiGenerateSchema = z.object({
  text: z.string().max(400_000).optional().default(''),
  fileId: uuidSchema.optional().nullable(),
  count: z.number().int().min(0).max(100).default(20),
  difficulty: z.enum(['basic', 'medium', 'advanced']).default('medium'),
  images: z.boolean().default(true),
  practical: z.boolean().default(true),
});

/* ---------- Интеграция 1С ---------- */

export const onecSettingsSchema = z.object({
  transport: z.enum(['http_service', 'odata', 'file_exchange', 'middleware']),
  baseUrl: z.string().max(2000).optional().nullable(),
  authType: z.enum(['basic', 'token', 'none']).default('none'),
  username: z.string().max(200).optional().nullable(),
  password: z.string().max(400).optional().nullable(),
  token: z.string().max(400).optional().nullable(),
  scheduleCron: z.string().max(100).optional().nullable(),
  isEnabled: z.boolean().default(false),
});

export const onecSyncSchema = z.object({
  types: z.array(z.enum(['departments', 'positions', 'professions', 'employees'])).default([
    'departments', 'positions', 'professions', 'employees',
  ]),
  dryRun: z.boolean().default(false),
  payload: z.unknown().optional(),
});

/* ---------- UI Builder ---------- */

export const uiVisibilitySchema = z.object({
  modules: z.array(
    z.object({
      code: z.string().max(100),
      visible: z.boolean(),
      sortOrder: z.number().int().min(0).optional(),
    }),
  ),
});

export const uiPageSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9-]{2,60}$/, 'Адрес: латиница, цифры и дефис'),
  title: z.string().trim().min(1, 'Укажите название страницы').max(200),
  cabinets: z.array(z.enum(['manager', 'employee'])).min(1, 'Выберите хотя бы один кабинет'),
  isActive: z.boolean().default(true),
});

export const uiPageBlocksSchema = z.object({
  blocks: z.array(
    z.object({
      component: z.enum([
        'HEADER', 'TEXT', 'TABLE', 'FILE_LIST', 'DOCUMENT_LIST',
        'VIDEO', 'LINK', 'TRAINING_LIST', 'EMPLOYEE_LIST', 'CUSTOM_WIDGET',
      ]),
      sortOrder: z.number().int().min(0),
      /* props — только данные. Произвольный HTML/JS не принимается:
         текстовые поля проходят через санитайзер на сервере (§48 ТЗ). */
      props: z.record(z.unknown()).default({}),
    }),
  ).max(50),
});

/* ---------- Настройки платформы ---------- */

export const platformSettingsSchema = z.object({
  certWarningDays: z.number().int().min(0).max(365).default(30),
  dueWarningDays: z.number().int().min(0).max(365).default(7),
  inactivityDays: z.number().int().min(0).max(365).default(21),
  repeatedFailureThreshold: z.number().int().min(1).max(20).default(2),
  defaultPassingScore: z.number().int().min(1).max(100).default(70),
  certificateValidityDays: z.number().int().min(1).max(3650).default(365),
  demoAccountsEnabled: z.boolean().default(false),
});
