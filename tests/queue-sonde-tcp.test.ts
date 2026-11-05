import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { PgBossQueue } from '../src/queue/pgboss';

/**
 * L'ÉCOUTEUR DU WORKER SE ROUVRE QUAND IL EST COUPÉ D'UN SEUL CÔTÉ (2026-11-05, `src/db/sonde-tcp.ts`). La sonde TCP
 * doit atteindre pg-boss, et pg-boss doit la transmettre à la connexion de son écouteur : les deux moitiés.
 */
const vus = vi.hoisted(() => ({ configs: [] as Record<string, unknown>[] }));

vi.mock('pg-boss', () => ({
  PgBoss: class {
    constructor(config: Record<string, unknown>) { vus.configs.push(config); }
    on(): void {}
  },
}));

describe('sonde TCP des connexions de pg-boss', () => {
  it('🔴 une instance qui ouvre ses propres connexions les sonde toutes les 60 s', () => {
    new PgBossQueue('postgres://faux', 'pgboss', { ecouteNotifications: true, max: 2 });
    const config = vus.configs.at(-1)!;
    expect(config.keepAlive).toBe(true);
    expect(config.keepAliveInitialDelayMillis).toBe(60_000);
    // La sonde ne remplace rien de ce que l'appelant règle.
    expect(config.max).toBe(2);
    expect(config.useListenNotify).toBe(true);
  });

  it('🔴 pg-boss passe sa configuration entière au pool ET à la connexion de son écouteur', () => {
    // Garde de montée de version : si pg-boss cessait de transmettre sa configuration à `pg`, la sonde ne ferait plus
    // rien, sans aucune erreur.
    const racine = dirname(createRequire(import.meta.url).resolve('pg-boss/package.json'));
    const db = readFileSync(join(racine, 'dist', 'db.js'), 'utf8');
    expect(db).toMatch(/new pg\.Pool\(this\.config\)/);
    expect(db).toMatch(/new pg\.Client\(this\.config\)/);
  });
});
