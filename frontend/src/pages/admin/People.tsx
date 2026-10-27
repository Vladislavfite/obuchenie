import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { Badge, ErrorBox, Modal, PageHeader, Spinner, useToast } from '../../components/ui';

type Reference = { id: string; name: string };
type Person = { id: string; userId?: string; fullName: string; login: string; isActive: boolean; departmentId?: string | null; positionId?: string | null; departmentName?: string | null; positionName?: string | null };

export function People() {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<'manager' | 'employee' | null>(null);
  const [form, setForm] = useState({ fullName: '', login: '', password: '', department: '', position: '' });
  const [error, setError] = useState('');
  const [password, setPassword] = useState<string | null>(null);
  const managers = useQuery({ queryKey: ['managers'], queryFn: () => api.get<Person[]>('/api/managers') });
  const employees = useQuery({ queryKey: ['all-employees'], queryFn: async () => {
    const result: Person[] = [];
    for (let page = 1; ; page++) {
      const batch = await api.get<Person[]>(`/api/employees?limit=100&page=${page}`);
      result.push(...batch);
      if (batch.length < 100) return result;
    }
  } });
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Reference[]>('/api/departments') });
  const positions = useQuery({ queryKey: ['positions'], queryFn: () => api.get<Reference[]>('/api/positions') });
  const reset = useMutation({ mutationFn: (id: string) => api.post<{ tempPassword: string }>(`/api/users/${id}/reset-password`),
    onSuccess: (r) => setPassword(r.tempPassword), onError: (e) => toast.show(e instanceof Error ? e.message : 'Ошибка', 'error') });
  const create = useMutation({ mutationFn: async () => {
    const resolve = async (name: string, rows: Reference[], path: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const existing = rows.find((r) => r.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
      if (existing) return existing.id;
      const created = await api.post<Reference>(path, { name: trimmed });
      await qc.invalidateQueries({ queryKey: [path.slice(5)] });
      return created.id;
    };
    const departmentId = await resolve(form.department, departments.data ?? [], '/api/departments');
    const positionId = await resolve(form.position, positions.data ?? [], '/api/positions');
    const body = { fullName: form.fullName.trim(), login: form.login, password: form.password, departmentId, positionId };
    if (kind === 'manager') await api.post('/api/users', { ...body, roleCodes: ['MANAGER'] });
    else await api.post('/api/employees', body);
  }, onSuccess: () => {
    void qc.invalidateQueries({ queryKey: ['managers'] });
    void qc.invalidateQueries({ queryKey: ['all-employees'] });
    setKind(null); setForm({ fullName: '', login: '', password: '', department: '', position: '' }); setError('');
    toast.show('Пользователь создан. При первом входе потребуется сменить пароль.');
  }, onError: (e) => {
    if (e instanceof ApiError) setError([e.message, ...Object.values(e.fieldErrors)].join(' '));
    else setError('Не удалось создать пользователя.');
  } });
  const queries = [managers, employees, departments, positions];
  if (queries.some((q) => q.isLoading)) return <Spinner />;
  const failed = queries.find((q) => q.error);
  if (failed) return <ErrorBox error={failed.error} onRetry={() => void failed.refetch()} />;
  const list = (title: string, people: Person[]) => <section className="mb-6"><h2 className="mb-3 text-lg font-semibold">{title} ({people.length})</h2>
    {people.length === 0 ? <p className="text-sm text-slate-500">Пока никого нет.</p> : <div className="space-y-2">{people.map((p) => <div key={p.id} className="card"><div className="card-body py-3">
      <div className="flex flex-wrap justify-between gap-2"><div><p className="font-medium">{p.fullName}</p><p className="text-sm text-slate-500">{p.login} · {[p.departmentName ?? departments.data?.find((d) => d.id === p.departmentId)?.name, p.positionName ?? positions.data?.find((d) => d.id === p.positionId)?.name].filter(Boolean).join(' · ') || 'Подразделение и должность не указаны'}</p></div><Badge tone={p.isActive ? 'green' : 'red'}>{p.isActive ? 'Активен' : 'Заблокирован'}</Badge></div>
      <button type="button" className="btn-secondary mt-3" onClick={() => reset.mutate(p.userId ?? p.id)}>Сбросить пароль</button>
    </div></div>)}</div>}</section>;
  return <div><PageHeader title="Пользователи" actions={<div className="flex flex-wrap gap-2"><button className="btn-primary" onClick={() => { setError(''); setKind('manager'); }}>Добавить руководителя</button><button className="btn-secondary" onClick={() => { setError(''); setKind('employee'); }}>Добавить сотрудника</button></div>} />
    {list('Руководители', managers.data ?? [])}{list('Сотрудники', employees.data ?? [])}
    <section className="card"><div className="card-body"><h2 className="font-semibold">Должности</h2><p className="mt-2 text-sm text-slate-600">{positions.data?.map((p) => p.name).join(', ') || 'Должности пока не добавлены.'}</p><p className="hint">Должность можно выбрать или добавить при создании пользователя.</p></div></section>
    <Modal open={kind !== null} title={kind === 'manager' ? 'Новый руководитель' : 'Новый сотрудник'} onClose={() => { if (!create.isPending) setKind(null); }}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(''); create.mutate(); }}>
        <label className="block"><span className="label">ФИО</span><input className="field" required maxLength={200} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></label>
        <label className="block"><span className="label">Логин</span><input className="field" required minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" autoComplete="off" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} /><span className="hint">Латинские буквы, цифры, точка, дефис или подчёркивание.</span></label>
        <label className="block"><span className="label">Временный пароль</span><input className="field" type="password" required minLength={8} maxLength={200} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        <label className="block"><span className="label">Подразделение</span><input className="field" list="department-options" maxLength={200} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Выберите или введите новое" /><datalist id="department-options">{departments.data?.map((d) => <option key={d.id} value={d.name} />)}</datalist></label>
        <label className="block"><span className="label">Должность</span><input className="field" list="position-options" maxLength={200} value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="Выберите или введите новую" /><datalist id="position-options">{positions.data?.map((p) => <option key={p.id} value={p.name} />)}</datalist></label>
        {kind === 'manager' && <p className="hint">Выбранное подразделение и его дочерние подразделения станут зоной ответственности руководителя. Если оставить поле пустым, он увидит все подразделения организации.</p>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="btn-primary" disabled={create.isPending}>{create.isPending ? 'Создание…' : 'Создать'}</button>
      </form>
    </Modal>
    <Modal open={!!password} title="Временный пароль" onClose={() => setPassword(null)}><p className="mb-3 text-sm">Передайте пароль пользователю. После закрытия он больше не показывается.</p><div className="rounded-lg bg-slate-100 p-3 text-center font-mono">{password}</div></Modal>
    {toast.element}</div>;
}
