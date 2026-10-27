import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Spinner, ErrorBox, PageHeader, Badge, Modal, useToast, EmptyState } from '../../components/ui';

/* Конструктор обучения.

   Главная особенность экрана: перед публикацией система прямо говорит,
   создаст ли правка новую версию. Руководитель узнаёт это ДО того, как
   сбросит прогресс сотрудникам, а не после. */

export function TrainingConstructor() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [newModuleTitle, setNewModuleTitle] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['training-block', id],
    queryFn: () => api.get<any>(`/api/training/blocks/${id}`),
  });

  const addModule = useMutation({
    mutationFn: () => api.post(`/api/training/blocks/${id}/modules`, { title: newModuleTitle }),
    onSuccess: () => {
      setAddOpen(false); setNewModuleTitle('');
      void queryClient.invalidateQueries({ queryKey: ['training-block', id] });
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : 'Ошибка', 'error'),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <Link to="/manager/trainings" className="mb-3 inline-block text-sm text-brand-600">← Все обучения</Link>
      <PageHeader title={data.title} subtitle={data.description ?? undefined}
        actions={<button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>Добавить модуль</button>} />

      {data.modules.length === 0 ? (
        <EmptyState title="В обучении пока нет модулей"
          hint="Модуль — это учебный материал и тест к нему."
          action={<button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>Добавить модуль</button>} />
      ) : (
        <div className="space-y-3">
          {data.modules.map((m: any, index: number) => (
            <div key={m.id} className="card">
              <div className="card-body">
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <Link to={`/manager/modules/${m.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                        {m.title}
                      </Link>
                      <div className="flex gap-1.5">
                        <Badge tone={m.status === 'published' ? 'green' : 'amber'}>
                          {m.status === 'published' ? `Опубликован · v${m.currentVersion}` : 'Черновик'}
                        </Badge>
                        {m.hasDraft && m.status === 'published' && <Badge tone="blue">Есть изменения</Badge>}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>Проходной балл: {m.passingScore}%</span>
                      <span>{m.isRequired ? 'Обязательный' : 'Необязательный'}</span>
                      {m.archivedVersions.length > 0 && <span>В архиве версий: {m.archivedVersions.length}</span>}
                    </div>
                    <Link to={`/manager/modules/${m.id}`} className="btn-secondary mt-3 inline-flex">Редактировать</Link>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={addOpen} title="Новый модуль" onClose={() => setAddOpen(false)}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setAddOpen(false)}>Отмена</button>
          <button type="button" className="btn-primary" disabled={!newModuleTitle.trim() || addModule.isPending}
            onClick={() => addModule.mutate()}>Создать</button>
        </>}>
        <label className="label">Название модуля</label>
        <input className="field" value={newModuleTitle} onChange={(e) => setNewModuleTitle(e.target.value)} autoFocus />
      </Modal>

      {toast.element}
    </div>
  );
}

/* ---------- Редактор модуля ---------- */

export function ModuleEditor() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<any>(null);
  const [tab, setTab] = useState<'content' | 'questions' | 'settings'>('content');
  const [publishInfo, setPublishInfo] = useState<any>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiError, setAiError] = useState('');
  const { can } = useAuth();
  const availability = useQuery({ queryKey: ['ai-availability'], queryFn: () => api.get<{ available: boolean }>('/api/ai/availability'), enabled: can('ai.use') });
  const generate = useMutation({
    mutationFn: () => api.post<any>('/api/ai/generate/course', { text: aiText, count: 5, images: false }),
    onSuccess: (result) => {
      setDraft((previous: any) => ({ ...previous,
        contentItems: [...previous.contentItems, ...result.contentItems.map((item: any, i: number) => ({ ...item, sortOrder: previous.contentItems.length + i }))],
        questions: [...previous.questions, ...result.questions.map((item: any, i: number) => ({ ...item, sortOrder: previous.questions.length + i }))],
      }));
      setAiOpen(false); setAiText(''); setAiError('');
      toast.show('Материал добавлен в черновик. Проверьте его и сохраните.');
    },
    onError: (e) => setAiError(e instanceof ApiError ? e.message : 'Не удалось подготовить материал.'),
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['module', id],
    queryFn: () => api.get<any>(`/api/training/modules/${id}`),
  });

  useEffect(() => {
    if (data?.current && !draft) {
      const { id: _v, version: _ver, status: _s, ...content } = data.current;
      setDraft(content);
    }
  }, [data, draft]);

  const save = useMutation({
    mutationFn: () => api.put<any>(`/api/training/modules/${id}/draft`, draft),
    onSuccess: (result) => {
      setPublishInfo(result);
      toast.show(result.wouldCreateNewVersion
        ? `Черновик сохранён. При публикации будет создана версия ${result.nextVersion}.`
        : 'Черновик сохранён. Изменения косметические — версия не изменится.');
      void queryClient.invalidateQueries({ queryKey: ['module', id] });
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : 'Не удалось сохранить', 'error'),
  });

  const publish = useMutation({
    mutationFn: () => api.post<any>(`/api/training/modules/${id}/publish`),
    onSuccess: (result) => {
      toast.show(result.createdNewVersion
        ? `Опубликована версия ${result.version}. Версия ${result.archivedVersion} отправлена в архив.`
        : 'Изменения опубликованы без создания новой версии.');
      setPublishInfo(null);
      void queryClient.invalidateQueries({ queryKey: ['module', id] });
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : 'Не удалось опубликовать', 'error'),
  });

  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;
  if (isLoading || !draft) return <Spinner />;

  const set = (patch: Record<string, unknown>) => setDraft({ ...draft, ...patch });

  return (
    <div>
      <Link to={`/manager/trainings/${data.module.trainingId}`} className="mb-3 inline-block text-sm text-brand-600">
        ← К модулям
      </Link>
      <PageHeader title={draft.title || 'Модуль'}
        subtitle={`Текущая версия: ${data.current.version} (${data.current.status === 'published' ? 'опубликована' : 'черновик'})`}
        actions={<>
          <button type="button" className="btn-secondary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Сохранение…' : 'Сохранить'}
          </button>
          <button type="button" className="btn-primary" disabled={publish.isPending} onClick={() => publish.mutate()}>
            Опубликовать
          </button>
        </>} />

      {publishInfo && (
        <div className={`mb-4 rounded-lg border p-4 ${publishInfo.wouldCreateNewVersion
          ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
          <p className={`text-sm font-medium ${publishInfo.wouldCreateNewVersion ? 'text-amber-900' : 'text-emerald-900'}`}>
            {publishInfo.wouldCreateNewVersion
              ? `При публикации будет создана версия ${publishInfo.nextVersion}`
              : 'Публикация не создаст новую версию'}
          </p>
          <p className={`mt-1 text-sm ${publishInfo.wouldCreateNewVersion ? 'text-amber-800' : 'text-emerald-800'}`}>
            {publishInfo.wouldCreateNewVersion
              ? 'Сотрудникам, уже сдавшим этот модуль, потребуется пройти его заново. Прежние результаты сохранятся в истории.'
              : 'Изменены только оформительские поля. Прогресс сотрудников не сбросится.'}
          </p>
          {publishInfo.changedFields.length > 0 && (
            <p className="mt-1 text-xs text-slate-600">Изменено: {publishInfo.changedFields.join(', ')}</p>
          )}
        </div>
      )}

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {([['content', 'Материал'], ['questions', `Вопросы (${draft.questions.length})`], ['settings', 'Настройки']] as const)
          .map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium ${
                tab === key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500'}`}>
              {label}
            </button>
          ))}
      </div>

      {tab === 'content' && availability.data?.available && <div className="ai-inline"><div><strong>Помощь с материалом</strong><p>Вставьте текст документа, и помощник подготовит материал и вопросы.</p></div><button type="button" className="btn-secondary" onClick={() => { setAiError(''); setAiOpen(true); }}>Подготовить с ИИ</button></div>}
      {tab === 'content' && <ContentEditor draft={draft} set={set} />}
      {tab === 'questions' && <QuestionsEditor draft={draft} set={set} />}
      {tab === 'settings' && <SettingsEditor draft={draft} set={set} versions={data.versions} />}

      <Modal open={aiOpen} title="Подготовить материал" onClose={() => { if (!generate.isPending) setAiOpen(false); }}>
        <form onSubmit={(e) => { e.preventDefault(); setAiError(''); generate.mutate(); }} className="space-y-4">
          <p className="text-sm text-slate-600">Вставьте текст документа. Подготовленные разделы и вопросы добавятся к текущему черновику.</p>
          <label className="block"><span className="label">Текст документа</span><textarea className="field" rows={9} minLength={200} maxLength={400000} required value={aiText} onChange={(e) => setAiText(e.target.value)} /><span className="hint">Не менее 200 символов. Перед публикацией проверьте материал и ответы.</span></label>
          {aiError && <p role="alert" className="text-sm text-red-600">{aiError}</p>}
          <button type="submit" className="btn-primary" disabled={generate.isPending}>{generate.isPending ? 'Подготавливаем…' : 'Подготовить'}</button>
        </form>
      </Modal>
      {toast.element}
    </div>
  );
}

function ContentEditor({ draft, set }: { draft: any; set(p: Record<string, unknown>): void }) {
  const items = draft.contentItems as any[];

  function add(type: string) {
    const payloadByType: Record<string, unknown> = {
      text: { html: '<p></p>' },
      image: { url: '', fit: 'contain', caption: '' },
      video: { provider: 'youtube', url: '', videoId: '', caption: '' },
      slides: { slides: [] },
      live: { provider: 'youtube', url: '', speaker: '', startsAt: null },
      link: { url: '', label: '', description: '' },
    };
    set({ contentItems: [...items, { type, title: '', sortOrder: items.length, payload: payloadByType[type] }] });
  }

  function update(index: number, patch: Record<string, unknown>) {
    set({ contentItems: items.map((it, i) => (i === index ? { ...it, ...patch } : it)) });
  }

  function updatePayload(index: number, patch: Record<string, unknown>) {
    set({ contentItems: items.map((it, i) => (i === index ? { ...it, payload: { ...it.payload, ...patch } } : it)) });
  }

  function remove(index: number) {
    set({ contentItems: items.filter((_, i) => i !== index).map((it, i) => ({ ...it, sortOrder: i })) });
  }

  function move(index: number, delta: number) {
    const next = [...items];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    set({ contentItems: next.map((it, i) => ({ ...it, sortOrder: i })) });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {([['text', 'Текст'], ['image', 'Изображение'], ['video', 'Видео'],
           ['slides', 'Слайды'], ['live', 'Трансляция'], ['link', 'Ссылка']] as const).map(([type, label]) => (
          <button key={type} type="button" className="btn-secondary" onClick={() => add(type)}>+ {label}</button>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState title="Материал пуст" hint="Добавьте хотя бы один элемент — без него модуль нельзя опубликовать." />
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => (
            <div key={index} className="card">
              <div className="card-body">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <Badge tone="blue">{typeLabel(item.type)}</Badge>
                  <div className="flex gap-1">
                    <button type="button" className="btn-ghost px-2" onClick={() => move(index, -1)}>↑</button>
                    <button type="button" className="btn-ghost px-2" onClick={() => move(index, 1)}>↓</button>
                    <button type="button" className="btn-ghost px-2 text-red-600" onClick={() => remove(index)}>Удалить</button>
                  </div>
                </div>

                <input className="field mb-3" placeholder="Заголовок раздела (необязательно)"
                  value={item.title ?? ''} onChange={(e) => update(index, { title: e.target.value })} />

                {item.type === 'text' && (
                  <>
                    <textarea className="field min-h-[160px] font-mono text-sm" value={item.payload.html}
                      onChange={(e) => updatePayload(index, { html: e.target.value })} />
                    <p className="hint">
                      Допустимы теги: h2, h3, h4, p, strong, em, ul, ol, li, blockquote, a, br.
                      Остальное сервер удалит.
                    </p>
                  </>
                )}

                {item.type === 'image' && <ImageField value={item.payload.url}
                  onChange={(url) => updatePayload(index, { url })} />}

                {(item.type === 'video' || item.type === 'link' || item.type === 'live') && (
                  <>
                    <input className="field" placeholder="Ссылка (https://…)" value={item.payload.url}
                      onChange={(e) => updatePayload(index, { url: e.target.value })} />
                    <p className="hint">
                      {item.type === 'video' ? 'YouTube, Vimeo или прямая ссылка на MP4/WEBM.'
                       : item.type === 'live' ? 'YouTube Live или Zoom.' : 'Любая внешняя ссылка.'}
                    </p>
                  </>
                )}

                {item.type === 'slides' && <SlidesField slides={item.payload.slides ?? []}
                  onChange={(slides) => updatePayload(index, { slides })} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ImageField({ value, onChange }: { value: string; onChange(url: string): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function upload(file: File) {
    setBusy(true); setError('');
    try {
      const result = await api.upload(file);
      onChange(result.url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить файл.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {value && <img src={value} alt="" className="mb-3 max-h-48 rounded-lg border border-slate-200 object-contain" />}
      <input type="file" accept=".jpg,.jpeg,.png,.webp,.svg" disabled={busy}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
        className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2.5 file:text-sm file:text-brand-700" />
      {busy && <p className="hint">Загрузка…</p>}
      {error && <p className="error-text">{error}</p>}
      <input className="field mt-2" placeholder="Или вставьте ссылку на изображение"
        value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SlidesField({ slides, onChange }: { slides: any[]; onChange(s: any[]): void }) {
  return (
    <div className="space-y-2">
      {slides.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{i + 1}</span>
          <input className="field flex-1" placeholder="Ссылка на изображение" value={s.imageUrl}
            onChange={(e) => onChange(slides.map((x, j) => (j === i ? { ...x, imageUrl: e.target.value } : x)))} />
          <button type="button" className="btn-ghost text-red-600"
            onClick={() => onChange(slides.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="btn-secondary"
        onClick={() => onChange([...slides, { imageUrl: '', caption: '', order: slides.length }])}>
        + Слайд
      </button>
    </div>
  );
}

function QuestionsEditor({ draft, set }: { draft: any; set(p: Record<string, unknown>): void }) {
  const questions = draft.questions as any[];

  function add() {
    set({ questions: [...questions, {
      sortOrder: questions.length, text: '', type: 'single', explanation: '',
      difficulty: 'normal', isPractical: false, points: 1,
      options: [{ sortOrder: 0, text: '', isCorrect: true }, { sortOrder: 1, text: '', isCorrect: false }],
    }] });
  }

  function update(index: number, patch: Record<string, unknown>) {
    set({ questions: questions.map((q, i) => (i === index ? { ...q, ...patch } : q)) });
  }

  return (
    <div>
      <button type="button" className="btn-primary mb-4" onClick={add}>+ Добавить вопрос</button>

      {questions.length === 0 ? (
        <EmptyState title="Вопросов пока нет" hint="Без вопросов сотрудник не сможет пройти проверку знаний." />
      ) : (
        <div className="space-y-3">
          {questions.map((q, index) => (
            <div key={index} className="card">
              <div className="card-body">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-500">Вопрос {index + 1}</span>
                  <button type="button" className="btn-ghost text-red-600"
                    onClick={() => set({ questions: questions.filter((_, i) => i !== index).map((x, i) => ({ ...x, sortOrder: i })) })}>
                    Удалить
                  </button>
                </div>

                <textarea className="field mb-3" rows={2} placeholder="Текст вопроса"
                  value={q.text} onChange={(e) => update(index, { text: e.target.value })} />

                <div className="mb-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">Тип</label>
                    <select className="field" value={q.type} onChange={(e) => update(index, { type: e.target.value })}>
                      <option value="single">Один правильный ответ</option>
                      <option value="multiple">Несколько правильных</option>
                      <option value="truefalse">Верно / неверно</option>
                      <option value="scenario">Ситуационный</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Сложность</label>
                    <select className="field" value={q.difficulty}
                      onChange={(e) => update(index, { difficulty: e.target.value })}>
                      <option value="easy">Лёгкий</option>
                      <option value="normal">Обычный</option>
                      <option value="hard">Сложный</option>
                    </select>
                  </div>
                </div>

                <label className="label">Варианты ответа</label>
                <div className="mb-3 space-y-2">
                  {q.options.map((o: any, oi: number) => (
                    <div key={oi} className="flex items-center gap-2">
                      <input type={q.type === 'multiple' ? 'checkbox' : 'radio'} checked={o.isCorrect}
                        className="h-5 w-5 shrink-0"
                        onChange={() => update(index, {
                          options: q.options.map((x: any, j: number) => ({
                            ...x, isCorrect: q.type === 'multiple' ? (j === oi ? !x.isCorrect : x.isCorrect) : j === oi,
                          })),
                        })} />
                      <input className="field flex-1" placeholder={`Вариант ${oi + 1}`} value={o.text}
                        onChange={(e) => update(index, {
                          options: q.options.map((x: any, j: number) => (j === oi ? { ...x, text: e.target.value } : x)),
                        })} />
                      {q.options.length > 2 && (
                        <button type="button" className="btn-ghost text-red-600"
                          onClick={() => update(index, {
                            options: q.options.filter((_: any, j: number) => j !== oi).map((x: any, j: number) => ({ ...x, sortOrder: j })),
                          })}>✕</button>
                      )}
                    </div>
                  ))}
                  <button type="button" className="btn-secondary"
                    onClick={() => update(index, {
                      options: [...q.options, { sortOrder: q.options.length, text: '', isCorrect: false }],
                    })}>+ Вариант</button>
                </div>

                <label className="label">Объяснение правильного ответа</label>
                <textarea className="field" rows={2} value={q.explanation ?? ''}
                  onChange={(e) => update(index, { explanation: e.target.value })} />
                <p className="hint">
                  Обязательное поле: сотрудник увидит объяснение в разборе ошибок. Без него модуль не публикуется.
                </p>

                <label className="label mt-3">Ссылка на пункт документа</label>
                <input className="field" value={q.sourceReference ?? ''}
                  onChange={(e) => update(index, { sourceReference: e.target.value })}
                  placeholder="Например: Трудовой кодекс РК, статья 182" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsEditor({ draft, set, versions }: { draft: any; set(p: Record<string, unknown>): void; versions: any[] }) {
  return (
    <div className="space-y-4">
      <div className="card"><div className="card-body">
        <h2 className="mb-4 font-semibold">Основное</h2>
        <div className="mb-4">
          <label className="label">Название модуля</label>
          <input className="field" value={draft.title} onChange={(e) => set({ title: e.target.value })} />
          <p className="hint">Изменение названия создаёт новую версию.</p>
        </div>
        <div className="mb-4">
          <label className="label">Глава / раздел</label>
          <input className="field" value={draft.chapter ?? ''} onChange={(e) => set({ chapter: e.target.value })} />
          <p className="hint">Оформительское поле: новую версию не создаёт.</p>
        </div>
        <div className="mb-4">
          <label className="label">Лектор</label>
          <input className="field" value={draft.speaker ?? ''} onChange={(e) => set({ speaker: e.target.value })} />
          <p className="hint">Оформительское поле: новую версию не создаёт.</p>
        </div>
        <div>
          <label className="label">Код доступа к тесту</label>
          <input className="field" value={draft.accessCode ?? ''} onChange={(e) => set({ accessCode: e.target.value })} />
          <p className="hint">Если задан, сотрудник введёт его перед началом теста. Новую версию не создаёт.</p>
        </div>
      </div></div>

      <div className="card"><div className="card-body">
        <h2 className="mb-4 font-semibold">Проверка знаний</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Проходной балл, %</label>
            <input type="number" className="field" min={1} max={100} value={draft.passingScore}
              onChange={(e) => set({ passingScore: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Лимит попыток</label>
            <input type="number" className="field" min={0} max={20} value={draft.attemptLimit}
              onChange={(e) => set({ attemptLimit: Number(e.target.value) })} />
            <p className="hint">0 — без ограничений.</p>
          </div>
          <div>
            <label className="label">Вопросов на попытку</label>
            <input type="number" className="field" min={0} value={draft.questionCount}
              onChange={(e) => set({ questionCount: Number(e.target.value) })} />
            <p className="hint">0 — выдавать все вопросы из банка.</p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {([['isRequired', 'Обязательный модуль'],
             ['randomQuestions', 'Случайный порядок вопросов'],
             ['shuffleOptions', 'Перемешивать варианты ответа']] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={!!draft[key]}
                onChange={(e) => set({ [key]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Все настройки этого раздела влияют на обучение, поэтому их изменение создаёт новую версию.
        </p>
      </div></div>

      <div className="card"><div className="card-body">
        <h2 className="mb-3 font-semibold">История версий</h2>
        <div className="space-y-2">
          {versions.map((v) => (
            <div key={v.id} className="flex items-center justify-between text-sm">
              <span>Версия {v.version}</span>
              <Badge tone={v.status === 'published' ? 'green' : v.status === 'draft' ? 'amber' : 'slate'}>
                {v.status === 'published' ? 'Опубликована' : v.status === 'draft' ? 'Черновик' : 'В архиве'}
              </Badge>
            </div>
          ))}
        </div>
      </div></div>
    </div>
  );
}

function typeLabel(type: string): string {
  return ({ text: 'Текст', image: 'Изображение', video: 'Видео',
            slides: 'Слайды', live: 'Трансляция', link: 'Ссылка' } as Record<string, string>)[type] ?? type;
}
