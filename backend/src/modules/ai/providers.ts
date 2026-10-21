import { config } from '../../core/config.js';
import { AiProviderError } from '../../core/errors.js';
import { redact } from '../../core/crypto.js';

/* Клиенты провайдеров ИИ. Перенос lib/ai-providers.js прототипа.

   Ключ существует только здесь и в зашифрованном виде в базе. В браузер он
   не уходит никогда — ни при сохранении настроек, ни при генерации. */

export interface AiCallInput {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number | null;
  signal?: AbortSignal;
}

export interface AiCallResult {
  text: string;
  outputTokens: number;
  model: string;
}

const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-4o',
};

async function callAnthropic(input: AiCallInput): Promise<AiCallResult> {
  const response = await fetch(`${config.ai.anthropicBaseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: input.model || DEFAULT_MODELS.anthropic,
      max_tokens: input.maxTokens,
      temperature: input.temperature ?? undefined,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) throw AiProviderError('Провайдер отклонил API-ключ. Проверьте ключ в настройках.', 'AI_AUTH');
    if (response.status === 429) throw AiProviderError('Превышен лимит запросов к ИИ. Повторите через минуту.', 'AI_RATE_LIMIT');
    throw AiProviderError(`Провайдер вернул ошибку ${response.status}: ${redact(body).slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { output_tokens?: number };
    model?: string;
  };

  const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
  return { text, outputTokens: data.usage?.output_tokens ?? 0, model: data.model ?? input.model };
}

async function callOpenAI(input: AiCallInput): Promise<AiCallResult> {
  const response = await fetch(`${config.ai.openaiBaseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
    body: JSON.stringify({
      model: input.model || DEFAULT_MODELS.openai,
      max_tokens: input.maxTokens,
      temperature: input.temperature ?? undefined,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) throw AiProviderError('Провайдер отклонил API-ключ. Проверьте ключ в настройках.', 'AI_AUTH');
    if (response.status === 429) throw AiProviderError('Превышен лимит запросов к ИИ. Повторите через минуту.', 'AI_RATE_LIMIT');
    throw AiProviderError(`Провайдер вернул ошибку ${response.status}: ${redact(body).slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { completion_tokens?: number };
    model?: string;
  };

  return {
    text: data.choices?.[0]?.message?.content ?? '',
    outputTokens: data.usage?.completion_tokens ?? 0,
    model: data.model ?? input.model,
  };
}

export async function callProvider(providerCode: string, input: AiCallInput): Promise<AiCallResult> {
  if (providerCode === 'anthropic') return callAnthropic(input);
  if (providerCode === 'openai') return callOpenAI(input);
  throw AiProviderError(`Неизвестный провайдер ИИ: ${providerCode}`);
}

export function defaultModel(providerCode: string): string {
  return DEFAULT_MODELS[providerCode as keyof typeof DEFAULT_MODELS] ?? '';
}

/* Разбор JSON из ответа модели: модели иногда оборачивают его в ```json. */
export function parseJsonFromModel<T>(text: string): T {
  const cleaned = String(text ?? '')
    .replace(/^[\s\S]*?```(?:json)?\s*/i, (m) => (m.includes('```') ? '' : m))
    .replace(/```[\s\S]*$/i, '')
    .trim();
  const candidate = cleaned || String(text ?? '').trim();
  const start = candidate.indexOf('{');
  const startArr = candidate.indexOf('[');
  const from = startArr !== -1 && (startArr < start || start === -1) ? startArr : start;
  if (from === -1) throw AiProviderError('ИИ вернул ответ не в формате JSON. Попробуйте ещё раз.');
  const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
  try {
    return JSON.parse(candidate.slice(from, end + 1)) as T;
  } catch {
    throw AiProviderError('Не удалось разобрать ответ ИИ. Попробуйте сократить исходный текст.');
  }
}
