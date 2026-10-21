import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, query } from '../../lib/api';
import { Spinner, ErrorBox, PageHeader, Badge, EmptyState, Modal, useToast } from '../../components/ui';
import { ASSIGNMENT_STATUS_LABELS, fmtDateRu, todayISO } from '@tbedu/shared';

/* Назначение обучения. Массовое назначение всегда показывает,
   сколько человек попадёт под условия, до отправки. */

export function Assignments() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [assignOpen, setAssignOpen] = useState(false);
  const [form, setForm] = useState({
    trainingId: '', dueDate: todayISO(14), priority: 'normal',
    departmentIds: [] as string[], employeeIds: [] as string[],
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['assignments'],
    queryFn: () => api.get<any[]>('/api/assignments?limit=100'),
  });
  const { data: trainings } = useQuery({
    queryKey: ['training-blocks-published'],
    queryFn: () => api.get<any[]>('/api/training/blocks?status=published&limit=100'),
  });
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<any[]>('/api/departments') });
  const { data: employees } = useQuery({ queryKey: ['employees-all'], queryFn: () => api.get<any[]>('/api/employees?limit=100') });

  const assign = useMutation({
    mutationFn: () => api.post<any>('/api/assignments/bulk', {
      trainingId: form.trainingId, dueDate: form.dueDate || null, priority: form.priority, isRequired: true,
      targets: {
        employeeIds: form.employeeIds, departmentIds: form.departmentIds,
        positionIds: [], professionIds: [], groups: [],
      },
    }),
    onSuccess: (r) => {
      setAssignOpen(false);
      toast.show(r.assigned > 0 ? `Обучение назначено ${r.assigned} сотрудникам.` : (r.message ?? 'Никто не подошёл под условия.'));
      void queryClient.invalidateQueries({ queryKey: ['assignments'] });
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : 'Не удалось назначить', 'error'),
  });

  const selectedCount = form.employeeIds.length +
    (employees?.filter((e) => form.departmentIds.includes(e.departmentId)).length ?? 0);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader title="Назначения" subtitle={`Всего: ${data?.length ?? 0}`}
        actions={<button type="button" className="btn-primary" onClick={() => setAssignOpen(true)}>Назначить обучение</button>} />

      {!data || data.length === 0 ? (
        <EmptyState title="Назначений пока нет"
          hint="Назначьте обучение сотрудникам или целому подразделению." />
      ) : (
        <div className="space-y-2">
          {data.map((row) => (
            <div key={row.assignment.id} className="card">
              <div className="card-body py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{row.employeeName}</p>
                    <p className="truncate text-xs text-slate-500">{row.trainingTitle}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {row.departmentName ?? 'Без подразделения'} · срок: {fmtDateRu(row.assignment.dueDate)}
                    </p>
                  </div>
                  <Badge tone={row.assignment.status === 'completed' ? 'green'
                    : row.assignment.status === 'in_progress' ? 'blue' : 'slate'}>
                    {ASSIGNMENT_STATUS_LABELS[row.assignment.status as keyof typeof ASSIGNMENT_STATUS_LABELS]}
                  </Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={assignOpen} title="Назначить обучение" onClose={() => setAssignOpen(false)}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setAssignOpen(false)}>Отмена</button>
          <button type="button" className="btn-primary" disabled={!form.trainingId || assign.isPending}
            onClick={() => assign.mutate()}>Назначить</button>
        </>}>
        <div className="mb-4">
          <label className="label">Обучение</label>
          <select className="field" value={form.trainingId}
            onChange={(e) => setForm({ ...form, trainingId: e.target.value })}>
            <option value="">Выберите обучение</option>
            {trainings?.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </div>

        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Срок выполнения</label>
            <input type="date" className="field" value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </div>
          <div>
            <label className="label">Приоритет</label>
            <select className="field" value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="low">Низкий</option>
              <option value="normal">Обычный</option>
              <option value="high">Высокий</option>
              <option value="critical">Критический</option>
            </select>
          </div>
        </div>

        <div className="mb-4">
          <label className="label">Подразделения целиком</label>
          <div className="max-h-32 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 p-3">
            {departments?.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={form.departmentIds.includes(d.id)}
                  onChange={(e) => setForm({ ...form, departmentIds: e.target.checked
                    ? [...form.departmentIds, d.id] : form.departmentIds.filter((x) => x !== d.id) })} />
                {d.name}
              </label>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="label">Отдельные сотрудники</label>
          <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 p-3">
            {employees?.map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={form.employeeIds.includes(e.id)}
                  onChange={(ev) => setForm({ ...form, employeeIds: ev.target.checked
                    ? [...form.employeeIds, e.id] : form.employeeIds.filter((x) => x !== e.id) })} />
                {e.fullName}
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
          Будет назначено примерно {selectedCount} сотрудникам.
          Повторное назначение не создаёт дубликат — обновляется срок.
        </div>
      </Modal>

      {toast.element}
    </div>
  );
}
