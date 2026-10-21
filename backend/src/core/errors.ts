/* Единая иерархия ошибок. Сообщения на русском и пригодны для показа
   пользователю; внутренние детали в message не попадают — только в лог. */

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly details?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const ValidationError = (message: string, details?: Array<{ field: string; message: string }>) =>
  new AppError('VALIDATION_ERROR', message, 400, details);

export const Unauthorized = (message = 'Требуется вход в систему.') =>
  new AppError('UNAUTHORIZED', message, 401);

export const Forbidden = (message = 'Недостаточно прав для этого действия.') =>
  new AppError('FORBIDDEN', message, 403);

export const NotFound = (message = 'Объект не найден.') =>
  new AppError('NOT_FOUND', message, 404);

export const Conflict = (message: string) => new AppError('CONFLICT', message, 409);

export const TooLarge = (message = 'Запрос слишком большой.') =>
  new AppError('PAYLOAD_TOO_LARGE', message, 413);

export const UnsupportedMedia = (message: string) =>
  new AppError('UNSUPPORTED_MEDIA_TYPE', message, 415);

export const RateLimited = (message = 'Слишком много запросов. Повторите позже.') =>
  new AppError('RATE_LIMITED', message, 429);

export const AiProviderError = (message: string, code = 'AI_PROVIDER_ERROR') =>
  new AppError(code, message, 502);

export const IntegrationError = (message: string) =>
  new AppError('INTEGRATION_ERROR', message, 502);
