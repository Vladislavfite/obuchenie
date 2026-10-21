
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, closeDatabase } from '../db/client.js';

async function main() {
  console.log('Применяю миграции базы данных…');

  const migrationsFolder = fileURLToPath(
    new URL('../../src/db/migrations', import.meta.url)
  );

  await migrate(db, { migrationsFolder });

  console.log('Миграции применены.');
  await closeDatabase();
}

main().catch(async (error) => {
  console.error('Ошибка миграции:', error);
  await closeDatabase();
  process.exit(1);
});
