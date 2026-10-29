import './style.css';
import type { Game } from './game';
import { BUILD } from './credit';
import { runAuthorizationGate, revoke } from './auth';

console.info(
  `%c FORGE WORLD %c ${BUILD.label} to ${BUILD.author} · ${BUILD.site} · ${BUILD.id} `,
  'background:#ffb347;color:#1b1305;font-weight:700;padding:2px 6px;border-radius:4px 0 0 4px',
  'background:#0f151d;color:#8d9db3;padding:2px 6px;border-radius:0 4px 4px 0',
);

async function start(): Promise<void> {
  const grant = await runAuthorizationGate();
  console.info(
    `%c ✓ authorized %c ${grant.build} → ${grant.holder} · ${grant.site} · token ${grant.token} `,
    'background:#7ce38b;color:#0a1810;font-weight:700;padding:2px 6px;border-radius:4px 0 0 4px',
    'background:#0f151d;color:#8d9db3;padding:2px 6px;border-radius:0 4px 4px 0',
  );

  // The game bundle only executes after the build is authorized.
  const { Game: GameClass } = await import('./game');
  const game = new GameClass();

  // Handy for tinkering in devtools.
  const w = window as unknown as { forgeworld: Game; forgeworldAuth: { grant: unknown; revoke: () => void } };
  w.forgeworld = game;
  w.forgeworldAuth = { grant, revoke };

  await game.boot().catch((err: unknown) => {
    console.error('[forgeworld] boot failed', err);
    const label = document.querySelector<HTMLElement>('#loading .loading-text');
    if (label) label.textContent = 'Failed to start — see the console';
  });
}

void start();
