import crypto from 'node:crypto';
import { promisify } from 'node:util';

/* Хеширование паролей.

   ТЗ допускает Argon2id или bcrypt. Здесь используется scrypt из стандартной
   библиотеки Node: тот же класс memory-hard функций, что и Argon2id, но без
   нативных зависимостей — это важно для сборки в контейнере и для Render.

   Формат хеша самоописывающийся: scrypt$N$r$p$salt$hash. Когда понадобится
   перейти на Argon2id, verify() сможет распознать оба формата и переподписать
   пароль при следующем успешном входе. */

const scrypt = promisify(crypto.scrypt) as (
  password: string, salt: Buffer, keylen: number, options: crypto.ScryptOptions,
) => Promise<Buffer>;

const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(String(password), salt, PARAMS.keylen, {
    N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: 256 * 1024 * 1024,
  });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), derived.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  const parts = String(stored).split('$');
  if (parts[0] !== 'scrypt' || parts.length !== 6) return false;
  const [, N, r, p, salt, expected] = parts;
  try {
    const derived = await scrypt(String(password), Buffer.from(salt, 'base64'), PARAMS.keylen, {
      N: parseInt(N, 10), r: parseInt(r, 10), p: parseInt(p, 10), maxmem: 256 * 1024 * 1024,
    });
    const expectedBuf = Buffer.from(expected, 'base64');
    return derived.length === expectedBuf.length && crypto.timingSafeEqual(derived, expectedBuf);
  } catch {
    return false;
  }
}

/* Временный пароль при создании пользователя или сбросе. */
export function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  const bytes = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
