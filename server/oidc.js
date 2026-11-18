/** Sign-in through an OpenID Connect provider (Authentik, Keycloak, Authelia, Pocket ID, Google, Entra ID …). */
import * as client from 'openid-client';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { config } from './config.js';
import { db, createUser, freeUsername, now } from './db.js';
import { startSession } from './auth.js';

const FLOW_COOKIE = 'tasks_oidc_flow';
const redirectUri = () => `${config.publicUrl}/auth/oidc/callback`;

let discovered = null;

async function oidcConfig() {
  if (discovered) return discovered;
  const { issuer, clientId, clientSecret } = config.oidc;
  const options = issuer.startsWith('http://') ? { execute: [client.allowInsecureRequests] } : undefined;
  discovered = clientSecret
    ? await client.discovery(new URL(issuer), clientId, clientSecret, undefined, options)
    : await client.discovery(new URL(issuer), clientId, undefined, client.None(), options);
  return discovered;
}

/** Try discovery at start-up so mistakes show in the logs early (failures are retried on sign-in). */
export async function warmUp() {
  if (!config.oidc.enabled) return;
  try {
    await oidcConfig();
    console.log(`OIDC: using ${config.oidc.issuer} (redirect URI: ${redirectUri()})`);
  } catch (err) {
    console.warn(`OIDC: couldn’t reach ${config.oidc.issuer} yet (${err.message}). Will retry on the next sign-in.`);
  }
}

function fail(c, code, err) {
  if (err) console.warn(`OIDC sign-in failed (${code}):`, err.message || err);
  return c.redirect(`/?auth_error=${code}`);
}

export async function login(c) {
  if (!config.oidc.enabled) return fail(c, 'oidc_disabled');
  let cfg;
  try {
    cfg = await oidcConfig();
  } catch (err) {
    return fail(c, 'oidc_failed', err);
  }
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();
  db.prepare('INSERT INTO oidc_flows (state, code_verifier, nonce, created_at) VALUES (?, ?, ?, ?)').run(state, codeVerifier, nonce, Date.now());
  setCookie(c, FLOW_COOKIE, state, { path: '/auth/oidc', httpOnly: true, sameSite: 'Lax', secure: config.secureCookies, maxAge: 900 });
  const url = client.buildAuthorizationUrl(cfg, {
    redirect_uri: redirectUri(),
    scope: config.oidc.scopes,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce
  });
  return c.redirect(url.href);
}

function groupsOf(claims) {
  const raw = claims[config.oidc.groupsClaim];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.split(/[ ,]+/).filter(Boolean);
  return [];
}

export async function callback(c) {
  if (!config.oidc.enabled) return fail(c, 'oidc_disabled');
  const reqUrl = new URL(c.req.url);
  const state = reqUrl.searchParams.get('state');
  const cookieState = getCookie(c, FLOW_COOKIE);
  deleteCookie(c, FLOW_COOKIE, { path: '/auth/oidc', secure: config.secureCookies });
  if (reqUrl.searchParams.get('error')) return fail(c, 'oidc_failed', reqUrl.searchParams.get('error_description') || reqUrl.searchParams.get('error'));
  if (!state || state !== cookieState) return fail(c, 'oidc_state');
  const flow = db.prepare('SELECT * FROM oidc_flows WHERE state = ?').get(state);
  db.prepare('DELETE FROM oidc_flows WHERE state = ?').run(state);
  if (!flow || Date.now() - flow.created_at > 15 * 60 * 1000) return fail(c, 'oidc_state');

  let claims;
  let idToken;
  try {
    const cfg = await oidcConfig();
    const currentUrl = new URL(redirectUri());
    currentUrl.search = reqUrl.search;
    const tokens = await client.authorizationCodeGrant(cfg, currentUrl, {
      pkceCodeVerifier: flow.code_verifier,
      expectedState: state,
      expectedNonce: flow.nonce,
      idTokenExpected: true
    });
    idToken = tokens.id_token;
    claims = { ...tokens.claims() };
    if ((!claims.email || !claims.name) && tokens.access_token && cfg.serverMetadata().userinfo_endpoint) {
      try {
        const info = await client.fetchUserInfo(cfg, tokens.access_token, claims.sub);
        claims = { ...info, ...claims, email: claims.email || info.email, name: claims.name || info.name };
      } catch {
        /* userinfo is optional */
      }
    }
  } catch (err) {
    return fail(c, 'oidc_failed', err);
  }

  if (config.oidc.allowedGroups.length) {
    const groups = groupsOf(claims);
    if (!config.oidc.allowedGroups.some((g) => groups.includes(g))) return fail(c, 'oidc_not_allowed');
  }

  const issuer = config.oidc.issuer;
  let user = db.prepare('SELECT * FROM users WHERE oidc_issuer = ? AND oidc_subject = ?').get(issuer, claims.sub);
  const email = typeof claims.email === 'string' ? claims.email : null;

  if (!user && email && claims.email_verified !== false && config.oidc.linkByEmail) {
    const existing = db.prepare('SELECT * FROM users WHERE (email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE) AND oidc_subject IS NULL').get(email, email);
    if (existing && claims.email_verified === true) {
      db.prepare('UPDATE users SET oidc_issuer = ?, oidc_subject = ? WHERE id = ?').run(issuer, claims.sub, existing.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
    }
  }

  if (!user) {
    if (!config.oidc.allowSignup) return fail(c, 'oidc_signup_disabled');
    const base = claims.preferred_username || email || `user-${String(claims.sub).slice(0, 8)}`;
    user = createUser({
      username: freeUsername(String(base)),
      email,
      name: String(claims.name || claims.given_name || ''),
      oidcIssuer: issuer,
      oidcSubject: String(claims.sub)
    });
    console.log(`OIDC: created account ${user.username} at ${now()}`);
  } else {
    const name = claims.name ? String(claims.name) : user.name;
    db.prepare('UPDATE users SET name = ?, email = COALESCE(?, email) WHERE id = ?').run(name, email, user.id);
  }

  startSession(c, user.id, idToken);
  return c.redirect('/');
}

/** Where to send the browser after signing out (the provider's logout page when configured). */
export async function logoutRedirect(idToken) {
  if (!config.oidc.enabled || !config.oidc.logoutAtProvider || !idToken) return null;
  try {
    const cfg = await oidcConfig();
    if (!cfg.serverMetadata().end_session_endpoint) return null;
    return client.buildEndSessionUrl(cfg, { id_token_hint: idToken, post_logout_redirect_uri: `${config.publicUrl}/` }).href;
  } catch {
    return null;
  }
}
