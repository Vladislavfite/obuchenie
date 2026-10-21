import type { FastifyInstance } from 'fastify';
import { and, eq, asc, desc, sql, isNull, ilike, inArray } from 'drizzle-orm';
import {
  trainingBlockSchema, moduleDraftSchema, paginationSchema, PERMISSION,
  validateModuleForPublish,
} from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { ok, paginated } from '../../core/response.js';
import { requireAuth, requirePermission } from '../../core/context.js';
import { NotFound, ValidationError, Conflict } from '../../core/errors.js';
import { logAudit } from '../../core/audit.js';
import * as service from './service.js';

export async function trainingRoutes(app: FastifyInstance) {
  /* ---------- Блоки обучения ---------- */

  app.get(
    '/api/training/blocks',
    { onRequest: [requireAuth, requirePermission(PERMISSION.TRAINING_VIEW, PERMISSION.TRAINING_EDIT)] },
    async (request) => {
      const q = paginationSchema.parse(request.query);
      const query = request.query as { status?: string };

      const filters = [
        eq(schema.trainingBlocks.organizationId, request.user.organizationId),
        isNull(schema.trainingBlocks.deletedAt),
      ];
      if (query.status) filters.push(eq(schema.trainingBlocks.status, query.status));
      if (q.search) filters.push(ilike(schema.trainingBlocks.title, `%${q.search}%`));
      const where = and(...filters);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.trainingBlocks)
        .where(where);

      const blocks = await db
        .select()
        .from(schema.trainingBlocks)
        .where(where)
        .orderBy(asc(schema.trainingBlocks.sortOrder), desc(schema.trainingBlocks.createdAt))
        .limit(q.limit)
        .offset((q.page - 1) * q.limit);

      const ids = blocks.map((b) => b.id);
      const moduleRows = ids.length
        ? await db
            .select({
              id: schema.trainingModules.id,
              trainingId: schema.trainingModules.trainingId,
              status: schema.trainingModules.status,
              sortOrder: schema.trainingModules.sortOrder,
              currentVersion: schema.trainingModules.currentVersion,
            })
            .from(schema.trainingModules)
            .where(
              and(inArray(schema.trainingModules.trainingId, ids), isNull(schema.trainingModules.deletedAt)),
            )
        : [];

      const byBlock = new Map<string, typeof moduleRows>();
      for (const m of moduleRows) byBlock.set(m.trainingId, [...(byBlock.get(m.trainingId) ?? []), m]);

      return paginated(
        blocks.map((b) => {
          const mods = byBlock.get(b.id) ?? [];
          return {
            ...b,
            moduleCount: mods.length,
            publishedModuleCount: mods.filter((m) => m.status === 'published').length,
          };
        }),
        q.page,
        q.limit,
        count,
      );
    },
  );

  app.post(
    '/api/training/blocks',
    { onRequest: [requireAuth, requirePermission(PERMISSION.TRAINING_CREATE)] },
    async (request) => {
      const body = trainingBlockSchema.parse(request.body);
      const slug = await service.uniqueBlockSlug(request.user.organizationId, body.title);
      const [created] = await db
        .insert(schema.trainingBlocks)
        .values({
          organizationId: request.user.organizationId,
          slug,
          title: body.title,
          description: body.description ?? null,
          icon: body.icon ?? null,
          sequential: body.sequential,
          prereqBlockId: body.prereqBlockId ?? null,
          requiredPct: body.requiredPct,
          isCore: body.isCore,
          createdBy: request.user.userId,
        })
        .returning();

      await logAudit({
        organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'block_created',
        entityType: 'training', entityId: created.id, details: `«${body.title}»`,
      });
      return ok(created);
    },
  );

  app.get(
    '/api/training/blocks/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.TRAINING_VIEW, PERMISSION.TRAINING_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const blocks = await db
        .select()
        .from(schema.trainingBlocks)
        .where(
          and(eq(schema.trainingBlocks.id, id), eq(schema.trainingBlocks.organizationId, request.user.organizationId)),
        )
        .limit(1);
      if (!blocks[0]) throw NotFound('Обучение не найдено.');

      const modules = await db
        .select()
        .from(schema.trainingModules)
        .where(and(eq(schema.trainingModules.trainingId, id), isNull(schema.trainingModules.deletedAt)))
        .orderBy(asc(schema.trainingModules.sortOrder));

      const versions = modules.length
        ? await db
            .select()
            .from(schema.trainingModuleVersions)
            .where(inArray(schema.trainingModuleVersions.moduleId, modules.map((m) => m.id)))
        : [];

      return ok({
        ...blocks[0],
        modules: modules.map((m) => {
          const mine = versions.filter((v) => v.moduleId === m.id);
          const published = mine.find((v) => v.status === 'published');
          const draft = mine.find((v) => v.status === 'draft');
          return {
            ...m,
            title: published?.title ?? draft?.title ?? '(без названия)',
            publishedVersionId: published?.id ?? null,
            hasDraft: !!draft,
            draftVersion: draft?.version ?? null,
            isRequired: published?.isRequired ?? draft?.isRequired ?? true,
            passingScore: published?.passingScore ?? draft?.passingScore ?? 70,
            attemptLimit: published?.attemptLimit ?? draft?.attemptLimit ?? 0,
            archivedVersions: mine.filter((v) => v.status === 'archived').map((v) => v.version).sort((a, b) => b - a),
          };
        }),
      });
    },
  );

  app.patch(
    '/api/training/blocks/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.TRAINING_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = trainingBlockSchema.partial().parse(request.body);
      if (body.prereqBlockId === id) throw ValidationError('Обучение не может быть предусловием самому себе.');
      const [updated] = await db
        .update(schema.trainingBlocks)
        .set({
          title: body.title,
          description: body.description ?? undefined,
          icon: body.icon ?? undefined,
          sequential: body.sequential,
          prereqBlockId: body.prereqBlockId !== undefined ? body.prereqBlockId : undefined,
          requiredPct: body.requiredPct,
          isCore: body.isCore,
          updatedAt: new Date(),
        })
        .where(
          and(eq(schema.trainingBlocks.id, id), eq(schema.trainingBlocks.organizationId, request.user.organizationId)),
        )
        .returning();
      if (!updated) throw NotFound('Обучение не найдено.');
      await logAudit({
        organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'block_updated', entityType: 'training', entityId: id,
      });
      return ok(updated);
    },
  );

  for (const [suffix, status, action] of [
    ['publish', 'published', 'block_published'],
    ['archive', 'archived', 'block_hidden'],
  ] as const) {
    app.post(
      `/api/training/blocks/:id/${suffix}`,
      { onRequest: [requireAuth, requirePermission(PERMISSION.TRAINING_PUBLISH)] },
      async (request) => {
        const { id } = request.params as { id: string };
        const [updated] = await db
          .update(schema.trainingBlocks)
          .set({ status, publishedAt: status === 'published' ? new Date() : undefined, updatedAt: new Date() })
          .where(
            and(eq(schema.trainingBlocks.id, id), eq(schema.trainingBlocks.organizationId, request.user.organizationId)),
          )
          .returning();
        if (!updated) throw NotFound('Обучение не найдено.');
        await logAudit({
          organizationId: request.user.organizationId, actorUserId: request.user.userId,
          actorLabel: request.user.fullName, action, entityType: 'training', entityId: id,
          details: updated.title,
        });
        return ok(updated);
      },
    );
  }

  app.delete(
    '/api/training/blocks/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.TRAINING_DELETE)] },
    async (request) => {
      const { id } = request.params as { id: string };

      /* Если по обучению есть попытки, удалять нельзя — это разрушило бы
         историю прохождения. Вместо удаления архивируем (§29 ТЗ). */
      const [{ attempts }] = await db
        .select({ attempts: sql<number>`count(*)::int` })
        .from(schema.testAttempts)
        .where(eq(schema.testAttempts.trainingId, id));

      if (attempts > 0) {
        await db
          .update(schema.trainingBlocks)
          .set({ status: 'archived', updatedAt: new Date() })
          .where(eq(schema.trainingBlocks.id, id));
        await logAudit({
          organizationId: request.user.organizationId, actorUserId: request.user.userId,
          actorLabel: request.user.fullName, action: 'block_hidden', entityType: 'training', entityId: id,
          details: `архивировано вместо удаления: есть ${attempts} попыток`,
        });
        return ok({ deleted: false, archived: true, reason: `По обучению есть ${attempts} попыток, поэтому оно архивировано, а не удалено.` });
      }

      await db
        .update(schema.trainingBlocks)
        .set({ deletedAt: new Date() })
        .where(
          and(eq(schema.trainingBlocks.id, id), eq(schema.trainingBlocks.organizationId, request.user.organizationId)),
        );
      await logAudit({
        organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'block_deleted', entityType: 'training', entityId: id,
      });
      return ok({ deleted: true });
    },
  );

  /* ---------- Модули ---------- */

  app.post(
    '/api/training/blocks/:id/modules',
    { onRequest: [requireAuth, requirePermission(PERMISSION.TRAINING_CREATE)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { title?: string };
      const title = String(body.title ?? '').trim() || 'Новый модуль';

      const blocks = await db
        .select()
        .from(schema.trainingBlocks)
        .where(
          and(eq(schema.trainingBlocks.id, id), eq(schema.trainingBlocks.organizationId, request.user.organizationId)),
        )
        .limit(1);
      if (!blocks[0]) throw NotFound('Обучение не найдено.');

      const [{ maxOrder }] = await db
        .select({ maxOrder: sql<number>`coalesce(max(${schema.trainingModules.sortOrder}), -1)::int` })
        .from(schema.trainingModules)
        .where(eq(schema.trainingModules.trainingId, id));

      const slug = await service.uniqueModuleSlug(id, title);

      const created = await db.transaction(async (tx) => {
        const [mod] = await tx
          .insert(schema.trainingModules)
          .values({
            organizationId: request.user.organizationId,
            trainingId: id,
            slug,
            sortOrder: maxOrder + 1,
            currentVersion: 1,
            status: 'draft',
          })
          .returning();

        await tx.insert(schema.trainingModuleVersions).values({
          organizationId: request.user.organizationId,
          moduleId: mod.id,
          version: 1,
          status: 'draft',
          title,
          passingScore: 70,
          contentHash: 'empty',
        });

        return mod;
      });

      await logAudit({
        organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'module_created',
        entityType: 'module', entityId: created.id, details: `«${title}»`,
      });
      return ok(created);
    },
  );

  app.get(
    '/api/training/modules/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.TRAINING_VIEW, PERMISSION.TRAINING_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const modules = await db
        .select()
        .from(schema.trainingModules)
        .where(
          and(eq(schema.trainingModules.id, id), eq(schema.trainingModules.organizationId, request.user.organizationId)),
        )
        .limit(1);
      if (!modules[0]) throw NotFound('Модуль не найден.');

      const versions = await db
        .select()
        .from(schema.trainingModuleVersions)
        .where(eq(schema.trainingModuleVersions.moduleId, id))
        .orderBy(desc(schema.trainingModuleVersions.version));

      const published = versions.find((v) => v.status === 'published');
      const draft = versions.find((v) => v.status === 'draft');
      const target = draft ?? published ?? versions[0];

      return ok({
        module: modules[0],
        current: target ? await service.loadVersionContent(target.id) : null,
        publishedVersionId: published?.id ?? null,
        hasDraft: !!draft,
        versions: versions.map((v) => ({
          id: v.id, version: v.version, status: v.status,
          publishedAt: v.publishedAt, updatedAt: v.updatedAt, contentHash: v.contentHash,
        })),
      });
    },
  );

  app.get(
    '/api/training/modules/:id/versions',
    { onRequest: [requireAuth, requirePermission(PERMISSION.TRAINING_VIEW, PERMISSION.TRAINING_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const versions = await db
        .select()
        .from(schema.trainingModuleVersions)
        .where(eq(schema.trainingModuleVersions.moduleId, id))
        .orderBy(desc(schema.trainingModuleVersions.version));
      return ok(versions.map(({ accessCode, ...v }) => v));
    },
  );

  app.get(
    '/api/training/modules/:id/versions/:version',
    { onRequest: [requireAuth, requirePermission(PERMISSION.TRAINING_VIEW, PERMISSION.TRAINING_EDIT)] },
    async (request) => {
      const { id, version } = request.params as { id: string; version: string };
      const rows = await db
        .select()
        .from(schema.trainingModuleVersions)
        .where(
          and(
            eq(schema.trainingModuleVersions.moduleId, id),
            eq(schema.trainingModuleVersions.version, parseInt(version, 10)),
          ),
        )
        .limit(1);
      if (!rows[0]) throw NotFound('Версия не найдена.');
      return ok(await service.loadVersionContent(rows[0].id));
    },
  );

  app.put(
    '/api/training/modules/:id/draft',
    { onRequest: [requireAuth, requirePermission(PERMISSION.TRAINING_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = moduleDraftSchema.parse(request.body);
      const result = await service.saveDraft(id, body as never, {
        userId: request.user.userId,
        fullName: request.user.fullName,
        organizationId: request.user.organizationId,
      });
      return ok(result);
    },
  );

  app.delete(
    '/api/training/modules/:id/draft',
    { onRequest: [requireAuth, requirePermission(PERMISSION.TRAINING_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      await service.discardDraft(id, {
        userId: request.user.userId, fullName: request.user.fullName, organizationId: request.user.organizationId,
      });
      return ok({ discarded: true });
    },
  );

  app.get(
    '/api/training/modules/:id/validate',
    { onRequest: [requireAuth, requirePermission(PERMISSION.TRAINING_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const versions = await db
        .select()
        .from(schema.trainingModuleVersions)
        .where(eq(schema.trainingModuleVersions.moduleId, id))
        .orderBy(desc(schema.trainingModuleVersions.version));
      const target = versions.find((v) => v.status === 'draft') ?? versions.find((v) => v.status === 'published');
      if (!target) throw NotFound('Модуль не найден.');
      const content = await service.loadVersionContent(target.id);
      const problems = validateModuleForPublish(content);
      return ok({ valid: problems.length === 0, problems });
    },
  );

  app.post(
    '/api/training/modules/:id/publish',
    { onRequest: [requireAuth, requirePermission(PERMISSION.TRAINING_PUBLISH)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const result = await service.publishModule(id, {
        userId: request.user.userId, fullName: request.user.fullName, organizationId: request.user.organizationId,
      });
      return ok(result);
    },
  );

  app.post(
    '/api/training/modules/:id/unpublish',
    { onRequest: [requireAuth, requirePermission(PERMISSION.TRAINING_PUBLISH)] },
    async (request) => {
      const { id } = request.params as { id: string };
      await service.unpublishModule(id, {
        userId: request.user.userId, fullName: request.user.fullName, organizationId: request.user.organizationId,
      });
      return ok({ unpublished: true });
    },
  );

  app.delete(
    '/api/training/modules/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.TRAINING_DELETE)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const [{ attempts }] = await db
        .select({ attempts: sql<number>`count(*)::int` })
        .from(schema.testAttempts)
        .where(eq(schema.testAttempts.moduleId, id));

      if (attempts > 0) {
        await db
          .update(schema.trainingModules)
          .set({ status: 'archived', updatedAt: new Date() })
          .where(eq(schema.trainingModules.id, id));
        return ok({ deleted: false, archived: true, reason: `По модулю есть ${attempts} попыток, поэтому он архивирован.` });
      }

      await db
        .update(schema.trainingModules)
        .set({ deletedAt: new Date() })
        .where(
          and(eq(schema.trainingModules.id, id), eq(schema.trainingModules.organizationId, request.user.organizationId)),
        );
      await logAudit({
        organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'module_deleted', entityType: 'module', entityId: id,
      });
      return ok({ deleted: true });
    },
  );

  app.put(
    '/api/training/modules/reorder',
    { onRequest: [requireAuth, requirePermission(PERMISSION.TRAINING_EDIT)] },
    async (request) => {
      const body = request.body as { ids: string[] };
      await db.transaction(async (tx) => {
        for (const [index, id] of (body.ids ?? []).entries()) {
          await tx
            .update(schema.trainingModules)
            .set({ sortOrder: index })
            .where(
              and(
                eq(schema.trainingModules.id, id),
                eq(schema.trainingModules.organizationId, request.user.organizationId),
              ),
            );
        }
      });
      return ok({ reordered: true });
    },
  );
}
