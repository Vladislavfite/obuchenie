import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, query } from '../../lib/api';
import { Spinner, ErrorBox, PageHeader, Badge, EmptyState, Modal, useToast } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { PERMISSION } from '@tbedu/shared';

export function Employees() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: '', login: '', password: '', departmentId: '', positionId: '', professionId: '', personnelNumber: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['employees', search],
    queryFn: () => api.get<any[]>(`/api/employees${query({ search, limit: 100 })}`),
  });
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<any[]>('/api/departments') });
  const { data: positions } = useQuery({ queryKey: ['positions'], queryFn: () => api.get<any[]>('/api/positions') });
  const { data: professions } = useQuery({ queryKey: ['professions'], queryFn: () => api.get<any[]>('/api/professions') });

  async function suggestLogin(fullName: string) {
    if (!fullName.trim()) return;
    try {
      const r = await api.get<{ login: string }>(`/api/users/suggest-login${query({ fullName })}`);
      setForm((f) => ({ ...f, login: r.login }));
    } catch { /* подсказка необязательна */ }
  }

  const create = useMutation({
    mutationFn: () => api.post<any>('/api/employees', {
      ...form,
      departmentId: form.departmentId || null,
      positionId: form.positionId || null,
      professionId: form.professionId || null,
      personnelNumber: form.personnelNumber || null,
    }),
    onSuccess: () => {
      setCreateOpen(false);
      setTempPassword(form.password);
      setForm({ fullName: '', login: '', password: '', departmentId: '', positionId: '', professionId: '', personnelNumber: '' });
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        setFieldErrors(e.fieldErrors);
        toast.show(e.message, 'error');
      }
    },
  });

  const reset = useMutation({
    mutationFn: (id: string) => api.post<{ tempPassword: string }>(`/api/employees/${id}/reset-password`),
    onSuccess: (r) => setTempPassword(r.tempPassword),
    onError: (e) => toast.show(e instanceof ApiError ? e.message : 'Ошибка', 'error'),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader title="Сотрудники" subtitle={`Всего: ${data?.length ?? 0}`}
        actions={can(PERMISSION.EMPLOYEE_EDIT) && (
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>Добавить сотрудника</button>
        )} />

      <input className="field mb-4" placeholder="Поиск по имени, логину или табельному номеру"
        value={search} onChange={(e) => setSearch(e.target.value)} />

      {!data || data.length === 0 ? (
        <EmptyState title="Сотрудники не найдены"
          hint={search ? 'Измените условия поиска.' : 'Добавьте сотрудников вручную или загрузите из 1С.'} />
      ) : (
        <div className="space-y-2">
          {data.map((e) => (
            <div key={e.id} className="card">
              <div className="card-body py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{e.fullName}</p>
                    <p className="text-xs text-slate-500">
                      {[e.departmentName, e.positionName].filter(Boolean).join(' · ') || 'Подразделение не указано'}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Логин: {e.login}{e.personnelNumber ? ` · таб. № ${e.personnelNumber}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {e.source === 'onec' && <Badge tone="blue">Из 1С</Badge>}
                    <Badge tone={e.isActive ? 'green' : 'red'}>{e.isActive ? 'Активен' : 'Заблокирован'}</Badge>
                  </div>
                </div>
                {can(PERMISSION.EMPLOYEE_EDIT) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary" onClick={() => reset.mutate(e.id)}>
                      Сбросить пароль
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={createOpen} title="Новый сотрудник" onClose={() => setCreateOpen(false)}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>Отмена</button>
          <button type="button" className="btn-primary" disabled={create.isPending}
            onClick={() => create.mutate()}>Создать</button>
        </>}>
        <div className="mb-4">
          <label className="label">Фамилия, имя, отчество</label>
          <input className="field" value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            onBlur={(e) => void suggestLogin(e.target.value)} />
          {fieldErrors.fullName && <p className="error-text">{fieldErrors.fullName}</p>}
        </div>
        <div className="mb-4">
          <label className="label">Логин</label>
          <input className="field" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
          <p className="hint">Предлагается автоматически по фамилии. Латиница, цифры, точка.</p>
          {fieldErrors.login && <p className="error-text">{fieldErrors.login}</p>}
        </div>
        <div className="mb-4">
          <label className="label">Временный пароль</label>
          <input className="field" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <p className="hint">Не менее 8 символов. Сотрудник сменит его при первом входе.</p>
          {fieldErrors.password && <p className="error-text">{fieldErrors.password}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Подразделение</label>
            <select className="field" value={form.departmentId}
              onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
              <option value="">Не выбрано</option>
              {departments?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Должность</label>
            <select className="field" value={form.positionId}
              onChange={(e) => setForm({ ...form, positionId: e.target.value })}>
              <option value="">Не выбрано</option>
              {positions?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Профессия</label>
            <select className="field" value={form.professionId}
              onChange={(e) => setForm({ ...form, professionId: e.target.value })}>
              <option value="">Не выбрано</option>
              {professions?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Табельный номер</label>
            <input className="field" value={form.personnelNumber}
              onChange={(e) => setForm({ ...form, personnelNumber: e.target.value })} />
          </div>
        </div>
      </Modal>

      <Modal open={!!tempPassword} title="Временный пароль" onClose={() => setTempPassword(null)}
        footer={<button type="button" className="btn-primary" onClick={() => setTempPassword(null)}>Понятно</button>}>
        <p className="mb-3 text-sm text-slate-700">
          Передайте пароль сотруднику. Он показывается один раз — после закрытия окна восстановить его нельзя,
          можно только сбросить заново.
        </p>
        <div className="rounded-lg bg-slate-100 px-4 py-3 text-center font-mono text-lg">{tempPassword}</div>
      </Modal>

      {toast.element}
    </div>
  );
}
