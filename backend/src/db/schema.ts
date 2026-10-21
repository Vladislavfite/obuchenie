/* Схема базы данных TBEDU LMS (PostgreSQL + Drizzle ORM).

   Принципы (см. DATABASE-DESIGN.md):
   1. organization_id во всех бизнес-сущностях — мультиарендность с первого дня.
   2. Вычисляемое не хранится: passed, bestScore, статусы считаются из попыток.
   3. История не перезаписывается: test_attempts только INSERT.
   4. Результат ссылается на ВЕРСИЮ модуля, а не на модуль.
   5. Мягкое удаление там, где на запись могут ссылаться результаты. */

import {
  pgTable, uuid, text, integer, boolean, timestamp, date, jsonb,
  uniqueIndex, index, bigserial, numeric, primaryKey, inet,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const now = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/* ============ ОРГАНИЗАЦИИ И ОРГСТРУКТУРА ============ */

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  bin: text('bin'),
  timezone: text('timezone').notNull().default('Asia/Almaty'),
  locale: text('locale').notNull().default('ru'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: now(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id'),
  name: text('name').notNull(),
  code: text('code'),
  externalId: text('external_id'),
  source: text('source').notNull().default('manual'),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: now(),
}, (t) => ({
  extIdx: uniqueIndex('departments_external_uniq').on(t.organizationId, t.externalId),
  orgIdx: index('departments_org_idx').on(t.organizationId),
}));

export const positions = pgTable('positions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  externalId: text('external_id'),
  source: text('source').notNull().default('manual'),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: now(),
}, (t) => ({ extIdx: uniqueIndex('positions_external_uniq').on(t.organizationId, t.externalId) }));

export const professions = pgTable('professions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  externalId: text('external_id'),
  source: text('source').notNull().default('manual'),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: now(),
}, (t) => ({ extIdx: uniqueIndex('professions_external_uniq').on(t.organizationId, t.externalId) }));

/* ============ ПОЛЬЗОВАТЕЛИ, РОЛИ, ПРАВА ============ */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  login: text('login').notNull(),
  email: text('email'),
  phone: text('phone'),
  fullName: text('full_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: now(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  loginIdx: uniqueIndex('users_login_uniq').on(t.organizationId, t.login),
  orgIdx: index('users_org_idx').on(t.organizationId),
  nameIdx: index('users_name_idx').on(t.fullName),
}));

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: now(),
}, (t) => ({ codeIdx: uniqueIndex('roles_code_uniq').on(t.organizationId, t.code) }));

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  groupName: text('group_name').notNull(),
  description: text('description'),
});

export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
}, (t) => ({ pk: primaryKey({ columns: [t.roleId, t.permissionId] }) }));

export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  grantedBy: uuid('granted_by'),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.roleId] }) }));

/* Индивидуальные исключения поверх роли (§9 ТЗ). */
export const userPermissions = pgTable('user_permissions', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  effect: text('effect').notNull(), // allow | deny
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.permissionId] }) }));

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: now(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => ({ expIdx: index('sessions_expiry_idx').on(t.expiresAt) }));

/* ============ ПРОФИЛИ ============ */

export const employeeProfiles = pgTable('employee_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  externalId: text('external_id'),
  personnelNumber: text('personnel_number'),
  departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
  positionId: uuid('position_id').references(() => positions.id, { onDelete: 'set null' }),
  professionId: uuid('profession_id').references(() => professions.id, { onDelete: 'set null' }),
  hiredAt: date('hired_at'),
  experienceMonths: integer('experience_months'),
  qualification: text('qualification'),
  employeeGroup: text('employee_group'),
  stage: text('stage'),
  birthDate: date('birth_date'),
  source: text('source').notNull().default('manual'),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
  createdAt: now(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  extIdx: uniqueIndex('emp_external_uniq').on(t.organizationId, t.externalId),
  deptIdx: index('emp_department_idx').on(t.departmentId),
  posIdx: index('emp_position_idx').on(t.positionId),
  profIdx: index('emp_profession_idx').on(t.professionId),
  actIdx: index('emp_last_activity_idx').on(t.organizationId, t.lastActivityAt),
}));

export const managerProfiles = pgTable('manager_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
  positionId: uuid('position_id').references(() => positions.id, { onDelete: 'set null' }),
  createdAt: now(),
});

/* Зона ответственности руководителя (§62 ТЗ: изоляция). */
export const managerDepartments = pgTable('manager_departments', {
  managerProfileId: uuid('manager_profile_id').notNull().references(() => managerProfiles.id, { onDelete: 'cascade' }),
  departmentId: uuid('department_id').notNull().references(() => departments.id, { onDelete: 'cascade' }),
  includeChildren: boolean('include_children').notNull().default(true),
}, (t) => ({ pk: primaryKey({ columns: [t.managerProfileId, t.departmentId] }) }));

/* ============ ОБУЧЕНИЕ ============ */

export const trainingBlocks = pgTable('training_blocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  icon: text('icon'),
  status: text('status').notNull().default('draft'),
  isCore: boolean('is_core').notNull().default(false),
  sequential: boolean('sequential').notNull().default(true),
  prereqBlockId: uuid('prereq_block_id'),
  requiredPct: integer('required_pct').notNull().default(100),
  sortOrder: integer('sort_order').notNull().default(0),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: now(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  slugIdx: uniqueIndex('blocks_slug_uniq').on(t.organizationId, t.slug),
  titleIdx: index('blocks_title_idx').on(t.title),
}));

export const trainingModules = pgTable('training_modules', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  trainingId: uuid('training_id').notNull().references(() => trainingBlocks.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  currentVersion: integer('current_version').notNull().default(1),
  status: text('status').notNull().default('draft'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: now(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  slugIdx: uniqueIndex('modules_slug_uniq').on(t.trainingId, t.slug),
  trainIdx: index('modules_training_idx').on(t.trainingId, t.sortOrder),
}));

/* Каждая версия — отдельная строка. Прогресс сотрудника ссылается сюда. */
export const trainingModuleVersions = pgTable('training_module_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  moduleId: uuid('module_id').notNull().references(() => trainingModules.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  status: text('status').notNull().default('draft'),
  title: text('title').notNull(),
  chapter: text('chapter'),
  description: text('description'),
  speaker: text('speaker'),
  accessCode: text('access_code'),
  passingScore: integer('passing_score').notNull().default(70),
  attemptLimit: integer('attempt_limit').notNull().default(0),
  isRequired: boolean('is_required').notNull().default(true),
  randomQuestions: boolean('random_questions').notNull().default(false),
  questionCount: integer('question_count').notNull().default(0),
  shuffleOptions: boolean('shuffle_options').notNull().default(false),
  contentHash: text('content_hash').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: now(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  versionIdx: uniqueIndex('versions_module_version_uniq').on(t.moduleId, t.version),
  moduleIdx: index('versions_module_idx').on(t.moduleId),
}));

export const trainingContentItems = pgTable('training_content_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  moduleVersionId: uuid('module_version_id').notNull().references(() => trainingModuleVersions.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull(),
  type: text('type').notNull(),
  title: text('title'),
  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  origin: text('origin'),
  createdAt: now(),
}, (t) => ({ verIdx: index('content_version_idx').on(t.moduleVersionId, t.sortOrder) }));

export const questions = pgTable('questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  moduleVersionId: uuid('module_version_id').notNull().references(() => trainingModuleVersions.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull(),
  text: text('text').notNull(),
  type: text('type').notNull().default('single'),
  explanation: text('explanation'),
  sourceReference: text('source_reference'),
  topic: text('topic'),
  topicId: text('topic_id'),
  difficulty: text('difficulty').notNull().default('normal'),
  isPractical: boolean('is_practical').notNull().default(false),
  points: integer('points').notNull().default(1),
  media: jsonb('media'),
  imagePrompt: text('image_prompt'),
  timestampSec: integer('timestamp_sec'),
  origin: text('origin'),
  createdAt: now(),
}, (t) => ({ verIdx: index('questions_version_idx').on(t.moduleVersionId, t.sortOrder) }));

export const questionOptions = pgTable('question_options', {
  id: uuid('id').primaryKey().defaultRandom(),
  questionId: uuid('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull(),
  text: text('text').notNull(),
  isCorrect: boolean('is_correct').notNull().default(false),
}, (t) => ({ qIdx: index('options_question_idx').on(t.questionId, t.sortOrder) }));

/* ============ НАЗНАЧЕНИЯ ============ */

export const assignmentRules = pgTable('assignment_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  trainingId: uuid('training_id').notNull().references(() => trainingBlocks.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  conditions: jsonb('conditions').notNull(),
  dueDays: integer('due_days'),
  priority: text('priority').notNull().default('normal'),
  isActive: boolean('is_active').notNull().default(true),
  lastAppliedAt: timestamp('last_applied_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: now(),
});

export const assignments = pgTable('assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  trainingId: uuid('training_id').notNull().references(() => trainingBlocks.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employeeProfiles.id, { onDelete: 'cascade' }),
  ruleId: uuid('rule_id').references(() => assignmentRules.id, { onDelete: 'set null' }),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
  dueDate: date('due_date'),
  status: text('status').notNull().default('assigned'),
  priority: text('priority').notNull().default('normal'),
  isRequired: boolean('is_required').notNull().default(true),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: now(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('assignments_employee_training_uniq').on(t.employeeId, t.trainingId),
  empIdx: index('assignments_employee_idx').on(t.employeeId, t.status),
  dueIdx: index('assignments_due_idx').on(t.organizationId, t.dueDate),
}));

export const assignmentTargets = pgTable('assignment_targets', {
  id: uuid('id').primaryKey().defaultRandom(),
  ruleId: uuid('rule_id').notNull().references(() => assignmentRules.id, { onDelete: 'cascade' }),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id'),
  targetValue: text('target_value'),
});

/* ============ ТЕСТИРОВАНИЕ ============ */

export const testAttempts = pgTable('test_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employeeProfiles.id, { onDelete: 'cascade' }),
  trainingId: uuid('training_id').notNull().references(() => trainingBlocks.id, { onDelete: 'cascade' }),
  moduleId: uuid('module_id').notNull().references(() => trainingModules.id, { onDelete: 'cascade' }),
  moduleVersionId: uuid('module_version_id').notNull().references(() => trainingModuleVersions.id, { onDelete: 'cascade' }),
  assignmentId: uuid('assignment_id').references(() => assignments.id, { onDelete: 'set null' }),
  attemptNumber: integer('attempt_number').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  durationSec: integer('duration_sec'),
  score: integer('score'),
  correctCount: integer('correct_count'),
  totalCount: integer('total_count'),
  passingScore: integer('passing_score').notNull(),
  passed: boolean('passed'),
  questionSet: jsonb('question_set'),
  createdAt: now(),
}, (t) => ({
  uniq: uniqueIndex('attempts_number_uniq').on(t.employeeId, t.moduleVersionId, t.attemptNumber),
  empIdx: index('attempts_employee_idx').on(t.employeeId, t.moduleVersionId),
  verIdx: index('attempts_version_idx').on(t.moduleVersionId),
  orgIdx: index('attempts_org_finished_idx').on(t.organizationId, t.finishedAt),
}));

export const testAnswers = pgTable('test_answers', {
  id: uuid('id').primaryKey().defaultRandom(),
  attemptId: uuid('attempt_id').notNull().references(() => testAttempts.id, { onDelete: 'cascade' }),
  questionId: uuid('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
  questionIndex: integer('question_index').notNull(),
  givenOptionIds: jsonb('given_option_ids').notNull().default(sql`'[]'::jsonb`),
  isCorrect: boolean('is_correct').notNull(),
  answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  attIdx: index('answers_attempt_idx').on(t.attemptId),
  qIdx: index('answers_question_idx').on(t.questionId),
}));

export const extraAttempts = pgTable('extra_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  employeeId: uuid('employee_id').notNull().references(() => employeeProfiles.id, { onDelete: 'cascade' }),
  moduleVersionId: uuid('module_version_id').notNull().references(() => trainingModuleVersions.id, { onDelete: 'cascade' }),
  grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  reason: text('reason'),
});

export const moduleProgress = pgTable('module_progress', {
  id: uuid('id').primaryKey().defaultRandom(),
  employeeId: uuid('employee_id').notNull().references(() => employeeProfiles.id, { onDelete: 'cascade' }),
  moduleVersionId: uuid('module_version_id').notNull().references(() => trainingModuleVersions.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  materialOpenedAt: timestamp('material_opened_at', { withTimezone: true }),
  testStartedAt: timestamp('test_started_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniq: uniqueIndex('module_progress_uniq').on(t.employeeId, t.moduleVersionId) }));

export const moduleFeedback = pgTable('module_feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  employeeId: uuid('employee_id').notNull().references(() => employeeProfiles.id, { onDelete: 'cascade' }),
  moduleVersionId: uuid('module_version_id').notNull().references(() => trainingModuleVersions.id, { onDelete: 'cascade' }),
  stars: integer('stars').notNull(),
  comment: text('comment'),
  createdAt: now(),
}, (t) => ({ uniq: uniqueIndex('module_feedback_uniq').on(t.employeeId, t.moduleVersionId) }));

/* ============ ЛЕКЦИИ ============ */

export const lectures = pgTable('lectures', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  trainingId: uuid('training_id').references(() => trainingBlocks.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  lecturerName: text('lecturer_name'),
  lecturerUserId: uuid('lecturer_user_id').references(() => users.id, { onDelete: 'set null' }),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  durationMin: integer('duration_min'),
  location: text('location'),
  provider: text('provider'),
  joinUrl: text('join_url'),
  status: text('status').notNull().default('planned'),
  followUp: jsonb('follow_up'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: now(),
}, (t) => ({ orgIdx: index('lectures_org_idx').on(t.organizationId, t.startsAt) }));

export const liveSessions = pgTable('live_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  lectureId: uuid('lecture_id').notNull().references(() => lectures.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  recordingUrl: text('recording_url'),
  peakViewers: integer('peak_viewers'),
});

export const lectureAttendance = pgTable('lecture_attendance', {
  id: uuid('id').primaryKey().defaultRandom(),
  lectureId: uuid('lecture_id').notNull().references(() => lectures.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employeeProfiles.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  markedBy: uuid('marked_by').references(() => users.id, { onDelete: 'set null' }),
  markedAt: timestamp('marked_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniq: uniqueIndex('attendance_uniq').on(t.lectureId, t.employeeId) }));

/* ============ ФАЙЛЫ ============ */

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  storage: text('storage').notNull().default('local'),
  storageKey: text('storage_key').notNull(),
  contentHash: text('content_hash').notNull(),
  mime: text('mime').notNull(),
  extension: text('extension').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  originalName: text('original_name'),
  kind: text('kind').notNull().default('image'),
  isPublic: boolean('is_public').notNull().default(false),
  uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: now(),
}, (t) => ({ hashIdx: uniqueIndex('files_hash_uniq').on(t.organizationId, t.contentHash) }));

/* ============ СЕРТИФИКАТЫ И ДОПУСКИ ============ */

export const certificates = pgTable('certificates', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employeeProfiles.id, { onDelete: 'cascade' }),
  trainingId: uuid('training_id').notNull().references(() => trainingBlocks.id, { onDelete: 'cascade' }),
  trainingVersionKey: text('training_version_key').notNull(),
  number: text('number').notNull(),
  score: integer('score'),
  issuedAt: date('issued_at').notNull(),
  issuedBy: uuid('issued_by').references(() => users.id, { onDelete: 'set null' }),
  validUntil: date('valid_until'),
  status: text('status').notNull().default('active'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokeReason: text('revoke_reason'),
  documentFileId: uuid('document_file_id').references(() => files.id, { onDelete: 'set null' }),
  createdAt: now(),
}, (t) => ({
  numberIdx: uniqueIndex('certificates_number_uniq').on(t.organizationId, t.number),
  versionIdx: uniqueIndex('certificates_version_uniq').on(t.employeeId, t.trainingId, t.trainingVersionKey),
  empIdx: index('certificates_employee_idx').on(t.employeeId, t.status),
  expIdx: index('certificates_expiry_idx').on(t.organizationId, t.validUntil),
}));

export const employeePermits = pgTable('employee_permits', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employeeProfiles.id, { onDelete: 'cascade' }),
  permitType: text('permit_type').notNull(),
  basis: text('basis'),
  certificateId: uuid('certificate_id').references(() => certificates.id, { onDelete: 'set null' }),
  issuedAt: date('issued_at').notNull(),
  issuedBy: uuid('issued_by').references(() => users.id, { onDelete: 'set null' }),
  validUntil: date('valid_until'),
  status: text('status').notNull().default('active'),
  externalId: text('external_id'),
  source: text('source').notNull().default('manual'),
  createdAt: now(),
}, (t) => ({
  empIdx: index('permits_employee_idx').on(t.employeeId, t.status),
  expIdx: index('permits_expiry_idx').on(t.organizationId, t.validUntil),
}));

/* Задел под ЭЦП (§39 ТЗ): схема готова, реализация подключается позже. */
export const signingEvents = pgTable('signing_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  signerUserId: uuid('signer_user_id').references(() => users.id, { onDelete: 'set null' }),
  documentHash: text('document_hash').notNull(),
  signature: text('signature'),
  certificateInfo: jsonb('certificate_info'),
  provider: text('provider'),
  signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ============ ИИ ============ */

export const aiProviders = pgTable('ai_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
  baseUrl: text('base_url'),
  isEnabled: boolean('is_enabled').notNull().default(true),
});

export const aiSettings = pgTable('ai_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().unique().references(() => organizations.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(false),
  providerCode: text('provider_code').notNull().default('anthropic'),
  model: text('model'),
  temperature: numeric('temperature', { precision: 3, scale: 2 }),
  maxTokens: integer('max_tokens').notNull().default(16000),
  systemPrompt: text('system_prompt'),
  allowedRoles: jsonb('allowed_roles').notNull().default(sql`'["ADMIN","MANAGER"]'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

/* Ключи отдельной таблицей: шифруются AES-256-GCM, наружу уходит только
   маска из последних четырёх символов (§43 ТЗ). */
export const aiApiKeys = pgTable('ai_api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  providerCode: text('provider_code').notNull(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  last4: text('last4').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
}, (t) => ({ uniq: uniqueIndex('ai_keys_uniq').on(t.organizationId, t.providerCode) }));

export const aiRequests = pgTable('ai_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  providerCode: text('provider_code').notNull(),
  model: text('model'),
  inputChars: integer('input_chars'),
  outputTokens: integer('output_tokens'),
  durationMs: integer('duration_ms'),
  status: text('status').notNull(),
  errorCode: text('error_code'),
  createdAt: now(),
});

/* ============ ИНТЕРФЕЙС (UI BUILDER) ============ */

export const uiModules = pgTable('ui_modules', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  cabinet: text('cabinet').notNull(),
  title: text('title').notNull(),
  route: text('route').notNull(),
  icon: text('icon'),
  sortOrder: integer('sort_order').notNull().default(0),
  isCore: boolean('is_core').notNull().default(false),
});

export const uiModuleVisibility = pgTable('ui_module_visibility', {
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  uiModuleId: uuid('ui_module_id').notNull().references(() => uiModules.id, { onDelete: 'cascade' }),
  isVisible: boolean('is_visible').notNull().default(true),
  sortOrder: integer('sort_order'),
}, (t) => ({ pk: primaryKey({ columns: [t.organizationId, t.uiModuleId] }) }));

export const uiPages = pgTable('ui_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  cabinets: jsonb('cabinets').notNull().default(sql`'[]'::jsonb`),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: now(),
}, (t) => ({ slugIdx: uniqueIndex('ui_pages_slug_uniq').on(t.organizationId, t.slug) }));

export const uiPageBlocks = pgTable('ui_page_blocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  pageId: uuid('page_id').notNull().references(() => uiPages.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull(),
  component: text('component').notNull(),
  props: jsonb('props').notNull().default(sql`'{}'::jsonb`),
});

/* ============ ИНТЕГРАЦИИ ============ */

export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  transport: text('transport').notNull(),
  baseUrl: text('base_url'),
  authType: text('auth_type'),
  credentialsEnc: text('credentials_enc'),
  credentialsIv: text('credentials_iv'),
  credentialsTag: text('credentials_tag'),
  scheduleCron: text('schedule_cron'),
  isEnabled: boolean('is_enabled').notNull().default(false),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastStatus: text('last_status'),
  createdAt: now(),
}, (t) => ({ uniq: uniqueIndex('integrations_kind_uniq').on(t.organizationId, t.kind) }));

export const integrationSyncLogs = pgTable('integration_sync_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  integrationId: uuid('integration_id').notNull().references(() => integrations.id, { onDelete: 'cascade' }),
  syncType: text('sync_type').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  receivedCount: integer('received_count').notNull().default(0),
  createdCount: integer('created_count').notNull().default(0),
  updatedCount: integer('updated_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  status: text('status').notNull(),
  errors: jsonb('errors'),
  triggeredBy: uuid('triggered_by').references(() => users.id, { onDelete: 'set null' }),
});

/* ============ АУДИТ, УВЕДОМЛЕНИЯ, НАСТРОЙКИ ============ */

export const auditLogs = pgTable('audit_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  actorLabel: text('actor_label'),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  details: text('details'),
  metadata: jsonb('metadata'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: now(),
}, (t) => ({
  createdIdx: index('audit_created_idx').on(t.createdAt),
  actionIdx: index('audit_org_action_idx').on(t.organizationId, t.action),
  entityIdx: index('audit_entity_idx').on(t.entityType, t.entityId),
}));

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  channel: text('channel').notNull().default('in_app'),
  readAt: timestamp('read_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: now(),
}, (t) => ({ userIdx: index('notifications_user_idx').on(t.userId, t.createdAt) }));

export const platformSettings = pgTable('platform_settings', {
  organizationId: uuid('organization_id').primaryKey().references(() => organizations.id, { onDelete: 'cascade' }),
  certWarningDays: integer('cert_warning_days').notNull().default(30),
  dueWarningDays: integer('due_warning_days').notNull().default(7),
  inactivityDays: integer('inactivity_days').notNull().default(21),
  repeatedFailureThreshold: integer('repeated_failure_threshold').notNull().default(2),
  defaultPassingScore: integer('default_passing_score').notNull().default(70),
  certificateValidityDays: integer('certificate_validity_days').notNull().default(365),
  demoAccountsEnabled: boolean('demo_accounts_enabled').notNull().default(false),
  branding: jsonb('branding').notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const loginAttempts = pgTable('login_attempts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ip: text('ip').notNull(),
  login: text('login'),
  succeeded: boolean('succeeded').notNull(),
  createdAt: now(),
}, (t) => ({ ipIdx: index('login_attempts_ip_idx').on(t.ip, t.createdAt) }));
