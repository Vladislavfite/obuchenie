/* Версионирование учебных модулей — ядро системы.

   Перенесено из storage.js (moduleContentSignature / moduleContentHash)
   с сохранением главного правила:

     новая версия создаётся ТОЛЬКО при существенном изменении.

   В подпись входит то, что влияет на обучение и тестирование. Косметические
   поля — глава, лектор, код доступа — новую версию не создают. Это и
   отличает систему от типовой LMS: руководитель может поправить опечатку в
   названии лектора, не сбрасывая прогресс всем сотрудникам.

   Отличие от прототипа: хеш считается SHA-256 вместо djb2. Правило, что
   именно попадает в подпись, не изменилось. */

import type { ContentItem, Question, ModuleVersionContent } from '../types/index.js';

/* Нормализация элемента контента для подписи.
   Идентификаторы исключены: пересоздание id при импорте не должно
   выглядеть как изменение материала и плодить лишние версии. */
function signatureContentItems(items: ContentItem[]): unknown[] {
  return (items || []).map((item) => {
    const payload = (item.payload ?? {}) as unknown as Record<string, unknown>;
    const base: Record<string, unknown> = {
      type: item.type,
      title: item.title || '',
      sortOrder: item.sortOrder,
    };
    switch (item.type) {
      case 'text':
        base.html = String(payload.html ?? '');
        break;
      case 'image':
        base.url = String(payload.url ?? '');
        base.fit = String(payload.fit ?? 'contain');
        base.caption = String(payload.caption ?? '');
        break;
      case 'video':
        base.provider = String(payload.provider ?? '');
        base.url = String(payload.url ?? '');
        base.videoId = String(payload.videoId ?? '');
        break;
      case 'slides':
        base.slides = (Array.isArray(payload.slides) ? payload.slides : []).map((s) => {
          const slide = s as Record<string, unknown>;
          return { imageUrl: String(slide.imageUrl ?? ''), caption: String(slide.caption ?? '') };
        });
        break;
      case 'live':
        base.provider = String(payload.provider ?? '');
        base.url = String(payload.url ?? '');
        base.startsAt = String(payload.startsAt ?? '');
        break;
      case 'link':
        base.url = String(payload.url ?? '');
        base.label = String(payload.label ?? '');
        base.description = String(payload.description ?? '');
        break;
    }
    return base;
  });
}

function signatureQuestions(questions: Question[]): unknown[] {
  return (questions || []).map((q) => ({
    text: q.text || '',
    type: q.type || 'single',
    options: (q.options || [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((o) => ({ text: o.text || '', isCorrect: !!o.isCorrect })),
    explanation: q.explanation || '',
    isPractical: !!q.isPractical,
    topic: q.topic || '',
    topicId: q.topicId || '',
    difficulty: q.difficulty || 'normal',
    points: q.points ?? 1,
    media: q.media && q.media.type === 'image'
      ? { type: 'image', url: q.media.url || '', fit: q.media.fit || 'contain' }
      : { type: 'none' },
  }));
}

/* Каноническая подпись содержания версии.
   ВНИМАНИЕ: любое изменение состава полей здесь меняет хеши всех модулей
   и приведёт к лавине «новых версий». Менять только вместе с миграцией. */
export function moduleContentSignature(content: ModuleVersionContent): string {
  return JSON.stringify({
    title: content.title || '',
    description: content.description || '',
    contentItems: signatureContentItems(content.contentItems || []),
    questions: signatureQuestions(content.questions || []),
    passingScore: content.passingScore,
    attemptLimit: content.attemptLimit,
    isRequired: content.isRequired !== false,
    randomQuestions: !!content.randomQuestions,
    questionCount: content.questionCount || 0,
    shuffleOptions: !!content.shuffleOptions,
  });
}

/* Поля, которые НЕ входят в подпись (изменение не создаёт новую версию). */
export const COSMETIC_FIELDS = ['chapter', 'speaker', 'accessCode'] as const;

/* Сравнение двух состояний: нужна ли новая версия и что именно изменилось. */
export function diffModuleContent(
  before: ModuleVersionContent,
  after: ModuleVersionContent,
): { substantive: boolean; changedFields: string[] } {
  const changed: string[] = [];

  if ((before.title || '') !== (after.title || '')) changed.push('title');
  if ((before.description || '') !== (after.description || '')) changed.push('description');
  if (JSON.stringify(signatureContentItems(before.contentItems || [])) !==
      JSON.stringify(signatureContentItems(after.contentItems || []))) changed.push('contentItems');
  if (JSON.stringify(signatureQuestions(before.questions || [])) !==
      JSON.stringify(signatureQuestions(after.questions || []))) changed.push('questions');
  if (before.passingScore !== after.passingScore) changed.push('passingScore');
  if (before.attemptLimit !== after.attemptLimit) changed.push('attemptLimit');
  if ((before.isRequired !== false) !== (after.isRequired !== false)) changed.push('isRequired');
  if (!!before.randomQuestions !== !!after.randomQuestions) changed.push('randomQuestions');
  if ((before.questionCount || 0) !== (after.questionCount || 0)) changed.push('questionCount');
  if (!!before.shuffleOptions !== !!after.shuffleOptions) changed.push('shuffleOptions');

  const cosmetic: string[] = [];
  for (const field of COSMETIC_FIELDS) {
    const a = (before as unknown as Record<string, unknown>)[field] ?? '';
    const b = (after as unknown as Record<string, unknown>)[field] ?? '';
    if (String(a) !== String(b)) cosmetic.push(field);
  }

  return { substantive: changed.length > 0, changedFields: [...changed, ...cosmetic] };
}

/* ---------- Валидация перед публикацией (§106 прототипа) ---------- */

export interface ValidationProblem {
  scope: 'module' | 'content' | 'question';
  index?: number;
  message: string;
}

export function validateContentItems(items: ContentItem[]): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  (items || []).forEach((item, index) => {
    const payload = (item.payload ?? {}) as unknown as Record<string, unknown>;
    const at = index + 1;
    switch (item.type) {
      case 'text':
        if (!String(payload.html ?? '').trim()) {
          problems.push({ scope: 'content', index, message: `Элемент ${at}: текст не заполнен.` });
        }
        break;
      case 'image':
        if (!String(payload.url ?? '').trim()) {
          problems.push({ scope: 'content', index, message: `Элемент ${at}: не выбрано изображение.` });
        }
        break;
      case 'video':
      case 'link':
        if (!String(payload.url ?? '').trim()) {
          problems.push({ scope: 'content', index, message: `Элемент ${at}: не указана ссылка.` });
        }
        break;
      case 'slides': {
        const slides = Array.isArray(payload.slides) ? payload.slides : [];
        if (slides.length === 0) {
          problems.push({ scope: 'content', index, message: `Элемент ${at}: не добавлено ни одного слайда.` });
        }
        break;
      }
      case 'live':
        if (!String(payload.url ?? '').trim()) {
          problems.push({ scope: 'content', index, message: `Элемент ${at}: не указана ссылка на трансляцию.` });
        }
        break;
    }
  });
  return problems;
}

export function validateQuestions(questions: Question[]): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  (questions || []).forEach((q, index) => {
    const at = index + 1;
    if (!String(q.text || '').trim()) {
      problems.push({ scope: 'question', index, message: `Вопрос ${at}: не заполнен текст.` });
    }
    const options = (q.options || []).filter((o) => String(o.text || '').trim());
    if (options.length < 2) {
      problems.push({ scope: 'question', index, message: `Вопрос ${at}: нужно не менее двух вариантов ответа.` });
    }
    const correct = options.filter((o) => o.isCorrect);
    if (correct.length === 0) {
      problems.push({ scope: 'question', index, message: `Вопрос ${at}: не отмечен правильный ответ.` });
    }
    if (q.type !== 'multiple' && correct.length > 1) {
      problems.push({ scope: 'question', index, message: `Вопрос ${at}: для одиночного выбора допустим один правильный ответ.` });
    }
    if (!String(q.explanation || '').trim()) {
      problems.push({ scope: 'question', index, message: `Вопрос ${at}: не заполнено объяснение правильного ответа.` });
    }
  });
  return problems;
}

export function validateModuleForPublish(content: ModuleVersionContent): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  if (!String(content.title || '').trim()) {
    problems.push({ scope: 'module', message: 'Укажите название модуля.' });
  }
  if (!content.contentItems || content.contentItems.length === 0) {
    problems.push({ scope: 'module', message: 'Добавьте хотя бы один элемент учебного материала.' });
  }
  if (content.passingScore < 1 || content.passingScore > 100) {
    problems.push({ scope: 'module', message: 'Проходной балл должен быть от 1 до 100.' });
  }
  if (content.questionCount > 0 && content.questions.length < content.questionCount) {
    problems.push({
      scope: 'module',
      message: `В банке ${content.questions.length} вопросов, а на попытку задано выдавать ${content.questionCount}.`,
    });
  }
  problems.push(...validateContentItems(content.contentItems || []));
  problems.push(...validateQuestions(content.questions || []));
  return problems;
}
