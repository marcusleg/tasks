/** Theme preference: 'system' (follow the OS), 'light' or 'dark'. Stored in this browser only. */
const KEY = 'theme';

function read() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export const theme = $state({ preference: read() });

export function setTheme(preference) {
  theme.preference = preference;
  try {
    if (preference === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, preference);
  } catch {
    /* storage unavailable: still applies for this visit */
  }
  if (preference === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', preference);
}
