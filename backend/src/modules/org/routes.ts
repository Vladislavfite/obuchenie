import type { FastifyInstance } from 'fastify';
import { and, eq, isNull, asc } from 'drizzle-orm';
import { departmentSchema, referenceSchema, PERMISSION } from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { ok } from '../../core/response.js';
import { requireAuth, requirePermission } from '../../core/context.js';
import { NotFound, ValidationError } from '../../core/errors.js';
import { logAudit } from '../../core/audit.js';

/* Справочники оргструктуры. В прототипе подразделение и должность были
   свободными строками в записи сотрудника — из-за этого нельзя было
   назначать обучение по подразделению и считать аналитику надёжно. */

export async function orgRoutes(app: FastifyInstance) {
  app.get('/api/organizations/current', { onRequest: requireAuth }, async (request) => {
    const rows = await db.select().from(schema.organizations)
      .where(eq(schema.organizations.id, request.user.organizationId)).limit(1);
    if (!rows[0]) throw NotFound('Организация не найдена.');
    return ok(rows[0]);
  });

  app.patch('/api/organizations/current',
    { onRequest: [requireAuth, requirePermission(PERMISSION.SETTINGS_MANAGE)] },
    async (request) => {
      const body = request.body as { name?: string; bin?: string; timezone?: string };
      const [updated] = await db.update(schema.organizations)
        .set({
          name: body.name?.trim() || undefined,
          bin: body.bin ?? undefined,
          timezone: body.timezone || undefined,
          updatedAt: new Date(),
        })
        .where(eq(schema.organizations.id, request.user.organizationId)).returning();
      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'settings_change', details: 'организация' });
      return ok(updated);
    });

  /* ---------- Подразделения (дерево) ---------- */

  app.get('/api/departments', { onRequest: requireAuth }, async (request) => {
    const rows = await db.select().from(schema.departments)
      .where(and(eq(schema.departments.organizationId, request.user.organizationId), isNull(schema.departments.deletedAt)))
      .orderBy(asc(schema.departments.name));

    const query = request.query as { tree?: string };
    if (query.tree !== 'true') return ok(rows);

    const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] as unknown[] }]));
    const roots: unknown[] = [];
    for (const row of byId.values()) {
      const parent = row.parentId ? byId.get(row.parentId) : null;
      if (parent) parent.children.push(row);
      else roots.push(row);
    }
    return ok(roots);
  });

  app.post('/api/departments',
    { onRequest: [requireAuth, requirePermission(PERMISSION.ORG_MANAGE)] },
    async (request) => {
      const body = departmentSchema.parse(request.body);
      const [created] = await db.insert(schema.departments).values({
        organizationId: request.user.organizationId,
        name: body.name, code: body.code ?? null, parentId: body.parentId ?? null,
      }).returning();
      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'settings_change',
        entityType: 'department', entityId: created.id, details: `создано подразделение «${body.name}»` });
      return ok(created);
    });

  app.patch('/api/departments/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.ORG_MANAGE)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = departmentSchema.partial().parse(request.body);
      if (body.parentId === id) throw ValidationError('Подразделение не может быть родителем самому себе.');
      const [updated] = await db.update(schema.departments)
        .set({ name: body.name, code: body.code ?? null, parentId: body.parentId ?? null })
        .where(and(eq(schema.departments.id, id), eq(schema.departments.organizationId, request.user.organizationId)))
        .returning();
      if (!updated) throw NotFound('Подразделение не найдено.');
      return ok(updated);
    });

  app.delete('/api/departments/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.ORG_MANAGE)] },
    async (request) => {
      const { id } = request.params as { id: string };
      await db.update(schema.departments).set({ deletedAt: new Date() })
        .where(and(eq(schema.departments.id, id), eq(schema.departments.organizationId, request.user.organizationId)));
      return ok({ deleted: true });
    });

  /* ---------- Должности и профессии ---------- */

  for (const [path, table, label] of [
    ['positions', schema.positions, 'должность'],
    ['professions', schema.professions, 'профессия'],
  ] as const) {
    app.get(`/api/${path}`, { onRequest: requireAuth }, async (request) => {
      const rows = await db.select().from(table)
        .where(and(eq(table.organizationId, request.user.organizationId), isNull(table.deletedAt)))
        .orderBy(asc(table.name));
      return ok(rows);
    });

    app.post(`/api/${path}`,
      { onRequest: [requireAuth, requirePermission(PERMISSION.ORG_MANAGE)] },
      async (request) => {
        const body = referenceSchema.parse(request.body);
        const [created] = await db.insert(table)
          .values({ organizationId: request.user.organizationId, name: body.name }).returning();
        await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
          actorLabel: request.user.fullName, action: 'settings_change', details: `создана ${label} «${body.name}»` });
        return ok(created);
      });

    app.patch(`/api/${path}/:id`,
      { onRequest: [requireAuth, requirePermission(PERMISSION.ORG_MANAGE)] },
      async (request) => {
        const { id } = request.params as { id: string };
        const body = referenceSchema.parse(request.body);
        const [updated] = await db.update(table).set({ name: body.name })
          .where(and(eq(table.id, id), eq(table.organizationId, request.user.organizationId))).returning();
        if (!updated) throw NotFound('Запись не найдена.');
        return ok(updated);
      });

    app.delete(`/api/${path}/:id`,
      { onRequest: [requireAuth, requirePermission(PERMISSION.ORG_MANAGE)] },
      async (request) => {
        const { id } = request.params as { id: string };
        await db.update(table).set({ deletedAt: new Date() })
          .where(and(eq(table.id, id), eq(table.organizationId, request.user.organizationId)));
        return ok({ deleted: true });
      });
  }
}
