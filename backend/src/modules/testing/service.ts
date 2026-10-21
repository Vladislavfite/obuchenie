import { and, eq, sql, desc, inArray, isNull } from 'drizzle-orm';
import {
  buildQuestionSet, gradeAttempt, toEmployeeQuestions, versionScores,
  attemptsLeft, isModuleUnlocked, blockCompletionPct, todayISO,
} from '@tbedu/shared';
import type { QuestionSetEntry, AttemptLike, BlockLike } from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { NotFound, ValidationError, Forbidden, Conflict } from '../../core/errors.js';
import { logAudit } from '../../core/audit.js';
import { loadVersionContent } from '../training/service.js';

/* ТЕСТИРОВАНИЕ.

   Главное отличие от прототипа: набор вопросов формируется на сервере,
   правильные ответы в браузер не уходят, проверка выполняется здесь.
   В прототипе модуль приходил сотруднику вместе с полем correct, и
   finishQuiz() считал результат на клиенте — в клиент-серверной системе
   это означало бы, что ответы видны заранее. */

export interface StartAttemptInput {
  employeeId: string;
  organizationId: string;
  moduleId: string;
  accessCode?: string | null;
  actor: { userId: string; fullName: string };
}

async function attemptsForModule(employeeId: string, moduleId: string): Promise<AttemptLike[]> {
  const rows = await db
    .select({
      moduleVersionId: schema.testAttempts.moduleVersionId,
      version: schema.trainingModuleVersions.version,
      score: schema.testAttempts.score,
      passed: schema.testAttempts.passed,
      finishedAt: schema.testAttempts.finishedAt,
      startedAt: schema.testAttempts.startedAt,
    })
    .from(schema.testAttempts)
    .innerJoin(
      schema.trainingModuleVersions,
      eq(schema.trainingModuleVersions.id, schema.testAttempts.moduleVersionId),
    )
    .where(and(eq(schema.testAttempts.employeeId, employeeId), eq(schema.testAttempts.moduleId, moduleId)));
  return rows as AttemptLike[];
}

/* Собрать блок в форме, которую понимают доменные функции. */
export async function loadBlockForProgress(trainingId: string): Promise<BlockLike | null> {
  const blocks = await db
    .select()
    .from(schema.trainingBlocks)
    .where(eq(schema.trainingBlocks.id, trainingId))
    .limit(1);
  if (!blocks[0]) return null;

  const modules = await db
    .select()
    .from(schema.trainingModules)
    .where(and(eq(schema.trainingModules.trainingId, trainingId), isNull(schema.trainingModules.deletedAt)))
    .orderBy(schema.trainingModules.sortOrder);

  const versions = modules.length
    ? await db
        .select()
        .from(schema.trainingModuleVersions)
        .where(
          and(
            inArray(schema.trainingModuleVersions.moduleId, modules.map((m) => m.id)),
            eq(schema.trainingModuleVersions.status, 'published'),
          ),
        )
    : [];

  return {
    id: blocks[0].id,
    sequential: blocks[0].sequential,
    prereqBlockId: blocks[0].prereqBlockId,
    requiredPct: blocks[0].requiredPct,
    modules: modules.map((m) => {
      const published = versions.find((v) => v.moduleId === m.id);
      return {
        id: m.id,
        sortOrder: m.sortOrder,
        currentVersion: m.currentVersion,
        publishedVersionId: published?.id ?? null,
        status: m.status,
        isRequired: published?.isRequired ?? true,
        attemptLimit: published?.attemptLimit ?? 0,
        passingScore: published?.passingScore ?? 70,
      };
    }),
  };
}

export async function attemptsByModuleMap(
  employeeId: string,
  moduleIds: string[],
): Promise<Map<string, AttemptLike[]>> {
  const map = new Map<string, AttemptLike[]>();
  if (moduleIds.length === 0) return map;
  const rows = await db
    .select({
      moduleId: schema.testAttempts.moduleId,
      moduleVersionId: schema.testAttempts.moduleVersionId,
      version: schema.trainingModuleVersions.version,
      score: schema.testAttempts.score,
      passed: schema.testAttempts.passed,
      finishedAt: schema.testAttempts.finishedAt,
      startedAt: schema.testAttempts.startedAt,
    })
    .from(schema.testAttempts)
    .innerJoin(
      schema.trainingModuleVersions,
      eq(schema.trainingModuleVersions.id, schema.testAttempts.moduleVersionId),
    )
    .where(
      and(eq(schema.testAttempts.employeeId, employeeId), inArray(schema.testAttempts.moduleId, moduleIds)),
    );
  for (const row of rows) {
    map.set(row.moduleId, [...(map.get(row.moduleId) ?? []), row as AttemptLike]);
  }
  return map;
}

export async function startAttempt(input: StartAttemptInput) {
  const modules = await db
    .select()
    .from(schema.trainingModules)
    .where(and(eq(schema.trainingModules.id, input.moduleId), isNull(schema.trainingModules.deletedAt)))
    .limit(1);
  const mod = modules[0];
  if (!mod) throw NotFound('Модуль не найден.');

  const versions = await db
    .select()
    .from(schema.trainingModuleVersions)
    .where(
      and(
        eq(schema.trainingModuleVersions.moduleId, mod.id),
        eq(schema.trainingModuleVersions.status, 'published'),
      ),
    )
    .limit(1);
  const version = versions[0];
  if (!version) throw ValidationError('Модуль ещё не опубликован.');

  /* 1. Обучение должно быть назначено. */
  const assignmentRows = await db
    .select()
    .from(schema.assignments)
    .where(
      and(
        eq(schema.assignments.employeeId, input.employeeId),
        eq(schema.assignments.trainingId, mod.trainingId),
      ),
    )
    .limit(1);

  const blocks = await db
    .select({ isCore: schema.trainingBlocks.isCore, title: schema.trainingBlocks.title })
    .from(schema.trainingBlocks)
    .where(eq(schema.trainingBlocks.id, mod.trainingId))
    .limit(1);

  if (!assignmentRows[0] && !blocks[0]?.isCore) {
    throw Forbidden('Это обучение вам не назначено.');
  }

  /* 2. Модуль должен быть открыт по правилу последовательности. */
  const block = await loadBlockForProgress(mod.trainingId);
  if (block) {
    const published = block.modules.filter((m) => m.status === 'published');
    const index = published.findIndex((m) => m.id === mod.id);
    const attemptsMap = await attemptsByModuleMap(input.employeeId, published.map((m) => m.id));
    if (!isModuleUnlocked(block, index, attemptsMap)) {
      throw Forbidden('Сначала пройдите предыдущий модуль.');
    }
  }

  /* 3. Код доступа проверяется на сервере: в прототипе он лежал в браузере
        сотрудника вместе с данными модуля. */
  if (version.accessCode) {
    if (String(input.accessCode ?? '').trim() !== version.accessCode) {
      throw Forbidden('Неверный код доступа к тесту.');
    }
  }

  /* 4. Лимит попыток. */
  const priorAttempts = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.testAttempts)
    .where(
      and(
        eq(schema.testAttempts.employeeId, input.employeeId),
        eq(schema.testAttempts.moduleVersionId, version.id),
        sql`${schema.testAttempts.finishedAt} is not null`,
      ),
    );
  const used = priorAttempts[0]?.count ?? 0;

  const [{ extra }] = await db
    .select({ extra: sql<number>`count(*)::int` })
    .from(schema.extraAttempts)
    .where(
      and(
        eq(schema.extraAttempts.employeeId, input.employeeId),
        eq(schema.extraAttempts.moduleVersionId, version.id),
      ),
    );

  const left = attemptsLeft(version.attemptLimit, used, extra);
  if (left !== null && left <= 0) {
    throw Forbidden('Попытки по этому модулю исчерпаны. Обратитесь к руководителю за дополнительной попыткой.');
  }

  /* 5. Незавершённая попытка возвращается, а не создаётся новая:
        перезагрузка страницы не должна тратить попытку. */
  const openAttempts = await db
    .select()
    .from(schema.testAttempts)
    .where(
      and(
        eq(schema.testAttempts.employeeId, input.employeeId),
        eq(schema.testAttempts.moduleVersionId, version.id),
        isNull(schema.testAttempts.finishedAt),
      ),
    )
    .limit(1);

  const content = await loadVersionContent(version.id);

  if (openAttempts[0]) {
    const set = openAttempts[0].questionSet as QuestionSetEntry[];
    return {
      attemptId: openAttempts[0].id,
      moduleVersionId: version.id,
      version: version.version,
      title: content.title,
      passingScore: version.passingScore,
      attemptNumber: openAttempts[0].attemptNumber,
      attemptsLeft: left,
      resumed: true,
      questions: toEmployeeQuestions(set, content.questions),
    };
  }

  if (content.questions.length === 0) {
    throw ValidationError('В этом модуле нет вопросов теста.');
  }

  const questionSet = buildQuestionSet(content.questions, {
    randomQuestions: version.randomQuestions,
    questionCount: version.questionCount,
    shuffleOptions: version.shuffleOptions,
  });

  const [created] = await db
    .insert(schema.testAttempts)
    .values({
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      trainingId: mod.trainingId,
      moduleId: mod.id,
      moduleVersionId: version.id,
      assignmentId: assignmentRows[0]?.id ?? null,
      attemptNumber: used + 1,
      passingScore: version.passingScore,
      questionSet: questionSet as object,
    })
    .returning();

  await db
    .insert(schema.moduleProgress)
    .values({
      employeeId: input.employeeId,
      moduleVersionId: version.id,
      startedAt: new Date(),
      testStartedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.moduleProgress.employeeId, schema.moduleProgress.moduleVersionId],
      set: { testStartedAt: new Date(), updatedAt: new Date() },
    });

  /* Назначение переходит в «в процессе». */
  if (assignmentRows[0] && assignmentRows[0].status === 'assigned') {
    await db
      .update(schema.assignments)
      .set({ status: 'in_progress', updatedAt: new Date() })
      .where(eq(schema.assignments.id, assignmentRows[0].id));
  }

  await logAudit({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorLabel: input.actor.fullName,
    action: 'attempt_started',
    entityType: 'attempt',
    entityId: created.id,
    details: `«${content.title}» v${version.version}, попытка ${used + 1}`,
  });

  return {
    attemptId: created.id,
    moduleVersionId: version.id,
    version: version.version,
    title: content.title,
    passingScore: version.passingScore,
    attemptNumber: used + 1,
    attemptsLeft: left,
    resumed: false,
    /* Вопросы БЕЗ признака правильности и без объяснений. */
    questions: toEmployeeQuestions(questionSet, content.questions),
  };
}

export interface FinishAttemptInput {
  attemptId: string;
  employeeId: string;
  organizationId: string;
  answers: Array<{ questionId: string; optionIds: string[] }>;
  actor: { userId: string; fullName: string };
}

export async function finishAttempt(input: FinishAttemptInput) {
  const attempts = await db
    .select()
    .from(schema.testAttempts)
    .where(and(eq(schema.testAttempts.id, input.attemptId), eq(schema.testAttempts.employeeId, input.employeeId)))
    .limit(1);
  const attempt = attempts[0];
  if (!attempt) throw NotFound('Попытка не найдена.');
  if (attempt.finishedAt) throw Conflict('Эта попытка уже завершена.');

  const content = await loadVersionContent(attempt.moduleVersionId);
  const questionSet = attempt.questionSet as QuestionSetEntry[];

  /* Проверка на сервере. */
  const graded = gradeAttempt(questionSet, content.questions, input.answers, attempt.passingScore);

  const finishedAt = new Date();
  const durationSec = Math.max(1, Math.round((finishedAt.getTime() - attempt.startedAt.getTime()) / 1000));

  await db.transaction(async (tx) => {
    await tx
      .update(schema.testAttempts)
      .set({
        finishedAt,
        durationSec,
        score: graded.score,
        correctCount: graded.correctCount,
        totalCount: graded.totalCount,
        passed: graded.passed,
      })
      .where(eq(schema.testAttempts.id, attempt.id));

    if (graded.answers.length) {
      await tx.insert(schema.testAnswers).values(
        graded.answers.map((a) => ({
          attemptId: attempt.id,
          questionId: a.questionId,
          questionIndex: a.questionIndex,
          givenOptionIds: a.givenOptionIds as object,
          isCorrect: a.isCorrect,
        })),
      );
    }

    await tx
      .update(schema.employeeProfiles)
      .set({ lastActivityAt: finishedAt })
      .where(eq(schema.employeeProfiles.id, input.employeeId));
  });

  await logAudit({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorLabel: input.actor.fullName,
    action: graded.passed ? 'attempt_passed' : 'attempt_failed',
    entityType: 'attempt',
    entityId: attempt.id,
    details: `«${content.title}» · ${graded.score}% · ${graded.passed ? 'сдан' : 'не сдан'}`,
  });

  /* Автовыдача сертификата и обновление назначения. */
  const certificate = await maybeIssueCertificate(
    input.employeeId,
    attempt.trainingId,
    input.organizationId,
    input.actor,
  );

  /* Разбор ошибок отдаётся только после завершения попытки. */
  const byId = new Map(content.questions.map((q) => [String(q.id), q]));
  const review = graded.answers.map((a) => {
    const q = byId.get(a.questionId);
    return {
      questionId: a.questionId,
      questionText: q?.text ?? '',
      isCorrect: a.isCorrect,
      givenOptionIds: a.givenOptionIds,
      correctOptionIds: a.correctOptionIds,
      explanation: q?.explanation ?? null,
      sourceReference: q?.sourceReference ?? null,
      options: (q?.options ?? []).map((o) => ({ id: String(o.id), text: o.text })),
    };
  });

  return {
    attemptId: attempt.id,
    score: graded.score,
    correctCount: graded.correctCount,
    totalCount: graded.totalCount,
    passed: graded.passed,
    passingScore: attempt.passingScore,
    durationSec,
    certificateIssued: certificate,
    review,
  };
}

/* Выдача сертификата при полном прохождении программы.
   Перенос issueCertificateIfCompleted() из прототипа: повторное
   прохождение той же версии второй сертификат не создаёт. */
export async function maybeIssueCertificate(
  employeeId: string,
  trainingId: string,
  organizationId: string,
  actor: { userId: string; fullName: string },
) {
  const block = await loadBlockForProgress(trainingId);
  if (!block) return null;

  const attemptsMap = await attemptsByModuleMap(employeeId, block.modules.map((m) => m.id));
  const pct = blockCompletionPct(block, attemptsMap);
  if (pct < 100) {
    /* Программа ещё не завершена — но назначение могло перейти в in_progress. */
    await db
      .update(schema.assignments)
      .set({ status: 'in_progress', updatedAt: new Date() })
      .where(
        and(
          eq(schema.assignments.employeeId, employeeId),
          eq(schema.assignments.trainingId, trainingId),
          eq(schema.assignments.status, 'assigned'),
        ),
      );
    return null;
  }

  /* Ключ версии: набор «модуль:версия» на момент выдачи. Если материал
     обновится, ключ станет другим и сертификат можно будет выдать заново. */
  const versionKey = block.modules
    .filter((m) => m.status === 'published')
    .map((m) => `${m.id}:${m.currentVersion}`)
    .sort()
    .join(',');

  const existing = await db
    .select()
    .from(schema.certificates)
    .where(
      and(
        eq(schema.certificates.employeeId, employeeId),
        eq(schema.certificates.trainingId, trainingId),
        eq(schema.certificates.trainingVersionKey, versionKey),
      ),
    )
    .limit(1);
  if (existing[0]) return null;

  const settings = await db
    .select()
    .from(schema.platformSettings)
    .where(eq(schema.platformSettings.organizationId, organizationId))
    .limit(1);
  const validityDays = settings[0]?.certificateValidityDays ?? 365;

  const scores: number[] = [];
  for (const mod of block.modules) {
    if (mod.status !== 'published' || !mod.isRequired) continue;
    const s = versionScores((attemptsMap.get(mod.id) ?? []).filter((a) => a.moduleVersionId === mod.publishedVersionId));
    if (s.officialScore !== null) scores.push(s.officialScore);
  }

  const blockRow = await db
    .select({ title: schema.trainingBlocks.title, slug: schema.trainingBlocks.slug })
    .from(schema.trainingBlocks)
    .where(eq(schema.trainingBlocks.id, trainingId))
    .limit(1);

  const number = [
    'TB',
    (blockRow[0]?.slug ?? 'GEN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'GEN',
    employeeId.replace(/-/g, '').slice(0, 4).toUpperCase(),
    Date.now().toString(36).slice(-5).toUpperCase(),
  ].join('-');

  const [created] = await db
    .insert(schema.certificates)
    .values({
      organizationId,
      employeeId,
      trainingId,
      trainingVersionKey: versionKey,
      number,
      score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      issuedAt: todayISO(0),
      validUntil: todayISO(validityDays),
      issuedBy: null,
    })
    .returning();

  await db
    .update(schema.assignments)
    .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.assignments.employeeId, employeeId), eq(schema.assignments.trainingId, trainingId)));

  await logAudit({
    organizationId,
    actorUserId: actor.userId,
    actorLabel: actor.fullName,
    action: 'certificate_issued',
    entityType: 'certificate',
    entityId: created.id,
    details: `${blockRow[0]?.title ?? ''} · ${number}`,
  });

  return { id: created.id, number: created.number, issuedAt: created.issuedAt, validUntil: created.validUntil };
}
