/* Прогресс, состояния модулей и баллы.

   Перенесено из storage.js (moduleState, versionScores, isModuleUnlocked,
   blockAccess, blockCompletionPct, employeeProgressPct, programStatus)
   с сохранением двух правил прототипа:

   1. Прогресс привязан к ПАРЕ «модуль + версия», а не к модулю.
      Публикация новой версии не стирает историю, но старое прохождение
      перестаёт считаться актуальным.

   2. Статусы и баллы НИГДЕ НЕ ХРАНЯТСЯ — они вычисляются из попыток.
      Поэтому невозможно рассогласование вида passed=true / status=failed. */

export interface AttemptLike {
  moduleVersionId: string;
  version: number;
  score: number | null;
  passed: boolean | null;
  finishedAt: string | Date | null;
  startedAt: string | Date;
}

export interface ModuleLike {
  id: string;
  sortOrder: number;
  currentVersion: number;
  publishedVersionId: string | null;
  status: string;
  isRequired: boolean;
  attemptLimit: number;
  passingScore: number;
}

export interface BlockLike {
  id: string;
  sequential: boolean;
  prereqBlockId: string | null;
  requiredPct: number;
  modules: ModuleLike[];
}

export type ModuleStateCode =
  | 'locked'
  | 'available'
  | 'in_progress'
  | 'passed'
  | 'failed'
  | 'outdated'
  | 'exhausted';

/* ---------- Баллы по версии ---------- */

export interface VersionScores {
  attemptCount: number;
  lastScore: number | null;
  bestScore: number | null;
  /* Официальный балл — первый сданный, иначе лучший. Это НЕ среднее:
     показатели «результат» и «средний балл попыток» в прототипе
     сознательно разделены. */
  officialScore: number | null;
  passed: boolean;
}

export function versionScores(attempts: AttemptLike[]): VersionScores {
  const finished = (attempts || []).filter((a) => a.finishedAt);
  if (finished.length === 0) {
    return { attemptCount: 0, lastScore: null, bestScore: null, officialScore: null, passed: false };
  }
  const sorted = finished
    .slice()
    .sort((a, b) => new Date(a.finishedAt as string).getTime() - new Date(b.finishedAt as string).getTime());
  const scores = sorted.map((a) => (typeof a.score === 'number' ? a.score : 0));
  const firstPassed = sorted.find((a) => a.passed === true);
  const bestScore = Math.max(...scores);
  return {
    attemptCount: sorted.length,
    lastScore: scores[scores.length - 1],
    bestScore,
    officialScore: firstPassed ? (firstPassed.score ?? bestScore) : bestScore,
    passed: !!firstPassed,
  };
}

/* Сколько попыток осталось. null — без ограничений. */
export function attemptsLeft(
  attemptLimit: number,
  usedAttempts: number,
  extraAttempts = 0,
): number | null {
  if (!attemptLimit || attemptLimit <= 0) return null;
  return Math.max(0, attemptLimit + extraAttempts - usedAttempts);
}

export function attemptsExhausted(
  attemptLimit: number,
  usedAttempts: number,
  extraAttempts = 0,
): boolean {
  const left = attemptsLeft(attemptLimit, usedAttempts, extraAttempts);
  return left !== null && left <= 0;
}

/* ---------- Состояние модуля ---------- */

export interface ModuleStateInput {
  module: ModuleLike;
  /* Попытки сотрудника по ВСЕМ версиям этого модуля. */
  attempts: AttemptLike[];
  extraAttempts?: number;
  unlocked: boolean;
}

export interface ModuleStateResult {
  code: ModuleStateCode;
  passedCurrent: boolean;
  passedOlderVersion: boolean;
  scores: VersionScores;
  attemptsUsed: number;
  attemptsLeft: number | null;
}

/* Единая точка расчёта статуса модуля. Нигде больше статус не определяется. */
export function moduleState(input: ModuleStateInput): ModuleStateResult {
  const { module: mod, attempts, unlocked } = input;
  const extra = input.extraAttempts || 0;

  const currentVersionId = mod.publishedVersionId;
  const currentAttempts = (attempts || []).filter((a) => a.moduleVersionId === currentVersionId);
  const olderAttempts = (attempts || []).filter((a) => a.moduleVersionId !== currentVersionId);

  const scores = versionScores(currentAttempts);
  const attemptsUsed = currentAttempts.filter((a) => a.finishedAt).length;
  const left = attemptsLeft(mod.attemptLimit, attemptsUsed, extra);
  const passedOlder = versionScores(olderAttempts).passed;

  const base: Omit<ModuleStateResult, 'code'> = {
    passedCurrent: scores.passed,
    passedOlderVersion: passedOlder,
    scores,
    attemptsUsed,
    attemptsLeft: left,
  };

  if (!unlocked) return { ...base, code: 'locked' };
  if (scores.passed) return { ...base, code: 'passed' };
  /* Пройдена прежняя версия, но материал обновился (§23 ТЗ). */
  if (passedOlder) return { ...base, code: 'outdated' };
  if (left !== null && left <= 0) return { ...base, code: 'exhausted' };
  if (attemptsUsed > 0) return { ...base, code: 'failed' };
  if (currentAttempts.length > 0) return { ...base, code: 'in_progress' };
  return { ...base, code: 'available' };
}

/* Модуль открыт, если блок непоследовательный, либо это первый модуль,
   либо предыдущий пройден В АКТУАЛЬНОЙ ВЕРСИИ. */
export function isModuleUnlocked(
  block: BlockLike,
  moduleIndex: number,
  attemptsByModule: Map<string, AttemptLike[]>,
): boolean {
  if (!block.sequential) return true;
  if (moduleIndex <= 0) return true;
  const published = block.modules.filter((m) => m.status === 'published');
  const prev = published[moduleIndex - 1];
  if (!prev) return true;
  const prevAttempts = (attemptsByModule.get(prev.id) || []).filter(
    (a) => a.moduleVersionId === prev.publishedVersionId,
  );
  return versionScores(prevAttempts).passed;
}

/* Процент прохождения блока: только обязательные опубликованные модули,
   только актуальные версии. */
export function blockCompletionPct(
  block: BlockLike,
  attemptsByModule: Map<string, AttemptLike[]>,
): number {
  const required = block.modules.filter((m) => m.status === 'published' && m.isRequired);
  if (required.length === 0) return 0;
  const passed = required.filter((m) => {
    const attempts = (attemptsByModule.get(m.id) || []).filter(
      (a) => a.moduleVersionId === m.publishedVersionId,
    );
    return versionScores(attempts).passed;
  }).length;
  return Math.round((passed / required.length) * 100);
}

export type ProgramStatusCode = 'not_started' | 'in_progress' | 'completed';

export function programStatus(
  block: BlockLike,
  attemptsByModule: Map<string, AttemptLike[]>,
): ProgramStatusCode {
  const pct = blockCompletionPct(block, attemptsByModule);
  if (pct >= 100) return 'completed';
  const anyAttempt = block.modules.some((m) => (attemptsByModule.get(m.id) || []).length > 0);
  return anyAttempt || pct > 0 ? 'in_progress' : 'not_started';
}

/* Доступ к блоку по предусловию (§14 прототипа). */
export function blockAccess(
  block: BlockLike,
  prereqBlock: BlockLike | null,
  attemptsByModule: Map<string, AttemptLike[]>,
): { allowed: boolean; reason: string } {
  if (!block.prereqBlockId || !prereqBlock) return { allowed: true, reason: '' };
  const pct = blockCompletionPct(prereqBlock, attemptsByModule);
  if (pct >= (block.requiredPct ?? 100)) return { allowed: true, reason: '' };
  return {
    allowed: false,
    reason: `Сначала пройдите предыдущее обучение не менее чем на ${block.requiredPct}% (сейчас ${pct}%).`,
  };
}

/* Общий прогресс сотрудника по назначенным блокам. */
export function employeeProgressPct(
  blocks: BlockLike[],
  attemptsByModule: Map<string, AttemptLike[]>,
): number {
  const required: ModuleLike[] = [];
  for (const block of blocks) {
    for (const mod of block.modules) {
      if (mod.status === 'published' && mod.isRequired) required.push(mod);
    }
  }
  if (required.length === 0) return 0;
  const passed = required.filter((m) => {
    const attempts = (attemptsByModule.get(m.id) || []).filter(
      (a) => a.moduleVersionId === m.publishedVersionId,
    );
    return versionScores(attempts).passed;
  }).length;
  return Math.round((passed / required.length) * 100);
}

/* Средний официальный балл по пройденным обязательным модулям. */
export function employeeAvgScore(
  blocks: BlockLike[],
  attemptsByModule: Map<string, AttemptLike[]>,
): number | null {
  const values: number[] = [];
  for (const block of blocks) {
    for (const mod of block.modules) {
      if (mod.status !== 'published' || !mod.isRequired) continue;
      const attempts = (attemptsByModule.get(mod.id) || []).filter(
        (a) => a.moduleVersionId === mod.publishedVersionId,
      );
      const s = versionScores(attempts);
      if (s.officialScore !== null) values.push(s.officialScore);
    }
  }
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}
