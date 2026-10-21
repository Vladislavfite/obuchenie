import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { Spinner, ErrorBox, PageHeader, ProgressBar, Badge, EmptyState } from '../../components/ui';
import { MODULE_STATE_LABELS, PROGRAM_STATUS_LABELS } from '@tbedu/shared';

const STATE_TONE: Record<string, string> = {
  passed: 'green', failed: 'red', exhausted: 'red', outdated: 'amber',
  locked: 'slate', available: 'blue', in_progress: 'blue',
};

export function MyTrainings() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['my-trainings'],
    queryFn: () => api.get<any[]>('/api/my/trainings'),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;

  if (!data || data.length === 0) {
    return (
      <div>
        <PageHeader title="Мои обучения" />
        <EmptyState title="Вам пока не назначено обучение"
          hint="Когда руководитель назначит обучение, оно появится здесь." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Мои обучения" subtitle={`Всего: ${data.length}`} />
      <div className="space-y-3">
        {data.map((t) => (
          <Link key={t.id} to={`/employee/trainings/${t.id}`} className="card block transition hover:border-brand-300">
            <div className="card-body">
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <h2 className="font-semibold text-slate-900">{t.title}</h2>
                <Badge tone={t.status === 'completed' ? 'green' : t.status === 'in_progress' ? 'blue' : 'slate'}>
                  {PROGRAM_STATUS_LABELS[t.status]}
                </Badge>
              </div>
              {t.description && <p className="mb-3 text-sm text-slate-600">{t.description}</p>}

              <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                <span>{t.moduleCount} {plural(t.moduleCount, 'модуль', 'модуля', 'модулей')}</span>
                <span>{t.completionPct}%</span>
              </div>
              <ProgressBar value={t.completionPct} tone={t.completionPct >= 100 ? 'green' : 'brand'} />

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {t.assignment?.due && (
                  <Badge tone={t.assignment.due.level === 'overdue' ? 'red'
                    : t.assignment.due.level === 'warning' ? 'amber' : 'slate'}>
                    {t.assignment.due.label}
                  </Badge>
                )}
                {t.assignment?.isRequired && <Badge tone="purple">Обязательное</Badge>}
                {!t.access.allowed && <Badge tone="amber">Закрыто</Badge>}
              </div>

              {!t.access.allowed && <p className="mt-2 text-xs text-amber-700">{t.access.reason}</p>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function TrainingDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['my-training', id],
    queryFn: () => api.get<any>(`/api/my/trainings/${id}`),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <Link to="/employee/trainings" className="mb-3 inline-block text-sm text-brand-600">← Все обучения</Link>
      <PageHeader title={data.title} subtitle={data.description ?? undefined} />

      <div className="card mb-5">
        <div className="card-body">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-slate-600">Прогресс</span>
            <span className="font-semibold">{data.completionPct}%</span>
          </div>
          <ProgressBar value={data.completionPct} tone={data.completionPct >= 100 ? 'green' : 'brand'} />
          {data.sequential && (
            <p className="mt-3 text-xs text-slate-500">
              Модули проходятся по порядку: следующий открывается после сдачи предыдущего.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {data.modules.map((m: any, index: number) => {
          const locked = m.state === 'locked';
          const body = (
            <div className="card-body">
              <div className="flex items-start gap-3">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  m.state === 'passed' ? 'bg-emerald-100 text-emerald-700'
                  : locked ? 'bg-slate-100 text-slate-400' : 'bg-brand-100 text-brand-700'}`}>
                  {m.state === 'passed' ? '✓' : index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className={`font-medium ${locked ? 'text-slate-400' : 'text-slate-900'}`}>{m.title}</h3>
                    <Badge tone={STATE_TONE[m.state] ?? 'slate'}>{MODULE_STATE_LABELS[m.state]}</Badge>
                  </div>
                  {m.chapter && <p className="mt-0.5 text-xs text-slate-500">{m.chapter}</p>}

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>Проходной балл: {m.passingScore}%</span>
                    {m.attemptLimit > 0 && <span>Попыток осталось: {m.attemptsLeft ?? '—'}</span>}
                    {m.scores.officialScore !== null && <span>Ваш результат: {m.scores.officialScore}%</span>}
                    {m.requiresAccessCode && <span>Нужен код доступа</span>}
                  </div>

                  {m.state === 'outdated' && (
                    <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                      Материал обновился. Прежнее прохождение сохранено в истории, но требуется пройти заново.
                    </p>
                  )}
                  {m.state === 'exhausted' && (
                    <p className="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">
                      Попытки исчерпаны. Обратитесь к руководителю за дополнительной попыткой.
                    </p>
                  )}
                </div>
              </div>
            </div>
          );

          return locked
            ? <div key={m.id} className="card opacity-60">{body}</div>
            : <Link key={m.id} to={`/employee/modules/${m.id}`} className="card block transition hover:border-brand-300">{body}</Link>;
        })}
      </div>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100, last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}
