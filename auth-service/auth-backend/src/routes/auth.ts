import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { getLogger } from '../logger.js';
import * as zitadelUser from '../services/zitadel-user.js';
import { getUserId, requireOidcUser } from '../middleware/auth.js';
import { sendSms } from '../services/sms.js';
import { generateOtp, storeOtp, verifyOtpEntry, checkSmsRateLimit } from '../services/otp.js';

const router = Router();
const log = getLogger('zitadel-auth-service');

function sanitizeError(err: unknown, fallback: string): string {
  if (err instanceof Error && /^[一-鿿]/.test(err.message)) return err.message;
  return fallback;
}

type AuthMode = 'login' | 'register';

interface LoginTokens {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

interface SessionTokens {
  sessionId: string;
  sessionToken: string;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getIssuer(): string {
  return config.zitadelInternalIssuer.replace(/\/+$/, '');
}

function serviceJsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.zitadelServicePat}`,
  };
}

function createAuthUrl(issuer: string, codeChallenge: string, state: string): URL {
  const authUrl = new URL(`${issuer}/oauth/v2/authorize`);
  authUrl.searchParams.set('client_id', config.zitadelClientId);
  authUrl.searchParams.set('redirect_uri', config.zitadelLoginRedirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid profile email offline_access');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  return authUrl;
}

async function startOidcFlow(includeAuthBodyInError: boolean): Promise<{
  issuer: string;
  codeVerifier: string;
  authRequestID: string;
}> {
  const issuer = getIssuer();
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const state = base64url(crypto.randomBytes(16));

  const authRes = await fetch(createAuthUrl(issuer, codeChallenge, state).toString(), { redirect: 'manual' });
  const location = authRes.headers.get('location');
  if (!location) {
    if (!includeAuthBodyInError) throw new Error('Failed to create auth request');
    const text = await authRes.text();
    throw new Error(`Failed to create auth request: ${text}`);
  }

  const locUrl = new URL(location, issuer);
  const authRequestID =
    locUrl.searchParams.get('authRequest') ||
    locUrl.searchParams.get('authRequestID') ||
    locUrl.searchParams.get('authRequestId');
  if (!authRequestID) {
    throw new Error('No authRequestID in redirect');
  }

  return { issuer, codeVerifier, authRequestID };
}

async function createSession(checks: unknown, errorPrefix: string): Promise<SessionTokens> {
  const sessionRes = await fetch(`${getIssuer()}/v2/sessions`, {
    method: 'POST',
    headers: serviceJsonHeaders(),
    body: JSON.stringify({ checks }),
  });

  if (!sessionRes.ok) {
    const text = await sessionRes.text();
    throw new Error(`${errorPrefix}: ${text}`);
  }

  return (await sessionRes.json()) as SessionTokens;
}

async function finishOidcFlow(
  flow: Awaited<ReturnType<typeof startOidcFlow>>,
  session: SessionTokens,
): Promise<LoginTokens> {
  const finRes = await fetch(`${flow.issuer}/v2/oidc/auth_requests/${flow.authRequestID}`, {
    method: 'POST',
    headers: serviceJsonHeaders(),
    body: JSON.stringify({ session }),
  });
  if (!finRes.ok) {
    const text = await finRes.text();
    throw new Error(`Failed to finalize auth request: ${text}`);
  }

  const { callbackUrl } = (await finRes.json()) as { callbackUrl: string };
  const code = new URL(callbackUrl).searchParams.get('code');
  if (!code) {
    throw new Error('No code in callback');
  }

  const tokenRes = await fetch(`${flow.issuer}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.zitadelLoginRedirectUri,
      client_id: config.zitadelClientId,
      code_verifier: flow.codeVerifier,
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  return (await tokenRes.json()) as LoginTokens;
}

async function lookupSessionUser(username: string): Promise<{ user: { loginName: string } } | { user: { userId: string } }> {
  if (!username.includes('@') || username.endsWith('@zitadel.localhost')) {
    return { user: { loginName: username } };
  }

  const results = await zitadelUser.searchUsers([
    { emailQuery: { emailAddress: username, method: 'TEXT_QUERY_METHOD_EQUALS' } },
  ]);
  const userId = results[0]?.userId;
  return userId ? { user: { userId } } : { user: { loginName: username } };
}

async function loginWithPassword(username: string, password: string): Promise<LoginTokens> {
  const flow = await startOidcFlow(true);
  const user = await lookupSessionUser(username);
  const session = await createSession({
    ...user,
    password: { password },
  }, 'Invalid credentials');

  return finishOidcFlow(flow, session);
}

async function loginWithUserIdAndPassword(userId: string, password: string): Promise<LoginTokens> {
  const flow = await startOidcFlow(true);
  const session = await createSession({
    user: { userId },
    password: { password },
  }, 'Invalid credentials');

  return finishOidcFlow(flow, session);
}

async function loginWithSession(sessionId: string, sessionToken: string): Promise<LoginTokens> {
  return finishOidcFlow(await startOidcFlow(false), { sessionId, sessionToken });
}

function isDuplicateUsernameError(message: string): boolean {
  return (
    (/username/.test(message) && (/already/.test(message) || /exists/.test(message) || /taken/.test(message))) ||
    /user already exists/.test(message)
  );
}

function isDuplicateEmailError(message: string): boolean {
  return /email/.test(message) && (/already/.test(message) || /exists/.test(message) || /taken/.test(message));
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function isEmailTaken(email: string): Promise<boolean> {
  const results = await zitadelUser.searchUsers([
    { emailQuery: { emailAddress: normalizeEmail(email), method: 'TEXT_QUERY_METHOD_EQUALS' } },
  ]);
  return results.length > 0;
}

async function registerWithPassword(username: string, email: string, password: string): Promise<LoginTokens> {
  const normalizedEmail = normalizeEmail(email);
  if (await isEmailTaken(normalizedEmail)) {
    throw new Error('该邮箱已被注册');
  }

  const givenName = username.replace(/[^a-zA-Z0-9]/g, '') || username;
  const createRes = await fetch(`${getIssuer()}/v2/users/human`, {
    method: 'POST',
    headers: serviceJsonHeaders(),
    body: JSON.stringify({
      username,
      profile: { givenName, familyName: 'User' },
      email: { email: normalizedEmail, isVerified: true },
      password: { password, changeRequired: false },
    }),
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    const normalizedText = text.toLowerCase();
    if (isDuplicateUsernameError(normalizedText)) {
      throw new Error('该用户名已存在');
    }
    if (isDuplicateEmailError(normalizedText)) {
      throw new Error('该邮箱已被注册');
    }
    throw new Error(`Registration failed: ${text}`);
  }

  const created = (await createRes.json()) as { userId?: string };
  if (created.userId && config.zitadelDefaultRoleKey) {
    try {
      await zitadelUser.assignUserRole(created.userId, config.zitadelDefaultRoleKey);
    } catch (err) {
      log.warn({ err, userId: created.userId }, 'Failed to assign default role on registration');
    }
  }

  if (!created.userId) {
    throw new Error('Registration succeeded but userId was not returned');
  }

  return loginWithUserIdAndPassword(created.userId, password);
}

async function runPasswordAuth(mode: AuthMode, req: Request, res: Response): Promise<void> {
  const username = req.body?.username?.trim();
  const email = req.body?.email?.trim();
  const password = req.body?.password;

  if (!username || !password) {
    res.status(400).json({ error: 'username and password required' });
    return;
  }

  if (mode === 'register' && !email) {
    res.status(400).json({ error: 'email is required for registration' });
    return;
  }

  const tokens =
    mode === 'register'
      ? await registerWithPassword(username, email, password)
      : await loginWithPassword(username, password);

  res.json(tokens);
}

router.post('/auth/password', async (req: Request, res: Response) => {
  const mode = req.body?.mode;
  if (mode !== 'login' && mode !== 'register') {
    res.status(400).json({ error: 'mode must be "login" or "register"' });
    return;
  }
  try {
    await runPasswordAuth(mode, req, res);
  } catch (err: any) {
    log.error({ err }, 'Password auth failed');
    res.status(400).json({ error: sanitizeError(err, 'Authentication failed') });
  }
});

router.post('/auth/logout', async (req: Request, res: Response) => {
  const refreshToken = req.body?.refresh_token;
  const accessToken = req.body?.access_token;

  if (!refreshToken && !accessToken) {
    res.json({ ok: true });
    return;
  }

  try {
    const tokensToRevoke = [
      refreshToken && { token: refreshToken, hint: 'refresh_token' },
      accessToken && { token: accessToken, hint: 'access_token' },
    ].filter(Boolean) as Array<{ token: string; hint: string }>;

    const results = await Promise.allSettled(
      tokensToRevoke.map(({ token, hint }) =>
        fetch(`${getIssuer()}/oauth/v2/revoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: config.zitadelClientId,
            token,
            token_type_hint: hint,
          }),
        }),
      ),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        log.warn({ err: result.reason }, 'Token revoke failed');
      } else if (!result.value.ok) {
        const text = await result.value.text();
        log.warn({ status: result.value.status, body: text }, 'Token revoke returned non-OK');
      }
    }

    res.json({ ok: true });
  } catch (err: any) {
    log.error({ err }, 'Logout failed');
    res.json({ ok: true });
  }
});

router.get('/auth/me', requireOidcUser, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const user = await zitadelUser.findById(userId);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    const roles = await zitadelUser.getUserRoles(userId);
    res.json({ ...user, roles });
  } catch (err: any) {
    log.error({ err }, 'Failed to fetch user info');
    res.status(500).json({ error: sanitizeError(err, '获取用户信息失败') });
  }
});


// ─── SMS 辅助函数 ────────────────────────────────────────────────────────────

function toE164Phone(phone: string): string {
  if (phone.startsWith('+')) return phone;
  // Fallback: bare 11-digit Chinese mobile → +86
  if (/^1[3-9]\d{9}$/.test(phone)) return `+86${phone}`;
  return phone;
}

async function sendSmsCode(phone: string): Promise<string> {
  const e164Phone = toE164Phone(phone);
  const code = generateOtp();
  const otpId = storeOtp(e164Phone, code);
  log.info({ phone: e164Phone, otpId }, 'Sending SMS OTP');

  try {
    await sendSms(e164Phone, `您的验证码是：${code}`);
  } catch (err: any) {
    log.error({ err, phone }, 'Failed to send SMS');
    throw new Error('短信发送失败，请稍后重试');
  }

  return otpId;
}

async function lookupUserByPhone(phone: string): Promise<string | null> {
  const e164Phone = toE164Phone(phone);
  const results = await zitadelUser.searchUsers([
    { phoneQuery: { number: e164Phone, method: 'TEXT_QUERY_METHOD_EQUALS' } },
  ]);
  return results[0]?.userId ?? null;
}

async function registerWithPhone(
  phone: string,
  username: string,
  password: string,
): Promise<LoginTokens> {
  const givenName = username.replace(/[^a-zA-Z0-9]/g, '') || username;
  const e164Phone = toE164Phone(phone);
  const createRes = await fetch(`${getIssuer()}/v2/users/human`, {
    method: 'POST',
    headers: serviceJsonHeaders(),
    body: JSON.stringify({
      username,
      profile: { givenName, familyName: 'User' },
      email: { email: `${phone}@phone.local`, isVerified: true },
      phone: { phone: e164Phone, isVerified: true },
      password: { password, changeRequired: false },
    }),
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    if (isDuplicateUsernameError(text.toLowerCase())) {
      throw new Error('该用户名已存在');
    }
    throw new Error(`Registration failed: ${text}`);
  }

  const created = (await createRes.json()) as { userId?: string };
  if (created.userId && config.zitadelDefaultRoleKey) {
    try {
      await zitadelUser.assignUserRole(created.userId, config.zitadelDefaultRoleKey);
    } catch (err) {
      log.warn({ err, userId: created.userId }, 'Failed to assign default role on registration');
    }
  }

  if (!created.userId) {
    throw new Error('Registration succeeded but userId was not returned');
  }

  return loginWithUserIdAndPassword(created.userId, password);
}

// ─── SMS 验证码端点 ──────────────────────────────────────────────────────────

router.post('/auth/sms/send', async (req: Request, res: Response) => {
  const phone = req.body?.phone?.trim();
  if (!phone) {
    res.status(400).json({ error: '手机号不能为空' });
    return;
  }

  const rateLimit = checkSmsRateLimit(toE164Phone(phone));
  if (!rateLimit.allowed) {
    res.status(429).json({ error: '发送过于频繁，请稍后再试', retryAfterSeconds: rateLimit.retryAfterSeconds });
    return;
  }

  try {
    const otpId = await sendSmsCode(phone);
    res.json({ ok: true, otpId, message: '验证码已发送' });
  } catch (err: any) {
    log.error({ err, phone }, 'Send SMS failed');
    res.status(500).json({ error: sanitizeError(err, '验证码发送失败') });
  }
});

router.post('/auth/sms/login', async (req: Request, res: Response) => {
  const { phone, code, otpId } = req.body || {};
  if (!phone || !code || !otpId) {
    res.status(400).json({ error: 'phone, code, otpId 必填' });
    return;
  }

  try {
    // 1. 验证 OTP
    const check = verifyOtpEntry(otpId, code);
    if (!check.ok) {
      res.status(400).json({ error: check.error });
      return;
    }

    // 2. 查找用户
    const userId = await lookupUserByPhone(phone);
    if (!userId) {
      res.status(404).json({ error: '该手机号未注册' });
      return;
    }

    const { sessionId, sessionToken } = await createSession(
      { user: { userId } },
      'Session creation failed',
    );

    // 4. 完成 OIDC 流程获取 tokens
    const tokens = await loginWithSession(sessionId, sessionToken);
    res.json(tokens);
  } catch (err: any) {
    log.error({ err, phone }, 'SMS login failed');
    res.status(400).json({ error: sanitizeError(err, '登录失败') });
  }
});

router.post('/auth/sms/register', async (req: Request, res: Response) => {
  const { phone, code, otpId, username, password } = req.body || {};
  if (!phone || !code || !otpId || !username || !password) {
    res.status(400).json({ error: 'phone, code, otpId, username, password 必填' });
    return;
  }

  try {
    // 1. 验证 OTP
    const check = verifyOtpEntry(otpId, code);
    if (!check.ok) {
      res.status(400).json({ error: check.error });
      return;
    }

    // 2. 检查用户是否已存在
    const existingUserId = await lookupUserByPhone(phone);
    if (existingUserId) {
      res.status(409).json({ error: '该手机号已注册' });
      return;
    }

    // 3. 创建用户并自动登录
    const tokens = await registerWithPhone(phone, username, password);
    res.json(tokens);
  } catch (err: any) {
    log.error({ err, phone }, 'SMS register failed');
    res.status(400).json({ error: sanitizeError(err, '注册失败') });
  }
});

// ─── Zitadel 自定义 SMS Provider 端点 ────────────────────────────────────────
// Zitadel 会 POST { recipient, message } 到此接口
router.post('/sms/send', async (req: Request, res: Response) => {
  const { recipient, message } = req.body || {};

  if (!recipient) {
    res.status(400).json({ error: 'recipient is required' });
    return;
  }

  try {
    await sendSms(recipient, message || '');
    res.json({ success: true });
  } catch (err: any) {
    log.error({ err, recipient }, 'SMS send (Zitadel provider) failed');
    res.status(500).json({ error: sanitizeError(err, 'SMS send failed') });
  }
});

export default router;
