/** Small JSON client for the server's API. Every mutating call carries a custom header (CSRF guard). */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** When no server answers, the app runs as a preview with an in-browser stand-in (see local-backend.js). */
export const mode = { preview: false };

export async function api(method, path, body) {
  if (mode.preview) {
    const { localApi } = await import('./local-backend.js');
    try {
      return await localApi(method, path, body);
    } catch (err) {
      throw new ApiError(err.status ?? 500, err.code ?? 'error', err.message);
    }
  }
  const headers = { 'X-Requested-With': 'tasks' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError(0, 'network', 'Can’t reach the server. Check your connection and try again.');
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok || data === null) {
    throw new ApiError(
      res.status,
      data?.error ?? 'error',
      data?.message ?? `Something went wrong (${res.status}). Try again.`
    );
  }
  return data;
}

/** Defaults used when no server answers (for example when the files are opened as a static site). */
export const FALLBACK_CONFIG = {
  appName: 'Tasks',
  passwordAuth: true,
  signupEnabled: true,
  oidc: { enabled: false, name: 'Single sign-on', autoRedirect: false },
  links: { help: '/help/', privacy: '/privacy/', terms: '/terms/' }
};

export async function loadConfig() {
  try {
    return { ...FALLBACK_CONFIG, ...(await api('GET', '/api/config')), preview: false };
  } catch (err) {
    // No API at all (opened as plain files or a static preview): run the app in the browser.
    const noServer = err.status !== 0 || window.location.protocol === 'file:';
    if (noServer) mode.preview = true;
    return { ...FALLBACK_CONFIG, preview: noServer };
  }
}
