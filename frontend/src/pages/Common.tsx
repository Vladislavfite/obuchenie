import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Spinner, ErrorBox, PageHeader, Badge, EmptyState, RichText, useToast } from '../components/ui';
import { fmtDateRu, AUDIT_LABELS } from '@tbedu/shared';
import { useAuth } from '../lib/auth';

/* Страницы, одинаковые для нескольких кабинетов. */

export function Certificates({ scope }: { scope: 'my' | 'manage' }) {
  const path = scope === 'my' ? '/api/my/certificates' : '/api/certificates?limit=100';
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['certificates', scope], queryFn: () => api.get<any[]>(path),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader title="Сертификаты" subtitle={`Всего: ${data?.length ?? 0}`} />
      {!data || data.length === 0 ? (
        <EmptyState title="Сертификатов пока нет"
          hint={scope === 'my' ? 'Сертификат выдаётся автоматически после полного прохождения обучения.' : undefined} />
      ) : (
        <div className="space-y-2">
          {data.map((row) => {
            const c = row.certificate ?? row;
            return (
              <div key={c.id} className="card"><div className="card-body py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-sm text-slate-900">{c.number}</p>
                    <p className="text-xs text-slate-500">{row.trainingTitle ?? ''}</p>
                    {row.employeeName && <p className="text-xs text-slate-500">{row.employeeName}</p>}
                    <p className="mt-0.5 text-xs text-slate-400">
                      Выдан {fmtDateRu(c.issuedAt)}{c.score !== null ? ` · ${c.score}%` : ''}
                    </p>
                  </div>
                  <Badge tone={c.status === 'revoked' ? 'red'
                    : row.validity?.level === 'expired' ? 'red'
                    : row.validity?.level === 'warning' ? 'amber' : 'green'}>
                    {c.status === 'revoked' ? 'Отозван' : row.validity?.label ?? 'Действует'}
                  </Badge>
                </div>
              </div></div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MyResults() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['my-results'], queryFn: () => api.get<any[]>('/api/my/results'),
  });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader title="Мои результаты" />
      {!data || data.length === 0 ? <EmptyState title="Пройденных тестов пока нет" /> : (
        <div className="space-y-2">
          {data.map((r) => (
            <div key={r.attempt.id} className="card"><div className="card-body py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{r.moduleTitle}</p>
                  <p className="text-xs text-slate-500">{r.trainingTitle} · версия {r.version}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{fmtDateRu(r.attempt.finishedAt)}</p>
                </div>
                <Badge tone={r.attempt.passed ? 'green' : 'red'}>{r.attempt.score}%</Badge>
              </div>
            </div></div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Results() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['attempts'], queryFn: () => api.get<any[]>('/api/testing/attempts?limit=100'),
  });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader title="Результаты" subtitle={`Попыток: ${data?.length ?? 0}`} />
      {!data || data.length === 0 ? <EmptyState title="Результатов пока нет" /> : (
        <div className="space-y-2">
          {data.map((r) => (
            <div key={r.attempt.id} className="card"><div className="card-body py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{r.employeeName}</p>
                  <p className="truncate text-xs text-slate-500">{r.moduleTitle} (v{r.version})</p>
                  <p className="mt-0.5 text-xs text-slate-400">{fmtDateRu(r.attempt.finishedAt)}</p>
                </div>
                <Badge tone={r.attempt.passed ? 'green' : 'red'}>{r.attempt.score}%</Badge>
              </div>
            </div></div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Lectures({ scope }: { scope: 'my' | 'manage' }) {
  const path = scope === 'my' ? '/api/my/lectures' : '/api/lectures';
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['lectures', scope], queryFn: () => api.get<any[]>(path),
  });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader title="Лекции" />
      {!data || data.length === 0 ? <EmptyState title="Лекций пока нет" /> : (
        <div className="space-y-2">
          {data.map((row) => (
            <div key={row.lecture.id} className="card"><div className="card-body py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{row.lecture.title}</p>
                  <p className="text-xs text-slate-500">
                    {row.lecture.kind === 'online' ? 'Онлайн' : 'Очно'}
                    {row.lecture.lecturerName ? ` · ${row.lecture.lecturerName}` : ''}
                    {row.lecture.startsAt ? ` · ${fmtDateRu(row.lecture.startsAt)}` : ''}
                  </p>
                </div>
                <Badge tone={row.lecture.status === 'live' ? 'red' : row.lecture.status === 'finished' ? 'slate' : 'blue'}>
                  {row.lecture.status === 'live' ? 'Идёт' : row.lecture.status === 'finished' ? 'Завершена' : 'Запланирована'}
                </Badge>
              </div>
              {row.lecture.joinUrl && row.lecture.status !== 'finished' && (
                <a href={row.lecture.joinUrl} target="_blank" rel="noopener noreferrer"
                   className="btn-primary mt-3 inline-flex">Подключиться</a>
              )}
            </div></div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AuditLog() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['audit'], queryFn: () => api.get<any[]>('/api/audit?limit=100'),
  });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader title="Журнал действий"
        actions={<a href="/api/audit/export" className="btn-secondary">Выгрузить CSV</a>} />
      {!data || data.length === 0 ? <EmptyState title="Записей пока нет" /> : (
        <div className="card divide-y divide-slate-100">
          {data.map((r) => (
            <div key={r.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-slate-900">{r.actionLabel ?? AUDIT_LABELS[r.action] ?? r.action}</p>
                  {r.details && <p className="text-xs text-slate-500">{r.details}</p>}
                </div>
                <div className="text-right text-xs text-slate-400">
                  <p>{r.actorLabel ?? 'Система'}</p>
                  <p>{new Date(r.createdAt).toLocaleString('ru-RU')}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Profile() {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ email: user?.user.email ?? '', phone: user?.user.phone ?? '' });

  const save = useMutation({
    mutationFn: () => api.patch('/api/my/profile', form),
    onSuccess: () => toast.show('Контактные данные сохранены'),
    onError: (e) => toast.show(e instanceof ApiError ? e.message : 'Ошибка', 'error'),
  });

  if (!user) return null;

  return (
    <div>
      <PageHeader title="Профиль" />
      <div className="card mb-4"><div className="card-body">
        <dl className="space-y-3 text-sm">
          <div><dt className="text-slate-500">ФИО</dt><dd className="font-medium">{user.user.fullName}</dd></div>
          <div><dt className="text-slate-500">Логин</dt><dd className="font-medium">{user.user.login}</dd></div>
          <div><dt className="text-slate-500">Организация</dt><dd className="font-medium">{user.organization.name}</dd></div>
        </dl>
        <p className="mt-4 text-xs text-slate-500">
          ФИО, подразделение и должность меняет руководитель или кадровая служба.
        </p>
      </div></div>

      {user.cabinet === 'employee' && (
        <div className="card"><div className="card-body">
          <h2 className="mb-4 font-semibold">Контактные данные</h2>
          <div className="mb-4">
            <label className="label">Email</label>
            <input type="email" className="field" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="mb-4">
            <label className="label">Телефон</label>
            <input className="field" value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            Сохранить
          </button>
        </div></div>
      )}
      {toast.element}
    </div>
  );
}

/* Отображение страницы, собранной в конструкторе (§48 ТЗ). */
export function CustomPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ui-page', slug], queryFn: () => api.get<any>(`/api/ui/pages/${slug}`),
  });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader title={data.title} />
      <div className="space-y-4">
        {data.blocks.map((b: any) => {
          const p = b.props ?? {};
          switch (b.component) {
            case 'HEADER': return <h2 key={b.id} className="text-lg font-semibold">{p.text}</h2>;
            case 'TEXT': return <div key={b.id} className="card"><div className="card-body"><RichText html={p.html ?? ''} /></div></div>;
            case 'LINK': return (
              <a key={b.id} href={p.url} target="_blank" rel="noopener noreferrer" className="card block">
                <div className="card-body">
                  <p className="font-medium text-brand-700">{p.label ?? p.url}</p>
                  {p.description && <p className="mt-1 text-sm text-slate-600">{p.description}</p>}
                </div>
              </a>
            );
            case 'TABLE': return (
              <div key={b.id} className="card overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200">
                  {(p.columns ?? []).map((c: string, i: number) => (
                    <th key={i} className="px-4 py-2 text-left font-medium text-slate-600">{c}</th>
                  ))}
                </tr></thead>
                <tbody>{(p.rows ?? []).map((row: string[], i: number) => (
                  <tr key={i} className="border-b border-slate-100">
                    {row.map((cell, j) => <td key={j} className="px-4 py-2">{cell}</td>)}
                  </tr>
                ))}</tbody>
              </table></div>
            );
            default: return null;
          }
        })}
      </div>
    </div>
  );
}
