import { and, eq, asc, desc, sql, inArray } from 'drizzle-orm';
import {
  moduleContentSignature, diffModuleContent, validateModuleForPublish,
  sanitizeRichText, safeLinkUrl, safeImageUrl, slugify,
} from '@tbedu/shared';
import type { ContentItem, Question, ModuleVersionContent } from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { sha256 } from '../../core/crypto.js';
import { NotFound, ValidationError, Conflict } from '../../core/errors.js';
import { logAudit } from '../../core/audit.js';

/* ЯДРО СИСТЕМЫ: версионирование учебных модулей.

   Правила, перенесённые из прототипа без изменений:

   1. Новая версия создаётся только при существенном изменении содержания.
      Определяется подписью (moduleContentSignature): косметика — глава,
      лектор, код доступа — версию не поднимает.
   2. Публикация архивирует предыдущую версию и поднимает номер.
   3. В модуле может быть не более одного черновика.
   4. Результат сотрудника ссылается на конкретную версию, поэтому
      опубликованную версию нельзя править задним числом. */

export function contentHash(content: ModuleVersionContent): string {
  return sha256(moduleContentSignature(content));
}

/* Очистка пользовательского контента на входе.
   Санитайзер на сервере — источник истины: клиентская очистка защищает
   только интерфейс, запрос можно отправить и мимо страницы. */
export function sanitizeContentItems(items: ContentItem[]): ContentItem[] {
  return (items || []).map((item, index) => {
    const payload = { ...(item.payload as unknown as Record<string, unknown>) };
    switch (item.type) {
      case 'text':
        payload.html = sanitizeRichText(payload.html);
        break;
      case 'image':
        payload.url = safeImageUrl(payload.url);
        if (!payload.url) throw ValidationError(`Элемент ${index + 1}: ссылка на изображение не поддерживается.`);
        break;
      case 'video':
      case 'link':
      case 'live': {
        const safe = safeLinkUrl(payload.url);
        if (!safe) throw ValidationError(`Элемент ${index + 1}: ссылка не поддерживается.`);
        payload.url = safe;
        if (payload.joinUrl) payload.joinUrl = safeLinkUrl(payload.joinUrl);
        break;
      }
      case 'slides': {
        const slides = Array.isArray(payload.slides) ? payload.slides : [];
        payload.slides = slides.map((raw, si) => {
          const slide = raw as Record<string, unknown>;
          const url = safeImageUrl(slide.imageUrl);
          if (!url) throw ValidationError(`Элемент ${index + 1}, слайд ${si + 1}: ссылка на изображение не поддерживается.`);
          return { id: slide.id ?? `s${si}`, imageUrl: url, caption: String(slide.caption ?? ''), order: si };
        });
        break;
      }
    }
    return { ...item, sortOrder: index, payload: payload as unknown as ContentItem['payload'] };
  });
}

export function sanitizeQuestions(questions: Question[]): Question[] {
  return (questions || []).map((q, index) => ({
    ...q,
    sortOrder: index,
    text: String(q.text ?? '').trim(),
    explanation: q.explanation ? String(q.explanation).trim() : null,
    media:
      q.media && q.media.type === 'image'
        ? { ...q.media, url: safeImageUrl(q.media.url) || '' }
        : { type: 'none' as const },
    options: (q.options || []).map((o, oi) => ({
      ...o,
      sortOrder: oi,
      text: String(o.text ?? '').trim(),
      isCorrect: !!o.isCorrect,
    })),
  }));
}

/* Собрать полное содержание версии из базы. */
export async function loadVersionContent(versionId: string): Promise<ModuleVersionContent & { id: string; version: number; status: string }> {
  const rows = await db
    .select()
    .from(schema.trainingModuleVersions)
    .where(eq(schema.trainingModuleVersions.id, versionId))
    .limit(1);
  const version = rows[0];
  if (!version) throw NotFound('Версия модуля не найдена.');

  const [items, questionRows] = await Promise.all([
    db
      .select()
      .from(schema.trainingContentItems)
      .where(eq(schema.trainingContentItems.moduleVersionId, versionId))
      .orderBy(asc(schema.trainingContentItems.sortOrder)),
    db
      .select()
      .from(schema.questions)
      .where(eq(schema.questions.moduleVersionId, versionId))
      .orderBy(asc(schema.questions.sortOrder)),
  ]);

  const optionRows = questionRows.length
    ? await db
        .select()
        .from(schema.questionOptions)
        .where(inArray(schema.questionOptions.questionId, questionRows.map((q) => q.id)))
        .orderBy(asc(schema.questionOptions.sortOrder))
    : [];

  const optionsByQuestion = new Map<string, typeof optionRows>();
  for (const o of optionRows) {
    optionsByQuestion.set(o.questionId, [...(optionsByQuestion.get(o.questionId) ?? []), o]);
  }

  return {
    id: version.id,
    version: version.version,
    status: version.status,
    title: version.title,
    chapter: version.chapter,
    description: version.description,
    speaker: version.speaker,
    accessCode: version.accessCode,
    passingScore: version.passingScore,
    attemptLimit: version.attemptLimit,
    isRequired: version.isRequired,
    randomQuestions: version.randomQuestions,
    questionCount: version.questionCount,
    shuffleOptions: version.shuffleOptions,
    contentItems: items.map((i) => ({
      id: i.id,
      type: i.type as ContentItem['type'],
      title: i.title,
      sortOrder: i.sortOrder,
      payload: i.payload as ContentItem['payload'],
      origin: i.origin as 'ai' | null,
    })),
    questions: questionRows.map((q) => ({
      id: q.id,
      sortOrder: q.sortOrder,
      text: q.text,
      type: q.type as Question['type'],
      explanation: q.explanation,
      sourceReference: q.sourceReference,
      topic: q.topic,
      topicId: q.topicId,
      difficulty: q.difficulty as Question['difficulty'],
      isPractical: q.isPractical,
      points: q.points,
      media: q.media as Question['media'],
      imagePrompt: q.imagePrompt,
      timestampSec: q.timestampSec,
      origin: q.origin as 'ai' | null,
      options: (optionsByQuestion.get(q.id) ?? []).map((o) => ({
        id: o.id,
        sortOrder: o.sortOrder,
        text: o.text,
        isCorrect: o.isCorrect,
      })),
    })),
  };
}

/* Тип транзакции Drizzle отличается от типа пула, поэтому принимаем оба. */
type DbLike = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function writeVersionContent(
  tx: DbLike,
  versionId: string,
  content: ModuleVersionContent,
): Promise<void> {
  await tx.delete(schema.trainingContentItems).where(eq(schema.trainingContentItems.moduleVersionId, versionId));
  await tx.delete(schema.questions).where(eq(schema.questions.moduleVersionId, versionId));

  if (content.contentItems.length) {
    await tx.insert(schema.trainingContentItems).values(
      content.contentItems.map((item, index) => ({
        moduleVersionId: versionId,
        sortOrder: index,
        type: item.type,
        title: item.title ?? null,
        payload: item.payload as object,
        origin: item.origin ?? null,
      })),
    );
  }

  for (const [index, q] of content.questions.entries()) {
    const [created] = await tx
      .insert(schema.questions)
      .values({
        moduleVersionId: versionId,
        sortOrder: index,
        text: q.text,
        type: q.type,
        explanation: q.explanation ?? null,
        sourceReference: q.sourceReference ?? null,
        topic: q.topic ?? null,
        topicId: q.topicId ?? null,
        difficulty: q.difficulty,
        isPractical: q.isPractical,
        points: q.points,
        media: (q.media ?? null) as object | null,
        imagePrompt: q.imagePrompt ?? null,
        timestampSec: q.timestampSec ?? null,
        origin: q.origin ?? null,
      })
      .returning();

    if (q.options.length) {
      await tx.insert(schema.questionOptions).values(
        q.options.map((o, oi) => ({
          questionId: created.id,
          sortOrder: oi,
          text: o.text,
          isCorrect: o.isCorrect,
        })),
      );
    }
  }
}

/* ---------- Черновик ---------- */

export interface SaveDraftResult {
  draftId: string;
  wouldCreateNewVersion: boolean;
  nextVersion: number;
  changedFields: string[];
  contentHash: string;
}

export async function saveDraft(
  moduleId: string,
  content: ModuleVersionContent,
  actor: { userId: string; fullName: string; organizationId: string },
): Promise<SaveDraftResult> {
  const moduleRows = await db
    .select()
    .from(schema.trainingModules)
    .where(and(eq(schema.trainingModules.id, moduleId), eq(schema.trainingModules.organizationId, actor.organizationId)))
    .limit(1);
  const mod = moduleRows[0];
  if (!mod) throw NotFound('Модуль не найден.');

  const clean: ModuleVersionContent = {
    ...content,
    contentItems: sanitizeContentItems(content.contentItems),
    questions: sanitizeQuestions(content.questions),
  };

  const published = await db
    .select()
    .from(schema.trainingModuleVersions)
    .where(
      and(
        eq(schema.trainingModuleVersions.moduleId, moduleId),
        eq(schema.trainingModuleVersions.status, 'published'),
      ),
    )
    .limit(1);

  let wouldCreateNewVersion = true;
  let changedFields: string[] = [];

  if (published[0]) {
    const publishedContent = await loadVersionContent(published[0].id);
    const diff = diffModuleContent(publishedContent, clean);
    wouldCreateNewVersion = diff.substantive;
    changedFields = diff.changedFields;
  }

  const nextVersion = published[0] ? published[0].version + 1 : mod.currentVersion;
  const hash = contentHash(clean);

  const draftId = await db.transaction(async (tx) => {
    const existingDraft = await tx
      .select()
      .from(schema.trainingModuleVersions)
      .where(
        and(eq(schema.trainingModuleVersions.moduleId, moduleId), eq(schema.trainingModuleVersions.status, 'draft')),
      )
      .limit(1);

    const values = {
      title: clean.title,
      chapter: clean.chapter ?? null,
      description: clean.description ?? null,
      speaker: clean.speaker ?? null,
      accessCode: clean.accessCode ?? null,
      passingScore: clean.passingScore,
      attemptLimit: clean.attemptLimit,
      isRequired: clean.isRequired,
      randomQuestions: clean.randomQuestions,
      questionCount: clean.questionCount,
      shuffleOptions: clean.shuffleOptions,
      contentHash: hash,
      updatedAt: new Date(),
    };

    let id: string;
    if (existingDraft[0]) {
      await tx
        .update(schema.trainingModuleVersions)
        .set(values)
        .where(eq(schema.trainingModuleVersions.id, existingDraft[0].id));
      id = existingDraft[0].id;
    } else {
      const [created] = await tx
        .insert(schema.trainingModuleVersions)
        .values({
          organizationId: actor.organizationId,
          moduleId,
          version: nextVersion,
          status: 'draft',
          ...values,
        })
        .returning();
      id = created.id;
    }

    await writeVersionContent(tx, id, clean);
    return id;
  });

  await logAudit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorLabel: actor.fullName,
    action: 'module_draft_saved',
    entityType: 'module',
    entityId: moduleId,
    details: `«${clean.title}» → v${nextVersion}${wouldCreateNewVersion ? '' : ' (без изменения версии)'}`,
  });

  return { draftId, wouldCreateNewVersion, nextVersion, changedFields, contentHash: hash };
}

export async function discardDraft(
  moduleId: string,
  actor: { userId: string; fullName: string; organizationId: string },
): Promise<void> {
  await db
    .delete(schema.trainingModuleVersions)
    .where(
      and(eq(schema.trainingModuleVersions.moduleId, moduleId), eq(schema.trainingModuleVersions.status, 'draft')),
    );
  await logAudit({
    organizationId: actor.organizationId, actorUserId: actor.userId, actorLabel: actor.fullName,
    action: 'module_draft_discarded', entityType: 'module', entityId: moduleId,
  });
}

/* ---------- Публикация ---------- */

export interface PublishResult {
  versionId: string;
  version: number;
  archivedVersion: number | null;
  createdNewVersion: boolean;
}

export async function publishModule(
  moduleId: string,
  actor: { userId: string; fullName: string; organizationId: string },
): Promise<PublishResult> {
  const draftRows = await db
    .select()
    .from(schema.trainingModuleVersions)
    .where(
      and(eq(schema.trainingModuleVersions.moduleId, moduleId), eq(schema.trainingModuleVersions.status, 'draft')),
    )
    .limit(1);
  const draft = draftRows[0];
  if (!draft) throw ValidationError('Нет черновика для публикации. Сначала сохраните изменения.');

  const content = await loadVersionContent(draft.id);
  const problems = validateModuleForPublish(content);
  if (problems.length > 0) {
    throw ValidationError(
      'Модуль нельзя опубликовать: ' + problems.map((p) => p.message).join(' '),
      problems.map((p) => ({ field: `${p.scope}${p.index !== undefined ? `[${p.index}]` : ''}`, message: p.message })),
    );
  }

  const result = await db.transaction(async (tx) => {
    const published = await tx
      .select()
      .from(schema.trainingModuleVersions)
      .where(
        and(
          eq(schema.trainingModuleVersions.moduleId, moduleId),
          eq(schema.trainingModuleVersions.status, 'published'),
        ),
      )
      .limit(1);

    let archivedVersion: number | null = null;
    let createdNewVersion = true;

    if (published[0]) {
      const publishedContent = await loadVersionContent(published[0].id);
      const diff = diffModuleContent(publishedContent, content);

      if (!diff.substantive) {
        /* Косметическая правка: обновляем опубликованную версию на месте,
           номер не меняем, архив не трогаем — прогресс сотрудников
           остаётся действительным. */
        await tx
          .update(schema.trainingModuleVersions)
          .set({
            title: content.title,
            chapter: content.chapter ?? null,
            description: content.description ?? null,
            speaker: content.speaker ?? null,
            accessCode: content.accessCode ?? null,
            updatedAt: new Date(),
          })
          .where(eq(schema.trainingModuleVersions.id, published[0].id));
        await tx.delete(schema.trainingModuleVersions).where(eq(schema.trainingModuleVersions.id, draft.id));
        createdNewVersion = false;
        return { versionId: published[0].id, version: published[0].version, archivedVersion: null, createdNewVersion };
      }

      /* Существенное изменение: предыдущая версия уходит в архив. */
      await tx
        .update(schema.trainingModuleVersions)
        .set({ status: 'archived' })
        .where(eq(schema.trainingModuleVersions.id, published[0].id));
      archivedVersion = published[0].version;
    }

    const nextVersion = archivedVersion !== null ? archivedVersion + 1 : draft.version;

    await tx
      .update(schema.trainingModuleVersions)
      .set({
        status: 'published',
        version: nextVersion,
        publishedAt: new Date(),
        publishedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(schema.trainingModuleVersions.id, draft.id));

    await tx
      .update(schema.trainingModules)
      .set({ currentVersion: nextVersion, status: 'published', updatedAt: new Date() })
      .where(eq(schema.trainingModules.id, moduleId));

    return { versionId: draft.id, version: nextVersion, archivedVersion, createdNewVersion };
  });

  await logAudit({
    organizationId: actor.organizationId, actorUserId: actor.userId, actorLabel: actor.fullName,
    action: result.createdNewVersion ? 'module_version_published' : 'module_published',
    entityType: 'module', entityId: moduleId,
    details: `«${content.title}» v${result.version}`,
  });
  if (result.archivedVersion !== null) {
    await logAudit({
      organizationId: actor.organizationId, actorUserId: actor.userId, actorLabel: actor.fullName,
      action: 'module_archived', entityType: 'module', entityId: moduleId,
      details: `v${result.archivedVersion} отправлена в архив`,
    });
  }

  return result;
}

export async function unpublishModule(
  moduleId: string,
  actor: { userId: string; fullName: string; organizationId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(schema.trainingModuleVersions)
      .set({ status: 'archived' })
      .where(
        and(
          eq(schema.trainingModuleVersions.moduleId, moduleId),
          eq(schema.trainingModuleVersions.status, 'published'),
        ),
      );
    await tx
      .update(schema.trainingModules)
      .set({ status: 'draft', updatedAt: new Date() })
      .where(eq(schema.trainingModules.id, moduleId));
  });
  await logAudit({
    organizationId: actor.organizationId, actorUserId: actor.userId, actorLabel: actor.fullName,
    action: 'module_unpublished', entityType: 'module', entityId: moduleId,
  });
}

/* Уникальный slug внутри блока. */
export async function uniqueModuleSlug(trainingId: string, title: string): Promise<string> {
  const base = slugify(title);
  const existing = await db
    .select({ slug: schema.trainingModules.slug })
    .from(schema.trainingModules)
    .where(eq(schema.trainingModules.trainingId, trainingId));
  const used = new Set(existing.map((e) => e.slug));
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`;
}

export async function uniqueBlockSlug(organizationId: string, title: string): Promise<string> {
  const base = slugify(title);
  const existing = await db
    .select({ slug: schema.trainingBlocks.slug })
    .from(schema.trainingBlocks)
    .where(eq(schema.trainingBlocks.organizationId, organizationId));
  const used = new Set(existing.map((e) => e.slug));
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`;
}
