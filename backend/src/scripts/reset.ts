import readline from 'node:readline/promises';
import { sql } from 'drizzle-orm';
import { db, closeDatabase } from '../db/client.js';
import { config } from '../core/config.js';

/* Полная очистка базы. Операция необратима, поэтому требует подтверждения
   и запрещена в production. */

async function main() {
  if (config.isProduction) {
    console.error('Сброс базы запрещён при NODE_ENV=production.');
    process.exit(1);
  }

  const auto = process.argv.includes('--yes');
  if (!auto) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `Будут удалены ВСЕ данные из ${config.databaseUrl.replace(/:[^:@]+@/, ':***@')}.\nВведите «удалить» для подтверждения: `,
    );
    rl.close();
    if (answer.trim().toLowerCase() !== 'удалить') {
      console.log('Отменено.');
      await closeDatabase();
      return;
    }
  }

  await db.execute(sql`drop schema public cascade; create schema public;`);
  console.log('База очищена. Выполните npm run db:migrate и npm run db:seed.');
  await closeDatabase();
}

main().catch(async (error) => {
  console.error('Ошибка сброса:', error.message);
  await closeDatabase();
  process.exit(1);
});
