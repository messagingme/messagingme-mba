import { describe, it, expect, vi } from 'vitest';
import {
  COLLECTIONS_LISTEES, PASSAGE_COLLECTIONS_MS, PRODUITS_PAR_LOT, SANS_READ_PRODUCTS_COLLECTIONS, cablerCollections, lireCollections,
  traiterCollections, vueLecture,
} from '../src/shopify/collections';
import { COLLECTIONS_PAR_PRODUIT, lireCollectionsDesProduits, produitDuNoeud } from '../src/shopify/collections-lues';
import { BAIL_LOT_SECONDES, DEMANDE_PERIMEE_MINUTES, FRAICHEUR_COLLECTIONS_HEURES, type MagasinCollections } from '../src/shopify/collections.pg';
import { API_VERSION_SHOPIFY } from '../src/shopify/connexion';
import * as journal from '../src/lib/journal';
import { BOUTIQUE_COLLECTIONS, MIDI_COLLECTIONS, T_COLLECTIONS as T, monterCollections, noeudDe } from './collections-faux';

/**
 * LA LECTURE DES COLLECTIONS DES PRODUITS ACHETÉS (segments Shopify enrichis, lot 6a) : le job sur un faux Shopify (lots,
 * coût journalisé, `hasNextPage`, nœud nul, droits refusés, bail repris, passage borné, pannes), la liste qui enfile, et la
 * lecture GraphQL elle-même sur un faux `fetch`. Le vrai cache est éprouvé sur PGlite
 * (`tests/integration/shopify-collections.integration.test.ts`).
 */
const JOB = { tenantId: T };
const produits = (n: number, depuis = 1): string[] => Array.from({ length: n }, (_, i) => String(9000 + depuis + i));
const sans = (id: string) => ({ titre: `Produit ${id}`, collections: [] });

describe('le job de lecture des collections', () => {
  it('🔴 les produits des lignes, réservés par lots de dix, les jamais lus d’abord ; chacun écrit, la lecture aboutie', async () => {
    const ids = produits(25);
    const catalogue = Object.fromEntries(ids.map((id) => [id, { titre: `Produit ${id}`, collections: [{ id: '4401', titre: 'Été' }] }]));
    const f = monterCollections({ lignes: ids, catalogue, etat: {} });
    await traiterCollections(f.deps, JOB);
    expect(f.trace.lots.map((l) => l.length)).toEqual([PRODUITS_PAR_LOT, PRODUITS_PAR_LOT, 5]);
    expect(f.trace.lots.flat().sort()).toEqual([...ids].sort());
    expect([...f.produits.values()].every((p) => p.luesLe === MIDI_COLLECTIONS && p.bail === null && p.jeton === null)).toBe(true);
    expect(f.collections.get(ids[0]!)).toEqual([{ collectionId: '4401', titre: 'Été' }]);
    expect(f.trace.issues).toEqual([{ issue: 'lue', message: null }]);
    expect(f.etat()).toMatchObject({ lueLe: new Date(MIDI_COLLECTIONS), issue: 'lue' });
    // Rien ne reste à lire : un second passage ne lit rien et ne redit rien d'autre.
    await traiterCollections(f.deps, JOB);
    expect(f.trace.lots).toHaveLength(3);
  });

  it('le coût du premier lot de chaque passage est journalisé', async () => {
    const espion = vi.spyOn(journal, 'journaliser');
    const f = monterCollections({ lignes: produits(12), catalogue: Object.fromEntries(produits(12).map((id) => [id, sans(id)])), etat: {} });
    await traiterCollections(f.deps, JOB);
    const couts = espion.mock.calls.filter((c) => c[1] === 'shopify_collections_cout');
    expect(couts).toEqual([['info', 'shopify_collections_cout', { tenantId: T, parLot: PRODUITS_PAR_LOT, demande: 530, reel: 120 }]]);
    espion.mockRestore();
  });

  it('🔴 plus de 50 collections : le produit se dit incomplet ; un produit supprimé chez Shopify est lu, sans collection', async () => {
    const f = monterCollections({
      lignes: ['9001', '9002', '9003'],
      catalogue: {
        9001: { titre: 'Sérum', collections: [{ id: '4401', titre: 'Été' }], plus: true },
        9003: { titre: 'Crème', collections: [{ id: '4402', titre: 'Nuit' }] },
      },
      etat: {},
    });
    // 9003 est dans une collection : le cache la garde ; puis 9003 est sorti de la collection et 9002 supprimé.
    f.collections.set('9002', [{ collectionId: '4499', titre: 'Ancienne' }]);
    await traiterCollections(f.deps, JOB);
    expect(f.produits.get('9001')).toMatchObject({ titre: 'Sérum', incompletes: true });
    expect(f.produits.get('9002')).toMatchObject({ titre: null, incompletes: false, luesLe: MIDI_COLLECTIONS });
    // Remplacées en bloc : la collection d'avant du produit supprimé part avec sa lecture.
    expect(f.collections.get('9002')).toEqual([]);
    expect((await f.deps.magasin.etat(T))?.incompletes).toBe(true);
    expect(vueLecture(await f.deps.magasin.etat(T), MIDI_COLLECTIONS).incompletes).toBe(true);
  });

  it('🔴 sans le droit read_products : rien n’est lu, l’état le dit, avec la phrase qui dit de l’ajouter', async () => {
    const f = monterCollections({ lignes: produits(3), droits: ['read_customers', 'read_orders'], etat: {} });
    await traiterCollections(f.deps, JOB);
    expect(f.trace.lots).toEqual([]);
    expect(f.produits.size).toBe(0);
    expect(f.trace.issues).toEqual([{ issue: 'sans_droit', message: SANS_READ_PRODUCTS_COLLECTIONS }]);
    expect(vueLecture(await f.deps.magasin.etat(T), MIDI_COLLECTIONS)).toEqual({
      lueLe: null, enCours: false, refus: { code: 'sans_droit', message: SANS_READ_PRODUCTS_COLLECTIONS }, incompletes: false,
    });
    expect(SANS_READ_PRODUCTS_COLLECTIONS).toContain('read_products');
  });

  it('les droits ou le jeton refusés par Shopify : l’issue le dit ; une panne passagère remonte (pg-boss rejoue)', async () => {
    const refus = monterCollections({ lignes: produits(1), droits: { ok: false, code: 'acces_refuse', message: 'app désinstallée' }, etat: {} });
    await traiterCollections(refus.deps, JOB);
    expect(refus.trace.issues).toEqual([{ issue: 'refusee', message: 'app désinstallée' }]);
    const jeton = monterCollections({ lignes: produits(1), jeton: { ok: false, code: 'identifiants', message: 'clés refusées' } as never, etat: {} });
    await traiterCollections(jeton.deps, JOB);
    expect(jeton.trace.issues).toEqual([{ issue: 'refusee', message: 'clés refusées' }]);
    const passager = monterCollections({ lignes: produits(1), droits: { ok: false, code: 'passager', message: 'Shopify absent' }, etat: {} });
    await expect(traiterCollections(passager.deps, JOB)).rejects.toThrow('Shopify absent');
    expect(passager.trace.issues).toEqual([]);
  });

  it('boutique effacée : rien ; coupée : l’issue le dit, rien n’est lu', async () => {
    const effacee = monterCollections({ lignes: produits(1), boutique: null, etat: {} });
    await traiterCollections(effacee.deps, JOB);
    expect(effacee.trace).toMatchObject({ lots: [], issues: [], droits: 0 });
    const coupee = monterCollections({ lignes: produits(1), boutique: { ...BOUTIQUE_COLLECTIONS, etat: 'coupee' }, etat: {} });
    await traiterCollections(coupee.deps, JOB);
    expect(coupee.trace.lots).toEqual([]);
    expect(coupee.trace.issues).toEqual([{ issue: 'erreur', message: expect.stringContaining('coupée') }]);
  });

  it('🔴 coupée ou remplacée PENDANT le passage : le lot lu n’est pas écrit, son bail est rendu', async () => {
    for (const relue of [{ ...BOUTIQUE_COLLECTIONS, etat: 'coupee' }, { ...BOUTIQUE_COLLECTIONS, domaine: 'autre.myshopify.com' }, null]) {
      const f = monterCollections({ lignes: produits(3), catalogue: { 9001: sans('9001') }, boutiquesSuivantes: [relue], etat: {} });
      await traiterCollections(f.deps, JOB);
      expect(f.trace.lots).toHaveLength(1);
      expect(f.trace.ecritures).toEqual([]);
      expect([...f.produits.values()].every((p) => p.luesLe === null && p.bail === null)).toBe(true);
      expect(f.trace.issues.map((i) => i.issue)).toEqual(relue === null ? [] : ['erreur']);
    }
  });

  it('🔴 bail : un produit tenu par un autre passage n’est pas relu ; repris après son bail ; un jeton périmé n’écrit plus rien', async () => {
    const f = monterCollections({ lignes: produits(3), catalogue: Object.fromEntries(produits(3).map((id) => [id, sans(id)])), etat: {} });
    await f.deps.magasin.synchroniser(T);
    // Un autre passage tient deux produits.
    const autre = await f.deps.magasin.reserver(T, 2);
    expect(autre.produits).toEqual(['9001', '9002']);
    await traiterCollections(f.deps, JOB);
    expect(f.trace.lots).toEqual([['9003']]);
    // Il en reste deux à lire, tenus par l'autre : ce passage ne dit pas la lecture aboutie.
    expect(f.trace.issues).toEqual([]);
    // L'autre meurt ; son bail expire, un passage suivant les reprend.
    f.horloge.t += BAIL_LOT_SECONDES * 1000 + 1;
    await traiterCollections(f.deps, JOB);
    expect(f.trace.lots).toEqual([['9003'], ['9001', '9002']]);
    expect(f.trace.issues).toEqual([{ issue: 'lue', message: null }]);
    // Le mort se réveille : son jeton ne vaut plus rien.
    expect(await f.deps.magasin.ecrire(T, autre.jeton, [{ produitId: '9001', titre: 'périmé', collections: [], incompletes: false }])).toBe(0);
    expect(f.produits.get('9001')?.titre).toBe('Produit 9001');
  });

  it('un produit lu il y a plus de 24 h se relit ; un produit lu depuis, non', async () => {
    const f = monterCollections({ lignes: produits(2), catalogue: Object.fromEntries(produits(2).map((id) => [id, sans(id)])), etat: {} });
    await traiterCollections(f.deps, JOB);
    f.horloge.t += FRAICHEUR_COLLECTIONS_HEURES * 3_600_000 - 1000;
    expect(await f.deps.magasin.aLire(T)).toBe(false);
    await traiterCollections(f.deps, JOB);
    expect(f.trace.lots).toHaveLength(1);
    f.horloge.t += 2000;
    expect(await f.deps.magasin.aLire(T)).toBe(true);
    await traiterCollections(f.deps, JOB);
    expect(f.trace.lots).toHaveLength(2);
  });

  it('🔴 le passage est borné : au-delà, le job se réenfile, les produits pas encore lus restent à lire', async () => {
    const ids = produits(40);
    const f = monterCollections({ lignes: ids, catalogue: Object.fromEntries(ids.map((id) => [id, sans(id)])), msParLot: PASSAGE_COLLECTIONS_MS / 2, etat: {} });
    await traiterCollections(f.deps, JOB);
    expect(f.trace.lots).toHaveLength(2);
    expect(f.trace.jobs).toEqual([{ job: JOB, dansSecondes: 0 }]);
    expect(f.trace.issues).toEqual([]);
    expect([...f.produits.values()].filter((p) => p.luesLe === null)).toHaveLength(20);
  });

  it('🔴 une panne pendant un lot rend son bail AVANT de remonter ; un lot trop lourd se redemande plus petit ; un accès refusé se dit', async () => {
    const ids = produits(4);
    const catalogue = Object.fromEntries(ids.map((id) => [id, sans(id)]));
    const panne = monterCollections({ lignes: ids, catalogue, echecs: [{ ok: false, code: 'passager', message: 'Shopify n’a pas répondu' }], etat: {} });
    await expect(traiterCollections(panne.deps, JOB)).rejects.toThrow('Shopify n’a pas répondu');
    expect([...panne.produits.values()].every((p) => p.bail === null && p.jeton === null)).toBe(true);
    expect(panne.trace.liberes).toHaveLength(1);

    const lourd = monterCollections({ lignes: ids, catalogue, echecs: [{ ok: false, code: 'trop_lourd', message: 'trop lourd' }], etat: {} });
    await traiterCollections(lourd.deps, JOB);
    expect(lourd.trace.lots.map((l) => l.length)).toEqual([4, 4]);
    expect(lourd.trace.issues).toEqual([{ issue: 'lue', message: null }]);

    const refuse = monterCollections({ lignes: ids, catalogue, echecs: [{ ok: false, code: 'acces_refuse', message: 'Access denied for collections field' }], etat: {} });
    await traiterCollections(refuse.deps, JOB);
    expect(refuse.trace.issues).toEqual([{ issue: 'refusee', message: 'Access denied for collections field' }]);
    expect([...refuse.produits.values()].every((p) => p.bail === null && p.luesLe === null)).toBe(true);
  });

  it('une écriture en panne rend aussi son bail avant de remonter', async () => {
    const f = monterCollections({ lignes: produits(2), catalogue: { 9001: sans('9001'), 9002: sans('9002') }, etat: {} });
    f.deps.magasin.ecrire = async () => { throw new Error('base en panne'); };
    await expect(traiterCollections(f.deps, JOB)).rejects.toThrow('base en panne');
    expect([...f.produits.values()].every((p) => p.bail === null)).toBe(true);
  });

  it('un job illisible est ignoré ; un identifiant de produit illisible n’entre pas au cache', async () => {
    const f = monterCollections({ lignes: ['9001', 'abc', '1'.repeat(20)], catalogue: { 9001: sans('9001') }, etat: {} });
    await traiterCollections(f.deps, { tenantId: 'pas-un-uuid' });
    expect(f.trace.droits).toBe(0);
    await traiterCollections(f.deps, JOB);
    expect([...f.produits.keys()]).toEqual(['9001']);
  });
});

describe('la liste des collections lues, qui enfile la lecture', () => {
  it('🔴 un produit commandé jamais lu : la lecture est demandée UNE fois et enfilée ; la liste le dit en cours', async () => {
    const f = monterCollections({ lignes: ['9001'] });
    const v = await lireCollections(f.deps, T, undefined);
    expect(v.lecture).toEqual({ lueLe: null, enCours: true, refus: null, incompletes: false });
    expect(f.trace.jobs).toEqual([{ job: JOB, dansSecondes: 0 }]);
    // Rouvert dans la foulée : la demande vit, rien de plus n'est enfilé.
    await lireCollections(f.deps, T, undefined);
    expect(f.trace.jobs).toHaveLength(1);
    // Sans issue au bout d'un quart d'heure, la demande est perdue : une nouvelle part.
    f.horloge.t += DEMANDE_PERIMEE_MINUTES * 60_000 + 1;
    expect((await lireCollections(f.deps, T, undefined)).lecture.enCours).toBe(true);
    expect(f.trace.jobs).toHaveLength(2);
  });

  it('rien à lire (tout est frais), ou une boutique coupée ou absente : rien n’est enfilé', async () => {
    const frais = monterCollections({ lignes: ['9001'], catalogue: { 9001: sans('9001') }, etat: {} });
    await traiterCollections(frais.deps, JOB);
    expect((await lireCollections(frais.deps, T, undefined)).lecture).toMatchObject({ enCours: false, lueLe: new Date(MIDI_COLLECTIONS).toISOString() });
    expect(frais.trace.jobs).toEqual([]);
    for (const boutique of [{ ...BOUTIQUE_COLLECTIONS, etat: 'coupee' }, null]) {
      const f = monterCollections({ lignes: ['9001'], boutique });
      expect((await lireCollections(f.deps, T, undefined)).lecture.enCours).toBe(false);
      expect(f.trace.jobs).toEqual([]);
    }
  });

  it('🔴 après une issue, une nouvelle demande attend une minute : un refus ne se relance pas en boucle', async () => {
    const f = monterCollections({ lignes: ['9001'], droits: ['read_orders'] });
    await lireCollections(f.deps, T, undefined);
    await traiterCollections(f.deps, JOB);
    const v = await lireCollections(f.deps, T, undefined);
    expect(v.lecture).toMatchObject({ enCours: false, refus: { code: 'sans_droit' } });
    expect(f.trace.jobs).toHaveLength(1);
    f.horloge.t += 61_000;
    expect((await lireCollections(f.deps, T, undefined)).lecture).toMatchObject({ enCours: true, refus: null });
    expect(f.trace.jobs).toHaveLength(2);
  });

  it('🔴 un job qui n’a pas pu être enfilé efface sa demande : la liste se rend, la suivante repart tout de suite', async () => {
    const f = monterCollections({ lignes: ['9001'] });
    f.deps.enfiler = async () => { throw new Error('file en panne'); };
    const v = await lireCollections(f.deps, T, undefined);
    expect(v.lecture.enCours).toBe(false);
    expect(f.etat()?.demandeeLe).toBeNull();
    const jobs: unknown[] = [];
    f.deps.enfiler = async (job) => { jobs.push(job); };
    expect((await lireCollections(f.deps, T, undefined)).lecture.enCours).toBe(true);
    expect(jobs).toEqual([JOB]);
  });

  it('les collections lues, celles qui portent le plus de produits d’abord, au plus 50, cherchables', async () => {
    const f = monterCollections({
      lignes: ['9001', '9002', '9003'],
      catalogue: {
        9001: { titre: 'A', collections: [{ id: '4401', titre: 'Été' }, { id: '4402', titre: 'Soins' }] },
        9002: { titre: 'B', collections: [{ id: '4402', titre: 'Soins' }] },
        9003: { titre: 'C', collections: [{ id: '4403', titre: 'Hiver' }] },
      },
      etat: {},
    });
    await traiterCollections(f.deps, JOB);
    expect((await lireCollections(f.deps, T, undefined)).collections).toEqual([
      { collectionId: '4402', titre: 'Soins', produits: 2 },
      { collectionId: '4401', titre: 'Été', produits: 1 },
      { collectionId: '4403', titre: 'Hiver', produits: 1 },
    ]);
    expect((await lireCollections(f.deps, T, 'hiv')).collections.map((c) => c.collectionId)).toEqual(['4403']);
    expect(COLLECTIONS_LISTEES).toBe(50);
  });
});

describe('vueLecture', () => {
  const base = { lueLe: null, demandeeLe: null, issue: null, issueLe: null, message: null, incompletes: false };
  it('aucune ligne : rien de lu, rien en cours', () => {
    expect(vueLecture(null, MIDI_COLLECTIONS)).toEqual({ lueLe: null, enCours: false, refus: null, incompletes: false });
  });
  it('🔴 en cours tant qu’une demande vive attend son issue ; le refus ne se montre pas pendant une nouvelle demande', () => {
    const demandee = new Date(MIDI_COLLECTIONS - 60_000);
    const refusAvant = { ...base, issue: 'sans_droit' as const, issueLe: new Date(MIDI_COLLECTIONS - 120_000), message: 'm', demandeeLe: demandee };
    expect(vueLecture(refusAvant, MIDI_COLLECTIONS)).toMatchObject({ enCours: true, refus: null });
    expect(vueLecture({ ...refusAvant, issueLe: new Date(MIDI_COLLECTIONS) }, MIDI_COLLECTIONS)).toMatchObject({ enCours: false, refus: { code: 'sans_droit', message: 'm' } });
    expect(vueLecture({ ...base, demandeeLe: new Date(MIDI_COLLECTIONS - DEMANDE_PERIMEE_MINUTES * 60_000 - 1) }, MIDI_COLLECTIONS).enCours).toBe(false);
  });
});

describe('cablerCollections', () => {
  it('🔴 le magasin passe ENTIER : ses méthodes lisent `this`', async () => {
    class Magasin {
      readonly appels: string[] = [];
      private readonly espace = 'lu par this';
      async etat() { this.appels.push(this.espace); return null; }
      async collections() { this.appels.push(this.espace); return []; }
      async aLire() { this.appels.push(this.espace); return false; }
    }
    const m = new Magasin();
    const deps = cablerCollections({
      magasin: m as unknown as MagasinCollections,
      boutiques: { acces: async () => null, lire: async () => ({ etat: 'connectee' }) } as never,
      enfiler: async () => undefined,
    });
    await lireCollections(deps, T, undefined);
    expect(m.appels).toEqual(['lu par this', 'lu par this', 'lu par this']);
  });
});

describe('la lecture GraphQL d’un lot', () => {
  const ACCES = { domaine: 'b.myshopify.com', jeton: 'shpat_x' };
  /** Un faux `fetch` qui rend les corps donnés, dans l'ordre, et garde les requêtes. */
  const faux = (...corps: Array<{ statut?: number; json: unknown }>) => {
    const requetes: Array<{ url: string; corps: { query: string; variables: { ids: string[] } } }> = [];
    const appeler = (async (url: string, init: { body: string }) => {
      requetes.push({ url, corps: JSON.parse(init.body) });
      const c = corps.shift() ?? corps[corps.length - 1] ?? { json: {} };
      return new Response(JSON.stringify(c.json), { status: c.statut ?? 200 });
    }) as unknown as typeof fetch;
    return { appeler, requetes };
  };
  const reponse = (nodes: unknown[], cout = { requestedQueryCost: 106, actualQueryCost: 24 }) => ({ json: { data: { nodes }, extensions: { cost: cout } } });

  it('🔴 les GID des produits, la version d’API, 50 collections au plus ; le titre coupé, un doublon écarté ; le coût rendu', async () => {
    const f = faux(reponse([
      { legacyResourceId: '9001', title: ` ${'S'.repeat(250)} `, collections: { pageInfo: { hasNextPage: false }, nodes: [
        { legacyResourceId: '4401', title: 'Été' }, { legacyResourceId: '4401', title: 'Été' }, { legacyResourceId: '4402', title: '  ' },
      ] } },
      null,
    ]));
    const r = await lireCollectionsDesProduits(ACCES, { produits: ['9001', '9002'], delaiMs: 20_000 }, f.appeler);
    expect(f.requetes[0]!.url).toBe(`https://b.myshopify.com/admin/api/${API_VERSION_SHOPIFY}/graphql.json`);
    expect(f.requetes[0]!.corps.variables.ids).toEqual(['gid://shopify/Product/9001', 'gid://shopify/Product/9002']);
    expect(f.requetes[0]!.corps.query).toContain(`collections(first: ${COLLECTIONS_PAR_PRODUIT})`);
    expect(r).toEqual({
      ok: true, cout: { demande: 106, reel: 24 },
      produits: [
        { produitId: '9001', titre: 'S'.repeat(200), collections: [{ collectionId: '4401', titre: 'Été' }, { collectionId: '4402', titre: null }], incompletes: false },
        { produitId: '9002', titre: null, collections: [], incompletes: false },
      ],
    });
  });

  it('🔴 un titre long se coupe en points de code : jamais une moitié d’emoji, que le jsonb de l’écriture refuserait', () => {
    const long = 'a'.repeat(199) + '😀' + 'b'.repeat(10);
    const p = produitDuNoeud('9001', noeudDe('9001', { titre: long, collections: [{ id: '1', titre: long }], plus: false }));
    for (const t of [p.titre!, p.collections[0]!.titre!]) {
      expect(Array.from(t)).toHaveLength(200);
      expect(t.endsWith('😀')).toBe(true);
      expect(/[\uD800-\uDFFF]/u.test(t)).toBe(false);
    }
    // Une moitié déjà présente dans le texte reçu devient le caractère de remplacement.
    expect(produitDuNoeud('9001', noeudDe('9001', { titre: 'x\uD83D', collections: [], plus: false })).titre).toBe('x�');
  });

  it('🔴 hasNextPage, une collection illisible ou un nœud illisible : jamais dit exhaustif', () => {
    expect(produitDuNoeud('9001', noeudDe('9001', { titre: 'A', collections: [{ id: '1', titre: 'x' }], plus: true })).incompletes).toBe(true);
    expect(produitDuNoeud('9001', { legacyResourceId: '9001', title: 'A', collections: { pageInfo: { hasNextPage: false }, nodes: [{ id: 'gid' }] } }))
      .toEqual({ produitId: '9001', titre: 'A', collections: [], incompletes: true });
    expect(produitDuNoeud('9001', {})).toEqual({ produitId: '9001', titre: null, collections: [], incompletes: true });
    // Le nœud d'un AUTRE produit ne s'écrit pas sur celui-ci.
    expect(produitDuNoeud('9001', noeudDe('9002', { titre: 'B', collections: [{ id: '1', titre: 'x' }] }))).toMatchObject({ collections: [], incompletes: true });
  });

  it('🔴 une réponse qui n’a pas un nœud par produit demandé ne s’écrit pas : elle dirait supprimés des produits qui ne le sont pas', async () => {
    const f = faux(reponse([null]));
    expect(await lireCollectionsDesProduits(ACCES, { produits: ['9001', '9002'], delaiMs: 20_000 }, f.appeler)).toMatchObject({ ok: false, code: 'passager' });
  });

  it('un accès refusé se dit par le message de Shopify ; 401 aussi ; un 5xx ou un coût dépassé : trop lourd', async () => {
    const refus = faux({ json: { errors: [{ message: 'Access denied for collections field. Required access: `read_products`', extensions: { code: 'ACCESS_DENIED' } }] } });
    expect(await lireCollectionsDesProduits(ACCES, { produits: ['9001'], delaiMs: 20_000 }, refus.appeler))
      .toEqual({ ok: false, code: 'acces_refuse', message: expect.stringContaining('Required access: `read_products`') });
    expect(await lireCollectionsDesProduits(ACCES, { produits: ['9001'], delaiMs: 20_000 }, faux({ statut: 401, json: {} }).appeler)).toMatchObject({ code: 'acces_refuse' });
    expect(await lireCollectionsDesProduits(ACCES, { produits: ['9001'], delaiMs: 20_000 }, faux({ statut: 502, json: {} }).appeler)).toMatchObject({ code: 'trop_lourd' });
    expect(await lireCollectionsDesProduits(ACCES, { produits: ['9001'], delaiMs: 20_000 }, faux({ json: { errors: [{ message: 'x', extensions: { code: 'MAX_COST_EXCEEDED' } }] } }).appeler))
      .toMatchObject({ code: 'trop_lourd' });
  });

  it('🔴 le frein de Shopify attend la recharge du seau, dans le délai de l’appel', async () => {
    const attentes: number[] = [];
    const f = faux(
      { json: { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }], extensions: { cost: { requestedQueryCost: 530, throttleStatus: { currentlyAvailable: 30, restoreRate: 100 } } } } },
      reponse([null]),
    );
    let t = 0;
    const r = await lireCollectionsDesProduits(ACCES, { produits: ['9001'], delaiMs: 20_000 }, f.appeler, async (ms) => { attentes.push(ms); t += ms; }, () => t);
    expect(attentes).toEqual([5000]);
    expect(r).toMatchObject({ ok: true, produits: [{ produitId: '9001', collections: [] }] });
    // Un frein plus long que le délai restant : passager, sans attendre.
    const lent = faux({ json: { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }], extensions: { cost: { requestedQueryCost: 900, throttleStatus: { currentlyAvailable: 0, restoreRate: 10 } } } } });
    expect(await lireCollectionsDesProduits(ACCES, { produits: ['9001'], delaiMs: 20_000 }, lent.appeler, async () => undefined, () => 0)).toMatchObject({ ok: false, code: 'passager' });
  });

  it('un identifiant illisible : le lot est refusé avant tout appel', async () => {
    const f = faux(reponse([]));
    expect(await lireCollectionsDesProduits(ACCES, { produits: ['9001', 'abc'], delaiMs: 20_000 }, f.appeler)).toMatchObject({ ok: false, code: 'passager' });
    expect(f.requetes).toEqual([]);
  });
});
