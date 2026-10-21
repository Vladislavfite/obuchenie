import crypto from 'node:crypto';
import { config } from './config.js';

/* Шифрование секретов AES-256-GCM.
   Перенесено из lib/ai-settings.js прототипа без изменения схемы:
   ключ выводится SHA-256 из ENCRYPTION_KEY, у каждой записи свой IV,
   целостность защищена authTag. */

function cipherKey(): Buffer {
  return crypto.createHash('sha256').update(config.encryptionKey).digest();
}

export interface Encrypted {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function encryptSecret(plain: string): Encrypted {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cipherKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return {
    ciphertext: enc.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptSecret(record: Encrypted): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', cipherKey(), Buffer.from(record.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function maskKey(last4: string): string {
  return last4 ? '••••••••' + last4 : '';
}

export function sha256(text: string | Buffer): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/* Вычистка секретов из текста перед логированием (§67 ТЗ).
   Перенос redact() из lib/ai-providers.js. */
export function redact(text: unknown): string {
  return String(text ?? '')
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._\-]{8,}/gi, 'Bearer ***')
    .replace(/x-api-key["'\s:=]+[A-Za-z0-9._\-]{8,}/gi, 'x-api-key: ***');
}
