/* Роли и права (§7, §9 ТЗ).
   Роли перечислены как данные, а не зашиты в условия: добавление новой роли
   не требует правок кода — только строки в roles и role_permissions. */

export const ROLE = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  EMPLOYEE: 'EMPLOYEE',
  METHODIST: 'METHODIST',
  HR: 'HR',
  SAFETY_SPECIALIST: 'SAFETY_SPECIALIST',
  AUDITOR: 'AUDITOR',
  LECTURER: 'LECTURER',
} as const;
export type RoleCode = (typeof ROLE)[keyof typeof ROLE];

export const ROLE_TITLES: Record<string, string> = {
  SUPER_ADMIN: 'Суперадминистратор',
  ADMIN: 'Администратор',
  MANAGER: 'Руководитель',
  EMPLOYEE: 'Сотрудник',
  METHODIST: 'Методист',
  HR: 'Кадровая служба',
  SAFETY_SPECIALIST: 'Специалист по охране труда',
  AUDITOR: 'Аудитор',
  LECTURER: 'Лектор',
};

/* Кабинет, в который попадает пользователь с данной ролью. */
export const ROLE_CABINET: Record<string, 'admin' | 'manager' | 'employee'> = {
  SUPER_ADMIN: 'admin',
  ADMIN: 'admin',
  MANAGER: 'manager',
  METHODIST: 'manager',
  HR: 'manager',
  SAFETY_SPECIALIST: 'manager',
  AUDITOR: 'manager',
  LECTURER: 'manager',
  EMPLOYEE: 'employee',
};

export const PERMISSION = {
  TRAINING_CREATE: 'training.create',
  TRAINING_EDIT: 'training.edit',
  TRAINING_DELETE: 'training.delete',
  TRAINING_PUBLISH: 'training.publish',
  TRAINING_VIEW: 'training.view',
  EMPLOYEE_VIEW: 'employee.view',
  EMPLOYEE_EDIT: 'employee.edit',
  EMPLOYEE_ASSIGN: 'employee.assign',
  TEST_CREATE: 'test.create',
  TEST_EDIT: 'test.edit',
  TEST_PUBLISH: 'test.publish',
  LECTURE_CREATE: 'lecture.create',
  LECTURE_EDIT: 'lecture.edit',
  LECTURE_LIVE: 'lecture.live',
  CERTIFICATE_ISSUE: 'certificate.issue',
  PERMIT_ISSUE: 'permit.issue',
  REPORTS_VIEW: 'reports.view',
  AI_USE: 'ai.use',
  AI_CONFIGURE: 'ai.configure',
  INTEGRATION_ONEC: 'integration.1c',
  SETTINGS_MANAGE: 'settings.manage',
  USERS_CREATE: 'users.create',
  USERS_EDIT: 'users.edit',
  USERS_BLOCK: 'users.block',
  UI_CONFIGURE: 'ui.configure',
  AUDIT_VIEW: 'audit.view',
  FILES_UPLOAD: 'files.upload',
  ORG_MANAGE: 'org.manage',
} as const;
export type PermissionCode = (typeof PERMISSION)[keyof typeof PERMISSION];

export const PERMISSION_META: Record<string, { group: string; title: string }> = {
  'training.create': { group: 'Обучение', title: 'Создавать обучения' },
  'training.edit': { group: 'Обучение', title: 'Редактировать обучения' },
  'training.delete': { group: 'Обучение', title: 'Удалять обучения' },
  'training.publish': { group: 'Обучение', title: 'Публиковать версии' },
  'training.view': { group: 'Обучение', title: 'Просматривать обучения' },
  'employee.view': { group: 'Сотрудники', title: 'Просматривать сотрудников' },
  'employee.edit': { group: 'Сотрудники', title: 'Редактировать сотрудников' },
  'employee.assign': { group: 'Сотрудники', title: 'Назначать обучение' },
  'test.create': { group: 'Тесты', title: 'Создавать тесты' },
  'test.edit': { group: 'Тесты', title: 'Редактировать тесты' },
  'test.publish': { group: 'Тесты', title: 'Публиковать тесты' },
  'lecture.create': { group: 'Лекции', title: 'Создавать лекции' },
  'lecture.edit': { group: 'Лекции', title: 'Редактировать лекции' },
  'lecture.live': { group: 'Лекции', title: 'Проводить трансляции' },
  'certificate.issue': { group: 'Документы', title: 'Выдавать сертификаты' },
  'permit.issue': { group: 'Документы', title: 'Выдавать допуски' },
  'reports.view': { group: 'Отчёты', title: 'Просматривать отчёты' },
  'ai.use': { group: 'ИИ', title: 'Использовать ИИ-ассистента' },
  'ai.configure': { group: 'ИИ', title: 'Настраивать ИИ-ассистента' },
  'integration.1c': { group: 'Интеграции', title: 'Управлять интеграцией 1С' },
  'settings.manage': { group: 'Настройки', title: 'Управлять настройками платформы' },
  'users.create': { group: 'Пользователи', title: 'Создавать пользователей' },
  'users.edit': { group: 'Пользователи', title: 'Редактировать пользователей' },
  'users.block': { group: 'Пользователи', title: 'Блокировать пользователей' },
  'ui.configure': { group: 'Интерфейс', title: 'Настраивать интерфейс' },
  'audit.view': { group: 'Аудит', title: 'Просматривать журнал действий' },
  'files.upload': { group: 'Файлы', title: 'Загружать файлы' },
  'org.manage': { group: 'Организация', title: 'Управлять оргструктурой' },
};

const ALL = Object.values(PERMISSION) as string[];

export const ROLE_DEFAULT_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ALL,
  ADMIN: ALL,
  MANAGER: [
    'training.create', 'training.edit', 'training.delete', 'training.publish', 'training.view',
    'employee.view', 'employee.edit', 'employee.assign',
    'test.create', 'test.edit', 'test.publish',
    'lecture.create', 'lecture.edit', 'lecture.live',
    'certificate.issue', 'permit.issue',
    'reports.view', 'ai.use', 'files.upload',
  ],
  METHODIST: [
    'training.create', 'training.edit', 'training.publish', 'training.view',
    'test.create', 'test.edit', 'test.publish', 'ai.use', 'files.upload', 'reports.view',
  ],
  HR: ['employee.view', 'employee.edit', 'employee.assign', 'reports.view', 'training.view'],
  SAFETY_SPECIALIST: [
    'training.view', 'employee.view', 'employee.assign',
    'certificate.issue', 'permit.issue', 'reports.view',
  ],
  AUDITOR: ['reports.view', 'audit.view', 'training.view', 'employee.view'],
  LECTURER: ['lecture.create', 'lecture.edit', 'lecture.live', 'training.view'],
  EMPLOYEE: [],
};
