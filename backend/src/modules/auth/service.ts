import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { ROLE_CABINET } from '@tbedu/shared';
import type { CurrentUser } from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { config } from '../../core/config.js';
import { hashPassword, verifyPassword } from '../../core/password.js';
import { randomToken, sha256 } from '../../core/crypto.js';
import { effectivePermissions, userRoleCodes } from '../../core/rbac.js';
import { AppError, Unauthorized, ValidationError, RateLimited } from '../../core/errors.js';
import { logAudit } from '../../core/audit.js';

export const SESSION_COOKIE = 'tbedu_sid';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

/* Ограничение попыток входа (§66 ТЗ).
   В прототипе счётчик жил в памяти процесса и обнулялся при рестарте —
   здесь он в базе и переживает перезапуск. */
async function tooManyFailures(ip: string): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.loginAttempts)
    .where(
      and(
        eq(schema.loginAttempts.ip, ip),
        eq(schema.loginAttempts.succeeded, false),
        gte(schema.loginAttempts.createdAt, since),
      ),
    );
  return (rows[0]?.count ?? 0) >= LOGIN_MAX_FAILURES;
}

async function noteAttempt(ip: string, login: string, succeeded: boolean): Promise<void> {
  await db.insert(schema.loginAttempts).values({ ip, login: login.slice(0, 100), succeeded });
}

export interface LoginContext {
  ip: string;
  userAgent?: string;
}

export async function login(loginName: string, password: string, ctx: LoginContext) {
  const normalized = String(loginName || '').trim().toLowerCase();

  if (await tooManyFailures(ctx.ip)) {
    throw RateLimited('Слишком много неудачных попыток входа. Подождите 15 минут.');
  }

  const rows = await db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.login, normalized), isNull(schema.users.deletedAt)))
    .limit(1);

  const user = rows[0];
  /* Одно и то же сообщение при неверном логине и при неверном пароле:
     иначе форма входа подсказывает, какие логины существуют. */
  const invalid = 'Неверный логин или пароль.';

  if (!user) {
    await noteAttempt(ctx.ip, normalized, false);
    await logAudit({ organizationId: null, action: 'login_failed', details: `неизвестный логин «${normalized}»`, ip: ctx.ip });
    throw new AppError('UNAUTHORIZED', invalid, 401);
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    await noteAttempt(ctx.ip, normalized, false);
    await logAudit({
      organizationId: user.organizationId, actorUserId: user.id, actorLabel: user.fullName,
      action: 'login_failed', details: 'неверный пароль', ip: ctx.ip,
    });
    throw new AppError('UNAUTHORIZED', invalid, 401);
  }

  if (!user.isActive) {
    await noteAttempt(ctx.ip, normalized, false);
    throw new AppError('FORBIDDEN', 'Учётная запись заблокирована. Обратитесь к администратору.', 403);
  }

  await noteAttempt(ctx.ip, normalized, true);

  const token = randomToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlMs);
  await db.insert(schema.sessions).values({
    userId: user.id,
    tokenHash: sha256(token),
    ip: ctx.ip,
    userAgent: ctx.userAgent?.slice(0, 300) ?? null,
    expiresAt,
  });

  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));

  await logAudit({
    organizationId: user.organizationId, actorUserId: user.id, actorLabel: user.fullName,
    action: 'login', ip: ctx.ip, userAgent: ctx.userAgent,
  });

  return { token, expiresAt, user };
}

export interface SessionUser {
  userId: string;
  organizationId: string;
  login: string;
  fullName: string;
  mustChangePassword: boolean;
  permissions: string[];
  roles: string[];
  employeeId: string | null;
  sessionId: string;
}

export async function resolveSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;

  const rows = await db
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.tokenHash, sha256(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.session.revokedAt) return null;
  if (row.session.expiresAt.getTime() < Date.now()) return null;
  if (!row.user.isActive || row.user.deletedAt) return null;

  /* Скользящий срок: активная работа не выбрасывает из кабинета. */
  if (row.session.expiresAt.getTime() - Date.now() < config.sessionTtlMs / 2) {
    await db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() + config.sessionTtlMs) })
      .where(eq(schema.sessions.id, row.session.id));
  }

  const [permissions, roles, employee] = await Promise.all([
    effectivePermissions(row.user.id),
    userRoleCodes(row.user.id),
    db
      .select({ id: schema.employeeProfiles.id })
      .from(schema.employeeProfiles)
      .where(eq(schema.employeeProfiles.userId, row.user.id))
      .limit(1),
  ]);

  return {
    userId: row.user.id,
    organizationId: row.user.organizationId,
    login: row.user.login,
    fullName: row.user.fullName,
    mustChangePassword: row.user.mustChangePassword,
    permissions,
    roles,
    employeeId: employee[0]?.id ?? null,
    sessionId: row.session.id,
  };
}

export async function logout(sessionId: string): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.sessions.id, sessionId));
}

export async function changePassword(
  user: SessionUser,
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, user.userId)).limit(1);
  const record = rows[0];
  if (!record) throw Unauthorized();

  if (!(await verifyPassword(oldPassword, record.passwordHash))) {
    throw ValidationError('Текущий пароль указан неверно.', [
      { field: 'oldPassword', message: 'Неверный пароль' },
    ]);
  }
  if (String(newPassword).length < 8) {
    throw ValidationError('Новый пароль должен содержать не менее 8 символов.', [
      { field: 'newPassword', message: 'Не менее 8 символов' },
    ]);
  }
  if (oldPassword === newPassword) {
    throw ValidationError('Новый пароль должен отличаться от текущего.');
  }

  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(newPassword), mustChangePassword: false, updatedAt: new Date() })
    .where(eq(schema.users.id, user.userId));

  /* Остальные сессии завершаются: старый пароль больше ничего не открывает. */
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.sessions.userId, user.userId), sql`${schema.sessions.id} <> ${user.sessionId}`));

  await logAudit({
    organizationId: user.organizationId, actorUserId: user.userId, actorLabel: user.fullName,
    action: 'password_changed',
  });
}

/* Полный профиль для фронтенда: что показывать и что разрешено (§8 ТЗ). */
export async function currentUser(session: SessionUser): Promise<CurrentUser> {
  const [userRows, orgRows] = await Promise.all([
    db.select().from(schema.users).where(eq(schema.users.id, session.userId)).limit(1),
    db.select().from(schema.organizations).where(eq(schema.organizations.id, session.organizationId)).limit(1),
  ]);

  const user = userRows[0];
  const org = orgRows[0];

  const primaryRole = session.roles[0] ?? 'EMPLOYEE';
  const cabinet = ROLE_CABINET[primaryRole] ?? 'employee';

  const modules = await db
    .select({
      code: schema.uiModules.code,
      title: schema.uiModules.title,
      route: schema.uiModules.route,
      cabinet: schema.uiModules.cabinet,
      sortOrder: schema.uiModules.sortOrder,
      isVisible: schema.uiModuleVisibility.isVisible,
      isCore: schema.uiModules.isCore,
    })
    .from(schema.uiModules)
    .leftJoin(
      schema.uiModuleVisibility,
      and(
        eq(schema.uiModuleVisibility.uiModuleId, schema.uiModules.id),
        eq(schema.uiModuleVisibility.organizationId, session.organizationId),
      ),
    )
    .where(eq(schema.uiModules.cabinet, cabinet));

  const visible = modules
    .filter((m) => m.isCore || m.isVisible !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((m) => ({ code: m.code, title: m.title, route: m.route, cabinet: m.cabinet }));

  const pages = await db
    .select({ slug: schema.uiPages.slug, title: schema.uiPages.title, cabinets: schema.uiPages.cabinets })
    .from(schema.uiPages)
    .where(and(eq(schema.uiPages.organizationId, session.organizationId), eq(schema.uiPages.isActive, true)));

  return {
    user: {
      id: user.id,
      login: user.login,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
    },
    organization: { id: org.id, name: org.name },
    roles: session.roles,
    permissions: session.permissions,
    cabinet,
    employeeId: session.employeeId,
    uiModules: visible,
    customPages: pages
      .filter((p) => (p.cabinets as string[]).includes(cabinet))
      .map((p) => ({ slug: p.slug, title: p.title, cabinets: p.cabinets as string[] })),
    mustChangePassword: session.mustChangePassword,
  };
}
