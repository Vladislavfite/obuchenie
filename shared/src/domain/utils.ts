/* Утилиты, перенесённые из storage.js без изменения поведения.
   Чистые функции: работают и в браузере, и на сервере. */

export function slugify(name: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  const base = String(name || '')
    .toLowerCase()
    .split('')
    .map((ch) => (map[ch] !== undefined ? map[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'item';
}

/* Транслитерация ФИО в логин — перенос transliterate()/suggestLogin(). */
export function transliterate(text: string): string {
  return slugify(text).replace(/-/g, '.');
}

export function suggestLogin(fullName: string, taken: string[]): string {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  let base = '';
  if (parts.length >= 2) base = `${transliterate(parts[0])}.${transliterate(parts[1]).slice(0, 1)}`;
  else if (parts.length === 1) base = transliterate(parts[0]);
  base = base.replace(/\.+$/, '').slice(0, 24) || 'user';
  if (base.length < 3) base = (base + '.user').slice(0, 24);
  const used = new Set(taken.map((t) => String(t).toLowerCase()));
  if (!used.has(base)) return base;
  for (let i = 2; i < 500; i++) {
    const candidate = `${base}${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}.${Date.now().toString(36)}`;
}

export const LOGIN_RE = /^[a-z0-9._-]{3,32}$/;

export function normalizeLogin(login: unknown): string {
  return String(login ?? '').trim().toLowerCase();
}

export function validateLoginFormat(login: string): string | null {
  if (!login) return 'Укажите логин.';
  if (!LOGIN_RE.test(login)) {
    return 'Логин: 3–32 символа, латинские буквы, цифры, точка, дефис и подчёркивание.';
  }
  return null;
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/* Сколько дней осталось до даты. Отрицательное — просрочено. */
export function daysBetween(dateISO: string | Date | null | undefined): number {
  if (!dateISO) return 0;
  const target = new Date(dateISO);
  if (Number.isNaN(target.getTime())) return 0;
  const today = new Date();
  const a = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a - b) / 86400000);
}

export function fmtDateRu(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* Русская плюрализация: plural(5, 'день', 'дня', 'дней'). */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function initials(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/* Статус срока обучения (§56 прототипа, §32 ТЗ). */
export function dueStatus(
  dueDate: string | Date | null | undefined,
  warningDays = 7,
): { level: 'normal' | 'warning' | 'overdue' | 'none'; days: number | null; label: string } {
  if (!dueDate) return { level: 'none', days: null, label: 'Срок не задан' };
  const days = daysBetween(dueDate);
  if (days < 0) {
    return { level: 'overdue', days, label: `Просрочено на ${Math.abs(days)} ${plural(Math.abs(days), 'день', 'дня', 'дней')}` };
  }
  if (days <= warningDays) {
    return { level: 'warning', days, label: `Осталось ${days} ${plural(days, 'день', 'дня', 'дней')}` };
  }
  return { level: 'normal', days, label: `Осталось ${days} ${plural(days, 'день', 'дня', 'дней')}` };
}

/* Статус срока действия сертификата или допуска. */
export function validityStatus(
  validUntil: string | Date | null | undefined,
  warningDays = 30,
): { level: 'active' | 'warning' | 'expired' | 'permanent'; days: number | null; label: string } {
  if (!validUntil) return { level: 'permanent', days: null, label: 'Бессрочно' };
  const days = daysBetween(validUntil);
  if (days < 0) {
    return { level: 'expired', days, label: `Истёк ${Math.abs(days)} ${plural(Math.abs(days), 'день', 'дня', 'дней')} назад` };
  }
  if (days <= warningDays) {
    return { level: 'warning', days, label: `Истекает через ${days} ${plural(days, 'день', 'дня', 'дней')}` };
  }
  return { level: 'active', days, label: `Действует ещё ${days} ${plural(days, 'день', 'дня', 'дней')}` };
}
