import { describe, it, expect } from 'vitest';
import {
  TYPES_PAR_DEFAUT, creerAdresse, envoyerEssai, modifierAdresse, rejouerEnvoi, tournerSecret, type DepsGestionEvenements,
} from '../src/evenements/gestion';
import type { AdresseVue } from '../src/evenements/store.pg';
import { AUTORISATION_REVOQUEE } from '../src/oauth/store.pg';

/**
 * LA GESTION DES WEBHOOKS SORTANTS : les contrôles que la console et l'outil MCP partagent (lot 12, livraison A).
 */
const T = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const A = 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f';
const URL_OK = 'https://app.client.fr/hook';

function vue(over: Partial<AdresseVue> = {}): AdresseVue {
  return {
    id: A, url: URL_OK, description: '', types: ['message.received'], active: true, creeLe: '2026-10-08T10:00:00.000Z',
    ancienSecretJusqua: null, derniereLivraisonLe: null, enReessai: 0, echecs: 0, application: null, ...over,
  };
}

function banc(o: {
  actives?: number; limite?: number | null; adresse?: AdresseVue | null; verdict?: { ok: boolean; raison?: string };
  /** Le magasin dit que l'autorisation de l'application vient d'être révoquée (lot D de l'audit). */
  revoquee?: boolean;
} = {}) {
  const ecrits: Array<{ secretChiffre: string; types: readonly string[]; autorisation: string | null }> = [];
  /** L'autorisation que chaque modification passe au magasin (lot D de l'audit). */
  const modifs: Array<string | null> = [];
  const essais: unknown[] = [];
  const jobs: unknown[] = [];
  let invalide = 0;
  const deps: DepsGestionEvenements = {
    adresses: {
      lister: async () => [],
      lire: async () => (o.adresse === undefined ? vue() : o.adresse),
      existe: async () => o.adresse !== null,
      compterActives: async () => o.actives ?? 0,
      creer: async (_t, a, autorisation) => {
        if (o.revoquee) return null;
        ecrits.push({ secretChiffre: a.secretChiffre, types: a.types, autorisation });
        return vue({ types: [...a.types] });
      },
      modifier: async (_t, _i, m, autorisation) => {
        modifs.push(autorisation);
        if (o.revoquee && m.active === true) return AUTORISATION_REVOQUEE;
        return vue({ active: m.active ?? true });
      },
      tourner: async () => true,
      supprimer: async () => true,
      pourEnvoi: async () => ({ url: URL_OK, active: true, rang: 1, secretChiffre: 'chiffre:whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', secretPrecedentChiffre: null, secretPrecedentJusqua: null }),
    },
    envois: {
      noterEssai: async (_t, _a, e) => { essais.push(e); },
      journal: async () => [],
      rejouer: async () => null,
      rejouerEchecs: async () => [],
    },
    limiteAdresses: async () => (o.limite === undefined ? null : o.limite),
    chiffrementPret: true,
    chiffrer: (c) => `chiffre:${c}`,
    dechiffrer: (c) => c.replace(/^chiffre:/, ''),
    verifierAdresse: async () => o.verdict ?? { ok: true },
    appeler: async () => ({ livre: true, definitif: false, code: 200, extrait: 'ok' }),
    enfiler: async (j) => { jobs.push(j); },
    invaliderCache: () => { invalide += 1; },
  };
  return { deps, ecrits, modifs, essais, jobs, invalide: () => invalide };
}

describe('créer une adresse', () => {
  it('🔴 le secret est rendu une fois, en clair, et écrit chiffré ; le cache de l’émetteur est invalidé', async () => {
    const b = banc();
    const r = await creerAdresse(b.deps, T, { url: URL_OK, types: ['message.received'] }, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valeur.secret).toMatch(/^whsec_/);
    expect(b.ecrits[0]!.secretChiffre).toBe(`chiffre:${r.valeur.secret}`);
    expect(JSON.stringify(r.valeur.adresse)).not.toContain(r.valeur.secret);
    expect(b.invalide()).toBe(1);
  });

  it('🔴 lot D de l’audit : l’autorisation de l’application va au magasin, la console n’en passe aucune', async () => {
    const b = banc();
    await creerAdresse(b.deps, T, { url: URL_OK }, 'aut-1');
    await creerAdresse(b.deps, T, { url: URL_OK }, null);
    expect(b.ecrits.map((e) => e.autorisation)).toEqual(['aut-1', null]);
  });

  it('🔴 lot D de l’audit : une autorisation révoquée entre la garde et l’insertion refuse en 403, sans rien invalider', async () => {
    const b = banc({ revoquee: true });
    const r = await creerAdresse(b.deps, T, { url: URL_OK }, 'aut-1');
    expect(r).toMatchObject({ ok: false, statut: 403 });
    expect(b.invalide()).toBe(0);
  });

  it('sans types précisés (l’outil MCP) : tous, sauf les accusés de livraison', async () => {
    const b = banc();
    await creerAdresse(b.deps, T, { url: URL_OK }, null);
    expect(b.ecrits[0]!.types).toEqual(TYPES_PAR_DEFAUT);
    expect(TYPES_PAR_DEFAUT).not.toContain('message.delivered');
    expect(TYPES_PAR_DEFAUT).toContain('message.received');
  });

  it('🔴 HTTPS obligatoire, hôte interne et nom qui résout vers l’intérieur refusés, avant toute écriture', async () => {
    for (const [url, verdict] of [
      ['http://app.client.fr/hook', undefined],
      ['https://localhost/hook', undefined],
      ['https://169.254.169.254/latest', undefined],
      [URL_OK, { ok: false, raison: 'ce nom pointe vers une adresse interne' }],
    ] as const) {
      const b = banc({ ...(verdict ? { verdict } : {}) });
      const r = await creerAdresse(b.deps, T, { url }, null);
      expect(r).toMatchObject({ ok: false, statut: 400 });
      expect(b.ecrits).toEqual([]);
    }
  });

  it('🔴 la limite d’adresses actives de l’offre : 402 plan_limit_reached, à la création', async () => {
    const r = await creerAdresse(banc({ actives: 1, limite: 1 }).deps, T, { url: URL_OK }, null);
    expect(r).toMatchObject({ ok: false, statut: 402, details: { code: 'plan_limit_reached', limite: 'adressesWebhook', max: 1 } });
    expect((await creerAdresse(banc({ actives: 7, limite: null }).deps, T, { url: URL_OK }, null)).ok).toBe(true);
  });

  it('une saisie hors contrat est refusée (clé inconnue, type inconnu, doublon)', async () => {
    for (const s of [{ url: URL_OK, tenantId: T }, { url: URL_OK, types: ['message.sent'] }, { url: URL_OK, types: ['link.clicked', 'link.clicked'] }]) {
      expect(await creerAdresse(banc().deps, T, s, null)).toMatchObject({ ok: false, statut: 400 });
    }
  });
});

describe('modifier, faire tourner, essayer, rejouer', () => {
  it('🔴 réactiver une adresse au-delà de l’offre rend 402 ; une adresse active se modifie sans compter', async () => {
    const b = banc({ adresse: vue({ active: false }), actives: 1, limite: 1 });
    expect(await modifierAdresse(b.deps, T, A, { active: true }, null)).toMatchObject({ ok: false, statut: 402 });
    expect((await modifierAdresse(banc({ actives: 1, limite: 1 }).deps, T, A, { types: ['link.clicked'] }, null)).ok).toBe(true);
  });

  it('🔴 lot D de l’audit : une réactivation passe l’autorisation au magasin, et refuse en 403 si l’application vient d’être révoquée', async () => {
    const b = banc({ adresse: vue({ active: false }), revoquee: true });
    expect(await modifierAdresse(b.deps, T, A, { active: true }, 'aut-1')).toMatchObject({ ok: false, statut: 403 });
    expect(b.modifs).toEqual(['aut-1']);
    expect(b.invalide()).toBe(0);
    // La console (aucune autorisation) passe `null`.
    const parConsole = banc({ adresse: vue({ active: false }) });
    expect((await modifierAdresse(parConsole.deps, T, A, { active: true }, null)).ok).toBe(true);
    expect(parConsole.modifs).toEqual([null]);
  });

  it('la rotation rend un secret neuf, et l’ancien signe encore 24 h', async () => {
    const b = banc();
    b.deps.maintenant = () => new Date('2026-10-08T10:00:00Z');
    const r = await tournerSecret(b.deps, T, A);
    expect(r).toMatchObject({ ok: true, valeur: { ancienJusqua: '2026-10-09T10:00:00.000Z' } });
  });

  it('🔴 l’essai part signé, et son issue est écrite au journal de l’adresse', async () => {
    const b = banc();
    const r = await envoyerEssai(b.deps, T, A);
    expect(r).toMatchObject({ ok: true, valeur: { livre: true, code: 200 } });
    expect(b.essais).toHaveLength(1);
    expect(JSON.parse((b.essais[0] as { corps: string }).corps)).toMatchObject({ type: 'test', workspace_id: T });
  });

  it('rejouer un envoi encore en cours rend 409 et n’enfile rien', async () => {
    const b = banc();
    expect(await rejouerEnvoi(b.deps, T, A)).toMatchObject({ ok: false, statut: 409 });
    expect(b.jobs).toEqual([]);
  });
});
