import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { parseVideoUrl, youtubeEmbedUrl } from '@tbedu/shared';
import { api, ApiError } from '../../lib/api';
import { Spinner, ErrorBox, PageHeader, RichText, Modal } from '../../components/ui';

/* Просмотр учебного материала.

   Вопросы теста сюда не приходят вовсе — они выдаются только при старте
   попытки и без признака правильности. */

export function ModuleView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [codeOpen, setCodeOpen] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [startError, setStartError] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['my-module', id],
    queryFn: () => api.get<any>(`/api/my/modules/${id}`),
  });

  async function startTest(code?: string) {
    setBusy(true);
    setStartError('');
    try {
      const attempt = await api.post<any>('/api/testing/attempts', { moduleId: id, accessCode: code ?? null });
      navigate(`/employee/test/${attempt.attemptId}`, { state: { attempt } });
    } catch (e) {
      setStartError(e instanceof ApiError ? e.message : 'Не удалось начать тест.');
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <Link to={`/employee/trainings/${data.trainingId}`} className="mb-3 inline-block text-sm text-brand-600">
        ← К модулям
      </Link>
      <PageHeader title={data.title} subtitle={data.chapter ?? undefined} />

      {data.speaker && <p className="mb-4 text-sm text-slate-500">Лектор: {data.speaker}</p>}

      <div className="space-y-5">
        {data.contentItems.map((item: any) => (
          <ContentBlock key={item.id} item={item} />
        ))}
      </div>

      <div className="card mt-6">
        <div className="card-body">
          <h2 className="font-semibold text-slate-900">Проверка знаний</h2>
          <p className="mt-1 text-sm text-slate-600">
            {data.questionsPerAttempt} {plural(data.questionsPerAttempt, 'вопрос', 'вопроса', 'вопросов')},
            проходной балл — {data.passingScore}%.
            {data.attemptLimit > 0 && ` Попыток: не более ${data.attemptLimit}.`}
          </p>
          {startError && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{startError}</p>}
          <button type="button" className="btn-primary mt-4 w-full sm:w-auto" disabled={busy}
            onClick={() => (data.requiresAccessCode ? setCodeOpen(true) : void startTest())}>
            {busy ? 'Подождите…' : 'Начать тест'}
          </button>
        </div>
      </div>

      <Modal open={codeOpen} title="Код доступа" onClose={() => setCodeOpen(false)}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setCodeOpen(false)}>Отмена</button>
          <button type="button" className="btn-primary" disabled={busy}
            onClick={() => { setCodeOpen(false); void startTest(accessCode); }}>Продолжить</button>
        </>}>
        <p className="mb-3 text-sm text-slate-600">Введите код, который назвал лектор или руководитель.</p>
        <input className="field" value={accessCode} onChange={(e) => setAccessCode(e.target.value)}
          inputMode="numeric" autoFocus />
      </Modal>
    </div>
  );
}

function ContentBlock({ item }: { item: any }) {
  const [slide, setSlide] = useState(0);

  switch (item.type) {
    case 'text':
      return (
        <section className="card">
          <div className="card-body">
            {item.title && <h2 className="mb-3 text-lg font-semibold text-slate-900">{item.title}</h2>}
            <RichText html={item.payload.html} />
          </div>
        </section>
      );

    case 'image':
      return (
        <figure className="card overflow-hidden">
          <img src={item.payload.url} alt={item.payload.caption || item.title || ''}
            className={`w-full ${item.payload.fit === 'cover' ? 'h-64 object-cover' : 'object-contain'}`} loading="lazy" />
          {item.payload.caption && (
            <figcaption className="px-4 py-2 text-sm text-slate-500">{item.payload.caption}</figcaption>
          )}
        </figure>
      );

    case 'video': {
      const parsed = parseVideoUrl(item.payload.url);
      return (
        <section className="card overflow-hidden">
          {item.title && <div className="border-b border-slate-200 px-4 py-3 font-medium">{item.title}</div>}
          {parsed?.provider === 'youtube' ? (
            <div className="aspect-video">
              <iframe className="h-full w-full" src={youtubeEmbedUrl(parsed.videoId, parsed.startSeconds)}
                title={item.title || 'Видео'} allowFullScreen
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" />
            </div>
          ) : parsed?.provider === 'vimeo' ? (
            <div className="aspect-video">
              <iframe className="h-full w-full" src={parsed.embedUrl} title={item.title || 'Видео'} allowFullScreen />
            </div>
          ) : parsed?.provider === 'file' ? (
            <video className="w-full" controls preload="metadata" src={parsed.url} />
          ) : (
            <div className="p-4 text-sm text-slate-500">Видео недоступно.</div>
          )}
        </section>
      );
    }

    case 'slides': {
      const slides = item.payload.slides ?? [];
      if (slides.length === 0) return null;
      const current = slides[Math.min(slide, slides.length - 1)];
      return (
        <section className="card overflow-hidden">
          {item.title && <div className="border-b border-slate-200 px-4 py-3 font-medium">{item.title}</div>}
          <img src={current.imageUrl} alt={current.caption || `Слайд ${slide + 1}`} className="w-full object-contain" />
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
            <button type="button" className="btn-secondary" disabled={slide === 0}
              onClick={() => setSlide((s) => s - 1)}>← Назад</button>
            <span className="text-sm text-slate-500">{slide + 1} из {slides.length}</span>
            <button type="button" className="btn-secondary" disabled={slide >= slides.length - 1}
              onClick={() => setSlide((s) => s + 1)}>Вперёд →</button>
          </div>
          {current.caption && <p className="px-4 pb-3 text-sm text-slate-500">{current.caption}</p>}
        </section>
      );
    }

    case 'live': {
      const parsed = parseVideoUrl(item.payload.url);
      return (
        <section className="card">
          <div className="card-body">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              <span className="text-sm font-medium text-slate-900">{item.title || 'Онлайн-трансляция'}</span>
            </div>
            {item.payload.speaker && <p className="mb-2 text-sm text-slate-500">Лектор: {item.payload.speaker}</p>}
            {parsed?.provider === 'youtube' ? (
              <div className="aspect-video overflow-hidden rounded-lg">
                <iframe className="h-full w-full" src={youtubeEmbedUrl(parsed.videoId)} title="Трансляция" allowFullScreen />
              </div>
            ) : (
              <a href={item.payload.joinUrl || item.payload.url} target="_blank" rel="noopener noreferrer"
                 className="btn-primary">Подключиться</a>
            )}
          </div>
        </section>
      );
    }

    case 'link':
      return (
        <a href={item.payload.url} target="_blank" rel="noopener noreferrer nofollow"
           className="card block transition hover:border-brand-300">
          <div className="card-body">
            <p className="font-medium text-brand-700">{item.payload.label || item.title || 'Материал'}</p>
            {item.payload.description && <p className="mt-1 text-sm text-slate-600">{item.payload.description}</p>}
            <p className="mt-2 truncate text-xs text-slate-400">{item.payload.url}</p>
          </div>
        </a>
      );

    default:
      return null;
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100, last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}
