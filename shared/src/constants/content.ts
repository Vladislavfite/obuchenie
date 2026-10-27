/* Типы учебного контента, статусы и словари.
   Перенесено из storage.js (CONTENT_ITEM_TYPES, MEDIA_TYPES, AUDIT_LABELS,
   MODULE_STATE_LABELS, PROGRAM_STATUS_LABELS) без изменения смысла. */

export const CONTENT_ITEM_TYPES = {
  text:   { label: 'Текст',             hint: 'Лекционный текст с заголовками, списками и ссылками' },
  image:  { label: 'Изображение',       hint: 'JPG, JPEG, PNG, WEBP или SVG' },
  video:  { label: 'Видео',             hint: 'Ссылка на YouTube или на видеофайл MP4/WEBM' },
  slides: { label: 'Слайды',            hint: 'Последовательность изображений с перелистыванием' },
  live:   { label: 'Онлайн-трансляция', hint: 'YouTube Live или Zoom' },
  link:   { label: 'Ссылка',            hint: 'Внешний материал, открывается в новой вкладке' },
} as const;
export type ContentItemType = keyof typeof CONTENT_ITEM_TYPES;

export const VIDEO_PROVIDERS = { youtube: 'YouTube', vimeo: 'Vimeo', file: 'Ссылка на видеофайл' } as const;
export const LIVE_PROVIDERS = { youtube: 'YouTube Live', zoom: 'Zoom' } as const;

export const MEDIA_TYPES = {
  none:  { label: 'Без изображения', hint: 'Вопрос будет показан без иллюстрации' },
  image: { label: 'Изображение',     hint: 'JPG, PNG, WEBP или SVG' },
} as const;
export const MEDIA_FITS = {
  contain: 'Вписать целиком (не обрезается)',
  cover: 'Заполнить область (края обрезаются)',
} as const;

export const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
export const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,.svg,image/jpeg,image/png,image/webp,image/svg+xml';
export const DOCUMENT_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain', 'text/markdown',
];
/* §59 ТЗ: исполняемые расширения запрещены всегда. */
export const FORBIDDEN_EXTENSIONS = [
  'js','mjs','cjs','php','exe','sh','bat','cmd','com','msi','dll','so','jar','py','rb','pl','ps1','vbs','scr','app','deb','rpm',
];

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const MODULE_STATUS = ['draft', 'published', 'archived'] as const;
export type ModuleStatus = (typeof MODULE_STATUS)[number];

export const ASSIGNMENT_STATUS = [
  'assigned', 'in_progress', 'completed', 'failed', 'expired', 'cancelled',
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUS)[number];

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  assigned: 'Назначено',
  in_progress: 'В процессе',
  completed: 'Завершено',
  failed: 'Не сдано',
  expired: 'Просрочено',
  cancelled: 'Отменено',
};

export const MODULE_STATE_LABELS: Record<string, string> = {
  locked: 'Закрыт',
  available: 'Доступен',
  in_progress: 'В процессе',
  passed: 'Пройден',
  failed: 'Не сдан',
  outdated: 'Требует повторного прохождения',
  exhausted: 'Попытки исчерпаны',
};

export const PROGRAM_STATUS_LABELS: Record<string, string> = {
  not_started: 'Не начато',
  in_progress: 'В процессе',
  completed: 'Завершено',
};

/* 47 типов событий прототипа + новые для backend (§61 ТЗ). */
export const AUDIT_LABELS: Record<string, string> = {
  login: 'Вход в систему',
  logout: 'Выход из системы',
  login_failed: 'Неудачная попытка входа',
  password_changed: 'Смена пароля',
  password_reset: 'Сброс пароля',
  block_created: 'Создан блок',
  block_updated: 'Изменён блок',
  block_deleted: 'Удалён блок',
  block_published: 'Блок опубликован',
  block_hidden: 'Блок скрыт',
  block_shown: 'Блок открыт сотрудникам',
  module_created: 'Создан модуль (черновик)',
  module_updated: 'Изменён модуль',
  module_draft_saved: 'Сохранён черновик новой версии',
  module_draft_discarded: 'Черновик отменён',
  module_published: 'Материал опубликован',
  module_version_published: 'Опубликована новая версия',
  module_archived: 'Версия отправлена в архив',
  module_deleted: 'Удалён модуль',
  module_unpublished: 'Модуль снят с публикации',
  content_item_added: 'Добавлен элемент содержания',
  content_item_updated: 'Изменён элемент содержания',
  content_item_deleted: 'Удалён элемент содержания',
  assignment_created: 'Назначено обучение',
  assignment_updated: 'Изменено назначение',
  assignment_deleted: 'Снято назначение',
  assignment_bulk: 'Массовое назначение обучения',
  assignment_rule_created: 'Создано правило назначения',
  assignment_rule_applied: 'Применено правило назначения',
  attempt_started: 'Начат тест',
  attempt_finished: 'Завершён тест',
  attempt_passed: 'Тест сдан',
  attempt_failed: 'Тест не сдан',
  attempt_granted: 'Выдана дополнительная попытка',
  material_completed: 'Материал изучен',
  material_opened: 'Открыт учебный материал',
  certificate_issued: 'Выдан сертификат',
  certificate_revoked: 'Отозван сертификат',
  permit_issued: 'Выдан допуск',
  permit_revoked: 'Отозван допуск',
  employee_created: 'Создан аккаунт сотрудника',
  employee_updated: 'Изменён аккаунт сотрудника',
  employee_blocked: 'Аккаунт заблокирован',
  employee_unblocked: 'Аккаунт разблокирован',
  employee_deleted: 'Удалён аккаунт сотрудника',
  employee_password_reset: 'Сброшен пароль сотрудника',
  user_created: 'Создан пользователь',
  user_updated: 'Изменён пользователь',
  user_blocked: 'Пользователь заблокирован',
  user_roles_changed: 'Изменены роли пользователя',
  role_permissions_changed: 'Изменены права роли',
  lecture_created: 'Создана лекция',
  lecture_updated: 'Изменена лекция',
  lecture_started: 'Начата трансляция',
  lecture_finished: 'Завершена трансляция',
  attendance_marked: 'Отмечена посещаемость',
  live_created: 'Добавлена онлайн-трансляция',
  live_updated: 'Изменена онлайн-трансляция',
  ai_generation_started: 'Запущена генерация материала ИИ',
  ai_generation_completed: 'ИИ подготовил материал',
  ai_generation_failed: 'Ошибка генерации ИИ',
  ai_settings_saved: 'Изменены настройки ИИ-ассистента',
  settings_change: 'Изменены настройки платформы',
  ui_visibility_changed: 'Изменена видимость разделов',
  ui_page_created: 'Создана страница',
  ui_page_updated: 'Изменена страница',
  ui_page_deleted: 'Удалена страница',
  file_uploaded: 'Загружен файл',
  file_deleted: 'Удалён файл',
  onec_sync: 'Синхронизация с 1С',
  onec_settings_changed: 'Изменены настройки 1С',
  data_reset: 'Сброс данных',
  legacy_import: 'Импорт данных прототипа',
  demo_seeded: 'Созданы демо-данные',
  feedback_submitted: 'Оставлен отзыв об обучении',
};

export const UI_MODULES = [
  // admin
  { code: 'admin.dashboard', cabinet: 'admin', title: 'Статистика', route: '/admin', isCore: true },
  { code: 'admin.users', cabinet: 'admin', title: 'Пользователи', route: '/admin/users', isCore: true },
  { code: 'admin.managers', cabinet: 'admin', title: 'Руководители', route: '/admin/managers', isCore: true },
  { code: 'admin.employees', cabinet: 'admin', title: 'Сотрудники', route: '/admin/employees', isCore: true },
  { code: 'admin.organization', cabinet: 'admin', title: 'Организация', route: '/admin/organization', isCore: false },
  { code: 'admin.departments', cabinet: 'admin', title: 'Подразделения', route: '/admin/departments', isCore: false },
  { code: 'admin.positions', cabinet: 'admin', title: 'Должности', route: '/admin/positions', isCore: false },
  { code: 'admin.professions', cabinet: 'admin', title: 'Профессии', route: '/admin/professions', isCore: false },
  { code: 'admin.trainings', cabinet: 'admin', title: 'Обучения', route: '/admin/trainings', isCore: false },
  { code: 'admin.assignments', cabinet: 'admin', title: 'Назначения', route: '/admin/assignments', isCore: false },
  { code: 'admin.lectures', cabinet: 'admin', title: 'Лекции', route: '/admin/lectures', isCore: false },
  { code: 'admin.certificates', cabinet: 'admin', title: 'Сертификаты', route: '/admin/certificates', isCore: false },
  { code: 'admin.permits', cabinet: 'admin', title: 'Допуски', route: '/admin/permits', isCore: false },
  { code: 'admin.ai', cabinet: 'admin', title: 'AI Assistant', route: '/admin/ai', isCore: false },
  { code: 'admin.integrations', cabinet: 'admin', title: 'Интеграции 1С', route: '/admin/integrations', isCore: false },
  { code: 'admin.ui', cabinet: 'admin', title: 'Интерфейс', route: '/admin/ui', isCore: false },
  { code: 'admin.pages', cabinet: 'admin', title: 'Страницы', route: '/admin/pages', isCore: false },
  { code: 'admin.permissions', cabinet: 'admin', title: 'Права', route: '/admin/permissions', isCore: false },
  { code: 'admin.settings', cabinet: 'admin', title: 'Настройки платформы', route: '/admin/settings', isCore: false },
  { code: 'admin.files', cabinet: 'admin', title: 'Файлы', route: '/admin/files', isCore: false },
  { code: 'admin.audit', cabinet: 'admin', title: 'Аудит', route: '/admin/audit', isCore: false },
  // manager
  { code: 'manager.dashboard', cabinet: 'manager', title: 'Главная', route: '/manager', isCore: true },
  { code: 'manager.trainings', cabinet: 'manager', title: 'Обучения', route: '/manager/trainings', isCore: true },
  { code: 'manager.constructor', cabinet: 'manager', title: 'Конструктор обучения', route: '/manager/constructor', isCore: false },
  { code: 'manager.tests', cabinet: 'manager', title: 'Тесты', route: '/manager/tests', isCore: false },
  { code: 'manager.lectures', cabinet: 'manager', title: 'Лекции', route: '/manager/lectures', isCore: false },
  { code: 'manager.employees', cabinet: 'manager', title: 'Сотрудники', route: '/manager/employees', isCore: true },
  { code: 'manager.assignments', cabinet: 'manager', title: 'Назначения', route: '/manager/assignments', isCore: true },
  { code: 'manager.results', cabinet: 'manager', title: 'Результаты', route: '/manager/results', isCore: false },
  { code: 'manager.certificates', cabinet: 'manager', title: 'Сертификаты', route: '/manager/certificates', isCore: false },
  { code: 'manager.permits', cabinet: 'manager', title: 'Допуски', route: '/manager/permits', isCore: false },
  { code: 'manager.ai', cabinet: 'manager', title: 'AI Assistant', route: '/manager/ai', isCore: false },
  { code: 'manager.audit', cabinet: 'manager', title: 'Журнал действий', route: '/manager/audit', isCore: false },
  { code: 'manager.profile', cabinet: 'manager', title: 'Профиль', route: '/manager/profile', isCore: true },
  // employee
  { code: 'employee.dashboard', cabinet: 'employee', title: 'Главная', route: '/employee', isCore: true },
  { code: 'employee.trainings', cabinet: 'employee', title: 'Мои обучения', route: '/employee/trainings', isCore: true },
  { code: 'employee.tests', cabinet: 'employee', title: 'Мои тесты', route: '/employee/tests', isCore: false },
  { code: 'employee.lectures', cabinet: 'employee', title: 'Мои лекции', route: '/employee/lectures', isCore: false },
  { code: 'employee.certificates', cabinet: 'employee', title: 'Мои сертификаты', route: '/employee/certificates', isCore: false },
  { code: 'employee.permits', cabinet: 'employee', title: 'Мои допуски', route: '/employee/permits', isCore: false },
  { code: 'employee.library', cabinet: 'employee', title: 'Библиотека', route: '/employee/library', isCore: false },
  { code: 'employee.profile', cabinet: 'employee', title: 'Профиль', route: '/employee/profile', isCore: true },
] as const;

/* Безопасный набор компонентов конструктора страниц (§48 ТЗ).
   Произвольный HTML/JS не допускается ни в одном поле. */
export const UI_PAGE_COMPONENTS = {
  HEADER: { title: 'Заголовок', props: ['text', 'level'] },
  TEXT: { title: 'Текст', props: ['html'] },
  TABLE: { title: 'Таблица', props: ['columns', 'rows'] },
  FILE_LIST: { title: 'Список файлов', props: ['fileIds', 'title'] },
  DOCUMENT_LIST: { title: 'Список документов', props: ['fileIds', 'title'] },
  VIDEO: { title: 'Видео', props: ['url', 'title'] },
  LINK: { title: 'Ссылка', props: ['url', 'label', 'description'] },
  TRAINING_LIST: { title: 'Список обучений', props: ['status', 'limit'] },
  EMPLOYEE_LIST: { title: 'Список сотрудников', props: ['departmentId', 'limit'] },
  CUSTOM_WIDGET: { title: 'Виджет', props: ['widget', 'config'] },
} as const;
