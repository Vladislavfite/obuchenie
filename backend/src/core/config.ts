import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

/* .env ищем и рядом с backend, и в корне монорепозитория: при запуске
   через npm workspaces рабочий каталог отличается от того, где лежит файл. */
for (const candidate of [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
  path.resolve(process.cwd(), '../../.env'),
]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Не задана переменная окружения ${name}. Скопируйте .env.example в .env и заполните её.`);
  }
  return value;
}

const isProduction = process.env.NODE_ENV === 'production';

/* Секреты. В production слабые значения запрещены: система с ключом
   "change-me" в интернете — это отсутствие шифрования, а не шифрование. */
function secret(name: string, devFallback: string): string {
  const value = process.env[name] || (isProduction ? '' : devFallback);
  if (isProduction) {
    if (!value) throw new Error(`В production обязательна переменная ${name}.`);
    if (value.length < 32) throw new Error(`${name} должна содержать не менее 32 символов.`);
    if (value.startsWith('change-me')) throw new Error(`${name} осталась со значением из .env.example. Задайте собственное.`);
  }
  return value;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction,
  isTest: process.env.NODE_ENV === 'test',
  port: parseInt(process.env.PORT || '3000', 10),
  /* §77 ТЗ: слушать 0.0.0.0 и брать порт из окружения. */
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: required('DATABASE_URL', 'postgres://tbedu:tbedu@localhost:5432/tbedu'),
  sessionSecret: secret('SESSION_SECRET', 'dev-session-secret-not-for-production-use'),
  encryptionKey: secret('ENCRYPTION_KEY', 'dev-encryption-key-not-for-production-32'),
  corsOrigin: process.env.CORS_ORIGIN || '',
  logLevel: process.env.LOG_LEVEL || 'info',
  sessionTtlMs: 12 * 60 * 60 * 1000,
  bootstrap: {
    login: process.env.BOOTSTRAP_ADMIN_LOGIN || 'admin',
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin123',
    name: process.env.BOOTSTRAP_ADMIN_NAME || 'Администратор системы',
    orgName: process.env.BOOTSTRAP_ORG_NAME || 'Моя организация',
  },
  seedDemo: process.env.SEED_DEMO === 'true',
  files: {
    driver: (process.env.FILE_STORAGE || 'local') as 'local' | 's3',
    dir: process.env.FILE_STORAGE_DIR || './storage-data',
    s3: {
      endpoint: process.env.S3_ENDPOINT || '',
      region: process.env.S3_REGION || '',
      bucket: process.env.S3_BUCKET || '',
      accessKey: process.env.S3_ACCESS_KEY || '',
      secretKey: process.env.S3_SECRET_KEY || '',
    },
  },
  ai: {
    anthropicKey: process.env.ANTHROPIC_API_KEY || '',
    openaiKey: process.env.OPENAI_API_KEY || '',
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  onec: {
    apiUrl: process.env.ONEC_API_URL || '',
    apiKey: process.env.ONEC_API_KEY || '',
  },
  version: '2.0.0',
};
