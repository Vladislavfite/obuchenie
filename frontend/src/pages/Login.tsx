import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';

export function LoginPage() {
  const { login } = useAuth();
  const [form, setForm] = useState({ login: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(form.login, form.password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось войти. Попробуйте позже.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-brand-700">TBEDU</h1>
          <p className="mt-1 text-sm text-slate-500">Обучение по охране труда</p>
        </div>

        <form onSubmit={submit} className="card card-body">
          <div className="mb-4">
            <label className="label" htmlFor="login">Логин</label>
            <input id="login" className="field" autoComplete="username" autoCapitalize="none"
              value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required />
          </div>
          <div className="mb-4">
            <label className="label" htmlFor="password">Пароль</label>
            <input id="password" type="password" className="field" autoComplete="current-password"
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Вход…' : 'Войти'}
          </button>

          <p className="mt-4 text-center text-xs text-slate-500">
            Логин и пароль выдаёт руководитель или администратор.
          </p>
        </form>
      </div>
    </div>
  );
}
