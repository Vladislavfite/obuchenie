/* Очистка пользовательского HTML и проверка ссылок.

   В прототипе (storage.js) санитайзер работал через DOMParser и потому
   существовал только в браузере. Клиентская очистка перестаёт быть защитой,
   как только контент приходит по API: запрос можно отправить и мимо
   страницы. Поэтому здесь реализация без DOM — один и тот же код исполняется
   и во фронтенде, и в бэкенде, а бэкенд остаётся источником истины.

   Правила те же, что были: узкий белый список тегов, все атрибуты снимаются
   кроме href у <a>, схемы ограничены http/https/mailto/tel. */

const ALLOWED_TAGS = new Set([
  'h2', 'h3', 'h4', 'p', 'strong', 'em', 'b', 'i', 'u',
  'ul', 'ol', 'li', 'blockquote', 'a', 'br', 'hr',
]);

/* Содержимое этих тегов вырезается целиком вместе с тегом. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math',
]);

const VOID_TAGS = new Set(['br', 'hr']);

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/* Нормализация тега: <b> и <i> приводим к <strong>/<em>, как в прототипе. */
const TAG_ALIASES: Record<string, string> = { b: 'strong', i: 'em' };

export function safeLinkUrl(url: unknown): string {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  // Относительные ссылки на собственные файлы разрешены.
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const parsed = new URL(raw);
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export function safeImageUrl(url: unknown): string {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('/')&& !raw.startsWith('//')) return raw;
  // data:image допускается только как временное значение в редакторе.
  if (/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/i.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function extractHref(attrs: string): string {
  const match = /(?:^|\s)href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  if (!match) return '';
  const raw = match[2] ?? match[3] ?? match[4] ?? '';
  // Снимаем HTML-сущности перед проверкой схемы: javascript&#58;alert(1)
  const decoded = raw
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/gi, '&')
    .replace(/[\u0000-\u0020]/g, '')
    .trim();
  return safeLinkUrl(decoded);
}

/* Основная очистка. Разбор потоковый, без DOM. */
export function sanitizeRichText(html: unknown): string {
  const input = String(html ?? '');
  if (!input) return '';

  let out = '';
  const open: string[] = [];
  let i = 0;

  while (i < input.length) {
    const lt = input.indexOf('<', i);
    if (lt === -1) {
      out += escapeText(input.slice(i));
      break;
    }
    if (lt > i) out += escapeText(input.slice(i, lt));

    // Комментарии и CDATA вырезаются целиком.
    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4);
      i = end === -1 ? input.length : end + 3;
      continue;
    }
    if (input.startsWith('<!', lt) || input.startsWith('<?', lt)) {
      const end = input.indexOf('>', lt);
      i = end === -1 ? input.length : end + 1;
      continue;
    }

    const gt = input.indexOf('>', lt);
    if (gt === -1) {
      out += escapeText(input.slice(lt));
      break;
    }

    const inner = input.slice(lt + 1, gt);
    const closing = inner.startsWith('/');
    const body = closing ? inner.slice(1) : inner;
    const nameMatch = /^([a-zA-Z][a-zA-Z0-9]*)/.exec(body.trim());

    if (!nameMatch) {
      // Не похоже на тег — показываем как текст.
      out += escapeText(input.slice(lt, gt + 1));
      i = gt + 1;
      continue;
    }

    const rawName = nameMatch[1].toLowerCase();
    const name = TAG_ALIASES[rawName] ?? rawName;
    const attrs = body.trim().slice(nameMatch[1].length);

    if (DROP_WITH_CONTENT.has(rawName)) {
      if (closing) {
        i = gt + 1;
        continue;
      }
      // Ищем закрывающий тег и выбрасываем всё между.
      const closeRe = new RegExp(`</\\s*${rawName}\\s*>`, 'i');
      const rest = input.slice(gt + 1);
      const m = closeRe.exec(rest);
      i = m ? gt + 1 + m.index + m[0].length : input.length;
      continue;
    }

    if (!ALLOWED_TAGS.has(name)) {
      // Неразрешённый тег снимается, содержимое сохраняется.
      i = gt + 1;
      continue;
    }

    if (closing) {
      const idx = open.lastIndexOf(name);
      if (idx !== -1) {
        // Закрываем всё, что осталось открытым внутри.
        for (let k = open.length - 1; k >= idx; k--) out += `</${open[k]}>`;
        open.length = idx;
      }
      i = gt + 1;
      continue;
    }

    if (VOID_TAGS.has(name)) {
      out += `<${name}>`;
      i = gt + 1;
      continue;
    }

    if (name === 'a') {
      const href = extractHref(attrs);
      out += href
        ? `<a href="${href.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer nofollow">`
        : '<a>';
      open.push('a');
      i = gt + 1;
      continue;
    }

    out += `<${name}>`;
    open.push(name);
    i = gt + 1;
  }

  for (let k = open.length - 1; k >= 0; k--) out += `</${open[k]}>`;
  return out.trim();
}

/* Простой текст → HTML: абзацы по пустой строке, переносы строк в <br>. */
export function plainTextToHtml(text: unknown): string {
  const value = String(text ?? '').trim();
  if (!value) return '';
  return value
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeText(block.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/* HTML → простой текст: для поиска, превью и подсчёта длины. */
export function richTextToPlain(html: unknown): string {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h2|h3|h4|li|blockquote)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
