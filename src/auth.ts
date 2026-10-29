/**
 * Build authorization gate.
 *
 * FORGE WORLD is an authorized build by RAJ — https://shimul.is-a.dev
 * The game refuses to boot until a valid access key unlocks this build.
 * Keys are issued by the author; add new ones to ACCESS_KEYS below.
 */
import { BUILD } from './credit';

const STORAGE_KEY = 'forgeworld.auth.v1';

/** Access keys issued by RAJ for this build. Case and inner dashes are forgiving on input. */
const ACCESS_KEYS: readonly string[] = ['RAJ-FW-2026', 'RAJ-SHIMUL', BUILD.id];

export type Grant = {
  /** Masked key, safe to display. */
  key: string;
  holder: string;
  site: string;
  build: string;
  grantedAt: number;
  token: string;
};

export type AuthResult = { ok: true; grant: Grant } | { ok: false; error: string };

export function normalizeKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function isValidKey(raw: string): boolean {
  const k = normalizeKey(raw);
  return k.length > 0 && ACCESS_KEYS.some((valid) => normalizeKey(valid) === k);
}

function maskKey(key: string): string {
  const k = normalizeKey(key);
  const cut = k.indexOf('-');
  return cut > 0 ? `${k.slice(0, cut + 1)}••••••-${k.slice(-4)}` : k;
}

function tokenFor(key: string): string {
  const seed = `${BUILD.id}::${normalizeKey(key)}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x01000193) >>> 0;
    h2 = (h2 + Math.imul(seed.charCodeAt(i), i + 7)) >>> 0;
  }
  return `FW-${h1.toString(16).padStart(8, '0').toUpperCase()}-${h2.toString(16).padStart(6, '0').toUpperCase()}`;
}

export function loadGrant(): Grant | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as Grant;
    if (!g || g.build !== BUILD.id || g.holder !== BUILD.author || !g.token) return null;
    return g;
  } catch {
    return null;
  }
}

function saveGrant(g: Grant) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(g));
  } catch {
    // Private mode / storage full — the grant stays session-only.
  }
}

export function revoke() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function authorize(rawKey: string): AuthResult {
  if (!normalizeKey(rawKey)) {
    return { ok: false, error: 'Enter the access key issued with this build.' };
  }
  if (!isValidKey(rawKey)) {
    return { ok: false, error: `Invalid key — this build is sealed to ${BUILD.author}. Request access at ${BUILD.siteLabel}` };
  }
  const key = normalizeKey(rawKey);
  const grant: Grant = {
    key: maskKey(key),
    holder: BUILD.author,
    site: BUILD.siteLabel,
    build: BUILD.id,
    grantedAt: Date.now(),
    token: tokenFor(key),
  };
  saveGrant(grant);
  return { ok: true, grant };
}

function fillMeta(overlay: HTMLElement) {
  const set = (id: string, text: string, href?: string) => {
    const el = overlay.querySelector<HTMLElement>(id);
    if (!el) return;
    el.textContent = text;
    if (href) (el as HTMLAnchorElement).href = href;
  };
  set('#auth-build', BUILD.id);
  set('#auth-author', BUILD.author);
  set('#auth-site', BUILD.siteLabel, BUILD.site);
}

/**
 * Wires the #auth lock screen and resolves once the build is authorized.
 * A standing grant from localStorage skips the prompt on later visits.
 */
export function runAuthorizationGate(): Promise<Grant> {
  return new Promise((resolve) => {
    const overlay = document.getElementById('auth');
    if (!overlay) {
      // Gate markup stripped from the page — run unsealed, but say so.
      console.warn('[forgeworld] authorization markup missing — running unsealed');
      resolve({ key: 'UNSEALED', holder: BUILD.author, site: BUILD.siteLabel, build: BUILD.id, grantedAt: Date.now(), token: 'FW-UNSEALED-000000' });
      return;
    }

    const card = overlay.querySelector<HTMLElement>('.auth-card');
    const input = overlay.querySelector<HTMLInputElement>('#auth-key');
    const button = overlay.querySelector<HTMLButtonElement>('#auth-go');
    const status = overlay.querySelector<HTMLElement>('#auth-status');
    fillMeta(overlay);

    const standing = loadGrant();
    if (standing) {
      overlay.classList.add('hidden');
      resolve(standing);
      return;
    }
    if (!input || !button || !status || !card) {
      overlay.classList.add('hidden');
      resolve({ key: 'UNSEALED', holder: BUILD.author, site: BUILD.siteLabel, build: BUILD.id, grantedAt: Date.now(), token: 'FW-UNSEALED-000000' });
      return;
    }

    const fail = (error: string) => {
      status.classList.remove('ok');
      status.textContent = error;
      card.classList.remove('shake');
      void card.offsetWidth; // restart the animation
      card.classList.add('shake');
      input.select();
    };

    const succeed = (grant: Grant) => {
      input.disabled = true;
      button.disabled = true;
      button.textContent = 'Authorized ✓';
      status.classList.add('ok');
      status.textContent = `Build ${grant.build} authorized to ${grant.holder} — welcome back.`;
      status.insertAdjacentHTML('beforeend', `<span class="tok">license token ${grant.token}</span>`);
      window.setTimeout(() => {
        overlay.classList.add('hidden');
        resolve(grant);
      }, 900);
    };

    const attempt = () => {
      const result = authorize(input.value);
      if (result.ok) succeed(result.grant);
      else fail(result.error);
    };

    button.addEventListener('click', attempt);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') attempt();
    });
    window.setTimeout(() => input.focus(), 250);
  });
}
