import type { FastifyInstance } from 'fastify';
import { and, eq, desc } from 'drizzle-orm';
import { PERMISSION, IMAGE_MIME, DOCUMENT_MIME, FORBIDDEN_EXTENSIONS, MAX_FILE_BYTES } from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { ok } from '../../core/response.js';
import { requireAuth, requirePermission } from '../../core/context.js';
import { sha256 } from '../../core/crypto.js';
import { ValidationError, TooLarge, UnsupportedMedia, NotFound } from '../../core/errors.js';
import { logAudit } from '../../core/audit.js';
import { storage } from './storage.js';

/* Загрузка файлов (§59 ТЗ).

   Перенос lib/media-store.js прототипа: дедупликация по SHA-256, проверка
   сигнатуры файла, запрет исполняемых расширений. Расширение и MIME из
   запроса — это то, что назвал клиент; доверять им нельзя, поэтому тип
   подтверждается по первым байтам. */

const MAGIC: Array<{ mime: string; ext: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', ext: 'gif', test: (b) => b.subarray(0, 3).toString('ascii') === 'GIF' },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('ascii') === '%PDF-' },
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx',
    test: (b) => b[0] === 0x50 && b[1] === 0x4b },
];

function detectType(buffer: Buffer, declaredMime: string, filename: string): { mime: string; ext: string } {
  for (const entry of MAGIC) {
    if (entry.test(buffer)) return { mime: entry.mime, ext: entry.ext };
  }
  /* SVG и текст не имеют сигнатуры — проверяем содержимое. */
  const head = buffer.subarray(0, 1024).toString('utf8').trimStart().toLowerCase();
  if (declaredMime === 'image/svg+xml' && (head.startsWith('<svg') || head.startsWith('<?xml'))) {
    return { mime: 'image/svg+xml', ext: 'svg' };
  }
  if (declaredMime.startsWith('text/')) {
    return { mime: declaredMime, ext: filename.split('.').pop()?.toLowerCase() || 'txt' };
  }
  throw UnsupportedMedia('Тип файла не поддерживается или содержимое не совпадает с расширением.');
}

export async function filesRoutes(app: FastifyInstance) {
  app.post('/api/files',
    { onRequest: [requireAuth, requirePermission(PERMISSION.FILES_UPLOAD)] },
    async (request) => {
      const data = await (request as unknown as { file(): Promise<{
        filename: string; mimetype: string; toBuffer(): Promise<Buffer>;
      } | undefined> }).file();
      if (!data) throw ValidationError('Файл не передан.');

      const filename = data.filename || 'file';
      const ext = filename.split('.').pop()?.toLowerCase() ?? '';
      if (FORBIDDEN_EXTENSIONS.includes(ext)) {
        throw UnsupportedMedia(`Файлы с расширением .${ext} загружать нельзя.`);
      }

      const buffer = await data.toBuffer();
      if (buffer.length > MAX_FILE_BYTES) {
        throw TooLarge(`Файл больше ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} МБ.`);
      }
      if (buffer.length === 0) throw ValidationError('Файл пустой.');

      const detected = detectType(buffer, data.mimetype, filename);
      const allowed = [...IMAGE_MIME, ...DOCUMENT_MIME];
      if (!allowed.includes(detected.mime)) {
        throw UnsupportedMedia('Такой тип файла загружать нельзя.');
      }

      /* SVG может содержать скрипты. Отклоняем такие файлы целиком:
         вычищать скрипты из SVG надёжно сложнее, чем запретить. */
      if (detected.mime === 'image/svg+xml') {
        const text = buffer.toString('utf8').toLowerCase();
        if (text.includes('<script') || text.includes('javascript:') || /\son\w+\s*=/.test(text)) {
          throw UnsupportedMedia('В SVG обнаружен скрипт. Загрузите изображение без скриптов.');
        }
      }

      const hash = sha256(buffer);

      /* Дедупликация: один и тот же файл хранится один раз. */
      const existing = await db.select().from(schema.files)
        .where(and(eq(schema.files.organizationId, request.user.organizationId),
                   eq(schema.files.contentHash, hash))).limit(1);
      if (existing[0]) {
        return ok({ id: existing[0].id, url: storage.url(existing[0].storageKey),
          mime: existing[0].mime, sizeBytes: existing[0].sizeBytes, deduplicated: true });
      }

      const storageKey = `${request.user.organizationId}/${hash.slice(0, 2)}/${hash}.${detected.ext}`;
      await storage.put(storageKey, buffer, detected.mime);

      const [created] = await db.insert(schema.files).values({
        organizationId: request.user.organizationId,
        storage: 'local',
        storageKey,
        contentHash: hash,
        mime: detected.mime,
        extension: detected.ext,
        sizeBytes: buffer.length,
        originalName: filename.slice(0, 200),
        kind: detected.mime.startsWith('image/') ? 'image' : 'document',
        uploadedBy: request.user.userId,
      }).returning();

      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'file_uploaded',
        entityType: 'file', entityId: created.id,
        details: `${filename} · ${Math.round(buffer.length / 1024)} КБ` });

      return ok({ id: created.id, url: storage.url(storageKey), mime: created.mime,
        sizeBytes: created.sizeBytes, deduplicated: false });
    });

  app.get('/api/files', { onRequest: requireAuth }, async (request) => {
    const rows = await db.select().from(schema.files)
      .where(eq(schema.files.organizationId, request.user.organizationId))
      .orderBy(desc(schema.files.createdAt)).limit(200);
    return ok(rows.map((f) => ({ ...f, url: storage.url(f.storageKey) })));
  });

  /* Выдача файла. Доступ проверяется: файлы принадлежат организации. */
  app.get('/api/files/:key/raw', { onRequest: requireAuth }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const storageKey = decodeURIComponent(key);

    const rows = await db.select().from(schema.files)
      .where(and(eq(schema.files.storageKey, storageKey),
                 eq(schema.files.organizationId, request.user.organizationId))).limit(1);
    if (!rows[0]) throw NotFound('Файл не найден.');

    const buffer = await storage.get(storageKey);
    reply.header('content-type', rows[0].mime);
    reply.header('cache-control', 'private, max-age=86400');
    /* SVG и документы отдаём как вложение, чтобы они не исполнялись
       в контексте страницы. */
    if (rows[0].mime === 'image/svg+xml' || rows[0].kind === 'document') {
      reply.header('content-disposition', `attachment; filename="${encodeURIComponent(rows[0].originalName ?? 'file')}"`);
    }
    return reply.send(buffer);
  });

  app.delete('/api/files/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.FILES_UPLOAD)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const rows = await db.select().from(schema.files)
        .where(and(eq(schema.files.id, id), eq(schema.files.organizationId, request.user.organizationId))).limit(1);
      if (!rows[0]) throw NotFound('Файл не найден.');
      await storage.delete(rows[0].storageKey);
      await db.delete(schema.files).where(eq(schema.files.id, id));
      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'file_deleted', entityType: 'file', entityId: id });
      return ok({ deleted: true });
    });
}
