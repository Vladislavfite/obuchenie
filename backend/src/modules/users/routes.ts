import type { FastifyInstance } from 'fastify';
import { and, eq, isNull, sql, desc, inArray, ilike, or } from 'drizzle-orm';
import {
  createUserSchema, paginationSchema, PERMISSION, PERMISSION_META,
  ROLE, ROLE_TITLES, suggestLogin,
} from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { ok, paginated } from '../../core/response.js';
import { requireAuth, requirePermission } from '../../core/context.js';
import { Conflict, NotFound, ValidationError, Forbidden } from '../../core/errors.js';
import { hashPassword, generateTempPassword } from '../../core/password.js';
import { logAudit } from '../../core/audit.js';

async function rolesByCodes(organizationId: string, codes: string[]) {
  const rows = await db
    .select()
    .from(schema.roles)
    .where(
      and(
        or(eq(schema.roles.organizationId, organizationId), isNull(schema.roles.organizationId)),
        inArray(schema.roles.code, codes),
      ),
    );
  if (rows.length !== codes.length) {
    const found = new Set(rows.map((r) => r.code));
    const missing = codes.filter((c) => !found.has(c));
    throw ValidationError(`Неизвестные роли: ${missing.join(', ')}`);
  }
  return rows;
}

export async function usersRoutes(app: FastifyInstance) {
  /* ---------- Список и создание ---------- */

  app.get(
    '/api/users',
    { onRequest: [requireAuth, requirePermission(PERMISSION.USERS_EDIT, PERMISSION.EMPLOYEE_VIEW)] },
    async (request) => {
      const q = paginationSchema.extend({}).parse(request.query);
      const query = request.query as { role?: string; status?: string };

      const filters = [eq(schema.users.organizationId, request.user.organizationId), isNull(schema.users.deletedAt)];
      if (q.search) filters.push(or(ilike(schema.users.fullName, `%${q.search}%`), ilike(schema.users.login, `%${q.search}%`))!);
      if (query.status === 'active') filters.push(eq(schema.users.isActive, true));
      if (query.status === 'blocked') filters.push(eq(schema.users.isActive, false));

      const where = and(...filters);
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users).where(where);

      const rows = await db
        .select()
        .from(schema.users)
        .where(where)
        .orderBy(desc(schema.users.createdAt))
        .limit(q.limit)
        .offset((q.page - 1) * q.limit);

      const ids = rows.map((r) => r.id);
      const roleRows = ids.length
        ? await db
            .select({ userId: schema.userRoles.userId, code: schema.roles.code })
            .from(schema.userRoles)
            .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
            .where(inArray(schema.userRoles.userId, ids))
        : [];

      const rolesByUser = new Map<string, string[]>();
      for (const r of roleRows) {
        rolesByUser.set(r.userId, [...(rolesByUser.get(r.userId) ?? []), r.code]);
      }

      let data = rows.map((u) => ({
        id: u.id,
        login: u.login,
        fullName: u.fullName,
        email: u.email,
        phone: u.phone,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
        roles: rolesByUser.get(u.id) ?? [],
      }));

      if (query.role) data = data.filter((u) => u.roles.includes(query.role!));

      return paginated(data, q.page, q.limit, count);
    },
  );

  app.get(
    '/api/users/suggest-login',
    { onRequest: [requireAuth, requirePermission(PERMISSION.USERS_CREATE, PERMISSION.EMPLOYEE_EDIT)] },
    async (request) => {
      const { fullName } = request.query as { fullName?: string };
      const taken = await db
        .select({ login: schema.users.login })
        .from(schema.users)
        .where(eq(schema.users.organizationId, request.user.organizationId));
      return ok({ login: suggestLogin(fullName ?? '', taken.map((t) => t.login)) });
    },
  );

  app.post(
    '/api/users',
    { onRequest: [requireAuth, requirePermission(PERMISSION.USERS_CREATE)] },
    async (request) => {
      const body = createUserSchema.parse(request.body);

      /* Выдать роль выше собственной нельзя: иначе администратор организации
         мог бы создать суперадминистратора и выйти за пределы своей зоны. */
      if (body.roleCodes.includes(ROLE.SUPER_ADMIN) && !request.user.roles.includes(ROLE.SUPER_ADMIN)) {
        throw Forbidden('Роль SUPER_ADMIN может выдавать только суперадминистратор.');
      }

      const existing = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.organizationId, request.user.organizationId), eq(schema.users.login, body.login)))
        .limit(1);
      if (existing.length) throw Conflict('Этот логин уже используется. Выберите другой.');

      const roleRows = await rolesByCodes(request.user.organizationId, body.roleCodes);

      const created = await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(schema.users)
          .values({
            organizationId: request.user.organizationId,
            login: body.login,
            email: body.email || null,
            phone: body.phone || null,
            fullName: body.fullName,
            passwordHash: await hashPassword(body.password),
            mustChangePassword: true,
          })
          .returning();

        await tx.insert(schema.userRoles).values(
          roleRows.map((r) => ({ userId: user.id, roleId: r.id, grantedBy: request.user.userId })),
        );

        /* Профиль по типу роли: руководителю — manager_profile,
           сотруднику — employee_profile. */
        if (body.roleCodes.includes(ROLE.EMPLOYEE)) {
          await tx.insert(schema.employeeProfiles).values({
            userId: user.id,
            organizationId: request.user.organizationId,
            departmentId: body.departmentId ?? null,
            positionId: body.positionId ?? null,
          });
        } else if (!body.roleCodes.includes(ROLE.ADMIN) && !body.roleCodes.includes(ROLE.SUPER_ADMIN)) {
          await tx.insert(schema.managerProfiles).values({
            userId: user.id,
            organizationId: request.user.organizationId,
            departmentId: body.departmentId ?? null,
            positionId: body.positionId ?? null,
          });
        }

        return user;
      });

      await logAudit({
        organizationId: request.user.organizationId,
        actorUserId: request.user.userId,
        actorLabel: request.user.fullName,
        action: 'user_created',
        entityType: 'user',
        entityId: created.id,
        details: `${body.fullName} · логин ${body.login} · ${body.roleCodes.join(', ')}`,
        ip: request.ip,
      });

      return ok({ id: created.id, login: created.login, fullName: created.fullName, mustChangePassword: true });
    },
  );

  app.get(
    '/api/users/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.USERS_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const rows = await db
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.id, id), eq(schema.users.organizationId, request.user.organizationId)))
        .limit(1);
      if (!rows[0]) throw NotFound('Пользователь не найден.');

      const roleRows = await db
        .select({ code: schema.roles.code, id: schema.roles.id })
        .from(schema.userRoles)
        .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
        .where(eq(schema.userRoles.userId, id));

      const overrides = await db
        .select({ code: schema.permissions.code, effect: schema.userPermissions.effect })
        .from(schema.userPermissions)
        .innerJoin(schema.permissions, eq(schema.permissions.id, schema.userPermissions.permissionId))
        .where(eq(schema.userPermissions.userId, id));

      const { passwordHash, ...safe } = rows[0];
      return ok({ ...safe, roles: roleRows, permissionOverrides: overrides });
    },
  );

  app.patch(
    '/api/users/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.USERS_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { fullName?: string; email?: string; phone?: string };
      const [updated] = await db
        .update(schema.users)
        .set({
          fullName: body.fullName?.trim() || undefined,
          email: body.email !== undefined ? body.email || null : undefined,
          phone: body.phone !== undefined ? body.phone || null : undefined,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.users.id, id), eq(schema.users.organizationId, request.user.organizationId)))
        .returning();
      if (!updated) throw NotFound('Пользователь не найден.');
      await logAudit({
        organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'user_updated', entityType: 'user', entityId: id,
      });
      const { passwordHash, ...safe } = updated;
      return ok(safe);
    },
  );

  for (const [suffix, active, action] of [
    ['block', false, 'user_blocked'],
    ['unblock', true, 'user_updated'],
  ] as const) {
    app.post(
      `/api/users/:id/${suffix}`,
      { onRequest: [requireAuth, requirePermission(PERMISSION.USERS_BLOCK)] },
      async (request) => {
        const { id } = request.params as { id: string };
        if (id === request.user.userId) throw ValidationError('Нельзя заблокировать собственную учётную запись.');
        const [updated] = await db
          .update(schema.users)
          .set({ isActive: active, updatedAt: new Date() })
          .where(and(eq(schema.users.id, id), eq(schema.users.organizationId, request.user.organizationId)))
          .returning();
        if (!updated) throw NotFound('Пользователь не найден.');
        if (!active) {
          /* Блокировка обрывает все активные сессии сразу. */
          await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.userId, id));
        }
        await logAudit({
          organizationId: request.user.organizationId, actorUserId: request.user.userId,
          actorLabel: request.user.fullName, action, entityType: 'user', entityId: id,
          details: updated.fullName,
        });
        return ok({ id, isActive: active });
      },
    );
  }

  app.post(
    '/api/users/:id/reset-password',
    { onRequest: [requireAuth, requirePermission(PERMISSION.USERS_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const tempPassword = generateTempPassword();
      const [updated] = await db
        .update(schema.users)
        .set({ passwordHash: await hashPassword(tempPassword), mustChangePassword: true, updatedAt: new Date() })
        .where(and(eq(schema.users.id, id), eq(schema.users.organizationId, request.user.organizationId)))
        .returning();
      if (!updated) throw NotFound('Пользователь не найден.');
      await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.userId, id));
      await logAudit({
        organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'password_reset', entityType: 'user', entityId: id,
        details: updated.fullName,
      });
      /* Временный пароль показывается один раз — в ответе на это действие. */
      return ok({ tempPassword, mustChangePassword: true });
    },
  );

  app.put(
    '/api/users/:id/roles',
    { onRequest: [requireAuth, requirePermission(PERMISSION.USERS_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { roleCodes: string[] };
      if (!Array.isArray(body.roleCodes) || body.roleCodes.length === 0) {
        throw ValidationError('Выберите хотя бы одну роль.');
      }
      if (body.roleCodes.includes(ROLE.SUPER_ADMIN) && !request.user.roles.includes(ROLE.SUPER_ADMIN)) {
        throw Forbidden('Роль SUPER_ADMIN может выдавать только суперадминистратор.');
      }
      const roleRows = await rolesByCodes(request.user.organizationId, body.roleCodes);
      await db.transaction(async (tx) => {
        await tx.delete(schema.userRoles).where(eq(schema.userRoles.userId, id));
        await tx.insert(schema.userRoles).values(
          roleRows.map((r) => ({ userId: id, roleId: r.id, grantedBy: request.user.userId })),
        );
      });
      await logAudit({
        organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'user_roles_changed', entityType: 'user', entityId: id,
        details: body.roleCodes.join(', '),
      });
      return ok({ roles: body.roleCodes });
    },
  );

  app.put(
    '/api/users/:id/permissions',
    { onRequest: [requireAuth, requirePermission(PERMISSION.USERS_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { allow?: string[]; deny?: string[] };
      const codes = [...(body.allow ?? []), ...(body.deny ?? [])];
      const perms = codes.length
        ? await db.select().from(schema.permissions).where(inArray(schema.permissions.code, codes))
        : [];
      const byCode = new Map(perms.map((p) => [p.code, p.id]));

      await db.transaction(async (tx) => {
        await tx.delete(schema.userPermissions).where(eq(schema.userPermissions.userId, id));
        const values = [
          ...(body.allow ?? []).map((c) => ({ userId: id, permissionId: byCode.get(c)!, effect: 'allow' })),
          ...(body.deny ?? []).map((c) => ({ userId: id, permissionId: byCode.get(c)!, effect: 'deny' })),
        ].filter((v) => v.permissionId);
        if (values.length) await tx.insert(schema.userPermissions).values(values);
      });
      return ok({ allow: body.allow ?? [], deny: body.deny ?? [] });
    },
  );

  /* ---------- Роли и справочник прав ---------- */

  app.get('/api/roles', { onRequest: requireAuth }, async (request) => {
    const rows = await db
      .select()
      .from(schema.roles)
      .where(or(eq(schema.roles.organizationId, request.user.organizationId), isNull(schema.roles.organizationId)));

    const perms = await db
      .select({ roleId: schema.rolePermissions.roleId, code: schema.permissions.code })
      .from(schema.rolePermissions)
      .innerJoin(schema.permissions, eq(schema.permissions.id, schema.rolePermissions.permissionId));

    const byRole = new Map<string, string[]>();
    for (const p of perms) byRole.set(p.roleId, [...(byRole.get(p.roleId) ?? []), p.code]);

    return ok(rows.map((r) => ({ ...r, title: ROLE_TITLES[r.code] ?? r.name, permissions: byRole.get(r.id) ?? [] })));
  });

  app.get('/api/permissions', { onRequest: requireAuth }, async () => {
    const rows = await db.select().from(schema.permissions);
    return ok(
      rows.map((p) => ({
        code: p.code,
        group: PERMISSION_META[p.code]?.group ?? p.groupName,
        title: PERMISSION_META[p.code]?.title ?? p.description ?? p.code,
      })),
    );
  });

  app.put(
    '/api/roles/:id/permissions',
    { onRequest: [requireAuth, requirePermission(PERMISSION.USERS_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { permissionCodes: string[] };
      const perms = body.permissionCodes?.length
        ? await db.select().from(schema.permissions).where(inArray(schema.permissions.code, body.permissionCodes))
        : [];
      await db.transaction(async (tx) => {
        await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, id));
        if (perms.length) {
          await tx.insert(schema.rolePermissions).values(perms.map((p) => ({ roleId: id, permissionId: p.id })));
        }
      });
      await logAudit({
        organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'role_permissions_changed', entityType: 'role', entityId: id,
        details: `${perms.length} прав`,
      });
      return ok({ permissions: perms.map((p) => p.code) });
    },
  );

  /* ---------- Руководители (§12 ТЗ) ---------- */

  app.get(
    '/api/managers',
    { onRequest: [requireAuth, requirePermission(PERMISSION.USERS_EDIT)] },
    async (request) => {
      const rows = await db
        .select({
          id: schema.users.id,
          fullName: schema.users.fullName,
          login: schema.users.login,
          email: schema.users.email,
          phone: schema.users.phone,
          isActive: schema.users.isActive,
          lastLoginAt: schema.users.lastLoginAt,
          profileId: schema.managerProfiles.id,
          departmentId: schema.managerProfiles.departmentId,
          positionId: schema.managerProfiles.positionId,
        })
        .from(schema.managerProfiles)
        .innerJoin(schema.users, eq(schema.users.id, schema.managerProfiles.userId))
        .where(
          and(
            eq(schema.managerProfiles.organizationId, request.user.organizationId),
            isNull(schema.users.deletedAt),
          ),
        );
      return ok(rows);
    },
  );

  app.put(
    '/api/managers/:id/departments',
    { onRequest: [requireAuth, requirePermission(PERMISSION.USERS_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { departmentIds: string[]; includeChildren?: boolean };

      const profile = await db
        .select()
        .from(schema.managerProfiles)
        .where(
          and(eq(schema.managerProfiles.userId, id), eq(schema.managerProfiles.organizationId, request.user.organizationId)),
        )
        .limit(1);
      if (!profile[0]) throw NotFound('Профиль руководителя не найден.');

      await db.transaction(async (tx) => {
        await tx.delete(schema.managerDepartments).where(eq(schema.managerDepartments.managerProfileId, profile[0].id));
        if (body.departmentIds?.length) {
          await tx.insert(schema.managerDepartments).values(
            body.departmentIds.map((departmentId) => ({
              managerProfileId: profile[0].id,
              departmentId,
              includeChildren: body.includeChildren !== false,
            })),
          );
        }
      });
      return ok({ departmentIds: body.departmentIds ?? [] });
    },
  );
}
