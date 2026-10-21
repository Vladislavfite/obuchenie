/* Формирование набора вопросов и проверка ответов.

   Перенесено из storage.js (buildQuestionSet, shuffleArray, finishQuiz).

   ВАЖНОЕ ОТЛИЧИЕ ОТ ПРОТОТИПА: в прототипе выборка, перемешивание и
   проверка выполнялись в браузере, а модуль приходил к сотруднику вместе
   с правильными ответами. Здесь эти функции используются ТОЛЬКО на
   сервере — фронтенд получает вопросы без признака правильности. */

import type { Question } from '../types/index.js';

export interface QuestionSetEntry {
  questionId: string;
  questionIndex: number;
  /* Порядок показа вариантов: массив id вариантов. */
  optionOrder: string[];
}

export interface QuestionSetOptions {
  randomQuestions: boolean;
  questionCount: number;
  shuffleOptions: boolean;
  /* Источник случайности. Передаётся явно, чтобы тесты были детерминированными. */
  random?: () => number;
}

/* Перемешивание Фишера — Йейтса. */
export function shuffleArray<T>(arr: T[], random: () => number = Math.random): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* Набор вопросов для конкретной попытки.
   Сохраняется в test_attempts.question_set, чтобы при проверке и при
   показе разбора ошибок использовался тот же порядок. */
export function buildQuestionSet(
  questions: Question[],
  options: QuestionSetOptions,
): QuestionSetEntry[] {
  const random = options.random ?? Math.random;
  const ordered = (questions || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);

  let selected = ordered;
  if (options.randomQuestions) {
    selected = shuffleArray(ordered, random);
  }
  if (options.questionCount > 0 && options.questionCount < selected.length) {
    selected = selected.slice(0, options.questionCount);
  }

  return selected.map((q, index) => {
    const opts = (q.options || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const order = options.shuffleOptions ? shuffleArray(opts, random) : opts;
    return {
      questionId: String(q.id),
      questionIndex: index,
      optionOrder: order.map((o) => String(o.id)),
    };
  });
}

/* ---------- Проверка ответов ---------- */

export interface SubmittedAnswer {
  questionId: string;
  /* Выбранные варианты. Для single — один элемент. */
  optionIds: string[];
}

export interface GradedAnswer {
  questionId: string;
  questionIndex: number;
  givenOptionIds: string[];
  correctOptionIds: string[];
  isCorrect: boolean;
  points: number;
  earnedPoints: number;
}

export interface GradeResult {
  answers: GradedAnswer[];
  correctCount: number;
  totalCount: number;
  score: number;
  passed: boolean;
}

/* Проверка попытки. Выполняется ТОЛЬКО на сервере.
   Правильность определяется по флагу isCorrect у варианта, а не по индексу:
   при перемешивании индекс перестаёт быть надёжным. */
export function gradeAttempt(
  questionSet: QuestionSetEntry[],
  questions: Question[],
  submitted: SubmittedAnswer[],
  passingScore: number,
): GradeResult {
  const byId = new Map(questions.map((q) => [String(q.id), q]));
  const answerById = new Map(submitted.map((a) => [String(a.questionId), a]));

  const graded: GradedAnswer[] = [];
  let earned = 0;
  let total = 0;
  let correctCount = 0;

  for (const entry of questionSet) {
    const question = byId.get(entry.questionId);
    if (!question) continue;

    const points = question.points ?? 1;
    total += points;

    const correctIds = (question.options || [])
      .filter((o) => o.isCorrect)
      .map((o) => String(o.id))
      .sort();

    const given = (answerById.get(entry.questionId)?.optionIds ?? []).map(String).sort();

    const isCorrect =
      given.length > 0 &&
      given.length === correctIds.length &&
      given.every((id, idx) => id === correctIds[idx]);

    if (isCorrect) {
      earned += points;
      correctCount += 1;
    }

    graded.push({
      questionId: entry.questionId,
      questionIndex: entry.questionIndex,
      givenOptionIds: given,
      correctOptionIds: correctIds,
      isCorrect,
      points,
      earnedPoints: isCorrect ? points : 0,
    });
  }

  const score = total > 0 ? Math.round((earned / total) * 100) : 0;
  return {
    answers: graded,
    correctCount,
    totalCount: questionSet.length,
    score,
    passed: score >= passingScore,
  };
}

/* Вопрос в том виде, в каком он уходит сотруднику: без правильных ответов
   и без объяснения. Единственная точка сериализации для прохождения теста. */
export interface QuestionForEmployee {
  id: string;
  index: number;
  text: string;
  type: string;
  media: unknown;
  options: Array<{ id: string; text: string }>;
}

export function toEmployeeQuestions(
  questionSet: QuestionSetEntry[],
  questions: Question[],
): QuestionForEmployee[] {
  const byId = new Map(questions.map((q) => [String(q.id), q]));
  const out: QuestionForEmployee[] = [];

  for (const entry of questionSet) {
    const q = byId.get(entry.questionId);
    if (!q) continue;
    const optionById = new Map((q.options || []).map((o) => [String(o.id), o]));
    out.push({
      id: String(q.id),
      index: entry.questionIndex,
      text: q.text,
      type: q.type,
      media: q.media && q.media.type === 'image' ? q.media : null,
      options: entry.optionOrder
        .map((id) => optionById.get(id))
        .filter((o): o is NonNullable<typeof o> => !!o)
        .map((o) => ({ id: String(o.id), text: o.text })),
    });
  }
  return out;
}
