import type { FastifyInstance } from 'fastify';
import { checkDatabase } from '../../db/client.js';
import { config } from '../../core/config.js';
import { ok } from '../../core/response.js';

/* Проверка живости (§79 ТЗ). Платформы деплоя опрашивают этот адрес,
   чтобы понять, поднялось приложение или нет. */

export async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', { schema: { tags: ['system'], summary: 'Состояние сервиса' } }, async (_request, reply) => {
    const database = await checkDatabase();
    const payload = {
      status: database.ok ? 'ok' : 'degraded',
      version: config.version,
      env: config.env,
      uptimeSec: Math.round(process.uptime()),
      database: database.ok ? 'ok' : 'unavailable',
      timestamp: new Date().toISOString(),
    };
    if (!database.ok) reply.code(503);
    return ok(payload);
  });
}
