import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { Forbidden } from './errors.js';

/* Вычисление эффективных прав пользователя.

   Права = объединение прав всех ролей
           + индивидуальные allow
           − индивидуальные deny

   deny сильнее allow: если администратор явно запретил право, роль его не
   возвращает. Это позволяет сузить права конкретному человеку, не создавая
   отдельную роль. */

export async function effectivePermissions(userId: string): Promise<string[]> {
  const roleRows = await db
    .select({ roleId: schema.userRoles.roleId })
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, userId));

  const roleIds = roleRows.map((r) => r.roleId);
  const granted = new Set<string>();

  if (roleIds.length > 0) {
    const rows = await db
      .select({ code: schema.permissions.code })
      .from(schema.rolePermissions)
      .innerJoin(schema.permissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
      .where(inArray(schema.rolePermissions.roleId, roleIds));
    for (const row of rows) granted.add(row.code);
  }

  const overrides = await db
    .select({ code: schema.permissions.code, effect: schema.userPermissions.effect })
    .from(schema.userPermissions)
    .innerJoin(schema.permissions, eq(schema.permissions.id, schema.userPermissions.permissionId))
    .where(eq(schema.userPermissions.userId, userId));

  for (const row of overrides) {
    if (row.effect === 'allow') granted.add(row.code);
  }
  for (const row of overrides) {
    if (row.effect === 'deny') granted.delete(row.code);
  }

  return [...granted].sort();
}

export async function userRoleCodes(userId: string): Promise<string[]> {
  const rows = await db
    .select({ code: schema.roles.code })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(eq(schema.userRoles.userId, userId));
  return rows.map((r) => r.code);
}

export function assertPermission(permissions: string[], required: string): void {
  if (!permissions.includes(required)) {
    throw Forbidden(`Недостаточно прав: требуется «${required}».`);
  }
}

/* Подразделения, видимые руководителю, с раскрытием дерева (§62, §63 ТЗ).
   Администратор видит организацию целиком — для него функция не вызывается. */
export async function visibleDepartmentIds(userId: string, organizationId: string): Promise<string[] | null> {
  const profile = await db
    .select({ id: schema.managerProfiles.id })
    .from(schema.managerProfiles)
    .where(eq(schema.managerProfiles.userId, userId))
    .limit(1);

  if (profile.length === 0) return [];

  const assigned = await db
    .select({
      departmentId: schema.managerDepartments.departmentId,
      includeChildren: schema.managerDepartments.includeChildren,
    })
    .from(schema.managerDepartments)
    .where(eq(schema.managerDepartments.managerProfileId, profile[0].id));

  /* Зона не задана — руководитель не ограничен подразделениями,
     но остаётся в пределах своей организации. */
  if (assigned.length === 0) return null;

  const all = await db
    .select({ id: schema.departments.id, parentId: schema.departments.parentId })
    .from(schema.departments)
    .where(eq(schema.departments.organizationId, organizationId));

  const childrenOf = new Map<string, string[]>();
  for (const dep of all) {
    if (!dep.parentId) continue;
    const list = childrenOf.get(dep.parentId) ?? [];
    list.push(dep.id);
    childrenOf.set(dep.parentId, list);
  }

  const result = new Set<string>();
  const walk = (id: string) => {
    if (result.has(id)) return;
    result.add(id);
    for (const child of childrenOf.get(id) ?? []) walk(child);
  };

  for (const row of assigned) {
    if (row.includeChildren) walk(row.departmentId);
    else result.add(row.departmentId);
  }

  return [...result];
}
