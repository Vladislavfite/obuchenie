import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { Spinner, ErrorBox, PageHeader, Badge, EmptyState, Modal, useToast } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { PERMISSION } from '@tbedu/shared';

export function ManagerTrainings() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['training-blocks'],
    queryFn: () => api.get<any[]>('/api/training/blocks?limit=100'),
  });

  const create = useMutation({
    mutationFn: () => api.post('/api/training/blocks', { title, description, sequential: true, requiredPct: 100 }),
    onSuccess: () => {
      setCreateOpen(false); setTitle(''); setDescription('');
      toast.show('Обучение создано. Теперь добавьте модули.');
      void queryClient.invalidateQueries({ queryKey: ['training-blocks'] });
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : 'Не удалось создать обучение', 'error'),
  });

  const publish = useMutation({
    mutationFn: (id: string) => api.post(`/api/training/blocks/${id}/publish`),
    onSuccess: () => {
      toast.show('Обучение опубликовано');
      void queryClient.invalidateQueries({ queryKey: ['training-blocks'] });
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : 'Ошибка', 'error'),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader title="Обучения" subtitle={`Всего: ${data?.length ?? 0}`}
        actions={can(PERMISSION.TRAINING_CREATE) && (
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>Создать обучение</button>
        )} />

      {!data || data.length === 0 ? (
        <EmptyState title="Обучений пока нет"
          hint="Создайте обучение, добавьте в него модули с материалом и тестом, затем опубликуйте." />
      ) : (
        <div className="space-y-3">
          {data.map((b) => (
            <div key={b.id} className="card">
              <div className="card-body">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <Link to={`/manager/trainings/${b.id}`} className="font-semibold text-slate-900 hover:text-brand-700">
                    {b.title}
                  </Link>
                  <Badge tone={b.status === 'published' ? 'green' : b.status === 'archived' ? 'slate' : 'amber'}>
                    {b.status === 'published' ? 'Опубликовано' : b.status === 'archived' ? 'В архиве' : 'Черновик'}
                  </Badge>
                </div>
                {b.description && <p className="mb-3 text-sm text-slate-600">{b.description}</p>}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>Модулей: {b.moduleCount}</span>
                  <span>Опубликовано: {b.publishedModuleCount}</span>
                  {b.sequential && <span>Последовательное прохождение</span>}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link to={`/manager/trainings/${b.id}`} className="btn-secondary">Открыть</Link>
                  {b.status !== 'published' && b.publishedModuleCount > 0 && can(PERMISSION.TRAINING_PUBLISH) && (
                    <button type="button" className="btn-primary" onClick={() => publish.mutate(b.id)}>
                      Опубликовать
                    </button>
                  )}
                </div>
                {b.status !== 'published' && b.publishedModuleCount === 0 && (
                  <p className="mt-2 text-xs text-amber-700">
                    Чтобы опубликовать обучение, нужен хотя бы один опубликованный модуль.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={createOpen} title="Новое обучение" onClose={() => setCreateOpen(false)}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>Отмена</button>
          <button type="button" className="btn-primary" disabled={!title.trim() || create.isPending}
            onClick={() => create.mutate()}>Создать</button>
        </>}>
        <div className="mb-4">
          <label className="label">Название</label>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: Вводный инструктаж по охране труда" autoFocus />
        </div>
        <div>
          <label className="label">Описание</label>
          <textarea className="field min-h-[88px]" value={description}
            onChange={(e) => setDescription(e.target.value)} rows={3} />
          <p className="hint">Коротко: для кого это обучение и зачем.</p>
        </div>
      </Modal>

      {toast.element}
    </div>
  );
}
