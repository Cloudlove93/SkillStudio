import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ShieldCheck, Sparkles, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '../stores/auth';
import { BASE } from '../api/client';

type Mode = 'login' | 'register';

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);

  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const copy = useMemo(
    () => ({
      pageDescription: 'Skill 管理与成长工作台',
      loginSubtitle: '登录到 EduSkill',
      registerSubtitle: '创建 EduSkill 账号',
      loginHint: '登录后继续使用你的工作区。',
      registerHint: '注册后将直接进入工作区。',
      infoWorkspace:
        '在一个工作台中完成 Skill 的创建、整理、评估与持续优化，让好用的能力能够被沉淀、复用和共享。',
      infoAccount: '注册后可以继续管理工作区中的账号、资料与使用记录。',
      accountAccess: '账户访问',
      emailOrUsername: '邮箱',
      username: '用户名',
      email: '邮箱',
      password: '密码',
      confirmPassword: '确认密码',
      inviteCode: '邀请码',
      login: '登录',
      register: '注册',
      loggingIn: '登录中...',
      registering: '注册中...',
      emailInvalid: '请输入有效的邮箱地址',
      usernameLength: '用户名需要 3-32 个字符',
      passwordLength: '密码至少需要 6 个字符',
      passwordMismatch: '两次密码输入不一致',
      inviteCodeRequired: '请输入邀请码',
      unknownError: '发生未知错误，请重试',
    }),
    [],
  );

  function isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (mode === 'login') {
      // 登录时，username 字段实际存储的是邮箱
      if (!username.trim()) {
        setError(copy.emailInvalid);
        return;
      }
    } else {
      // 注册时验证邮箱格式
      if (!isValidEmail(email)) {
        setError(copy.emailInvalid);
        return;
      }
      if (username.length < 3 || username.length > 32) {
        setError(copy.usernameLength);
        return;
      }
    }

    if (password.length < 6) {
      setError(copy.passwordLength);
      return;
    }
    if (mode === 'register') {
      if (password !== confirmPassword) {
        setError(copy.passwordMismatch);
        return;
      }
      if (!inviteCode.trim()) {
        setError(copy.inviteCodeRequired);
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        await register(email, password, inviteCode, username);
      }
      navigate('/', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : copy.unknownError);
    } finally {
      setLoading(false);
    }
  }

  const highlights = [
    { icon: Sparkles, text: copy.infoWorkspace },
    { icon: Users, text: copy.infoAccount },
    { icon: ShieldCheck, text: copy.pageDescription },
  ];

  const isRegister = mode === 'register';

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-mesh-gradient opacity-90" />

      <div className="relative grid w-full max-w-6xl overflow-hidden rounded-[24px] border border-border bg-card shadow-[var(--shadow-lg)] xl:grid-cols-[minmax(0,1.15fr)_30rem]">
        <section className="relative hidden border-r border-border bg-muted/55 px-10 py-12 xl:flex xl:flex-col xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-3 rounded-full border border-primary/12 bg-primary-soft px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Workspace entry
            </div>

            <div className="mt-8 flex items-center gap-4">
              <img
                src={`${BASE}/logo.png`}
                alt="EduSkill"
                className="size-16 rounded-[18px] shadow-[var(--shadow-sm)]"
              />
              <div>
                <div className="text-[28px] font-semibold tracking-[-0.03em] text-foreground">
                  EduSkill
                </div>
                <div className="mt-1 text-sm leading-6 text-muted-foreground">
                  {copy.pageDescription}
                </div>
              </div>
            </div>

            <div className="mt-16 max-w-xl">
              <h1 className="text-[32px] leading-10 font-semibold tracking-[-0.04em] text-foreground">
                {isRegister ? copy.registerSubtitle : copy.loginSubtitle}
              </h1>
              <p className="mt-4 text-base leading-7 text-muted-foreground">
                {isRegister ? copy.registerHint : copy.loginHint}
              </p>
            </div>
          </div>

          <div className="grid gap-4">
            {highlights.map((item) => (
              <div
                key={item.text}
                className="flex items-start gap-3 rounded-[16px] border border-border bg-card px-4 py-4 shadow-[var(--shadow-sm)]"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-primary-soft text-primary">
                  <item.icon className="size-4.5" />
                </div>
                <div className="text-sm leading-6 text-muted-foreground">
                  {item.text}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-card px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
          <div className="mx-auto flex w-full max-w-md flex-col gap-6">
            <div className="xl:hidden">
              <div className="flex items-center gap-3">
                <img
                  src={`${BASE}/logo.png`}
                  alt="EduSkill"
                  className="size-12 rounded-[14px] shadow-[var(--shadow-sm)]"
                />
                <div>
                  <div className="text-xl font-semibold tracking-[-0.03em] text-foreground">
                    EduSkill
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {copy.pageDescription}
                  </div>
                </div>
              </div>
            </div>

            <div className="inline-flex w-full rounded-[12px] border border-border bg-muted p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
                className={`flex-1 rounded-[10px] px-4 py-2 text-sm font-medium ${!isRegister ? 'bg-card text-foreground shadow-[var(--shadow-sm)]' : 'text-muted-foreground'}`}
              >
                {copy.login}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError('');
                }}
                className={`flex-1 rounded-[10px] px-4 py-2 text-sm font-medium ${isRegister ? 'bg-card text-foreground shadow-[var(--shadow-sm)]' : 'text-muted-foreground'}`}
              >
                {copy.register}
              </button>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {copy.accountAccess}
              </div>
              <h2 className="mt-2 text-[28px] leading-9 font-semibold tracking-[-0.03em] text-foreground">
                {isRegister ? copy.registerSubtitle : copy.loginSubtitle}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {isRegister ? copy.registerHint : copy.loginHint}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {isRegister && (
                <div className="space-y-2">
                  <label
                    htmlFor="auth-username"
                    className="text-sm font-medium text-foreground"
                  >
                    {copy.username}
                  </label>
                  <div className="input-glow rounded-[12px] border border-border bg-card p-1">
                    <Input
                      id="auth-username"
                      name="username"
                      placeholder={copy.username}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoFocus
                      autoComplete="username"
                      className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label
                  htmlFor={isRegister ? 'auth-email' : 'auth-username'}
                  className="text-sm font-medium text-foreground"
                >
                  {isRegister ? copy.email : copy.emailOrUsername}
                </label>
                <div className="input-glow rounded-[12px] border border-border bg-card p-1">
                  {isRegister ? (
                    <Input
                      id="auth-email"
                      name="email"
                      type="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                    />
                  ) : (
                    <Input
                      id="auth-username"
                      name="username"
                      placeholder="your@email.com"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoFocus
                      autoComplete="username"
                      className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                    />
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="auth-password"
                  className="text-sm font-medium text-foreground"
                >
                  {copy.password}
                </label>
                <div className="input-glow rounded-[12px] border border-border bg-card p-1">
                  <Input
                    id="auth-password"
                    name="password"
                    type="password"
                    placeholder={copy.password}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={
                      isRegister ? 'new-password' : 'current-password'
                    }
                    className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                  />
                </div>
              </div>

              {isRegister && (
                <>
                  <div className="space-y-2">
                    <label
                      htmlFor="auth-confirm-password"
                      className="text-sm font-medium text-foreground"
                    >
                      {copy.confirmPassword}
                    </label>
                    <div className="input-glow rounded-[12px] border border-border bg-card p-1">
                      <Input
                        id="auth-confirm-password"
                        name="confirmPassword"
                        type="password"
                        placeholder={copy.confirmPassword}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        autoComplete="new-password"
                        className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="auth-invite-code"
                      className="text-sm font-medium text-foreground"
                    >
                      {copy.inviteCode}
                    </label>
                    <div className="input-glow rounded-[12px] border border-border bg-card p-1">
                      <Input
                        id="auth-invite-code"
                        name="inviteCode"
                        placeholder={copy.inviteCode}
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value)}
                        autoComplete="off"
                        className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                      />
                    </div>
                  </div>
                </>
              )}

              {error && (
                <div className="rounded-[12px] border border-[rgba(240,45,45,0.14)] bg-[rgba(240,45,45,0.08)] px-4 py-3 text-sm text-destructive animate-fade-in">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="h-10 w-full rounded-[10px] text-sm"
              >
                {loading
                  ? isRegister
                    ? copy.registering
                    : copy.loggingIn
                  : isRegister
                    ? copy.register
                    : copy.login}
              </Button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
