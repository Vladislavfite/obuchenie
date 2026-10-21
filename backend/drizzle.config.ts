import type { Config } from 'drizzle-kit';
import 'dotenv/config';

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://tbedu:tbedu@localhost:5432/tbedu',
  },
  verbose: true,
  strict: true,
} satisfies Config;
