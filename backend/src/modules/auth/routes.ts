import type { FastifyInstance } from 'fastify';
import { and, eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { Forbidden } from '../../core/errors.js';
import { loginBodySchema, changePasswordSchema } from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { config } from '../../core/config.js';
import { ok } from '../../core/response.js';
import { requireAuth } from '../../core/context.js';
import { logAudit } from '../../core/audit.js';
import * as service from './service.js';
import { SESSION_COOKIE } from './service.js';

function cookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: maxAgeSec,
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/api/auth/login',
    {
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
      schema: {
        tags: ['auth'],
        summary: 'Вход в систему',
        body: { type: 'object', required: ['login', 'password'], properties: { login: { type: 'string' }, password: { type: 'string' }, cabinet: { type: 'string', enum: ['admin', 'manager', 'employee'] } } },
      },
    },
    async (request, reply) => {
      const body = loginBodySchema.extend({ cabinet: z.enum(['admin', 'manager', 'employee']).optional() }).parse(request.body);
      const result = await service.login(body.login, body.password, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });

      const session = await service.resolveSession(result.token);
      const current = await service.currentUser(session!);
      if (body.cabinet && current.cabinet !== body.cabinet) {
        await service.logout(session!.sessionId);
        throw Forbidden('Эта учётная запись относится к другому кабинету. Выберите нужный кабинет.');
      }
      reply.setCookie(SESSION_COOKIE, result.token, cookieOptions(Math.floor(config.sessionTtlMs / 1000)));
      return ok(current);
    },
  );

  app.post('/api/auth/logout', { schema: { tags: ['auth'], summary: 'Выход' } }, async (request, reply) => {
    if (request.session) {
      await service.logout(request.session.sessionId);
      try { await logAudit({
        organizationId: request.session.organizationId,
        actorUserId: request.session.userId,
        actorLabel: request.session.fullName,
        action: 'logout',
        ip: request.ip,
      }); } catch (error) { request.log.error(error, 'Не удалось записать выход в журнал'); }
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return ok({ loggedOut: true });
  });

  app.get(
    '/api/auth/me',
    { onRequest: requireAuth, schema: { tags: ['auth'], summary: 'Текущий пользователь, роли и права' } },
    async (request) => ok(await service.currentUser(request.user)),
  );

  app.post(
    '/api/auth/change-password',
    { onRequest: requireAuth, schema: { tags: ['auth'], summary: 'Смена пароля' } },
    async (request) => {
      const body = changePasswordSchema.parse(request.body);
      await service.changePassword(request.user, body.oldPassword, body.newPassword);
      return ok({ changed: true });
    },
  );

  app.get(
    '/api/auth/sessions',
    { onRequest: requireAuth, schema: { tags: ['auth'], summary: 'Активные сессии' } },
    async (request) => {
      const rows = await db
        .select({
          id: schema.sessions.id,
          ip: schema.sessions.ip,
          userAgent: schema.sessions.userAgent,
          createdAt: schema.sessions.createdAt,
          expiresAt: schema.sessions.expiresAt,
        })
        .from(schema.sessions)
        .where(and(eq(schema.sessions.userId, request.user.userId)))
        .orderBy(desc(schema.sessions.createdAt))
        .limit(20);
      return ok(rows.map((r) => ({ ...r, current: r.id === request.user.sessionId })));
    },
  );

  app.delete(
    '/api/auth/sessions/:id',
    { onRequest: requireAuth, schema: { tags: ['auth'], summary: 'Завершить сессию' } },
    async (request) => {
      const { id } = request.params as { id: string };
      await db
        .update(schema.sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.sessions.id, id), eq(schema.sessions.userId, request.user.userId)));
      return ok({ revoked: true });
    },
  );
}
