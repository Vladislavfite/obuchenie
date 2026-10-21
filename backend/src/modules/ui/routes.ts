import type { FastifyInstance } from 'fastify';
import { and, eq, asc } from 'drizzle-orm';
import { uiVisibilitySchema, uiPageSchema, uiPageBlocksSchema, PERMISSION, sanitizeRichText, safeLinkUrl } from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { ok } from '../../core/response.js';
import { requireAuth, requirePermission } from '../../core/context.js';
import { NotFound } from '../../core/errors.js';
import { logAudit } from '../../core/audit.js';

/* Настройка интерфейса и конструктор страниц (§47, §48 ТЗ).

   Важное ограничение: страницы собираются из готовых компонентов, а не из
   произвольного HTML. Текстовые свойства проходят через санитайзер, ссылки
   проверяются. Иначе конструктор страниц превратился бы в способ выполнить
   чужой скрипт в кабинете сотрудника. */

const TEXT_PROPS = new Set(['html', 'text', 'description', 'title', 'label']);
const URL_PROPS = new Set(['url', 'href', 'joinUrl']);

function sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props ?? {})) {
    if (TEXT_PROPS.has(key) && typeof value === 'string') {
      clean[key] = key === 'html' ? sanitizeRichText(value) : String(value).slice(0, 1000);
    } else if (URL_PROPS.has(key)) {
      clean[key] = safeLinkUrl(value);
    } else if (Array.isArray(value)) {
      clean[key] = value.slice(0, 200).map((v) =>
        typeof v === 'string' ? v.slice(0, 500)
        : typeof v === 'object' && v ? sanitizeProps(v as Record<string, unknown>) : v);
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = sanitizeProps(value as Record<string, unknown>);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

export async function uiRoutes(app: FastifyInstance) {
  app.get('/api/ui/modules',
    { onRequest: [requireAuth, requirePermission(PERMISSION.UI_CONFIGURE)] },
    async (request) => {
      const rows = await db.select({
          module: schema.uiModules,
          isVisible: schema.uiModuleVisibility.isVisible,
          customOrder: schema.uiModuleVisibility.sortOrder,
        })
        .from(schema.uiModules)
        .leftJoin(schema.uiModuleVisibility,
          and(eq(schema.uiModuleVisibility.uiModuleId, schema.uiModules.id),
              eq(schema.uiModuleVisibility.organizationId, request.user.organizationId)))
        .orderBy(asc(schema.uiModules.cabinet), asc(schema.uiModules.sortOrder));

      return ok(rows.map((r) => ({
        ...r.module,
        isVisible: r.module.isCore ? true : r.isVisible !== false,
        sortOrder: r.customOrder ?? r.module.sortOrder,
      })));
    });

  app.put('/api/ui/modules',
    { onRequest: [requireAuth, requirePermission(PERMISSION.UI_CONFIGURE)] },
    async (request) => {
      const body = uiVisibilitySchema.parse(request.body);
      const all = await db.select().from(schema.uiModules);
      const byCode = new Map(all.map((m) => [m.code, m]));

      for (const entry of body.modules) {
        const mod = byCode.get(entry.code);
        if (!mod) continue;
        /* Основные разделы нельзя скрыть: без них кабинет становится
           неработоспособным (§47 ТЗ). */
        const visible = mod.isCore ? true : entry.visible;
        await db.insert(schema.uiModuleVisibility).values({
          organizationId: request.user.organizationId,
          uiModuleId: mod.id, isVisible: visible, sortOrder: entry.sortOrder ?? null,
        }).onConflictDoUpdate({
          target: [schema.uiModuleVisibility.organizationId, schema.uiModuleVisibility.uiModuleId],
          set: { isVisible: visible, sortOrder: entry.sortOrder ?? null },
        });
      }

      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'ui_visibility_changed',
        details: `${body.modules.length} разделов` });
      return ok({ saved: true });
    });

  /* ---------- Страницы ---------- */

  app.get('/api/ui/pages', { onRequest: requireAuth }, async (request) => {
    const rows = await db.select().from(schema.uiPages)
      .where(eq(schema.uiPages.organizationId, request.user.organizationId))
      .orderBy(asc(schema.uiPages.sortOrder));
    return ok(rows);
  });

  app.get('/api/ui/pages/:slug', { onRequest: requireAuth }, async (request) => {
    const { slug } = request.params as { slug: string };
    const rows = await db.select().from(schema.uiPages)
      .where(and(eq(schema.uiPages.slug, slug),
                 eq(schema.uiPages.organizationId, request.user.organizationId))).limit(1);
    if (!rows[0]) throw NotFound('Страница не найдена.');
    const blocks = await db.select().from(schema.uiPageBlocks)
      .where(eq(schema.uiPageBlocks.pageId, rows[0].id))
      .orderBy(asc(schema.uiPageBlocks.sortOrder));
    return ok({ ...rows[0], blocks });
  });

  app.post('/api/ui/pages',
    { onRequest: [requireAuth, requirePermission(PERMISSION.UI_CONFIGURE)] },
    async (request) => {
      const body = uiPageSchema.parse(request.body);
      const [created] = await db.insert(schema.uiPages).values({
        organizationId: request.user.organizationId,
        slug: body.slug, title: body.title,
        cabinets: body.cabinets as object, isActive: body.isActive,
        createdBy: request.user.userId,
      }).returning();
      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'ui_page_created',
        entityType: 'page', entityId: created.id, details: body.title });
      return ok(created);
    });

  app.put('/api/ui/pages/:id/blocks',
    { onRequest: [requireAuth, requirePermission(PERMISSION.UI_CONFIGURE)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = uiPageBlocksSchema.parse(request.body);

      await db.transaction(async (tx) => {
        await tx.delete(schema.uiPageBlocks).where(eq(schema.uiPageBlocks.pageId, id));
        if (body.blocks.length) {
          await tx.insert(schema.uiPageBlocks).values(
            body.blocks.map((b, index) => ({
              pageId: id, sortOrder: index, component: b.component,
              props: sanitizeProps(b.props) as object,
            })),
          );
        }
      });

      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'ui_page_updated', entityType: 'page', entityId: id });
      return ok({ saved: body.blocks.length });
    });

  app.delete('/api/ui/pages/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.UI_CONFIGURE)] },
    async (request) => {
      const { id } = request.params as { id: string };
      await db.delete(schema.uiPages)
        .where(and(eq(schema.uiPages.id, id), eq(schema.uiPages.organizationId, request.user.organizationId)));
      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'ui_page_deleted', entityType: 'page', entityId: id });
      return ok({ deleted: true });
    });
}
