import { eq, and, isNull } from 'drizzle-orm';
import {
  PERMISSION, PERMISSION_META, ROLE, ROLE_TITLES, ROLE_DEFAULT_PERMISSIONS,
  UI_MODULES, slugify, todayISO,
} from '@tbedu/shared';
import { db, schema, closeDatabase } from '../db/client.js';
import { config } from '../core/config.js';
import { hashPassword } from '../core/password.js';
import { contentHash } from '../modules/training/service.js';

/* Первичное наполнение базы.

   Скрипт идемпотентен: повторный запуск не создаёт дубликатов и не трогает
   существующие данные. Это важно, потому что на многих платформах деплоя
   сид выполняется при каждом релизе. */

async function seedPermissions() {
  const codes = Object.values(PERMISSION);
  for (const code of codes) {
    const meta = PERMISSION_META[code];
    await db.insert(schema.permissions)
      .values({ code, groupName: meta?.group ?? 'Прочее', description: meta?.title ?? code })
      .onConflictDoNothing({ target: schema.permissions.code });
  }
  console.log(`  права: ${codes.length}`);
}

async function seedRoles() {
  for (const [code, permissionCodes] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
    const existing = await db.select().from(schema.roles)
      .where(and(eq(schema.roles.code, code), isNull(schema.roles.organizationId))).limit(1);

    let roleId: string;
    if (existing[0]) {
      roleId = existing[0].id;
    } else {
      const [created] = await db.insert(schema.roles)
        .values({ code, name: ROLE_TITLES[code] ?? code, isSystem: true, organizationId: null })
        .returning();
      roleId = created.id;
    }

    /* Права роли пересобираем: если в коде появилось новое право,
       системная роль должна его получить. Пользовательские назначения
       (user_permissions) при этом не трогаются. */
    const permissions = permissionCodes.length
      ? await db.select().from(schema.permissions)
      : [];
    const wanted = permissions.filter((p) => permissionCodes.includes(p.code));
    for (const p of wanted) {
      await db.insert(schema.rolePermissions).values({ roleId, permissionId: p.id }).onConflictDoNothing();
    }
  }
  console.log(`  роли: ${Object.keys(ROLE_DEFAULT_PERMISSIONS).length}`);
}

async function seedUiModules() {
  for (const [index, mod] of UI_MODULES.entries()) {
    await db.insert(schema.uiModules).values({
      code: mod.code, cabinet: mod.cabinet, title: mod.title,
      route: mod.route, sortOrder: index, isCore: mod.isCore,
    }).onConflictDoUpdate({
      target: schema.uiModules.code,
      set: { title: mod.title, route: mod.route, cabinet: mod.cabinet, isCore: mod.isCore },
    });
  }
  console.log(`  разделы интерфейса: ${UI_MODULES.length}`);
}

async function seedProviders() {
  for (const p of [
    { code: 'anthropic', label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com' },
    { code: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com' },
  ]) {
    await db.insert(schema.aiProviders).values(p).onConflictDoNothing({ target: schema.aiProviders.code });
  }
}

async function seedOrganization() {
  const slug = slugify(config.bootstrap.orgName);
  const existing = await db.select().from(schema.organizations)
    .where(eq(schema.organizations.slug, slug)).limit(1);
  if (existing[0]) return existing[0];

  const [created] = await db.insert(schema.organizations)
    .values({ name: config.bootstrap.orgName, slug }).returning();

  await db.insert(schema.platformSettings)
    .values({ organizationId: created.id }).onConflictDoNothing();

  console.log(`  организация: ${created.name}`);
  return created;
}

async function seedAdmin(organizationId: string) {
  const login = config.bootstrap.login.toLowerCase();
  const existing = await db.select().from(schema.users)
    .where(and(eq(schema.users.organizationId, organizationId), eq(schema.users.login, login))).limit(1);
  if (existing[0]) {
    console.log(`  администратор ${login} уже существует — пропускаю`);
    return existing[0];
  }

  const role = await db.select().from(schema.roles)
    .where(and(eq(schema.roles.code, ROLE.ADMIN), isNull(schema.roles.organizationId))).limit(1);

  const [user] = await db.insert(schema.users).values({
    organizationId,
    login,
    fullName: config.bootstrap.name,
    passwordHash: await hashPassword(config.bootstrap.password),
    /* Первый вход обязывает сменить пароль: значение из .env попадает
       в историю команд и в репозиторий. */
    mustChangePassword: true,
  }).returning();

  if (role[0]) await db.insert(schema.userRoles).values({ userId: user.id, roleId: role[0].id });

  console.log(`  администратор: ${login} / ${config.bootstrap.password} (смена пароля при первом входе)`);
  return user;
}

async function seedDemo(organizationId: string, adminId: string) {
  const existing = await db.select().from(schema.trainingBlocks)
    .where(eq(schema.trainingBlocks.organizationId, organizationId)).limit(1);
  if (existing[0]) {
    console.log('  демо-данные уже есть — пропускаю');
    return;
  }

  const [dept] = await db.insert(schema.departments)
    .values({ organizationId, name: 'Производственный участок №1' }).returning();
  const [position] = await db.insert(schema.positions)
    .values({ organizationId, name: 'Электромонтёр' }).returning();
  const [profession] = await db.insert(schema.professions)
    .values({ organizationId, name: 'Электромонтёр по ремонту оборудования' }).returning();

  const managerRole = await db.select().from(schema.roles)
    .where(and(eq(schema.roles.code, ROLE.MANAGER), isNull(schema.roles.organizationId))).limit(1);
  const employeeRole = await db.select().from(schema.roles)
    .where(and(eq(schema.roles.code, ROLE.EMPLOYEE), isNull(schema.roles.organizationId))).limit(1);

  const [manager] = await db.insert(schema.users).values({
    organizationId, login: 'manager', fullName: 'Иванов Пётр Сергеевич',
    passwordHash: await hashPassword('manager123'), mustChangePassword: true,
  }).returning();
  if (managerRole[0]) await db.insert(schema.userRoles).values({ userId: manager.id, roleId: managerRole[0].id });
  const [managerProfile] = await db.insert(schema.managerProfiles)
    .values({ userId: manager.id, organizationId, departmentId: dept.id }).returning();
  await db.insert(schema.managerDepartments)
    .values({ managerProfileId: managerProfile.id, departmentId: dept.id, includeChildren: true });

  const employees = [
    { login: 'petrov', fullName: 'Петров Алексей Иванович' },
    { login: 'sidorov', fullName: 'Сидоров Николай Петрович' },
    { login: 'kuznetsov', fullName: 'Кузнецов Дмитрий Олегович' },
  ];
  const employeeIds: string[] = [];
  for (const e of employees) {
    const [user] = await db.insert(schema.users).values({
      organizationId, login: e.login, fullName: e.fullName,
      passwordHash: await hashPassword('employee123'), mustChangePassword: true,
    }).returning();
    if (employeeRole[0]) await db.insert(schema.userRoles).values({ userId: user.id, roleId: employeeRole[0].id });
    const [profile] = await db.insert(schema.employeeProfiles).values({
      userId: user.id, organizationId, departmentId: dept.id,
      positionId: position.id, professionId: profession.id,
      hiredAt: todayISO(-400), personnelNumber: `T-${1000 + employeeIds.length}`,
    }).returning();
    employeeIds.push(profile.id);
  }

  /* Демо-обучение: один блок, один опубликованный модуль с тестом. */
  const [block] = await db.insert(schema.trainingBlocks).values({
    organizationId, slug: 'vvodnyy-instruktazh',
    title: 'Вводный инструктаж по охране труда',
    description: 'Базовые требования охраны труда для вновь принятых работников.',
    status: 'published', sequential: true, createdBy: adminId, publishedAt: new Date(),
  }).returning();

  const [mod] = await db.insert(schema.trainingModules).values({
    organizationId, trainingId: block.id, slug: 'obshchie-trebovaniya',
    sortOrder: 0, currentVersion: 1, status: 'published',
  }).returning();

  const content = {
    title: 'Общие требования охраны труда',
    chapter: 'Раздел 1',
    description: 'Права и обязанности работника в области охраны труда.',
    speaker: null, accessCode: null,
    passingScore: 70, attemptLimit: 3, isRequired: true,
    randomQuestions: false, questionCount: 0, shuffleOptions: false,
    contentItems: [
      { type: 'text' as const, title: 'Обязанности работника', sortOrder: 0, payload: {
        html: '<h3>Обязанности работника</h3><p>Работник обязан соблюдать требования охраны труда, правильно применять средства индивидуальной защиты и немедленно извещать руководителя о любой ситуации, угрожающей жизни и здоровью людей.</p><ul><li>Проходить обучение и проверку знаний</li><li>Проходить обязательные медицинские осмотры</li><li>Извещать о несчастных случаях</li></ul>' } },
      { type: 'text' as const, title: 'Права работника', sortOrder: 1, payload: {
        html: '<h3>Права работника</h3><p>Работник имеет право на рабочее место, соответствующее требованиям охраны труда, на получение достоверной информации об условиях труда и на отказ от работы при возникновении опасности для жизни и здоровья.</p>' } },
    ],
    questions: [
      { sortOrder: 0, text: 'Что обязан сделать работник при возникновении ситуации, угрожающей жизни и здоровью людей?',
        type: 'single' as const, explanation: 'Работник обязан немедленно известить непосредственного руководителя — это позволяет остановить работы до устранения опасности.',
        sourceReference: 'Трудовой кодекс РК, обязанности работника', topic: 'Обязанности', topicId: null,
        difficulty: 'easy' as const, isPractical: false, points: 1, media: { type: 'none' as const },
        imagePrompt: null, timestampSec: null, origin: null,
        options: [
          { sortOrder: 0, text: 'Немедленно известить непосредственного руководителя', isCorrect: true },
          { sortOrder: 1, text: 'Продолжить работу до конца смены', isCorrect: false },
          { sortOrder: 2, text: 'Устранить опасность самостоятельно любым способом', isCorrect: false },
        ] },
      { sortOrder: 1, text: 'Имеет ли работник право отказаться от работы при опасности для жизни и здоровья?',
        type: 'single' as const, explanation: 'Да. Отказ от выполнения работы при возникновении опасности — это право работника, и такой отказ не влечёт дисциплинарной ответственности.',
        sourceReference: 'Трудовой кодекс РК, права работника', topic: 'Права', topicId: null,
        difficulty: 'normal' as const, isPractical: true, points: 1, media: { type: 'none' as const },
        imagePrompt: null, timestampSec: null, origin: null,
        options: [
          { sortOrder: 0, text: 'Да, это его право', isCorrect: true },
          { sortOrder: 1, text: 'Нет, работу нужно выполнить в любом случае', isCorrect: false },
          { sortOrder: 2, text: 'Только с письменного согласия профсоюза', isCorrect: false },
        ] },
    ],
  };

  const [version] = await db.insert(schema.trainingModuleVersions).values({
    organizationId, moduleId: mod.id, version: 1, status: 'published',
    title: content.title, chapter: content.chapter, description: content.description,
    passingScore: content.passingScore, attemptLimit: content.attemptLimit,
    isRequired: true, contentHash: contentHash(content as never),
    publishedAt: new Date(), publishedBy: adminId,
  }).returning();

  await db.insert(schema.trainingContentItems).values(
    content.contentItems.map((i) => ({
      moduleVersionId: version.id, sortOrder: i.sortOrder, type: i.type,
      title: i.title, payload: i.payload as object,
    })),
  );

  for (const q of content.questions) {
    const [created] = await db.insert(schema.questions).values({
      moduleVersionId: version.id, sortOrder: q.sortOrder, text: q.text, type: q.type,
      explanation: q.explanation, sourceReference: q.sourceReference, topic: q.topic,
      difficulty: q.difficulty, isPractical: q.isPractical, points: q.points,
      media: q.media as object,
    }).returning();
    await db.insert(schema.questionOptions).values(
      q.options.map((o) => ({ questionId: created.id, sortOrder: o.sortOrder, text: o.text, isCorrect: o.isCorrect })),
    );
  }

  await db.insert(schema.assignments).values(
    employeeIds.map((employeeId) => ({
      organizationId, trainingId: block.id, employeeId,
      assignedBy: manager.id, dueDate: todayISO(14), priority: 'high', isRequired: true,
    })),
  );

  console.log('  демо: 1 руководитель, 3 сотрудника, 1 обучение с тестом');
  console.log('  пароли: manager/manager123, petrov|sidorov|kuznetsov / employee123');
}

async function main() {
  console.log('Наполняю базу данных…');
  await seedPermissions();
  await seedRoles();
  await seedUiModules();
  await seedProviders();
  const org = await seedOrganization();
  const admin = await seedAdmin(org.id);
  if (config.seedDemo) await seedDemo(org.id, admin.id);
  console.log('Готово.');
  await closeDatabase();
}

main().catch(async (error) => {
  console.error('Ошибка наполнения базы:', error);
  await closeDatabase();
  process.exit(1);
});
