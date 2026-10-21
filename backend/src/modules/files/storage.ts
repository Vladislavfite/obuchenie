import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../core/config.js';

/* Абстракция файлового хранилища (§60 ТЗ).

   Локальный диск не переживает перезапуск контейнера на Render и подобных
   платформах, поэтому интерфейс сразу рассчитан на подмену: перевод на S3
   меняет одну переменную окружения, а не код приложения. */

export interface FileStorage {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  url(key: string): string;
}

class LocalStorage implements FileStorage {
  constructor(private readonly dir: string) {}

  private full(key: string): string {
    /* Защита от обхода каталога: ключ всегда внутри dir. */
    const safe = key.replace(/\.\./g, '').replace(/^\/+/, '');
    return path.join(this.dir, safe);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.full(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.full(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.full(key), { force: true });
  }

  url(key: string): string {
    return `/api/files/${encodeURIComponent(key)}/raw`;
  }
}

/* S3 подключается через fetch с подписью — реализация добавляется при
   переходе на облачное хранилище. Пока драйвер объявлен, чтобы конфигурация
   и типы были готовы. */
class S3Storage implements FileStorage {
  async put(): Promise<void> {
    throw new Error('Драйвер S3 ещё не настроен. Укажите FILE_STORAGE=local или завершите настройку S3.');
  }
  async get(): Promise<Buffer> {
    throw new Error('Драйвер S3 ещё не настроен.');
  }
  async delete(): Promise<void> {
    throw new Error('Драйвер S3 ещё не настроен.');
  }
  url(key: string): string {
    return `${config.files.s3.endpoint}/${config.files.s3.bucket}/${key}`;
  }
}

export const storage: FileStorage =
  config.files.driver === 's3' ? new S3Storage() : new LocalStorage(config.files.dir);
