import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, and, isNull } from 'drizzle-orm';
import { ROLE, slugify, sanitizeRichText, suggestLogin, todayISO } from '@tbedu/shared';
import type { ModuleVersionContent } from '@tbedu/shared';
import { db, schema, closeDatabase } from '../db/client.js';
import { config } from '../core/config.js';
import { hashPassword, generateTempPassword } from '../core/password.js';
import { contentHash, sanitizeContentItems, sanitizeQuestions } from '../modules/training/service.js';
import { logAudit } from '../core/audit.js';

/* Импорт данных из прототипа (§21 плана миграции).

   Прототип хранил всё в localStorage браузера. Чтобы перенести данные,
   выгрузите их из консоли браузера на странице руководителя:

     copy(JSON.stringify(localStorage))

   и сохраните в файл, например legacy.json. Затем:

     npm run import:legacy -- ./legacy.json

   ВАЖНО О ПАРОЛЯХ. Прототип хранил пароли как SHA-256 без соли, а часть —
   как хеш FNV-1a. Ни один из них нельзя преобразовать в scrypt, не зная
   исходного пароля. Поэтому все перенесённые пользователи получают
   временные пароли, которые выводятся в конце импорта, и обязаны сменить
   их при первом входе. Это не обходной путь, а единственный честный
   вариант: перенести старые хеши означало бы оставить в системе
   заведомо слабую защиту. */

interface ImportReport {
  departments: number;
  positions: number;
  professions: number;
  employees: number;
  trainings: number;
  modules: number;
  questions: number;
  skipped: string[];
  credentials: Array<{ fullName: string; login: string; tempPassword: string }>;
}

function parseStore(raw: string): Record<string, unknown> {
  const outer = JSON.parse(raw) as Record<string, string>;
  const store: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(outer)) {
    if (typeof value !== 'string') { store[key] = value; continue; }
    try {
      store[key] = JSON.parse(value);
    } catch {
      store[key] = value;
    }
  }
  return store;
}

/* Прототип складывал данные под разными ключами в зависимости от версии.
   Берём первый подошедший. */
function pick<T>(store: Record<string, unknown>, ...keys: string[]): T | null {
  for (const key of keys) {
    const value = store[key];
    if (value !== undefined && value !== null) return value as T;
  }
  return null;
}

async function ensureReference(
  table: typeof schema.departments | typeof schema.positions | typeof schema.professions,
  organizationId: string,
  name: string,
  cache: Map<string, string>,
): Promise<string | null> {
  const clean = String(name ?? '').trim();
  if (!clean) return null;
  const cached = cache.get(clean.toLowerCase());
  if (cached) return cached;

  const existing = await db.select().from(table)
    .where(and(eq(table.organizationId, organizationId), eq(table.name, clean))).limit(1);
  if (existing[0]) {
    cache.set(clean.toLowerCase(), existing[0].id);
    return existing[0].id;
  }

  const [created] = await db.insert(table)
    .values({ organizationId, name: clean, source: 'legacy' }).returning();
  cache.set(clean.toLowerCase(), created.id);
  return created.id;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Укажите путь к файлу выгрузки: npm run import:legacy -- ./legacy.json');
    process.exit(1);
  }

  const raw = await fs.readFile(path.resolve(filePath), 'utf8');
  const store = parseStore(raw);

  const orgRows = await db.select().from(schema.organizations).limit(1);
  if (!orgRows[0]) {
    console.error('В базе нет организации. Сначала выполните npm run db:seed.');
    process.exit(1);
  }
  const organizationId = orgRows[0].id;

  const report: ImportReport = {
    departments: 0, positions: 0, professions: 0, employees: 0,
    trainings: 0, modules: 0, questions: 0, skipped: [], credentials: [],
  };

  const depCache = new Map<string, string>();
  const posCache = new Map<string, string>();
  const profCache = new Map<string, string>();

  /* ---------- Сотрудники ---------- */

  const legacyEmployees = pick<Array<Record<string, unknown>>>(
    store, 'tbedu_employees', 'employees', 'tb_employees',
  ) ?? [];

  const employeeRole = await db.select().from(schema.roles)
    .where(and(eq(schema.roles.code, ROLE.EMPLOYEE), isNull(schema.roles.organizationId))).limit(1);

  const takenLogins = (await db.select({ login: schema.users.login }).from(schema.users)
    .where(eq(schema.users.organizationId, organizationId))).map((u) => u.login);

  const employeeIdMap = new Map<string, string>();

  for (const record of legacyEmployees) {
    const fullName = String(record.fullName ?? record.name ?? '').trim();
    if (!fullName) { report.skipped.push('сотрудник без имени'); continue; }

    const departmentId = await ensureReference(schema.departments, organizationId,
      String(record.department ?? ''), depCache);
    if (departmentId && !depCache.has('__counted__' + departmentId)) {
      depCache.set('__counted__' + departmentId, departmentId);
      report.departments += 1;
    }
    const positionId = await ensureReference(schema.positions, organizationId,
      String(record.position ?? ''), posCache);
    const professionId = await ensureReference(schema.professions, organizationId,
      String(record.profession ?? ''), profCache);

    /* Логин из прототипа сохраняем, если он свободен и подходит по формату. */
    let login = String(record.login ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(login) || takenLogins.includes(login)) {
      login = suggestLogin(fullName, takenLogins);
    }
    takenLogins.push(login);

    const tempPassword = generateTempPassword();

    try {
      const created = await db.transaction(async (tx) => {
        const [user] = await tx.insert(schema.users).values({
          organizationId,
          login,
          fullName,
          email: record.email ? String(record.email) : null,
          phone: record.phone ? String(record.phone) : null,
          passwordHash: await hashPassword(tempPassword),
          /* Старый пароль перенести невозможно — обязательная смена. */
          mustChangePassword: true,
        }).returning();

        if (employeeRole[0]) {
          await tx.insert(schema.userRoles).values({ userId: user.id, roleId: employeeRole[0].id });
        }

        const [profile] = await tx.insert(schema.employeeProfiles).values({
          userId: user.id,
          organizationId,
          departmentId, positionId, professionId,
          personnelNumber: record.personnelNumber ? String(record.personnelNumber) : null,
          qualification: record.qualification ? String(record.qualification) : null,
          hiredAt: typeof record.hiredAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(record.hiredAt)
            ? record.hiredAt.slice(0, 10) : null,
          source: 'legacy',
        }).returning();

        return profile;
      });

      if (record.id) employeeIdMap.set(String(record.id), created.id);
      report.employees += 1;
      report.credentials.push({ fullName, login, tempPassword });
    } catch (e) {
      report.skipped.push(`сотрудник «${fullName}»: ${(e as Error).message}`);
    }
  }

  /* ---------- Обучения и модули ---------- */

  const legacyBlocks = pick<Array<Record<string, unknown>>>(
    store, 'tbedu_blocks', 'blocks', 'tb_blocks', 'trainingBlocks',
  ) ?? [];

  const legacyModules = pick<Array<Record<string, unknown>>>(
    store, 'tbedu_modules', 'modules', 'tb_modules',
  ) ?? [];

  const adminRows = await db.select().from(schema.users)
    .where(and(eq(schema.users.organizationId, organizationId), eq(schema.users.login, config.bootstrap.login)))
    .limit(1);
  const authorId = adminRows[0]?.id ?? null;

  for (const block of legacyBlocks) {
    const title = String(block.title ?? block.name ?? '').trim();
    if (!title) { report.skipped.push('обучение без названия'); continue; }

    const [createdBlock] = await db.insert(schema.trainingBlocks).values({
      organizationId,
      slug: slugify(title) + '-' + Math.random().toString(36).slice(2, 6),
      title,
      description: block.description ? String(block.description) : null,
      icon: block.icon ? String(block.icon) : null,
      /* Импортированное обучение приходит черновиком: его нужно
         просмотреть и опубликовать осознанно. */
      status: 'draft',
      sequential: block.sequential !== false,
      requiredPct: typeof block.requiredPct === 'number' ? block.requiredPct : 100,
      isCore: !!block.isCore,
      createdBy: authorId,
    }).returning();
    report.trainings += 1;

    const blockModules = legacyModules.filter(
      (m) => String(m.blockId ?? m.block ?? '') === String(block.id ?? block.slug ?? ''),
    );

    for (const [index, mod] of blockModules.entries()) {
      const moduleTitle = String(mod.title ?? mod.name ?? '').trim() || `Модуль ${index + 1}`;

      /* Контент прототипа приводим к текущей форме и пропускаем через
         санитайзер: в localStorage мог лежать любой HTML. */
      const contentItems = Array.isArray(mod.contentItems)
        ? (mod.contentItems as Array<Record<string, unknown>>).map((item, i) => ({
            type: (item.type as string) ?? 'text',
            title: item.title ? String(item.title) : null,
            sortOrder: i,
            payload: (item.payload ?? { html: sanitizeRichText(item.html ?? '') }) as never,
          }))
        : mod.html || mod.content
          ? [{ type: 'text' as const, title: null, sortOrder: 0,
               payload: { html: sanitizeRichText(mod.html ?? mod.content) } as never }]
          : [];

      const questions = Array.isArray(mod.questions)
        ? (mod.questions as Array<Record<string, unknown>>).map((q, qi) => {
            const options = Array.isArray(q.options)
              ? (q.options as unknown[]).map((o, oi) => {
                  /* В прототипе вариант мог быть строкой, а правильный ответ
                     задавался отдельным полем correct с индексом. */
                  const text = typeof o === 'string' ? o : String((o as Record<string, unknown>).text ?? '');
                  const isCorrect = typeof o === 'object' && o !== null && 'isCorrect' in o
                    ? !!(o as Record<string, unknown>).isCorrect
                    : Number(q.correct ?? q.correctIndex ?? -1) === oi;
                  return { sortOrder: oi, text, isCorrect };
                })
              : [];
            return {
              sortOrder: qi,
              text: String(q.text ?? q.question ?? ''),
              type: (q.type as 'single') ?? 'single',
              explanation: q.explanation ? String(q.explanation) : null,
              sourceReference: q.sourceReference ? String(q.sourceReference) : null,
              topic: q.topic ? String(q.topic) : null,
              topicId: null,
              difficulty: (q.difficulty as 'normal') ?? 'normal',
              isPractical: !!q.isPractical,
              points: 1,
              media: { type: 'none' as const },
              imagePrompt: null,
              timestampSec: null,
              origin: null,
              options,
            };
          }).filter((q) => q.text && q.options.length >= 2)
        : [];

      const content: ModuleVersionContent = {
        title: moduleTitle,
        chapter: mod.chapter ? String(mod.chapter) : null,
        description: mod.description ? String(mod.description) : null,
        speaker: mod.speaker ? String(mod.speaker) : null,
        accessCode: mod.accessCode ? String(mod.accessCode) : null,
        passingScore: typeof mod.passingScore === 'number' ? mod.passingScore : 70,
        attemptLimit: typeof mod.attemptLimit === 'number' ? mod.attemptLimit : 0,
        isRequired: mod.isRequired !== false,
        randomQuestions: !!mod.randomQuestions,
        questionCount: typeof mod.questionCount === 'number' ? mod.questionCount : 0,
        shuffleOptions: !!mod.shuffleOptions,
        contentItems: sanitizeContentItems(contentItems as never),
        questions: sanitizeQuestions(questions as never),
      };

      try {
        await db.transaction(async (tx) => {
          const [createdModule] = await tx.insert(schema.trainingModules).values({
            organizationId,
            trainingId: createdBlock.id,
            slug: slugify(moduleTitle) + '-' + index,
            sortOrder: index,
            currentVersion: 1,
            status: 'draft',
          }).returning();

          const [version] = await tx.insert(schema.trainingModuleVersions).values({
            organizationId,
            moduleId: createdModule.id,
            version: 1,
            status: 'draft',
            title: content.title,
            chapter: content.chapter,
            description: content.description,
            speaker: content.speaker,
            accessCode: content.accessCode,
            passingScore: content.passingScore,
            attemptLimit: content.attemptLimit,
            isRequired: content.isRequired,
            randomQuestions: content.randomQuestions,
            questionCount: content.questionCount,
            shuffleOptions: content.shuffleOptions,
            contentHash: contentHash(content),
          }).returning();

          if (content.contentItems.length) {
            await tx.insert(schema.trainingContentItems).values(
              content.contentItems.map((item, i) => ({
                moduleVersionId: version.id,
                sortOrder: i,
                type: item.type,
                title: item.title ?? null,
                payload: item.payload as object,
              })),
            );
          }

          for (const [qi, q] of content.questions.entries()) {
            const [createdQuestion] = await tx.insert(schema.questions).values({
              moduleVersionId: version.id,
              sortOrder: qi,
              text: q.text,
              type: q.type,
              explanation: q.explanation ?? null,
              sourceReference: q.sourceReference ?? null,
              topic: q.topic ?? null,
              difficulty: q.difficulty,
              isPractical: q.isPractical,
              points: q.points,
              media: (q.media ?? null) as object | null,
            }).returning();

            if (q.options.length) {
              await tx.insert(schema.questionOptions).values(
                q.options.map((o, oi) => ({
                  questionId: createdQuestion.id,
                  sortOrder: oi,
                  text: o.text,
                  isCorrect: o.isCorrect,
                })),
              );
            }
          }
        });

        report.modules += 1;
        report.questions += content.questions.length;
      } catch (e) {
        report.skipped.push(`модуль «${moduleTitle}»: ${(e as Error).message}`);
      }
    }
  }

  await logAudit({
    organizationId,
    actorUserId: authorId,
    actorLabel: 'Импорт данных прототипа',
    action: 'legacy_import',
    details: `сотрудников ${report.employees}, обучений ${report.trainings}, модулей ${report.modules}`,
  });

  /* ---------- Отчёт ---------- */

  console.log('\n=== Импорт завершён ===');
  console.log(`Подразделений создано:  ${depCache.size / 2 || 0}`);
  console.log(`Сотрудников:            ${report.employees}`);
  console.log(`Обучений:               ${report.trainings}`);
  console.log(`Модулей:                ${report.modules}`);
  console.log(`Вопросов:               ${report.questions}`);

  if (report.skipped.length) {
    console.log(`\nПропущено (${report.skipped.length}):`);
    for (const line of report.skipped.slice(0, 30)) console.log(`  — ${line}`);
  }

  if (report.credentials.length) {
    const file = path.resolve(`temp-passwords-${todayISO(0)}.csv`);
    const csv = ['ФИО,Логин,Временный пароль',
      ...report.credentials.map((c) => `"${c.fullName}","${c.login}","${c.tempPassword}"`)].join('\n');
    await fs.writeFile(file, '\uFEFF' + csv, 'utf8');

    console.log('\nВНИМАНИЕ. Пароли из прототипа перенести невозможно:');
    console.log('он хранил их в виде, который нельзя преобразовать в новый формат.');
    console.log(`Всем ${report.credentials.length} пользователям выданы временные пароли.`);
    console.log(`Список сохранён: ${file}`);
    console.log('Раздайте пароли лично, после раздачи удалите файл.');
    console.log('При первом входе система потребует сменить пароль.');
  }

  console.log('\nОбучения импортированы как черновики: проверьте их и опубликуйте вручную.');

  await closeDatabase();
}

main().catch(async (error) => {
  console.error('Ошибка импорта:', error);
  await closeDatabase();
  process.exit(1);
});
