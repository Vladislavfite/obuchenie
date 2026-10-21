import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { initials } from '@tbedu/shared';
import { useAuth } from '../lib/auth';

/* Оболочка кабинета.

   На телефоне — нижняя панель с четырьмя основными разделами и кнопкой
   «Ещё»; на планшете и шире — боковое меню. Состав разделов приходит
   с сервера, поэтому администратор может скрыть лишнее (§47 ТЗ). */

export function Layout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  if (!user) return null;

  const modules = user.uiModules;
  const primary = modules.slice(0, 4);
  const rest = modules.slice(4);
  const pages = user.customPages.map((p) => ({
    code: `page.${p.slug}`, title: p.title, route: `/${user.cabinet}/pages/${p.slug}`, cabinet: user.cabinet,
  }));
  const allExtra = [...rest, ...pages];

  return (
    <div className="min-h-screen lg:flex">
      {/* Боковое меню на широких экранах */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
        <div className="flex h-16 items-center border-b border-slate-200 px-5">
          <span className="text-lg font-bold text-brand-700">TBEDU</span>
        </div>
        <nav className="space-y-1 p-3">
          {[...modules, ...pages].map((m) => (
            <NavLink key={m.code} to={m.route} end={m.route === `/${user.cabinet}`}
              className={({ isActive }) => `block rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'}`}>
              {m.title}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-brand-700 lg:hidden">TBEDU</span>
            <span className="hidden truncate text-sm text-slate-500 sm:block">{user.organization.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-slate-900">{user.user.fullName}</p>
              <p className="text-xs text-slate-500">{user.roles.map((r) => roleTitle(r)).join(', ')}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
              {initials(user.user.fullName)}
            </div>
            <button type="button" onClick={() => void logout()}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Выйти">
              ⏻
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 py-5 pb-24 sm:px-6 lg:pb-8">
          <div className="mx-auto max-w-6xl"><Outlet /></div>
        </main>
      </div>

      {/* Нижняя панель на телефоне */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white lg:hidden"
           style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex">
          {primary.map((m) => (
            <NavLink key={m.code} to={m.route} end={m.route === `/${user.cabinet}`}
              className={({ isActive }) => `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] ${
                isActive ? 'text-brand-700' : 'text-slate-500'}`}>
              <span className="truncate px-1">{m.title}</span>
            </NavLink>
          ))}
          {allExtra.length > 0 && (
            <button type="button" onClick={() => setMenuOpen(true)}
              className="flex min-h-[56px] flex-1 flex-col items-center justify-center text-[11px] text-slate-500">
              Ещё
            </button>
          )}
        </div>
      </nav>

      {menuOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden" onClick={() => setMenuOpen(false)}>
          <div className="absolute bottom-0 left-0 right-0 max-h-[70vh] overflow-y-auto rounded-t-2xl bg-white p-4"
               onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold">Все разделы</span>
              <button type="button" onClick={() => setMenuOpen(false)} className="p-2 text-slate-400">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {allExtra.map((m) => (
                <NavLink key={m.code} to={m.route} onClick={() => setMenuOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-3 text-sm text-slate-700">
                  {m.title}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function roleTitle(code: string): string {
  const titles: Record<string, string> = {
    SUPER_ADMIN: 'Суперадминистратор', ADMIN: 'Администратор', MANAGER: 'Руководитель',
    EMPLOYEE: 'Сотрудник', METHODIST: 'Методист', HR: 'Кадры',
    SAFETY_SPECIALIST: 'Охрана труда', AUDITOR: 'Аудитор', LECTURER: 'Лектор',
  };
  return titles[code] ?? code;
}
