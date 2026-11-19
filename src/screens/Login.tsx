import { useState } from 'react';
import { CalendarCheck2, Loader2 } from 'lucide-react';
import { store, useStore, useT } from '@/data/store';
import { supabase } from '@/sync/supabase';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import type { Lang } from '@/lib/types';

export function Login() {
  const t = useT();
  const lang = useStore((s) => s.settings.lang);
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = supabase();
    if (!sb) return;
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'in') {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        if (!data.session) setMsg(t('authConfirm'));
      }
    } catch (err) {
      const m = (err as Error).message || '';
      if (/database error|single-user|registration is closed/i.test(m)) setMsg(t('authClosed'));
      else if (/invalid login|invalid credentials/i.test(m)) setMsg(t('authBadCreds'));
      else if (/not confirmed/i.test(m)) setMsg(t('authConfirm'));
      else if (/fetch|network|load failed/i.test(m) || !navigator.onLine) setMsg(t('authOffline'));
      else setMsg(m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 pb-[calc(var(--sab)+24px)] pt-safe">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 grid h-20 w-20 place-items-center rounded-[22px] bg-gradient-to-br from-[#5b6cff] to-[#8a5cff] text-white shadow-float">
            <CalendarCheck2 size={40} />
          </div>
          <h1 className="text-[30px] font-bold tracking-tight">MyDay Planner</h1>
          <p className="mt-2 text-[15px] text-muted">{mode === 'in' ? t('signInText') : t('signUpText')}</p>
        </div>
        <form onSubmit={submit} className="card space-y-3 p-5">
          <h2 className="text-[19px] font-semibold">{mode === 'in' ? t('signInTitle') : t('signUpTitle')}</h2>
          <label className="block">
            <span className="label">{t('email')}</span>
            <input className="field" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email" />
          </label>
          <label className="block">
            <span className="label">{t('password')}</span>
            <input className="field" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={8} required
              value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password" />
            {mode === 'up' && <span className="mt-1 block text-[12.5px] text-muted">{t('passwordHint')}</span>}
          </label>
          {msg && <p className="rounded-xl bg-amber-500/10 p-3 text-[14px] text-amber-700 dark:text-amber-300" role="alert">{msg}</p>}
          <Button size="lg" className="w-full" disabled={busy} type="submit" data-testid="login-submit">
            {busy && <Loader2 size={18} className="animate-spin" />} {mode === 'in' ? t('signIn') : t('signUp')}
          </Button>
          <button type="button" className="w-full py-2 text-[14px] font-medium text-accent" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null); }}>
            {mode === 'in' ? t('noAccount') : t('haveAccount')}
          </button>
        </form>
        <div className="mt-6 flex justify-center">
          <Segmented<Lang> className="w-56" value={lang} onChange={(v) => store.setLang(v)} options={[{ value: 'ru', label: 'Русский' }, { value: 'uk', label: 'Українська' }]} />
        </div>
      </div>
    </div>
  );
}
