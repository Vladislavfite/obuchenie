import { decryptSecret } from '../../core/crypto.js';
import { IntegrationError } from '../../core/errors.js';

/* Транспорт для обмена с 1С (§45 ТЗ).

   Способ обмена неизвестен заранее и зависит от конкретной базы заказчика,
   поэтому он вынесен за интерфейс. Смена способа не затрагивает логику
   синхронизации — меняется только драйвер. */

export interface OnecRecord {
  externalId: string;
  [key: string]: unknown;
}

export interface OnecPayload {
  departments?: OnecRecord[];
  positions?: OnecRecord[];
  professions?: OnecRecord[];
  employees?: OnecRecord[];
}

export interface OnecTransport {
  fetchData(types: string[]): Promise<OnecPayload>;
}

export interface OnecCredentials {
  authType: string;
  username?: string;
  password?: string;
  token?: string;
}

function authHeaders(creds: OnecCredentials): Record<string, string> {
  if (creds.authType === 'basic' && creds.username) {
    const basic = Buffer.from(`${creds.username}:${creds.password ?? ''}`).toString('base64');
    return { authorization: `Basic ${basic}` };
  }
  if (creds.authType === 'token' && creds.token) {
    return { authorization: `Bearer ${creds.token}` };
  }
  return {};
}

/* 1. HTTP-сервис 1С: самый простой вариант, если база доступна по сети. */
class HttpServiceTransport implements OnecTransport {
  constructor(private readonly baseUrl: string, private readonly creds: OnecCredentials) {}

  async fetchData(types: string[]): Promise<OnecPayload> {
    const result: OnecPayload = {};
    for (const type of types) {
      const url = `${this.baseUrl.replace(/\/+$/, '')}/${type}`;
      let response: Response;
      try {
        response = await fetch(url, { headers: { accept: 'application/json', ...authHeaders(this.creds) } });
      } catch (e) {
        throw IntegrationError(`Не удалось соединиться с 1С (${type}): ${(e as Error).message}`);
      }
      if (!response.ok) {
        throw IntegrationError(`1С вернула ошибку ${response.status} при запросе «${type}».`);
      }
      const data = await response.json();
      (result as Record<string, unknown>)[type] = Array.isArray(data) ? data : (data as { value?: unknown }).value ?? [];
    }
    return result;
  }
}

/* 2. OData-интерфейс 1С: стандартный REST поверх справочников. */
class ODataTransport implements OnecTransport {
  private readonly entityMap: Record<string, string> = {
    departments: 'Catalog_ПодразделенияОрганизаций',
    positions: 'Catalog_Должности',
    professions: 'Catalog_Профессии',
    employees: 'Catalog_Сотрудники',
  };

  constructor(private readonly baseUrl: string, private readonly creds: OnecCredentials) {}

  async fetchData(types: string[]): Promise<OnecPayload> {
    const result: OnecPayload = {};
    for (const type of types) {
      const entity = this.entityMap[type];
      if (!entity) continue;
      const url = `${this.baseUrl.replace(/\/+$/, '')}/${entity}?$format=json`;
      const response = await fetch(url, { headers: { accept: 'application/json', ...authHeaders(this.creds) } });
      if (!response.ok) throw IntegrationError(`OData вернул ошибку ${response.status} для «${entity}».`);
      const data = (await response.json()) as { value?: unknown[] };
      (result as Record<string, unknown>)[type] = data.value ?? [];
    }
    return result;
  }
}

/* 3. Выгрузка файлом: для баз без сетевого доступа. Данные приходят
      в теле запроса, их загружает человек или скрипт на стороне 1С. */
class FileExchangeTransport implements OnecTransport {
  constructor(private readonly payload: OnecPayload) {}
  async fetchData(): Promise<OnecPayload> {
    return this.payload;
  }
}

export function createTransport(
  transport: string,
  baseUrl: string | null,
  creds: OnecCredentials,
  payload?: OnecPayload,
): OnecTransport {
  switch (transport) {
    case 'http_service':
    case 'middleware':
      if (!baseUrl) throw IntegrationError('Не указан адрес HTTP-сервиса 1С.');
      return new HttpServiceTransport(baseUrl, creds);
    case 'odata':
      if (!baseUrl) throw IntegrationError('Не указан адрес OData-интерфейса 1С.');
      return new ODataTransport(baseUrl, creds);
    case 'file_exchange':
      return new FileExchangeTransport(payload ?? {});
    default:
      throw IntegrationError(`Неизвестный способ обмена: ${transport}`);
  }
}

/* Нормализация записи 1С. Названия полей отличаются между конфигурациями,
   поэтому принимаем несколько вариантов. */
export function pick(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}
