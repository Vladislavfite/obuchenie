import type { FastifyInstance } from 'fastify';
import { and, eq, desc, sql } from 'drizzle-orm';
import { onecSettingsSchema, onecSyncSchema, PERMISSION, suggestLogin, slugify } from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { ok } from '../../core/response.js';
import { requireAuth, requirePermission, requireRole } from '../../core/context.js';
import { encryptSecret, decryptSecret } from '../../core/crypto.js';
import { hashPassword, generateTempPassword } from '../../core/password.js';
import { NotFound, IntegrationError } from '../../core/errors.js';
import { logAudit } from '../../core/audit.js';
import { createTransport, pick, type OnecPayload } from './transport.js';

/* Синхронизация с 1С (§44–§46 ТЗ).

   Главное правило: синхронизация идемпотентна. Сопоставление идёт по
   external_id (GUID из 1С), поэтому повторный запуск обновляет записи,
   а не создаёт дубликаты. Сотрудники, пропавшие из выгрузки, НЕ удаляются —
   только помечаются, потому что за ними стоит история обучения. */

export async function onecRoutes(app: FastifyInstance) {
  app.get('/api/integrations/1c',
    { onRequest: [requireAuth, requirePermission(PERMISSION.INTEGRATION_ONEC), requireRole('ADMIN', 'SUPER_ADMIN')] },
    async (request) => {
      const rows = await db.select().from(schema.integrations)
        .where(and(eq(schema.integrations.organizationId, request.user.organizationId),
                   eq(schema.integrations.kind, '1c'))).limit(1);
      if (!rows[0]) {
        return ok({ configured: false, transport: 'http_service', isEnabled: false });
      }
      const { credentialsEnc, credentialsIv, credentialsTag, ...safe } = rows[0];
      return ok({ configured: true, ...safe, hasCredentials: !!credentialsEnc });
    });

  app.put('/api/integrations/1c',
    { onRequest: [requireAuth, requirePermission(PERMISSION.INTEGRATION_ONEC), requireRole('ADMIN', 'SUPER_ADMIN')] },
    async (request) => {
      const body = onecSettingsSchema.parse(request.body);

      /* Учётные данные шифруются так же, как ключи ИИ. */
      let enc = null;
      if (body.username || body.password || body.token) {
        enc = encryptSecret(JSON.stringify({
          authType: body.authType, username: body.username, password: body.password, token: body.token,
        }));
      }

      const values = {
        organizationId: request.user.organizationId,
        kind: '1c',
        transport: body.transport,
        baseUrl: body.baseUrl ?? null,
        authType: body.authType,
        scheduleCron: body.scheduleCron ?? null,
        isEnabled: body.isEnabled,
        ...(enc ? { credentialsEnc: enc.ciphertext, credentialsIv: enc.iv, credentialsTag: enc.authTag } : {}),
      };

      await db.insert(schema.integrations).values(values).onConflictDoUpdate({
        target: [schema.integrations.organizationId, schema.integrations.kind],
        set: values,
      });

      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'onec_settings_changed',
        details: `способ обмена: ${body.transport}` });
      return ok({ saved: true });
    });

  app.post('/api/integrations/1c/sync',
    { onRequest: [requireAuth, requirePermission(PERMISSION.INTEGRATION_ONEC), requireRole('ADMIN', 'SUPER_ADMIN')] },
    async (request) => {
      const body = onecSyncSchema.parse(request.body ?? {});
      const orgId = request.user.organizationId;

      const rows = await db.select().from(schema.integrations)
        .where(and(eq(schema.integrations.organizationId, orgId), eq(schema.integrations.kind, '1c'))).limit(1);
      const integration = rows[0];
      if (!integration) throw NotFound('Интеграция с 1С не настроена.');

      let creds = { authType: integration.authType ?? 'none' };
      if (integration.credentialsEnc) {
        try {
          creds = JSON.parse(decryptSecret({
            ciphertext: integration.credentialsEnc,
            iv: integration.credentialsIv!,
            authTag: integration.credentialsTag!,
          }));
        } catch {
          throw IntegrationError('Не удалось расшифровать учётные данные 1С. Введите их заново.');
        }
      }

      const [log] = await db.insert(schema.integrationSyncLogs).values({
        integrationId: integration.id,
        syncType: body.types.join(','),
        status: 'running',
        triggeredBy: request.user.userId,
      }).returning();

      const counters = { received: 0, created: 0, updated: 0, skipped: 0, errors: 0 };
      const errors: Array<{ type: string; externalId: string; message: string }> = [];

      try {
        const transport = createTransport(
          integration.transport, integration.baseUrl, creds, body.payload as OnecPayload,
        );
        const payload = await transport.fetchData(body.types);

        /* ---- Справочники ---- */
        for (const [type, table] of [
          ['departments', schema.departments],
          ['positions', schema.positions],
          ['professions', schema.professions],
        ] as const) {
          if (!body.types.includes(type as never)) continue;
          const records = (payload as Record<string, unknown>)[type] as Array<Record<string, unknown>> | undefined;
          if (!records) continue;

          for (const record of records) {
            counters.received += 1;
            const externalId = pick(record, 'externalId', 'Ref_Key', 'Ссылка', 'Код', 'id');
            const name = pick(record, 'name', 'Description', 'Наименование', 'НаименованиеПолное');
            if (!externalId || !name) { counters.skipped += 1; continue; }

            try {
              if (body.dryRun) { counters.updated += 1; continue; }
              const existing = await db.select().from(table)
                .where(and(eq(table.organizationId, orgId), eq(table.externalId, externalId))).limit(1);

              if (existing[0]) {
                await db.update(table).set({ name, source: 'onec', syncedAt: new Date(), deletedAt: null })
                  .where(eq(table.id, existing[0].id));
                counters.updated += 1;
              } else {
                await db.insert(table).values({
                  organizationId: orgId, name, externalId, source: 'onec', syncedAt: new Date(),
                });
                counters.created += 1;
              }
            } catch (e) {
              counters.errors += 1;
              errors.push({ type, externalId, message: (e as Error).message });
            }
          }
        }

        /* ---- Сотрудники ---- */
        if (body.types.includes('employees') && payload.employees) {
          const [departments, positions, professions, existingLogins] = await Promise.all([
            db.select().from(schema.departments).where(eq(schema.departments.organizationId, orgId)),
            db.select().from(schema.positions).where(eq(schema.positions.organizationId, orgId)),
            db.select().from(schema.professions).where(eq(schema.professions.organizationId, orgId)),
            db.select({ login: schema.users.login }).from(schema.users).where(eq(schema.users.organizationId, orgId)),
          ]);
          const depByExt = new Map(departments.filter((d) => d.externalId).map((d) => [d.externalId!, d.id]));
          const posByExt = new Map(positions.filter((p) => p.externalId).map((p) => [p.externalId!, p.id]));
          const profByExt = new Map(professions.filter((p) => p.externalId).map((p) => [p.externalId!, p.id]));
          const takenLogins = existingLogins.map((u) => u.login);

          const employeeRole = await db.select().from(schema.roles)
            .where(eq(schema.roles.code, 'EMPLOYEE')).limit(1);

          for (const record of payload.employees as Array<Record<string, unknown>>) {
            counters.received += 1;
            const externalId = pick(record, 'externalId', 'Ref_Key', 'Ссылка', 'id');
            const fullName = pick(record, 'fullName', 'Description', 'Наименование', 'ФИО');
            if (!externalId || !fullName) { counters.skipped += 1; continue; }

            try {
              if (body.dryRun) { counters.updated += 1; continue; }

              const departmentId = depByExt.get(pick(record, 'departmentId', 'Подразделение_Key', 'ПодразделениеОрганизации_Key')) ?? null;
              const positionId = posByExt.get(pick(record, 'positionId', 'Должность_Key')) ?? null;
              const professionId = profByExt.get(pick(record, 'professionId', 'Профессия_Key')) ?? null;
              const personnelNumber = pick(record, 'personnelNumber', 'Код', 'ТабельныйНомер') || null;
              const hiredRaw = pick(record, 'hiredAt', 'ДатаПриема', 'ДатаПриемаНаРаботу');
              const hiredAt = /^\d{4}-\d{2}-\d{2}/.test(hiredRaw) ? hiredRaw.slice(0, 10) : null;

              const existing = await db.select().from(schema.employeeProfiles)
                .where(and(eq(schema.employeeProfiles.organizationId, orgId),
                           eq(schema.employeeProfiles.externalId, externalId))).limit(1);

              if (existing[0]) {
                await db.update(schema.employeeProfiles).set({
                  departmentId, positionId, professionId, personnelNumber, hiredAt,
                  qualification: pick(record, 'qualification', 'Квалификация', 'Разряд') || null,
                  source: 'onec', syncedAt: new Date(), updatedAt: new Date(),
                }).where(eq(schema.employeeProfiles.id, existing[0].id));
                await db.update(schema.users).set({ fullName, updatedAt: new Date() })
                  .where(eq(schema.users.id, existing[0].userId));
                counters.updated += 1;
              } else {
                const login = suggestLogin(fullName, takenLogins);
                takenLogins.push(login);
                const tempPassword = generateTempPassword();

                await db.transaction(async (tx) => {
                  const [user] = await tx.insert(schema.users).values({
                    organizationId: orgId, login, fullName,
                    email: pick(record, 'email', 'ЭлектроннаяПочта') || null,
                    phone: pick(record, 'phone', 'Телефон') || null,
                    passwordHash: await hashPassword(tempPassword),
                    mustChangePassword: true,
                  }).returning();

                  if (employeeRole[0]) {
                    await tx.insert(schema.userRoles).values({ userId: user.id, roleId: employeeRole[0].id });
                  }
                  await tx.insert(schema.employeeProfiles).values({
                    userId: user.id, organizationId: orgId, externalId,
                    personnelNumber, departmentId, positionId, professionId, hiredAt,
                    qualification: pick(record, 'qualification', 'Квалификация', 'Разряд') || null,
                    source: 'onec', syncedAt: new Date(),
                  });
                });
                counters.created += 1;
              }
            } catch (e) {
              counters.errors += 1;
              errors.push({ type: 'employees', externalId, message: (e as Error).message });
            }
          }
        }

        await db.update(schema.integrationSyncLogs).set({
          finishedAt: new Date(), status: counters.errors > 0 ? 'partial' : 'success',
          receivedCount: counters.received, createdCount: counters.created,
          updatedCount: counters.updated, skippedCount: counters.skipped,
          errorCount: counters.errors, errors: errors.slice(0, 100) as object,
        }).where(eq(schema.integrationSyncLogs.id, log.id));

        await db.update(schema.integrations)
          .set({ lastSyncAt: new Date(), lastStatus: counters.errors > 0 ? 'partial' : 'success' })
          .where(eq(schema.integrations.id, integration.id));

        await logAudit({ organizationId: orgId, actorUserId: request.user.userId,
          actorLabel: request.user.fullName, action: 'onec_sync',
          details: `получено ${counters.received}, создано ${counters.created}, обновлено ${counters.updated}, ошибок ${counters.errors}` });

        return ok({ ...counters, dryRun: body.dryRun, errors: errors.slice(0, 20), logId: log.id });
      } catch (e) {
        await db.update(schema.integrationSyncLogs).set({
          finishedAt: new Date(), status: 'error',
          errors: [{ message: (e as Error).message }] as object,
        }).where(eq(schema.integrationSyncLogs.id, log.id));
        throw e;
      }
    });

  app.get('/api/integrations/1c/logs',
    { onRequest: [requireAuth, requirePermission(PERMISSION.INTEGRATION_ONEC), requireRole('ADMIN', 'SUPER_ADMIN')] },
    async (request) => {
      const rows = await db.select({ log: schema.integrationSyncLogs })
        .from(schema.integrationSyncLogs)
        .innerJoin(schema.integrations, eq(schema.integrations.id, schema.integrationSyncLogs.integrationId))
        .where(eq(schema.integrations.organizationId, request.user.organizationId))
        .orderBy(desc(schema.integrationSyncLogs.startedAt)).limit(50);
      return ok(rows.map((r) => r.log));
    });
}
