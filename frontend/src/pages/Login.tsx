import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';

type Cabinet = 'admin' | 'manager' | 'employee';
const choices: { id: Cabinet; title: string; description: string; icon: string }[] = [
  { id: 'admin', title: 'Администратор', description: 'Управление платформой и пользователями', icon: '◈' },
  { id: 'manager', title: 'Руководитель', description: 'Создание и назначение обучений', icon: '▦' },
  { id: 'employee', title: 'Сотрудник', description: 'Материалы, тесты и результаты', icon: '◎' },
];
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const selected = choices.find((c) => location.pathname === `/login/${c.id}`);
  const [form, setForm] = useState({ login: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (!selected) return;
    setError(''); setBusy(true);
    try { await login(form.login, form.password, selected.id); navigate(`/${selected.id}`, { replace: true }); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Не удалось войти. Попробуйте позже.'); }
    finally { setBusy(false); }
  }
  return <div className="entry-screen"><aside className="entry-intro"><div className="entry-brand"><span>О</span><div>Обучение<small>Корпоративная платформа</small></div></div><div><p className="entry-eyebrow">РАЗВИВАЙТЕСЬ ВМЕСТЕ</p><h1>Знания, которые <em>работают.</em></h1><p className="entry-copy">Обучение, материалы и результаты — в одном понятном пространстве.</p></div><p className="entry-foot">Платформа для сотрудников и руководителей</p></aside>
    <main className="entry-main"><div className="entry-content"><div className="entry-mobile-brand">Обучение</div>
      {!selected ? <><p className="entry-kicker">ДОБРО ПОЖАЛОВАТЬ</p><h2>Выберите кабинет</h2><p className="entry-subtitle">Выберите, под какой учётной записью хотите войти.</p><div className="entry-choices">{choices.map((choice) => <button key={choice.id} type="button" className="entry-choice" onClick={() => { setError(''); setForm({ login: '', password: '' }); navigate(`/login/${choice.id}`); }}><span className="entry-icon">{choice.icon}</span><span><strong>{choice.title}</strong><small>{choice.description}</small></span><span className="entry-arrow">→</span></button>)}</div></> : <><button className="entry-back" type="button" onClick={() => { setError(''); navigate('/'); }}>← Выбрать другой кабинет</button><p className="entry-kicker">ВХОД В СИСТЕМУ</p><h2>{selected.title}</h2><p className="entry-subtitle">{selected.description}</p><form className="entry-form" onSubmit={submit}><label className="label" htmlFor="login">Логин</label><input id="login" className="field mb-4" autoComplete="username" autoCapitalize="none" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required /><label className="label" htmlFor="password">Пароль</label><input id="password" type="password" className="field mb-4" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />{error && <p className="entry-error" role="alert">{error}</p>}<button type="submit" className="entry-submit" disabled={busy}>{busy ? 'Вход…' : 'Войти в кабинет'} <span>→</span></button><p className="entry-help">Логин и пароль выдаёт администратор или руководитель.</p></form></>}
    </div></main></div>;
}
