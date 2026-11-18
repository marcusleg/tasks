/** Settings come from environment variables (see .env.example). */
import { resolve } from 'node:path';

const env = process.env;

function bool(name, fallback) {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

function list(name) {
  return (env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const port = Number(env.PORT || 3000);
const publicUrl = (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, '');

export const config = {
  port,
  host: env.HOST || '0.0.0.0',
  publicUrl,
  dataDir: resolve(env.DATA_DIR || './data'),
  appName: env.APP_NAME || 'Tasks',
  trustProxy: bool('TRUST_PROXY', false),
  secureCookies: bool('COOKIE_SECURE', publicUrl.startsWith('https://')),
  sessionDays: Number(env.SESSION_DAYS || 30),

  passwordAuth: bool('AUTH_PASSWORD_ENABLED', true),
  allowSignup: bool('ALLOW_SIGNUP', false),

  oidc: {
    issuer: env.OIDC_ISSUER || '',
    clientId: env.OIDC_CLIENT_ID || '',
    clientSecret: env.OIDC_CLIENT_SECRET || '',
    name: env.OIDC_PROVIDER_NAME || 'Single sign-on',
    scopes: env.OIDC_SCOPES || 'openid profile email',
    autoRedirect: bool('OIDC_AUTO_REDIRECT', false),
    allowSignup: bool('OIDC_ALLOW_SIGNUP', true),
    linkByEmail: bool('OIDC_LINK_EXISTING_BY_EMAIL', true),
    allowedGroups: list('OIDC_ALLOWED_GROUPS'),
    groupsClaim: env.OIDC_GROUPS_CLAIM || 'groups',
    logoutAtProvider: bool('OIDC_LOGOUT_AT_PROVIDER', false)
  },

  links: {
    help: env.HELP_URL || '/help/',
    privacy: env.PRIVACY_URL || '/privacy/',
    terms: env.TERMS_URL || '/terms/'
  }
};

config.oidc.enabled = Boolean(config.oidc.issuer && config.oidc.clientId);

export function validateConfig() {
  const problems = [];
  if (!config.passwordAuth && !config.oidc.enabled) {
    problems.push('Password sign-in is turned off (AUTH_PASSWORD_ENABLED=false) but OIDC isn’t configured, so nobody could sign in. Set OIDC_ISSUER and OIDC_CLIENT_ID, or enable passwords.');
  }
  if ((config.oidc.issuer && !config.oidc.clientId) || (!config.oidc.issuer && config.oidc.clientId)) {
    problems.push('OIDC needs both OIDC_ISSUER and OIDC_CLIENT_ID.');
  }
  try {
    new URL(config.publicUrl);
  } catch {
    problems.push(`PUBLIC_URL is not a valid address: ${config.publicUrl}`);
  }
  return problems;
}
