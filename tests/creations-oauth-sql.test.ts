import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { AUTORISATION_REVOQUEE, PgOauthStore } from '../src/oauth/store.pg';
import { PgApiKeyStore } from '../src/auth/api-key-store.pg';
import { PgAdressesEvenementsStore } from '../src/evenements/store.pg';
import { CLIENTS_OAUTH, clientDeLAutorisation } from '../src/oauth/clients';

/**
 * LOT D DE L'AUDIT, CE QUE LE SQL DOIT DIRE (migration 0282). La vérité se prouve en intégration, sur un vrai Postgres,
 * et seulement en CI (`tests/integration/creations-oauth.integration.test.ts`) ; ce fichier épingle, sans base, les
 * instructions qui portent le contrat, pour qu'un défaut remis en place rougisse aussi sur le poste : la révocation en une
 * transaction, sur l'espace, qui coupe clés ET adresses ; le verrou `FOR SHARE` pris AVANT l'insertion ou la réactivation ;
 * la purge qui épargne une autorisation portant une création vivante.
 */
type Requete = { sql: string; valeurs: unknown[]; client: boolean };
type Reponse = { rows: unknown[]; rowCount: number };

/** Un faux pool qui relève chaque requête, et répond selon la première règle dont le motif correspond. */
function fauxPool(regles: Array<[RegExp, unknown[]]>) {
  const journal: Requete[] = [];
  const repondre = (sql: string): Reponse => {
    const regle = regles.find(([motif]) => motif.test(sql));
    const rows = regle ? regle[1] : [];
    return { rows, rowCount: rows.length };
  };
  const pool = {
    query: async (sql: string, valeurs: unknown[] = []) => { journal.push({ sql, valeurs, client: false }); return repondre(sql); },
    connect: async () => ({
      query: async (sql: string, valeurs: unknown[] = []) => { journal.push({ sql, valeurs, client: true }); return repondre(sql); },
      release: () => {},
    }),
  } as unknown as Pool;
  /** Les requêtes, compactées, pour lire leur ordre. */
  const sqls = () => journal.map((r) => r.sql.replace(/\s+/g, ' ').trim());
  return { pool, journal, sqls };
}

const T = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const AUT = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const index = (sqls: string[], motif: RegExp) => sqls.findIndex((s) => motif.test(s));

describe('la révocation par un admin (PgOauthStore.revoquer)', () => {
  it('🔴 une transaction : la ligne verrouillée, puis l’autorisation, les clés et les adresses DE L’ESPACE', async () => {
    const { pool, journal, sqls } = fauxPool([
      [/for no key update/, [{ deja: false }]],
      [/update api_keys set revoked_at/, [{ id: 'k1', name: 'Mon application' }]],
      [/update adresses_evenements set active = false/, [{ id: 'w1', url: 'https://app.client.fr/hook' }]],
    ]);
    expect(await new PgOauthStore(pool).revoquer(T, AUT)).toEqual({
      cles: [{ id: 'k1', name: 'Mon application' }], adresses: [{ id: 'w1', url: 'https://app.client.fr/hook' }],
    });
    const s = sqls();
    expect(s[0]).toBe('begin');
    expect(s.at(-1)).toBe('commit');
    const verrou = index(s, /from oauth_autorisations where id = \$1 and tenant_id = \$2 for no key update/);
    const autorisation = index(s, /^update oauth_autorisations set revoque_le = now\(\) where id = \$1 and tenant_id = \$2$/);
    const cles = index(s, /^update api_keys set revoked_at = now\(\) where oauth_autorisation_id = \$1 and tenant_id = \$2 and revoked_at is null/);
    const adresses = index(s, /^update adresses_evenements set active = false, maj_le = now\(\) where oauth_autorisation_id = \$1 and tenant_id = \$2 and active/);
    expect([verrou, autorisation, cles, adresses].every((i) => i > 0)).toBe(true);
    expect(verrou < autorisation && autorisation < cles && cles < adresses).toBe(true);
    for (const i of [verrou, autorisation, cles, adresses]) expect(journal[i]!.valeurs).toEqual([AUT, T]);
    expect(journal.every((r) => r.sql === 'begin' || r.client)).toBe(true);
  });

  it('inconnue ou d’un autre espace : `null`, et aucune écriture', async () => {
    const { pool, sqls } = fauxPool([]);
    expect(await new PgOauthStore(pool).revoquer(T, AUT)).toBeNull();
    expect(sqls().filter((s) => s.startsWith('update'))).toEqual([]);
  });

  it('🔴 déjà finie (déconnectée par le client) : sa révocation coupe encore ce qu’elle a créé, sans retoucher `revoque_le`', async () => {
    const { pool, sqls } = fauxPool([
      [/for no key update/, [{ deja: true }]],
      [/update api_keys set revoked_at/, [{ id: 'k1', name: 'A' }]],
    ]);
    expect(await new PgOauthStore(pool).revoquer(T, AUT)).toEqual({ cles: [{ id: 'k1', name: 'A' }], adresses: [] });
    expect(sqls().some((s) => s.startsWith('update oauth_autorisations'))).toBe(false);
  });

  it('déjà révoquée sans plus rien à couper : `null` (le 404 d’avant le lot)', async () => {
    const { pool } = fauxPool([[/for no key update/, [{ deja: true }]]]);
    expect(await new PgOauthStore(pool).revoquer(T, AUT)).toBeNull();
  });
});

describe('la liste et la purge des autorisations', () => {
  it('🔴 la liste garde une autorisation finie qui porte une création vivante, et dit si elle est connectée', async () => {
    const { pool, sqls } = fauxPool([]);
    await new PgOauthStore(pool).lister(T);
    const s = sqls()[0]!;
    expect(s).toMatch(/as connectee/);
    expect(s).toMatch(/where a\.tenant_id = \$1 and \(\(a\.revoque_le is null .*\) or \(exists \(select 1 from api_keys k where k\.tenant_id = a\.tenant_id and k\.oauth_autorisation_id = a\.id and k\.revoked_at is null\) or exists \(select 1 from adresses_evenements e where e\.tenant_id = a\.tenant_id and e\.oauth_autorisation_id = a\.id and e\.active\)\)\)/);
  });

  it('🔴 la purge épargne une autorisation qui porte une création vivante', async () => {
    const { pool, sqls } = fauxPool([]);
    await new PgOauthStore(pool).purger();
    const purge = sqls().find((s) => s.startsWith('delete from oauth_autorisations'))!;
    expect(purge).toMatch(/and not \(exists \(select 1 from api_keys k where k\.tenant_id = a\.tenant_id and k\.oauth_autorisation_id = a\.id and k\.revoked_at is null\) or exists \(select 1 from adresses_evenements e/);
  });
});

describe('la création d’une clé sous une autorisation (PgApiKeyStore.creerSousPlafond)', () => {
  const PLAFOND = { max: 10, horsDroit: 'mba:relais' };

  it('🔴 le verrou FOR SHARE de l’autorisation, AVANT le verrou consultatif et l’insertion, qui écrit le lien', async () => {
    const { pool, journal, sqls } = fauxPool([[/for share/, [{ '?column?': 1 }]], [/count\(\*\)/, [{ n: 0 }]], [/insert into api_keys/, [{ id: 'k1' }]]]);
    const r = await new PgApiKeyStore(pool).creerSousPlafond(T, 'App', ['contacts:write'], PLAFOND, AUT);
    expect(r).toMatchObject({ id: 'k1' });
    const s = sqls();
    const verrou = index(s, /^select 1 from oauth_autorisations where id = \$1 and tenant_id = \$2 and revoque_le is null for share$/);
    const consultatif = index(s, /pg_advisory_xact_lock/);
    const insertion = index(s, /^insert into api_keys/);
    expect(verrou > 0 && verrou < consultatif && consultatif < insertion).toBe(true);
    expect(journal[verrou]!.valeurs).toEqual([AUT, T]);
    expect(journal[insertion]!.valeurs[4]).toBe(AUT);
    // 🔴 Le verrou et l'insertion sur le client de la transaction : hors d'elle, le verrou ne protégerait rien.
    expect(journal.every((r) => r.client)).toBe(true);
  });

  it('🔴 l’autorisation vient d’être révoquée : AUTORISATION_REVOQUEE, et rien n’est inséré', async () => {
    const { pool, sqls } = fauxPool([]);
    expect(await new PgApiKeyStore(pool).creerSousPlafond(T, 'App', ['contacts:write'], PLAFOND, AUT)).toBe(AUTORISATION_REVOQUEE);
    expect(sqls().some((s) => s.startsWith('insert'))).toBe(false);
  });

  it('🔴 l’offre sans limite (Entreprise) avec une autorisation : la même transaction et le même verrou, sans comptage', async () => {
    const { pool, journal, sqls } = fauxPool([[/for share/, [{ '?column?': 1 }]], [/insert into api_keys/, [{ id: 'k1' }]]]);
    await new PgApiKeyStore(pool).creerSousPlafond(T, 'App', ['contacts:write'], { max: null, horsDroit: 'mba:relais' }, AUT);
    const s = sqls();
    expect(s[0]).toBe('begin');
    expect(index(s, /for share/)).toBeLessThan(index(s, /^insert into api_keys/));
    expect(s.some((x) => /count\(\*\)|pg_advisory_xact_lock/.test(x))).toBe(false);
    expect(journal[index(s, /^insert into api_keys/)]!.valeurs[4]).toBe(AUT);
    expect(journal.every((r) => r.client)).toBe(true);
  });

  it('la console (aucune autorisation) : aucun verrou d’autorisation, le lien vide', async () => {
    const { pool, journal, sqls } = fauxPool([[/count\(\*\)/, [{ n: 0 }]], [/insert into api_keys/, [{ id: 'k1' }]]]);
    await new PgApiKeyStore(pool).creerSousPlafond(T, 'App', ['contacts:write'], PLAFOND, null);
    expect(sqls().some((s) => /oauth_autorisations/.test(s))).toBe(false);
    expect(journal.find((r) => r.sql.startsWith('insert'))!.valeurs[4]).toBeNull();
  });
});

describe('les adresses de webhook sous une autorisation (PgAdressesEvenementsStore)', () => {
  const ADRESSE = { url: 'https://app.client.fr/hook', description: '', types: ['message.received'], secretChiffre: 'c' };

  it('🔴 la création : le verrou FOR SHARE avant l’insertion, qui écrit le lien ; révoquée, rien n’est inséré', async () => {
    const vivante = fauxPool([[/for share/, [{ '?column?': 1 }]], [/insert into adresses_evenements/, [{ id: 'w1' }]]]);
    await new PgAdressesEvenementsStore(vivante.pool).creer(T, ADRESSE, AUT);
    const s = vivante.sqls();
    expect(index(s, /^select 1 from oauth_autorisations where id = \$1 and tenant_id = \$2 and revoque_le is null for share$/))
      .toBeLessThan(index(s, /^insert into adresses_evenements/));
    expect(vivante.journal.find((r) => r.sql.startsWith('insert'))!.valeurs[5]).toBe(AUT);
    // Le verrou et l'insertion sur le client de la transaction ; la relecture qui suit peut passer par le pool.
    expect(vivante.journal.filter((r) => /for share|^\s*insert into adresses_evenements/.test(r.sql)).every((r) => r.client)).toBe(true);

    const revoquee = fauxPool([]);
    expect(await new PgAdressesEvenementsStore(revoquee.pool).creer(T, ADRESSE, AUT)).toBeNull();
    expect(revoquee.sqls().some((x) => x.startsWith('insert'))).toBe(false);
  });

  it('🔴 la réactivation sous une autorisation : le verrou avant l’update ; révoquée, AUTORISATION_REVOQUEE et rien n’est écrit', async () => {
    const vivante = fauxPool([[/for share/, [{ '?column?': 1 }]], [/^\s*update adresses_evenements/, [{}]]]);
    await new PgAdressesEvenementsStore(vivante.pool).modifier(T, 'w1', { active: true }, AUT);
    const s = vivante.sqls();
    expect(s[0]).toBe('begin');
    expect(index(s, /for share/)).toBeLessThan(index(s, /^update adresses_evenements/));
    expect(vivante.journal.filter((r) => /for share|^\s*update adresses_evenements/.test(r.sql)).every((r) => r.client)).toBe(true);

    const revoquee = fauxPool([]);
    expect(await new PgAdressesEvenementsStore(revoquee.pool).modifier(T, 'w1', { active: true }, AUT)).toBe(AUTORISATION_REVOQUEE);
    expect(revoquee.sqls().some((x) => x.startsWith('update'))).toBe(false);
  });

  it('une pause, ou toute modification sans autorisation, n’a pas besoin du verrou', async () => {
    for (const [m, aut] of [[{ active: false }, AUT], [{ active: true }, null], [{ types: ['link.clicked'] }, AUT]] as const) {
      const f = fauxPool([[/^\s*update adresses_evenements/, [{}]]]);
      await new PgAdressesEvenementsStore(f.pool).modifier(T, 'w1', m, aut);
      expect(f.sqls().some((x) => /for share/.test(x))).toBe(false);
    }
  });
});

describe('le nom affiché d’une application (clientDeLAutorisation)', () => {
  it('🔴 un client enregistré qui se déclare « Claude Code » reste déclaré, partout où son nom s’affiche', () => {
    expect(clientDeLAutorisation({ clientId: `mcl_${'a'.repeat(32)}`, clientNom: 'Claude Code', clientMarque: 'declaree', clientHote: 'evil.example' }))
      .toEqual({ nom: 'Claude Code', marque: 'declaree', hote: 'evil.example' });
  });

  it('un épinglé prend son nom recopié ; une fiche garde sa marque de domaine ; un inconnu sans nom reste déclaré', () => {
    expect(clientDeLAutorisation({ clientId: CLIENTS_OAUTH[0]!.id, clientNom: null, clientMarque: null, clientHote: null }))
      .toEqual({ nom: 'Claude Code', marque: 'epingle', hote: null });
    expect(clientDeLAutorisation({ clientId: 'https://chatgpt.com/fiche', clientNom: 'ChatGPT', clientMarque: 'domaine', clientHote: 'chatgpt.com' }))
      .toEqual({ nom: 'ChatGPT', marque: 'domaine', hote: 'chatgpt.com' });
    expect(clientDeLAutorisation({ clientId: `mcl_${'b'.repeat(32)}`, clientNom: null, clientMarque: null, clientHote: null }))
      .toEqual({ nom: `mcl_${'b'.repeat(32)}`, marque: 'declaree', hote: null });
  });
});
