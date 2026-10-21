import type { ApiResponse } from '@tbedu/shared';

/* Единая точка обращения к API.

   Ошибки приходят с сервера уже в понятном пользователю виде, поэтому
   клиент их не переписывает — только достаёт message и подробности по полям. */

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /* Ошибки по конкретным полям формы. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details ?? []) out[d.field] = d.message;
    return out;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: body instanceof FormData ? {} : { 'content-type': 'application/json' },
  };
  if (body !== undefined) {
    init.body = body instanceof FormData ? body : JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('NETWORK', 'Нет связи с сервером. Проверьте подключение к сети.', 0);
  }

  if (response.status === 204) return undefined as T;

  let payload: ApiResponse<T>;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('BAD_RESPONSE', 'Сервер вернул неожиданный ответ.', response.status);
  }

  if (!payload.success) {
    throw new ApiError(payload.error.code, payload.error.message, response.status, payload.error.details);
  }
  return payload.data;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),

  async upload(file: File): Promise<{ id: string; url: string; mime: string }> {
    const form = new FormData();
    form.append('file', file);
    return request('POST', '/api/files', form);
  },
};

/* Сборка строки запроса без пустых параметров. */
export function query(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}
