import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '../stores/auth';
import { BASE } from '../api/client';
import { useT } from '../i18n';

const PRESET_ACCOUNTS = [
  { username: 'user1',  password: 'educlaw123' },
  { username: 'user2',  password: 'educlaw123' },
  { username: 'user3',  password: 'educlaw123' },
  { username: 'user4',  password: 'educlaw123' },
  { username: 'user5',  password: 'educlaw123' },
  { username: 'user6',  password: 'educlaw123' },
  { username: 'user7',  password: 'educlaw123' },
  { username: 'user8',  password: 'educlaw123' },
  { username: 'user9',  password: 'educlaw123' },
  { username: 'user10', password: 'educlaw123' },
  { username: 'user11', password: 'educlaw123' },
  { username: 'user12', password: 'educlaw123' },
  { username: 'user13', password: 'educlaw123' },
  { username: 'user14', password: 'educlaw123' },
  { username: 'user15', password: 'educlaw123' },
];

export default function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (username.length < 3 || username.length > 32) {
      setError(t('auth.usernameLength'));
      return;
    }
    if (password.length < 6) {
      setError(t('auth.passwordLength'));
      return;
    }

    setLoading(true);
    try {
      await login(username, password);
      navigate('/', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('auth.unknownError'));
    } finally {
      setLoading(false);
    }
  }

  const highlights = [
    { icon: Sparkles, text: t('auth.infoWorkspace') },
    { icon: Users, text: t('auth.infoAccount') },
    { icon: ShieldCheck, text: t('auth.pageDescription') },
  ];

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-mesh-gradient opacity-90" />

      <div className="relative grid w-full max-w-6xl overflow-hidden rounded-[24px] border border-border bg-card shadow-[var(--shadow-lg)] xl:grid-cols-[minmax(0,1.15fr)_30rem]">
        <section className="relative hidden border-r border-border bg-muted/55 px-10 py-12 xl:flex xl:flex-col xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-3 rounded-full border border-primary/12 bg-primary-soft px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              IAIE workspace entry
            </div>

            <div className="mt-8 flex items-center gap-4">
              <img src={`${BASE}/logo.png`} alt="EduClaw" className="size-16 rounded-[18px] shadow-[var(--shadow-sm)]" />
              <div>
                <div className="text-[28px] font-semibold tracking-[-0.03em] text-foreground">EduClaw</div>
                <div className="mt-1 text-sm leading-6 text-muted-foreground">{t('auth.pageDescription')}</div>
              </div>
            </div>

            <div className="mt-16 max-w-xl">
              <h1 className="text-[32px] leading-10 font-semibold tracking-[-0.04em] text-foreground">
                {t('auth.loginSubtitle')}
              </h1>
              <p className="mt-4 text-base leading-7 text-muted-foreground">{t('auth.loginHint')}</p>
            </div>
          </div>

          <div className="grid gap-4">
            {highlights.map((item) => (
              <div key={item.text} className="flex items-start gap-3 rounded-[16px] border border-border bg-card px-4 py-4 shadow-[var(--shadow-sm)]">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-primary-soft text-primary">
                  <item.icon className="size-4.5" />
                </div>
                <div className="text-sm leading-6 text-muted-foreground">{item.text}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-card px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
          <div className="mx-auto flex w-full max-w-md flex-col gap-6">
            <div className="xl:hidden">
              <div className="flex items-center gap-3">
                <img src={`${BASE}/logo.png`} alt="EduClaw" className="size-12 rounded-[14px] shadow-[var(--shadow-sm)]" />
                <div>
                  <div className="text-xl font-semibold tracking-[-0.03em] text-foreground">EduClaw</div>
                  <div className="text-sm text-muted-foreground">{t('auth.pageDescription')}</div>
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {t('auth.accountAccess')}
              </div>
              <h2 className="mt-2 text-[28px] leading-9 font-semibold tracking-[-0.03em] text-foreground">
                {t('auth.loginSubtitle')}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{t('auth.loginHint')}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="auth-username" className="text-sm font-medium text-foreground">{t('auth.usernamePlaceholder')}</label>
                <div className="input-glow rounded-[12px] border border-border bg-card p-1">
                  <Input
                    id="auth-username"
                    name="username"
                    placeholder={t('auth.usernamePlaceholder')}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoFocus
                    autoComplete="username"
                    className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="auth-password" className="text-sm font-medium text-foreground">{t('auth.passwordPlaceholder')}</label>
                <div className="input-glow rounded-[12px] border border-border bg-card p-1">
                  <Input
                    id="auth-password"
                    name="password"
                    type="password"
                    placeholder={t('auth.passwordPlaceholder')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-[12px] border border-[rgba(240,45,45,0.14)] bg-[rgba(240,45,45,0.08)] px-4 py-3 text-sm text-destructive animate-fade-in">
                  {error}
                </div>
              )}

              <Button type="submit" disabled={loading} className="h-10 w-full rounded-[10px] text-sm">
                {loading ? t('auth.loggingIn') : t('auth.login')}
              </Button>
            </form>

            <div className="rounded-[16px] border border-border bg-muted px-4 py-4 text-sm leading-6 text-muted-foreground">
              <div className="font-medium text-foreground mb-2">预置账号（点击快速填充）</div>
              <div className="grid grid-cols-3 gap-2">
                {PRESET_ACCOUNTS.map((acc) => (
                  <button
                    key={acc.username}
                    type="button"
                    onClick={() => {
                      setUsername(acc.username);
                      setPassword(acc.password);
                      setError('');
                    }}
                    className="rounded-lg border border-border/70 bg-card px-2 py-1.5 text-xs text-center hover:border-primary/40 hover:bg-primary/5 transition-colors cursor-pointer"
                  >
                    {acc.username}
                  </button>
                ))}
              </div>
              <div className="mt-2 text-xs">密码统一为：<span className="font-mono text-foreground">educlaw123</span></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
