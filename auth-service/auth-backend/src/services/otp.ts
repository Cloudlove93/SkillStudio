import crypto from 'node:crypto';

interface OtpEntry {
  code: string;
  phone: string;
  expiresAt: number;
  attempts: number;
}

const otpStore = new Map<string, OtpEntry>();
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

export function generateOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}

export function storeOtp(phone: string, code: string): string {
  const id = crypto.randomUUID();
  otpStore.set(id, { code, phone, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });
  return id;
}

export function verifyOtpEntry(id: string, code: string): { ok: boolean; error?: string } {
  const entry = otpStore.get(id);
  if (!entry) return { ok: false, error: '验证码不存在或已过期' };
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(id);
    return { ok: false, error: '验证码已过期' };
  }
  if (entry.attempts >= OTP_MAX_ATTEMPTS) {
    otpStore.delete(id);
    return { ok: false, error: '验证码尝试次数过多' };
  }
  entry.attempts++;
  if (entry.code !== code) return { ok: false, error: '验证码错误' };
  otpStore.delete(id);
  return { ok: true };
}

// ─── SMS 速率限制 ─────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const smsRateLimits = new Map<string, RateLimitEntry>();
const SMS_RATE_LIMIT_MAX = 3;
const SMS_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export function checkSmsRateLimit(phone: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const entry = smsRateLimits.get(phone);

  if (!entry || now - entry.windowStart > SMS_RATE_LIMIT_WINDOW_MS) {
    smsRateLimits.set(phone, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (entry.count >= SMS_RATE_LIMIT_MAX) {
    const retryAfterMs = SMS_RATE_LIMIT_WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
  }

  entry.count++;
  return { allowed: true };
}

// ─── 清理定时器 ─────────────────────────────────────────────────────────

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function cleanup() {
  const now = Date.now();
  for (const [id, entry] of otpStore) {
    if (now > entry.expiresAt) otpStore.delete(id);
  }
  for (const [phone, entry] of smsRateLimits) {
    if (now - entry.windowStart > SMS_RATE_LIMIT_WINDOW_MS) smsRateLimits.delete(phone);
  }
}

export function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanup, 60_000);
}

export function stopCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
