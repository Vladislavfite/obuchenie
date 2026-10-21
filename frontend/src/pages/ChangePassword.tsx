import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

/* Обязательная смена пароля при первом входе.
   Пока пароль не сменён, кабинет не открывается: временные пароли
   раздаются в переписке и по телефону, оставлять их надолго нельзя. */

export function ChangePasswordPage() {
  const { refresh, logout } = useAuth();
  const [form, setForm] = useState({ oldPassword: '', newPassword: '', repeat: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (form.newPassword !== form.repeat) {
      setError('Пароли не совпадают.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/auth/change-password', {
        oldPassword: form.oldPassword, newPassword: form.newPassword,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сменить пароль.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <form onSubmit={submit} className="card card-body w-full max-w-sm">
        <h1 className="mb-1 text-lg font-semibold">Смените пароль</h1>
        <p className="mb-4 text-sm text-slate-500">
          Вы вошли с временным паролем. Задайте собственный — он должен содержать не менее 8 символов.
        </p>

        <div className="mb-4">
          <label className="label">Текущий пароль</label>
          <input type="password" className="field" autoComplete="current-password" required
            value={form.oldPassword} onChange={(e) => setForm({ ...form, oldPassword: e.target.value })} />
        </div>
        <div className="mb-4">
          <label className="label">Новый пароль</label>
          <input type="password" className="field" autoComplete="new-password" minLength={8} required
            value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        </div>
        <div className="mb-4">
          <label className="label">Повторите новый пароль</label>
          <input type="password" className="field" autoComplete="new-password" minLength={8} required
            value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })} />
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Сохранение…' : 'Сохранить пароль'}
        </button>
        <button type="button" className="btn-ghost mt-2 w-full" onClick={() => void logout()}>Выйти</button>
      </form>
    </div>
  );
}
