import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { ErrorBox, ProgressBar, Badge, Modal, RichText } from '../../components/ui';

/* Прохождение теста.

   Ответы накапливаются на клиенте и отправляются одним запросом.
   Результат считает сервер — здесь только показ. */

export function TestRunner() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const attempt = (location.state as { attempt?: any })?.attempt;

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<any>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!attempt) {
    return (
      <ErrorBox error={new Error('Данные попытки не найдены. Откройте модуль и начните тест заново.')}
        onRetry={() => navigate('/employee/trainings')} />
    );
  }

  if (result) return <TestResult result={result} onClose={() => navigate('/employee/trainings')} />;

  const questions = attempt.questions as any[];
  const question = questions[index];
  const selected = answers[question.id] ?? [];
  const multiple = question.type === 'multiple';
  const answeredCount = Object.values(answers).filter((a) => a.length > 0).length;

  function toggle(optionId: string) {
    setAnswers((prev) => {
      const current = prev[question.id] ?? [];
      if (multiple) {
        return { ...prev, [question.id]: current.includes(optionId)
          ? current.filter((id) => id !== optionId) : [...current, optionId] };
      }
      return { ...prev, [question.id]: [optionId] };
    });
  }

  async function finish() {
    setBusy(true);
    setError('');
    try {
      const payload = questions.map((q) => ({ questionId: q.id, optionIds: answers[q.id] ?? [] }));
      setResult(await api.post<any>(`/api/testing/attempts/${attemptId}/finish`, { answers: payload }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось отправить ответы.');
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-slate-700">Вопрос {index + 1} из {questions.length}</span>
          <span className="text-slate-500">Отвечено: {answeredCount}</span>
        </div>
        <ProgressBar value={((index + 1) / questions.length) * 100} />
      </div>

      <div className="card">
        <div className="card-body">
          {multiple && <Badge tone="blue">Несколько правильных ответов</Badge>}
          <h2 className="mt-2 text-lg font-medium text-slate-900">{question.text}</h2>

          {question.media?.type === 'image' && question.media.url && (
            <img src={question.media.url} alt="" className="mt-3 max-h-72 w-full rounded-lg object-contain" />
          )}

          <div className="mt-4 space-y-2">
            {question.options.map((option: any) => {
              const active = selected.includes(option.id);
              return (
                <button key={option.id} type="button" onClick={() => toggle(option.id)}
                  className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition ${
                    active ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border ${
                    multiple ? 'rounded' : 'rounded-full'} ${
                    active ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300'}`}>
                    {active && '✓'}
                  </span>
                  <span className="text-sm text-slate-800">{option.text}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {error && <div className="mt-4"><ErrorBox error={new Error(error)} /></div>}

      <div className="mt-4 flex gap-2">
        <button type="button" className="btn-secondary flex-1" disabled={index === 0}
          onClick={() => setIndex((i) => i - 1)}>← Назад</button>
        {index < questions.length - 1 ? (
          <button type="button" className="btn-primary flex-1" onClick={() => setIndex((i) => i + 1)}>Далее →</button>
        ) : (
          <button type="button" className="btn-primary flex-1" onClick={() => setConfirmOpen(true)}>Завершить</button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {questions.map((q, i) => (
          <button key={q.id} type="button" onClick={() => setIndex(i)}
            className={`h-8 w-8 rounded text-xs font-medium ${
              i === index ? 'bg-brand-600 text-white'
              : (answers[q.id]?.length ?? 0) > 0 ? 'bg-brand-100 text-brand-700'
              : 'bg-slate-100 text-slate-500'}`}>
            {i + 1}
          </button>
        ))}
      </div>

      <Modal open={confirmOpen} title="Завершить тест?" onClose={() => setConfirmOpen(false)}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setConfirmOpen(false)}>Вернуться</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void finish()}>
            {busy ? 'Отправка…' : 'Завершить'}
          </button>
        </>}>
        <p className="text-sm text-slate-700">
          Отвечено {answeredCount} из {questions.length}.
          {answeredCount < questions.length && ' Неотвеченные вопросы будут засчитаны как ошибочные.'}
          {' '}Изменить ответы после отправки нельзя.
        </p>
      </Modal>
    </div>
  );
}

function TestResult({ result, onClose }: { result: any; onClose(): void }) {
  const [showReview, setShowReview] = useState(false);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="card">
        <div className="card-body text-center">
          <div className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full text-3xl ${
            result.passed ? 'bg-emerald-100' : 'bg-red-100'}`}>
            {result.passed ? '✓' : '✕'}
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-slate-900">
            {result.passed ? 'Тест сдан' : 'Тест не сдан'}
          </h1>
          <p className="mt-1 text-slate-600">
            {result.score}% — правильных ответов {result.correctCount} из {result.totalCount}
          </p>
          <p className="mt-1 text-sm text-slate-500">Проходной балл: {result.passingScore}%</p>

          {result.certificateIssued && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-sm font-medium text-emerald-900">Выдан сертификат</p>
              <p className="mt-1 font-mono text-sm text-emerald-800">{result.certificateIssued.number}</p>
            </div>
          )}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button type="button" className="btn-secondary flex-1" onClick={() => setShowReview((v) => !v)}>
              {showReview ? 'Скрыть разбор' : 'Разбор ошибок'}
            </button>
            <button type="button" className="btn-primary flex-1" onClick={onClose}>К обучениям</button>
          </div>
        </div>
      </div>

      {showReview && (
        <div className="mt-4 space-y-3">
          {result.review.map((r: any, i: number) => (
            <div key={r.questionId} className={`card border-l-4 ${r.isCorrect ? 'border-l-emerald-500' : 'border-l-red-500'}`}>
              <div className="card-body">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">{i + 1}. {r.questionText}</p>
                  <Badge tone={r.isCorrect ? 'green' : 'red'}>{r.isCorrect ? 'Верно' : 'Ошибка'}</Badge>
                </div>
                <div className="space-y-1.5">
                  {r.options.map((o: any) => {
                    const correct = r.correctOptionIds.includes(o.id);
                    const given = r.givenOptionIds.includes(o.id);
                    return (
                      <div key={o.id} className={`rounded px-2.5 py-1.5 text-sm ${
                        correct ? 'bg-emerald-50 text-emerald-900'
                        : given ? 'bg-red-50 text-red-900' : 'text-slate-600'}`}>
                        {correct && '✓ '}{given && !correct && '✕ '}{o.text}
                      </div>
                    );
                  })}
                </div>
                {r.explanation && (
                  <div className="mt-3 rounded bg-slate-50 p-3">
                    <p className="text-xs font-medium text-slate-500">Почему так</p>
                    <p className="mt-1 text-sm text-slate-700">{r.explanation}</p>
                    {r.sourceReference && (
                      <p className="mt-1 text-xs text-slate-500">Основание: {r.sourceReference}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
