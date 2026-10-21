import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { Unauthorized, Forbidden } from './errors.js';
import { resolveSession, SESSION_COOKIE, type SessionUser } from '../modules/auth/service.js';
import { visibleDepartmentIds } from './rbac.js';
import { ROLE } from '@tbedu/shared';

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionUser | null;
    /* Гарантированно непустой пользователь — только после requireAuth. */
    user: SessionUser;
  }
}

/* Контекст доступа к данным. Изоляция реализуется здесь, а не в обработчиках:
   обработчик не может «забыть» проверку, потому что репозиторий требует scope. */
export interface AccessScope {
  organizationId: string;
  userId: string;
  /* null — ограничений по подразделениям нет (администратор или руководитель
     без заданной зоны). Пустой массив — не видит ничего. */
  departmentIds: string[] | null;
  isAdmin: boolean;
  employeeId: string | null;
  permissions: string[];
}

export async function buildScope(user: SessionUser): Promise<AccessScope> {
  const isAdmin = user.roles.includes(ROLE.ADMIN) || user.roles.includes(ROLE.SUPER_ADMIN);
  const isEmployeeOnly = user.roles.length > 0 && user.roles.every((r) => r === ROLE.EMPLOYEE);

  let departmentIds: string[] | null = null;
  if (!isAdmin && !isEmployeeOnly) {
    departmentIds = await visibleDepartmentIds(user.userId, user.organizationId);
  }

  return {
    organizationId: user.organizationId,
    userId: user.userId,
    departmentIds,
    isAdmin,
    employeeId: user.employeeId,
    permissions: user.permissions,
  };
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('session', null);
  app.decorateRequest('user', null as unknown as SessionUser);

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const token = request.cookies?.[SESSION_COOKIE];
    request.session = await resolveSession(token);
    if (request.session) request.user = request.session;
  });
});

/* Хук обязательно асинхронный: синхронная функция без вызова done()
   заставляет Fastify ждать бесконечно. */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.session) throw Unauthorized();
}

/* Декларативная проверка права (§9 ТЗ).
   В обработчиках нет ни одной проверки вида if (role === 'manager'). */
export function requirePermission(...codes: string[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.session) throw Unauthorized();
    const has = codes.some((code) => request.session!.permissions.includes(code));
    if (!has) {
      throw Forbidden(`Недостаточно прав: требуется «${codes.join(' или ')}».`);
    }
  };
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.session) throw Unauthorized();
    if (!roles.some((r) => request.session!.roles.includes(r))) {
      throw Forbidden('Раздел доступен только администратору.');
    }
  };
}
