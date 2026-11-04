import { readFileSync } from 'node:fs';

function readPat(variable: string, fallback = ''): string {
  const file = process.env[variable] || fallback;
  return readFileSync(file, 'utf-8').trim();
}

export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT || '3000', 10),
  zitadelIssuer: process.env.ZITADEL_ISSUER || '',
  get zitadelInternalIssuer() {
    return process.env.ZITADEL_INTERNAL_ISSUER || this.zitadelIssuer;
  },
  zitadelClientId: process.env.ZITADEL_CLIENT_ID || '',
  // The admin PAT manages users and project grants.  Completing an OIDC
  // authorization request, however, requires the separate IAM_LOGIN_CLIENT PAT.
  zitadelServicePat: readPat('ZITADEL_SERVICE_PAT_FILE'),
  zitadelLoginClientPat: readPat('ZITADEL_LOGIN_CLIENT_PAT_FILE', '/zitadel/bootstrap/login-client.pat'),
  zitadelLoginRedirectUri:
    process.env.ZITADEL_LOGIN_REDIRECT_URI || 'http://auth-service:3000/auth/callback',
  zitadelProjectId: process.env.ZITADEL_PROJECT_ID || '',
  zitadelDefaultRoleKey: process.env.ZITADEL_DEFAULT_ROLE_KEY || 'EduClaw',
  aliyunAccessKeyId: process.env.ALIYUN_ACCESS_KEY_ID || '',
  aliyunAccessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET || '',
  aliyunSmsSignName: process.env.ALIYUN_SMS_SIGN_NAME || '',
  aliyunSmsTemplateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE || '',
};
