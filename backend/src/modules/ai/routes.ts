import type { FastifyInstance } from 'fastify';
import { and, eq, desc, sql } from 'drizzle-orm';
import { aiSettingsSchema, aiGenerateSchema, PERMISSION, sanitizeRichText, richTextToPlain } from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { ok } from '../../core/response.js';
import { requireAuth, requirePermission } from '../../core/context.js';
import { config } from '../../core/config.js';
import { encryptSecret, decryptSecret, maskKey } from '../../core/crypto.js';
import { ValidationError, Forbidden, AiProviderError } from '../../core/errors.js';
import { logAudit } from '../../core/audit.js';
import { callProvider, defaultModel, parseJsonFromModel } from './providers.js';
import { COURSE_SYSTEM, QUESTIONS_SYSTEM, LECTURE_SYSTEM, buildCoursePrompt } from './prompts.js';

/* ИИ-ассистент (§40–§43 ТЗ).

   Схема безопасности прототипа сохранена целиком:
   — ключ хранится зашифрованным (AES-256-GCM) и наружу уходит только маска;
   — запрос к провайдеру делает сервер, браузер ключ не видит;
   — сгенерированный HTML проходит через санитайзер, как любой другой ввод;
   — каждый вызов записывается в ai_requests без текста запроса. */

async function loadSettings(organizationId: string) {
  const rows = await db.select().from(schema.aiSettings)
    .where(eq(schema.aiSettings.organizationId, organizationId)).limit(1);
  return rows[0] ?? null;
}

async function resolveApiKey(organizationId: string, providerCode: string): Promise<string> {
  const rows = await db.select().from(schema.aiApiKeys)
    .where(and(eq(schema.aiApiKeys.organizationId, organizationId),
               eq(schema.aiApiKeys.providerCode, providerCode))).limit(1);
  if (rows[0]) {
    try {
      return decryptSecret({ ciphertext: rows[0].ciphertext, iv: rows[0].iv, authTag: rows[0].authTag });
    } catch {
      throw AiProviderError('Сохранённый API-ключ не удалось расшифровать. Вероятно, изменился ENCRYPTION_KEY — введите ключ заново.');
    }
  }
  /* Запасной вариант: ключ из окружения. */
  const fallback = providerCode === 'anthropic' ? config.ai.anthropicKey : config.ai.openaiKey;
  if (!fallback) throw AiProviderError('API-ключ не задан. Укажите его в разделе «AI Assistant».');
  return fallback;
}

async function assertAiAllowed(request: { user: { organizationId: string; roles: string[]; permissions: string[] } }) {
  const settings = await loadSettings(request.user.organizationId);
  if (!settings?.enabled) throw Forbidden('ИИ-ассистент выключен администратором.');
  const allowed = (settings.allowedRoles as string[]) ?? [];
  if (allowed.length && !request.user.roles.some((r) => allowed.includes(r))) {
    throw Forbidden('Вашей роли не разрешено использовать ИИ-ассистента.');
  }
  return settings;
}

export async function aiRoutes(app: FastifyInstance) {
  /* Настройки. Ключ в ответе — только маска. */
  app.get('/api/ai/settings',
    { onRequest: [requireAuth, requirePermission(PERMISSION.AI_CONFIGURE, PERMISSION.AI_USE)] },
    async (request) => {
      const settings = await loadSettings(request.user.organizationId);
      const keys = await db.select({ providerCode: schema.aiApiKeys.providerCode, last4: schema.aiApiKeys.last4 })
        .from(schema.aiApiKeys).where(eq(schema.aiApiKeys.organizationId, request.user.organizationId));

      return ok({
        enabled: settings?.enabled ?? false,
        provider: settings?.providerCode ?? 'anthropic',
        model: settings?.model ?? defaultModel(settings?.providerCode ?? 'anthropic'),
        temperature: settings?.temperature ? Number(settings.temperature) : null,
        maxTokens: settings?.maxTokens ?? 16000,
        systemPrompt: settings?.systemPrompt ?? '',
        allowedRoles: (settings?.allowedRoles as string[]) ?? ['ADMIN', 'MANAGER'],
        keys: keys.map((k) => ({ provider: k.providerCode, masked: maskKey(k.last4) })),
      });
    });

  app.put('/api/ai/settings',
    { onRequest: [requireAuth, requirePermission(PERMISSION.AI_CONFIGURE)] },
    async (request) => {
      const body = aiSettingsSchema.parse(request.body);

      await db.insert(schema.aiSettings).values({
        organizationId: request.user.organizationId,
        enabled: body.enabled,
        providerCode: body.provider,
        model: body.model ?? defaultModel(body.provider),
        temperature: body.temperature != null ? String(body.temperature) : null,
        maxTokens: body.maxTokens,
        systemPrompt: body.systemPrompt ?? null,
        allowedRoles: body.allowedRoles as object,
        updatedBy: request.user.userId,
      }).onConflictDoUpdate({
        target: schema.aiSettings.organizationId,
        set: {
          enabled: body.enabled, providerCode: body.provider,
          model: body.model ?? defaultModel(body.provider),
          temperature: body.temperature != null ? String(body.temperature) : null,
          maxTokens: body.maxTokens, systemPrompt: body.systemPrompt ?? null,
          allowedRoles: body.allowedRoles as object,
          updatedAt: new Date(), updatedBy: request.user.userId,
        },
      });

      /* Пустое поле ключа означает «оставить прежний», а не «стереть». */
      if (body.apiKey && body.apiKey.trim()) {
        const encrypted = encryptSecret(body.apiKey.trim());
        await db.insert(schema.aiApiKeys).values({
          organizationId: request.user.organizationId,
          providerCode: body.provider,
          ciphertext: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag,
          last4: body.apiKey.trim().slice(-4),
          updatedBy: request.user.userId,
        }).onConflictDoUpdate({
          target: [schema.aiApiKeys.organizationId, schema.aiApiKeys.providerCode],
          set: { ciphertext: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag,
                 last4: body.apiKey.trim().slice(-4), updatedAt: new Date(), updatedBy: request.user.userId },
        });
      }

      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'ai_settings_saved',
        details: `провайдер ${body.provider}, ${body.enabled ? 'включён' : 'выключен'}` });

      return ok({ saved: true });
    });

  /* Проверка ключа без генерации контента. */
  app.post('/api/ai/test',
    { onRequest: [requireAuth, requirePermission(PERMISSION.AI_CONFIGURE)] },
    async (request) => {
      const settings = await loadSettings(request.user.organizationId);
      const provider = settings?.providerCode ?? 'anthropic';
      const apiKey = await resolveApiKey(request.user.organizationId, provider);
      const started = Date.now();
      try {
        const result = await callProvider(provider, {
          apiKey, model: settings?.model ?? defaultModel(provider),
          system: 'Отвечай одним словом.', user: 'Ответь словом: работает',
          maxTokens: 32,
        });
        return ok({ ok: true, provider, model: result.model, durationMs: Date.now() - started,
          reply: result.text.slice(0, 100) });
      } catch (e) {
        return ok({ ok: false, provider, error: (e as Error).message });
      }
    });

  /* ---------- Генерация ---------- */

  async function generate(
    request: { user: { organizationId: string; userId: string; fullName: string; roles: string[]; permissions: string[] } },
    kind: string, system: string, user: string,
  ) {
    const settings = await assertAiAllowed(request);
    const provider = settings.providerCode;
    const apiKey = await resolveApiKey(request.user.organizationId, provider);
    const started = Date.now();

    await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
      actorLabel: request.user.fullName, action: 'ai_generation_started', details: kind });

    try {
      const result = await callProvider(provider, {
        apiKey,
        model: settings.model ?? defaultModel(provider),
        system: settings.systemPrompt ? `${system}\n\n${settings.systemPrompt}` : system,
        user,
        maxTokens: settings.maxTokens,
        temperature: settings.temperature ? Number(settings.temperature) : null,
      });

      await db.insert(schema.aiRequests).values({
        organizationId: request.user.organizationId, userId: request.user.userId,
        kind, providerCode: provider, model: result.model,
        inputChars: user.length, outputTokens: result.outputTokens,
        durationMs: Date.now() - started, status: 'success',
      });

      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'ai_generation_completed',
        details: `${kind}, ${result.outputTokens} токенов` });

      return result;
    } catch (e) {
      await db.insert(schema.aiRequests).values({
        organizationId: request.user.organizationId, userId: request.user.userId,
        kind, providerCode: provider, inputChars: user.length,
        durationMs: Date.now() - started, status: 'error', errorCode: (e as { code?: string }).code ?? 'ERROR',
      });
      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'ai_generation_failed', details: (e as Error).message });
      throw e;
    }
  }

  app.post('/api/ai/generate/course',
    { onRequest: [requireAuth, requirePermission(PERMISSION.AI_USE)],
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (request) => {
      const body = aiGenerateSchema.parse(request.body);
      const text = String(body.text ?? '').trim();
      if (text.length < 200) {
        throw ValidationError('Для генерации нужен текст документа не короче 200 символов.');
      }

      const result = await generate(request, 'course', COURSE_SYSTEM,
        buildCoursePrompt(text, { count: body.count, difficulty: body.difficulty,
          practical: body.practical, images: body.images }));

      const parsed = parseJsonFromModel<{
        title?: string; description?: string;
        contentItems?: Array<{ type: string; title?: string; html?: string }>;
        questions?: Array<Record<string, unknown>>;
      }>(result.text);

      /* Содержимое от ИИ проходит тот же санитайзер, что и ручной ввод:
         модель может вернуть теги, которых нет в белом списке. */
      const contentItems = (parsed.contentItems ?? [])
        .filter((i) => i.type === 'text' && i.html)
        .map((item, index) => ({
          type: 'text' as const, title: item.title ?? null, sortOrder: index, origin: 'ai' as const,
          payload: { html: sanitizeRichText(item.html) },
        }))
        .filter((i) => richTextToPlain(i.payload.html).length > 0);

      const questions = (parsed.questions ?? []).map((q, index) => {
        const options = Array.isArray(q.options) ? (q.options as Array<Record<string, unknown>>) : [];
        return {
          sortOrder: index,
          text: String(q.text ?? '').trim(),
          type: (['single', 'multiple', 'truefalse', 'scenario'].includes(String(q.type)) ? q.type : 'single') as
            'single' | 'multiple' | 'truefalse' | 'scenario',
          explanation: q.explanation ? String(q.explanation) : null,
          sourceReference: q.sourceReference ? String(q.sourceReference) : null,
          topic: q.topic ? String(q.topic) : null,
          topicId: null,
          difficulty: (['easy', 'normal', 'hard'].includes(String(q.difficulty)) ? q.difficulty : 'normal') as
            'easy' | 'normal' | 'hard',
          isPractical: !!q.isPractical,
          points: 1,
          media: { type: 'none' as const },
          imagePrompt: q.imagePrompt ? String(q.imagePrompt) : null,
          timestampSec: null,
          origin: 'ai' as const,
          options: options.map((o, oi) => ({
            sortOrder: oi, text: String(o.text ?? '').trim(), isCorrect: !!o.isCorrect,
          })).filter((o) => o.text),
        };
      }).filter((q) => q.text && q.options.length >= 2);

      return ok({
        title: String(parsed.title ?? '').trim() || 'Материал из документа',
        description: String(parsed.description ?? '').trim(),
        contentItems,
        questions,
        /* Предупреждаем сразу: результат требует проверки человеком. */
        notice: 'Материал подготовлен ИИ по вашему тексту. Проверьте формулировки и правильные ответы перед публикацией.',
        stats: { contentItems: contentItems.length, questions: questions.length, outputTokens: result.outputTokens },
      });
    });

  app.post('/api/ai/generate/questions',
    { onRequest: [requireAuth, requirePermission(PERMISSION.AI_USE)],
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (request) => {
      const body = aiGenerateSchema.parse(request.body);
      const text = String(body.text ?? '').trim();
      if (text.length < 100) throw ValidationError('Для генерации вопросов нужен текст не короче 100 символов.');

      const result = await generate(request, 'questions', QUESTIONS_SYSTEM,
        buildCoursePrompt(text, { count: body.count, difficulty: body.difficulty,
          practical: body.practical, images: false }));
      const parsed = parseJsonFromModel<{ questions?: Array<Record<string, unknown>> }>(result.text);

      const questions = (parsed.questions ?? []).map((q, index) => ({
        sortOrder: index,
        text: String(q.text ?? '').trim(),
        type: 'single' as const,
        explanation: q.explanation ? String(q.explanation) : null,
        sourceReference: q.sourceReference ? String(q.sourceReference) : null,
        topic: q.topic ? String(q.topic) : null,
        difficulty: 'normal' as const,
        isPractical: !!q.isPractical,
        points: 1,
        origin: 'ai' as const,
        options: (Array.isArray(q.options) ? (q.options as Array<Record<string, unknown>>) : [])
          .map((o, oi) => ({ sortOrder: oi, text: String(o.text ?? '').trim(), isCorrect: !!o.isCorrect }))
          .filter((o) => o.text),
      })).filter((q) => q.text && q.options.length >= 2);

      return ok({ questions, notice: 'Проверьте вопросы и правильные ответы перед публикацией.' });
    });

  app.post('/api/ai/generate/lecture',
    { onRequest: [requireAuth, requirePermission(PERMISSION.AI_USE)],
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (request) => {
      const body = aiGenerateSchema.parse(request.body);
      const text = String(body.text ?? '').trim();
      if (text.length < 100) throw ValidationError('Для плана лекции нужен текст не короче 100 символов.');
      const result = await generate(request, 'lecture', LECTURE_SYSTEM, text);
      return ok({ ...parseJsonFromModel<Record<string, unknown>>(result.text),
        notice: 'План подготовлен ИИ. Проверьте содержание перед проведением лекции.' });
    });

  /* Журнал обращений к ИИ. Тексты запросов не хранятся. */
  app.get('/api/ai/requests',
    { onRequest: [requireAuth, requirePermission(PERMISSION.AI_CONFIGURE)] },
    async (request) => {
      const rows = await db.select({
          request: schema.aiRequests,
          userName: schema.users.fullName,
        })
        .from(schema.aiRequests)
        .leftJoin(schema.users, eq(schema.users.id, schema.aiRequests.userId))
        .where(eq(schema.aiRequests.organizationId, request.user.organizationId))
        .orderBy(desc(schema.aiRequests.createdAt)).limit(100);
      return ok(rows);
    });
}
