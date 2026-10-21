import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Spinner, ErrorBox, PageHeader, Badge, EmptyState } from '../../components/ui';

/* Главная руководителя: не «сколько всего», а «где нужно вмешаться».
   Просроченные сроки, повторные несдачи и истекающие сертификаты
   вынесены наверх — это те случаи, где без человека не обойтись. */

export function ManagerHome() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['manager-dashboard'],
    queryFn: () => api.get<any>('/api/manager/dashboard'),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader title="Главная" subtitle="Состояние обучения в вашей зоне ответственности" />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Сотрудников" value={data.employees.total} />
        <Stat label="Назначено" value={data.assignments.total} />
        <Stat label="Просрочено" value={data.assignments.overdue} tone={data.assignments.overdue ? 'red' : 'slate'} />
        <Stat label="Срок на неделе" value={data.assignments.dueSoon} tone={data.assignments.dueSoon ? 'amber' : 'slate'} />
      </div>

      <section className="mb-5">
        <h2 className="mb-3 font-semibold text-slate-900">Требуют внимания</h2>
        {data.struggling.length === 0 ? (
          <EmptyState title="Все справляются" hint="Нет сотрудников с повторными несдачами." />
        ) : (
          <div className="space-y-2">
            {data.struggling.map((s: any, i: number) => (
              <div key={i} className="card border-l-4 border-l-amber-500">
                <div className="card-body flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{s.employeeName}</p>
                    <p className="truncate text-xs text-slate-500">{s.moduleTitle}</p>
                  </div>
                  <Badge tone="amber">Не сдал {s.failures} раз{s.failures > 1 ? 'а' : ''}</Badge>
                </div>
              </div>
            ))}
            <p className="px-1 text-xs text-slate-500">
              Повторная несдача обычно означает, что материал непонятен, а не что сотрудник не старается.
            </p>
          </div>
        )}
      </section>

      <section className="mb-5">
        <h2 className="mb-3 font-semibold text-slate-900">Истекающие сертификаты</h2>
        {data.expiringCertificates.length === 0 ? (
          <EmptyState title="Нет сертификатов с близким сроком" />
        ) : (
          <div className="space-y-2">
            {data.expiringCertificates.map((c: any) => (
              <div key={c.certificate.id} className="card">
                <div className="card-body flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{c.employeeName}</p>
                    <p className="truncate text-xs text-slate-500">{c.trainingTitle}</p>
                  </div>
                  <Badge tone="amber">{c.validity.label}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <Link to="/manager/trainings" className="btn-primary">Обучения</Link>
        <Link to="/manager/assignments" className="btn-secondary">Назначить обучение</Link>
        <Link to="/manager/employees" className="btn-secondary">Сотрудники</Link>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = 'slate' }: { label: string; value: unknown; tone?: string }) {
  const color = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-900';
  return (
    <div className="card"><div className="card-body py-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${color}`}>{String(value)}</p>
    </div></div>
  );
}
