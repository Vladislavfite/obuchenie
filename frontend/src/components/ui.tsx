import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '../lib/api';

/* Базовые элементы интерфейса. Mobile-first: всё рассчитано на ширину
   от 360 px, кнопки не меньше 44 px по высоте. */

export function Spinner({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-slate-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof ApiError ? error.message
    : error instanceof Error ? error.message : 'Произошла ошибка.';
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm text-red-800">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 btn-secondary">Повторить</button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card">
      <div className="card-body text-center">
        <p className="font-medium text-slate-900">{title}</p>
        {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
        {action && <div className="mt-4 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const BADGE_TONES: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-800',
  blue: 'bg-brand-100 text-brand-800',
  slate: 'bg-slate-100 text-slate-700',
  purple: 'bg-purple-100 text-purple-800',
};

export function Badge({ tone = 'slate', children }: { tone?: keyof typeof BADGE_TONES | string; children: ReactNode }) {
  return <span className={`badge ${BADGE_TONES[tone] ?? BADGE_TONES.slate}`}>{children}</span>;
}

export function ProgressBar({ value, tone = 'brand' }: { value: number; tone?: 'brand' | 'green' | 'amber' }) {
  const color = tone === 'green' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-brand-600';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
         role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer }: {
  open: boolean; title: string; onClose(): void; children: ReactNode; footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"
         onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white sm:max-w-2xl sm:rounded-2xl"
           onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть"
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600">✕</button>
        </div>
        <div className="px-4 py-4 sm:px-6">{children}</div>
        {footer && <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-6">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Подтвердить', danger, onConfirm, onCancel }: {
  open: boolean; title: string; message: string; confirmLabel?: string;
  danger?: boolean; onConfirm(): void; onCancel(): void;
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel}
      footer={<>
        <button type="button" className="btn-secondary" onClick={onCancel}>Отмена</button>
        <button type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>{confirmLabel}</button>
      </>}>
      <p className="text-sm text-slate-700">{message}</p>
    </Modal>
  );
}

export function Field({ label, hint, error, children }: {
  label: string; hint?: string; error?: string; children: ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="label">{label}</label>
      {children}
      {error ? <p className="error-text">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

/* Уведомление о результате действия. */
export function Toast({ message, tone = 'success', onDone }: {
  message: string; tone?: 'success' | 'error'; onDone(): void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDone, 4000);
    return () => clearTimeout(timer);
  }, [message, onDone]);

  return (
    <div className="fixed bottom-20 left-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 sm:bottom-6">
      <div className={`rounded-lg px-4 py-3 text-sm text-white shadow-lg ${tone === 'error' ? 'bg-red-600' : 'bg-slate-900'}`}>
        {message}
      </div>
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  return {
    toast,
    show: (message: string, tone: 'success' | 'error' = 'success') => setToast({ message, tone }),
    clear: () => setToast(null),
    element: toast ? <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} /> : null,
  };
}

/* Безопасный вывод очищенного HTML.
   Разметка уже прошла санитайзер на сервере; здесь она только выводится. */
export function RichText({ html }: { html: string }) {
  return <div className="prose-content" dangerouslySetInnerHTML={{ __html: html }} />;
}
