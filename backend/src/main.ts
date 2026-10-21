import { config } from './core/config.js';
import { buildServer } from './server.js';
import { closeDatabase, checkDatabase } from './db/client.js';

/* Точка входа. Один процесс отдаёт и API, и собранный фронтенд —
   так проще разворачивать: одна служба вместо двух. */

async function main() {
  const app = await buildServer();

  const database = await checkDatabase();
  if (!database.ok) {
    app.log.error(`Нет соединения с базой данных: ${database.message}`);
    app.log.error('Проверьте DATABASE_URL и запустите npm run db:migrate.');
  }

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`TBEDU LMS ${config.version} слушает http://${config.host}:${config.port}`);
  if (!config.isProduction) app.log.info(`Документация API: http://localhost:${config.port}/api/docs`);

  const shutdown = async (signal: string) => {
    app.log.info(`Получен ${signal}, завершаю работу.`);
    await app.close();
    await closeDatabase();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Не удалось запустить сервер:', error);
  process.exit(1);
});
