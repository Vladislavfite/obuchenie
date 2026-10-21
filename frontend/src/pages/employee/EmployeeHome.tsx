import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Spinner, ErrorBox, PageHeader, ProgressBar, Badge, EmptyState } from '../../components/ui';
import { fmtDateRu } from '@tbedu/shared';

export function EmployeeHome() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['my-dashboard'],
    queryFn: () => api.get<any>('/api/my/dashboard'),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader title="Главная" subtitle="Ваше обучение по охране труда" />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Назначено" value={data.assignedCount} />
        <Stat label="Завершено" value={data.completedCount} tone="green" />
        <Stat label="Просрочено" value={data.overdueCount} tone={data.overdueCount > 0 ? 'red' : 'slate'} />
        <Stat label="Средний балл" value={data.avgScore !== null ? `${data.avgScore}%` : '—'} />
      </div>

      <div className="card mb-5">
        <div className="card-body">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Общий прогресс</span>
            <span className="text-sm font-semibold text-slate-900">{data.progressPct}%</span>
          </div>
          <ProgressBar value={data.progressPct} tone={data.progressPct >= 100 ? 'green' : 'brand'} />
        </div>
      </div>

      {data.upcoming.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-3 font-semibold text-slate-900">Ближайшие сроки</h2>
          <div className="space-y-2">
            {data.upcoming.map((u: any) => (
              <Link key={u.trainingId} to={`/employee/trainings/${u.trainingId}`}
                    className="card block transition hover:border-brand-300">
                <div className="card-body flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0 truncate text-sm font-medium text-slate-900">{u.title}</span>
                  <Badge tone={u.due.level === 'overdue' ? 'red' : u.due.level === 'warning' ? 'amber' : 'slate'}>
                    {u.due.label}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data.certificates.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-3 font-semibold text-slate-900">Мои сертификаты</h2>
          <div className="space-y-2">
            {data.certificates.map((c: any) => (
              <div key={c.id} className="card">
                <div className="card-body flex items-center justify-between gap-3 py-3">
                  <span className="font-mono text-sm">{c.number}</span>
                  <Badge tone={c.validity.level === 'expired' ? 'red' : c.validity.level === 'warning' ? 'amber' : 'green'}>
                    {c.validity.label}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-semibold text-slate-900">Последние результаты</h2>
        {data.recentAttempts.length === 0 ? (
          <EmptyState title="Пока нет пройденных тестов"
            hint="Откройте раздел «Мои обучения», чтобы начать."
            action={<Link to="/employee/trainings" className="btn-primary">Мои обучения</Link>} />
        ) : (
          <div className="space-y-2">
            {data.recentAttempts.map((r: any) => (
              <div key={r.attempt.id} className="card">
                <div className="card-body flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{r.moduleTitle}</p>
                    <p className="text-xs text-slate-500">{fmtDateRu(r.attempt.finishedAt)}</p>
                  </div>
                  <Badge tone={r.attempt.passed ? 'green' : 'red'}>{r.attempt.score}%</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone = 'slate' }: { label: string; value: unknown; tone?: string }) {
  const color = tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : 'text-slate-900';
  return (
    <div className="card">
      <div className="card-body py-4">
        <p className="text-xs text-slate-500">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${color}`}>{String(value)}</p>
      </div>
    </div>
  );
}
