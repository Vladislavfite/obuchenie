import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { Spinner, ErrorBox, PageHeader, Badge, EmptyState, Modal, useToast } from '../../components/ui';
import { PERMISSION_META, ROLE_TITLES, fmtDateRu } from '@tbedu/shared';
import { AuditLog } from '../Common';

/* Кабинет администратора. */

export function AdminHome() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-dashboard'], queryFn: () => api.get<any>('/api/admin/dashboard'),
  });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader title="Статистика" subtitle="Состояние системы" />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Пользователей" value={`${data.users.active} / ${data.users.total}`} />
        <Stat label="Сотрудников" value={data.employees.total} />
        <Stat label="Обучений" value={`${data.trainings.published} / ${data.trainings.total}`} />
        <Stat label="Просрочено" value={data.overdueAssignments} tone={data.overdueAssignments ? 'red' : 'slate'} />
        <Stat label="Попыток" value={data.attempts.total} />
        <Stat label="Сдано" value={data.attempts.passed} tone="green" />
        <Stat label="Средний балл" value={`${data.attempts.avgScore}%`} />
        <Stat label="Сертификатов" value={data.certificates.active} />
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <div className="card"><div className="card-body">
          <h2 className="mb-2 font-semibold">ИИ-ассистент</h2>
          <div className="flex items-center gap-2">
            <Badge tone={data.ai.enabled ? 'green' : 'slate'}>{data.ai.enabled ? 'Включён' : 'Выключен'}</Badge>
            <span className="text-sm text-slate-500">Запросов: {data.ai.total}, ошибок: {data.ai.errors}</span>
          </div>
        </div></div>
        <div className="card"><div className="card-body">
          <h2 className="mb-2 font-semibold">Интеграция с 1С</h2>
          {data.integration.configured ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={data.integration.lastStatus === 'success' ? 'green'
                : data.integration.lastStatus === 'partial' ? 'amber' : 'slate'}>
                {data.integration.isEnabled ? 'Настроена' : 'Выключена'}
              </Badge>
              <span className="text-sm text-slate-500">
                {data.integration.lastSyncAt ? `Синхронизация: ${fmtDateRu(data.integration.lastSyncAt)}` : 'Ещё не запускалась'}
              </span>
            </div>
          ) : <p className="text-sm text-slate-500">Не настроена</p>}
        </div></div>
      </div>

      <AuditLog />
    </div>
  );
}

function Stat({ label, value, tone = 'slate' }: { label: string; value: unknown; tone?: string }) {
  const color = tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-emerald-600' : 'text-slate-900';
  return (
    <div className="card"><div className="card-body py-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${color}`}>{String(value)}</p>
    </div></div>
  );
}

export function Users() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['users'], queryFn: () => api.get<any[]>('/api/users?limit=100'),
  });
  const toast = useToast();
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ fullName: '', login: '', password: '' });
  const [createError, setCreateError] = useState('');

  const createManager = useMutation({
    mutationFn: () => api.post('/api/users', { ...form, roleCodes: ['MANAGER'] }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      setCreating(false);
      setForm({ fullName: '', login: '', password: '' });
      setCreateError('');
      toast.show('Руководитель создан. При первом входе потребуется сменить пароль.');
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        const details = Object.values(e.fieldErrors).join(' ');
        setCreateError([e.message, details].filter(Boolean).join(' '));
      } else setCreateError('Не удалось создать руководителя.');
    },
  });

  const reset = useMutation({
    mutationFn: (id: string) => api.post<{ tempPassword: string }>(`/api/users/${id}/reset-password`),
    onSuccess: (r) => setTempPassword(r.tempPassword),
    onError: (e) => toast.show(e instanceof ApiError ? e.message : 'Ошибка', 'error'),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader title="Пользователи" subtitle={`Показано: ${data?.length ?? 0}`}
        actions={<button type="button" className="btn-primary" onClick={() => { setCreateError(''); setCreating(true); }}>Создать руководителя</button>} />
      <div className="space-y-2">
        {data?.map((u) => (
          <div key={u.id} className="card"><div className="card-body py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{u.fullName}</p>
                <p className="text-xs text-slate-500">
                  {u.login} · {u.roles.map((r: string) => ROLE_TITLES[r] ?? r).join(', ')}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {u.lastLoginAt ? `Последний вход: ${fmtDateRu(u.lastLoginAt)}` : 'Ещё не входил'}
                </p>
              </div>
              <Badge tone={u.isActive ? 'green' : 'red'}>{u.isActive ? 'Активен' : 'Заблокирован'}</Badge>
            </div>
            <button type="button" className="btn-secondary mt-3" onClick={() => reset.mutate(u.id)}>
              Сбросить пароль
            </button>
          </div></div>
        ))}
      </div>

      <Modal open={creating} title="Создать руководителя" onClose={() => { if (!createManager.isPending) setCreating(false); }}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setCreateError(''); createManager.mutate(); }}>
          <label className="block"><span className="label">ФИО</span><input className="field" required maxLength={200} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></label>
          <label className="block"><span className="label">Логин</span><input className="field" required minLength={3} maxLength={32} autoComplete="off" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} /><span className="hint">Латинские буквы, цифры, точка, дефис или подчёркивание.</span></label>
          <label className="block"><span className="label">Временный пароль</span><input className="field" type="password" required minLength={8} maxLength={200} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /><span className="hint">Не менее 8 символов. При первом входе его нужно сменить.</span></label>
          {createError && <p role="alert" className="text-sm text-red-600">{createError}</p>}
          <button type="submit" className="btn-primary" disabled={createManager.isPending}>{createManager.isPending ? 'Создание…' : 'Создать'}</button>
        </form>
      </Modal>
      <Modal open={!!tempPassword} title="Временный пароль" onClose={() => setTempPassword(null)}
        footer={<button type="button" className="btn-primary" onClick={() => setTempPassword(null)}>Понятно</button>}>
        <p className="mb-3 text-sm text-slate-700">Пароль показывается один раз. Передайте его пользователю.</p>
        <div className="rounded-lg bg-slate-100 px-4 py-3 text-center font-mono text-lg">{tempPassword}</div>
      </Modal>
      {toast.element}
    </div>
  );
}

export function AiSettings() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<any>(null);
  const [apiKey, setApiKey] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ai-settings'], queryFn: () => api.get<any>('/api/ai/settings'),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;
  const state = form ?? data;

  return (
    <div>
      <PageHeader title="AI Assistant" subtitle="Генерация учебных материалов по документам" />

      <div className="card mb-4"><div className="card-body">
        <label className="mb-4 flex items-center gap-3 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={state.enabled}
            onChange={(e) => setForm({ ...state, enabled: e.target.checked })} />
          Включить ИИ-ассистента
        </label>

        <div className="mb-4">
          <label className="label">Провайдер</label>
          <select className="field" value={state.provider}
            onChange={(e) => setForm({ ...state, provider: e.target.value })}>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>

        <div className="mb-4">
          <label className="label">Модель</label>
          <input className="field" value={state.model ?? ''}
            onChange={(e) => setForm({ ...state, model: e.target.value })} />
        </div>

        <div className="mb-4">
          <label className="label">API-ключ</label>
          <input className="field" type="password" placeholder={
            state.keys?.find((k: any) => k.provider === state.provider)?.masked || 'Ключ не задан'}
            value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <p className="hint">
            Ключ хранится в базе в зашифрованном виде и никогда не возвращается обратно.
            Оставьте поле пустым, чтобы сохранить прежний ключ.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary"
            onClick={async () => {
              try {
                await api.put('/api/ai/settings', { ...state, apiKey: apiKey || null });
                setApiKey('');
                toast.show('Настройки сохранены');
                void queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
              } catch (e) {
                toast.show(e instanceof ApiError ? e.message : 'Ошибка', 'error');
              }
            }}>Сохранить</button>
          <button type="button" className="btn-secondary"
            onClick={async () => {
              const r = await api.post<any>('/api/ai/test');
              toast.show(r.ok ? `Связь есть: ${r.model} (${r.durationMs} мс)` : `Ошибка: ${r.error}`,
                r.ok ? 'success' : 'error');
            }}>Проверить связь</button>
        </div>
      </div></div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Материалы, подготовленные ИИ, всегда требуют проверки человеком перед публикацией:
        модель опирается только на переданный текст и может ошибиться в формулировках.
      </div>
      {toast.element}
    </div>
  );
}

export function Integrations() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<any>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['onec'], queryFn: () => api.get<any>('/api/integrations/1c'),
  });
  const { data: logs } = useQuery({ queryKey: ['onec-logs'], queryFn: () => api.get<any[]>('/api/integrations/1c/logs') });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;
  const state = form ?? data;

  return (
    <div>
      <PageHeader title="Интеграция с 1С" subtitle="Загрузка сотрудников и оргструктуры" />

      <div className="card mb-4"><div className="card-body">
        <div className="mb-4">
          <label className="label">Способ обмена</label>
          <select className="field" value={state.transport}
            onChange={(e) => setForm({ ...state, transport: e.target.value })}>
            <option value="http_service">HTTP-сервис 1С</option>
            <option value="odata">OData-интерфейс</option>
            <option value="file_exchange">Выгрузка файлом</option>
            <option value="middleware">Промежуточный сервис</option>
          </select>
          <p className="hint">
            Если база 1С недоступна по сети, выберите «Выгрузка файлом»: данные передаются в теле запроса.
          </p>
        </div>

        {state.transport !== 'file_exchange' && (
          <div className="mb-4">
            <label className="label">Адрес</label>
            <input className="field" value={state.baseUrl ?? ''}
              onChange={(e) => setForm({ ...state, baseUrl: e.target.value })}
              placeholder="https://1c.example.kz/base/hs/tbedu" />
          </div>
        )}

        <label className="mb-4 flex items-center gap-3 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={!!state.isEnabled}
            onChange={(e) => setForm({ ...state, isEnabled: e.target.checked })} />
          Интеграция включена
        </label>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={async () => {
            try {
              await api.put('/api/integrations/1c', {
                transport: state.transport, baseUrl: state.baseUrl ?? null,
                authType: state.authType ?? 'none', isEnabled: !!state.isEnabled,
              });
              toast.show('Настройки сохранены');
              void queryClient.invalidateQueries({ queryKey: ['onec'] });
            } catch (e) { toast.show(e instanceof ApiError ? e.message : 'Ошибка', 'error'); }
          }}>Сохранить</button>
          <button type="button" className="btn-secondary" onClick={async () => {
            try {
              const r = await api.post<any>('/api/integrations/1c/sync', { dryRun: true });
              toast.show(`Проверка: получено ${r.received}, ошибок ${r.errors?.length ?? 0}`);
            } catch (e) { toast.show(e instanceof ApiError ? e.message : 'Ошибка', 'error'); }
          }}>Пробный запуск</button>
        </div>
      </div></div>

      <h2 className="mb-3 font-semibold">История синхронизаций</h2>
      {!logs || logs.length === 0 ? <EmptyState title="Синхронизаций пока не было" /> : (
        <div className="card divide-y divide-slate-100">
          {logs.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <p className="text-sm text-slate-900">{l.syncType}</p>
                <p className="text-xs text-slate-500">
                  получено {l.receivedCount}, создано {l.createdCount}, обновлено {l.updatedCount}, ошибок {l.errorCount}
                </p>
              </div>
              <Badge tone={l.status === 'success' ? 'green' : l.status === 'partial' ? 'amber' : 'red'}>
                {l.status === 'success' ? 'Успешно' : l.status === 'partial' ? 'С ошибками' : 'Ошибка'}
              </Badge>
            </div>
          ))}
        </div>
      )}
      {toast.element}
    </div>
  );
}

export function UiSettings() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [changes, setChanges] = useState<Record<string, boolean>>({});

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ui-modules'], queryFn: () => api.get<any[]>('/api/ui/modules'),
  });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;

  const cabinets = ['admin', 'manager', 'employee'] as const;
  const labels = { admin: 'Администратор', manager: 'Руководитель', employee: 'Сотрудник' };

  return (
    <div>
      <PageHeader title="Настройка интерфейса" subtitle="Какие разделы видны в кабинетах"
        actions={<button type="button" className="btn-primary" onClick={async () => {
          try {
            await api.put('/api/ui/modules', {
              modules: Object.entries(changes).map(([code, visible]) => ({ code, visible })),
            });
            toast.show('Сохранено');
            setChanges({});
            void queryClient.invalidateQueries({ queryKey: ['ui-modules'] });
          } catch (e) { toast.show(e instanceof ApiError ? e.message : 'Ошибка', 'error'); }
        }}>Сохранить</button>} />

      {cabinets.map((cab) => (
        <section key={cab} className="mb-5">
          <h2 className="mb-2 font-semibold">{labels[cab]}</h2>
          <div className="card divide-y divide-slate-100">
            {data?.filter((m) => m.cabinet === cab).map((m) => (
              <label key={m.code} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className={m.isCore ? 'text-slate-400' : ''}>
                  {m.title}{m.isCore && ' · основной раздел'}
                </span>
                <input type="checkbox" className="h-5 w-5" disabled={m.isCore}
                  checked={changes[m.code] ?? m.isVisible}
                  onChange={(e) => setChanges({ ...changes, [m.code]: e.target.checked })} />
              </label>
            ))}
          </div>
        </section>
      ))}
      <p className="text-xs text-slate-500">
        Основные разделы скрыть нельзя: без них кабинет перестанет работать.
      </p>
      {toast.element}
    </div>
  );
}

export function Permissions() {
  const { data: roles, isLoading } = useQuery({ queryKey: ['roles'], queryFn: () => api.get<any[]>('/api/roles') });
  const { data: perms } = useQuery({ queryKey: ['permissions'], queryFn: () => api.get<any[]>('/api/permissions') });
  if (isLoading) return <Spinner />;

  const groups = [...new Set((perms ?? []).map((p) => p.group))];

  return (
    <div>
      <PageHeader title="Права ролей" subtitle="Какие действия доступны каждой роли" />
      <div className="space-y-4">
        {roles?.map((role) => (
          <div key={role.id} className="card"><div className="card-body">
            <h2 className="mb-3 font-semibold">{role.title}</h2>
            <div className="space-y-3">
              {groups.map((g) => {
                const inGroup = (perms ?? []).filter((p) => p.group === g && role.permissions.includes(p.code));
                if (inGroup.length === 0) return null;
                return (
                  <div key={g}>
                    <p className="mb-1 text-xs font-medium text-slate-500">{g}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {inGroup.map((p) => <Badge key={p.code} tone="blue">{p.title}</Badge>)}
                    </div>
                  </div>
                );
              })}
              {role.permissions.length === 0 && <p className="text-sm text-slate-500">Особых прав нет.</p>}
            </div>
          </div></div>
        ))}
      </div>
    </div>
  );
}

export function PlatformSettings() {
  const toast = useToast();
  const [form, setForm] = useState<any>(null);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['settings'], queryFn: () => api.get<any>('/api/settings'),
  });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;
  const s = form ?? data;

  const fields: Array<[string, string, string]> = [
    ['certWarningDays', 'Предупреждать об истечении сертификата за (дней)', ''],
    ['dueWarningDays', 'Предупреждать о сроке обучения за (дней)', ''],
    ['inactivityDays', 'Считать сотрудника неактивным после (дней)', ''],
    ['repeatedFailureThreshold', 'Отмечать повторную несдачу после (попыток)', 'Такие сотрудники попадают в раздел «Требуют внимания».'],
    ['defaultPassingScore', 'Проходной балл по умолчанию, %', ''],
    ['certificateValidityDays', 'Срок действия сертификата, дней', ''],
  ];

  return (
    <div>
      <PageHeader title="Настройки платформы" />
      <div className="card"><div className="card-body">
        {fields.map(([key, label, hint]) => (
          <div key={key} className="mb-4">
            <label className="label">{label}</label>
            <input type="number" className="field" value={s[key] ?? 0}
              onChange={(e) => setForm({ ...s, [key]: Number(e.target.value) })} />
            {hint && <p className="hint">{hint}</p>}
          </div>
        ))}
        <button type="button" className="btn-primary" onClick={async () => {
          try {
            const { organizationId, updatedAt, branding, ...payload } = s;
            await api.put('/api/settings', payload);
            toast.show('Настройки сохранены');
          } catch (e) { toast.show(e instanceof ApiError ? e.message : 'Ошибка', 'error'); }
        }}>Сохранить</button>
      </div></div>
      {toast.element}
    </div>
  );
}
