import type { ApiMeta } from '@tbedu/shared';

/* Формат ответа §56 ТЗ. Единственная точка формирования: ни один обработчик
   не возвращает «голый» объект. */

export function ok<T>(data: T, meta?: ApiMeta) {
  return meta ? { success: true as const, data, meta } : { success: true as const, data };
}

export function paginated<T>(data: T[], page: number, limit: number, total: number) {
  return {
    success: true as const,
    data,
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export function fail(code: string, message: string, details?: Array<{ field: string; message: string }>) {
  return { success: false as const, error: details ? { code, message, details } : { code, message } };
}
