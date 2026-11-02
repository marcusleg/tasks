// Shared by playwright.config.ts and the test helpers. The mock provider
// (oidc-mock.ts) gets the same values through its environment.

/** E2E_PORT lets several checkouts run the suite side by side. */
export const appPort = Number(process.env.E2E_PORT ?? 4173);
export const appOrigin = `http://localhost:${appPort}`;

/** Port of the mock OIDC provider; override with E2E_OIDC_PORT. */
export const oidcPort = Number(process.env.E2E_OIDC_PORT ?? 4185);
export const oidcIssuer = `http://localhost:${oidcPort}`;

export const oidcClientId = 'tasks-e2e';
export const oidcClientSecret = 'tasks-e2e-secret';

/** The e2e server runs with OIDC_ALLOWED_GROUP set to this. */
export const allowedGroup = 'tasks-users';
