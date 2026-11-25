import { describe, it, expect, vi } from 'vitest';
import {
  PASSAGE_ETIQUETTES_MS, SANS_READ_CUSTOMERS, SYNCHRO_ETEINTE, cablerEtiquettes, lireEtiquettes, reglerEtiquettes, relancerEtiquettesDues,
  synchroniserEtiquettes, traiterEtiquettes, vueSynchro,
} from '../src/shopify/etiquettes';
import {
  ADRESSES_PAR_CLIENT, CLIENTS_PAR_LOT, CLIENTS_PAR_RECHERCHE, COUT_PAR_CLIENT, ETIQUETTES_PAR_CLIENT, TELEPHONES_PAR_RECHERCHE, chercherParTelephones, etiquettesUtiles,
  lireClientsParIds,
} from '../src/shopify/etiquettes-lues';
import { BAIL_SYNCHRO_SECONDES, RELECTURE_HEURES, SYNCHRO_PERIMEE_MINUTES, type MagasinEtiquettes } from '../src/shopify/etiquettes.pg';
import { API_VERSION_SHOPIFY } from '../src/shopify/connexion';
import * as journal from '../src/lib/journal';
import { BOUTIQUE_ETIQUETTES, MIDI_ETIQUETTES, T_ETIQUETTES as T, monterEtiquettes } from './etiquettes-faux';

/**
 * LA SYNCHRONISATION DES ÉTIQUETTES DES CLIENTS SHOPIFY (segments Shopify enrichis, lot 6b ; lot 6b bis) : le job sur un faux
 * Shopify (le lien par tous les numéros du client, plusieurs à plusieurs ; la recherche par téléphone, de nouveau à chaque geste
 * du marchand, jamais par la relecture quotidienne ; les liens d'une fiche remplacés par une recherche complète ; les lots par identifiant, le remplacement en bloc, le
 * client disparu, la fiche supprimée, la boutique coupée en route, le bail, le passage borné, les pannes, le coût), la
 * gestion partagée par la carte et l'outil (allumer, éteindre, « maintenant », la Free une fois par 24 h), la relecture
 * quotidienne, et les deux lectures GraphQL sur un faux `fetch`. Le vrai magasin est éprouvé sur PGlite
 * (`tests/integration/shopify-etiquettes.integration.test.ts`).
 */
const JOB = { tenantId: T };
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'aaaaaaaa-0000-4000-8000-000000000002';
const C = 'aaaaaaaa-0000-4000-8000-000000000003';
const tel = (n: number): string => `+3360000${String(n).padStart(4, '0')}`;

/** Allume et commence une synchronisation, comme le fait la carte : la demande posée, le job pas encore traité. */
async function commencer(f: ReturnType<typeof monterEtiquettes>): Promise<void> {
  await f.deps.magasin.regler(T, true);
  expect(await f.deps.magasin.demander(T, { auPlusUneFoisParJour: false })).toBeInstanceOf(Date);
}

describe('le job de synchronisation des étiquettes', () => {
  it('🔴 relie chaque fiche ACTIVE à SON client par le téléphone, lit ses étiquettes, les écrit en bloc ; la synchronisation aboutit', async () => {
    const f = monterEtiquettes({
      fiches: { [A]: { telephone: tel(1), active: true }, [B]: { telephone: tel(2), active: true }, [C]: { telephone: tel(3), active: false } },
      boutiqueClients: { 1001: { telephone: tel(1), tags: [' VIP ', 'Grossiste', 'VIP'] }, 1003: { telephone: tel(3), tags: ['Perdu'] } },
    });
    await commencer(f);
    await traiterEtiquettes(f.deps, JOB);
    expect([...f.liens.values()].map((l) => [l.clientId, l.contactId])).toEqual([['1001', A]]);
    expect(f.etiquettes.get(A)).toEqual(['VIP', 'Grossiste']);
    // La fiche supprimée n'est ni reliée, ni cherchée, ni étiquetée ; chaque fiche active est cherchée, une fois.
    expect(f.etiquettes.get(C)).toBeUndefined();
    expect(f.trace.recherches).toEqual([[tel(1), tel(2)]]);
    expect(f.cherchees).toEqual(new Set([A, B]));
    expect(f.trace.lots).toEqual([['1001']]);
    expect(f.trace.issues).toEqual([{ issue: 'lue', message: null }]);
    expect(f.etat()).toMatchObject({ synchroLe: new Date(MIDI_ETIQUETTES), enCoursDepuis: null, jeton: null, bail: null });
    expect(f.etat()?.comptes).toEqual({ clientsLus: 1, trouvesParTelephone: 1, sansFiche: 0, fichesEtiquetees: 1 });
  });

  it('🔴 une fiche est cherchée par son téléphone ; la relecture quotidienne ne la cherche plus, elle relit son client par son identifiant', async () => {
    const f = monterEtiquettes({
      fiches: { [A]: { telephone: tel(1), active: true }, [B]: { telephone: tel(2), active: true } },
      boutiqueClients: { 2002: { telephone: tel(2), tags: ['Newsletter'] } },
    });
    await commencer(f);
    await traiterEtiquettes(f.deps, JOB);
    expect(f.trace.recherches).toEqual([[tel(1), tel(2)]]);
    expect(f.fichesDuClient('2002')).toEqual([B]);
    expect(f.etiquettes.get(B)).toEqual(['Newsletter']);
    expect(f.cherchees).toEqual(new Set([A, B]));
    // Trouvé par son téléphone puis lu par son identifiant : compté UNE fois.
    expect(f.etat()?.comptes).toMatchObject({ trouvesParTelephone: 1, clientsLus: 1 });
    // Le lendemain, la relecture quotidienne : plus aucune recherche, le client relié se relit par son identifiant, ses
    // étiquettes remplacées.
    f.catalogue.set('2002', { telephone: tel(2), tags: ['Fidèle'] });
    f.horloge.t += RELECTURE_HEURES * 3_600_000 + 1;
    expect(await f.deps.magasin.dues(10)).toHaveLength(1);
    await traiterEtiquettes(f.deps, JOB);
    expect(f.trace.recherches).toHaveLength(1);
    expect(f.etiquettes.get(B)).toEqual(['Fidèle']);
    // Le geste du marchand, lui, cherche de nouveau TOUTES les fiches : un numéro ajouté chez Shopify se relie.
    f.catalogue.set('1001', { telephone: tel(1), tags: ['Nouveau'] });
    f.horloge.t += RELECTURE_HEURES * 3_600_000 + 1;
    expect(await f.deps.magasin.demander(T, { auPlusUneFoisParJour: false })).toBeInstanceOf(Date);
    expect(f.cherchees.size).toBe(0);
    await traiterEtiquettes(f.deps, JOB);
    expect(f.trace.recherches).toHaveLength(2);
    expect(f.trace.recherches[1]).toEqual([tel(1), tel(2)]);
    expect(f.fichesDuClient('1001')).toEqual([A]);
    expect(f.etiquettes.get(A)).toEqual(['Nouveau']);
  });

  it('🔴 un client trouvé dont la fiche est supprimée entre-temps n’est ni relié ni gardé : compté, puis oublié', async () => {
    const f = monterEtiquettes({
      fiches: { [A]: { telephone: tel(1), active: true } },
      boutiqueClients: { 3001: { telephone: tel(1), tags: ['VIP'] } },
    });
    const chercher = f.deps.chercher;
    f.deps.chercher = async (acces, p) => { const r = await chercher(acces, p); f.fiches.set(A, { telephone: tel(1), active: false }); return r; };
    await commencer(f);
    await traiterEtiquettes(f.deps, JOB);
    expect(f.liens.size).toBe(0);
    expect(f.etiquettes.size).toBe(0);
    expect(f.cherchees.size).toBe(0);
    expect(f.etat()?.comptes).toMatchObject({ clientsLus: 0, trouvesParTelephone: 0, sansFiche: 1 });
  });

  it('🔴 un client relié dont la fiche est supprimée perd son lien et ses étiquettes ; un client supprimé chez Shopify aussi, et sa fiche redevient cherchable', async () => {
    const f = monterEtiquettes({
      fiches: { [A]: { telephone: tel(1), active: true }, [B]: { telephone: tel(2), active: true } },
      boutiqueClients: { 1001: { telephone: tel(1), tags: ['VIP'] }, 1002: { telephone: tel(2), tags: ['Grossiste'] } },
    });
    await commencer(f);
    await traiterEtiquettes(f.deps, JOB);
    expect(f.etiquettes.get(A)).toEqual(['VIP']);
    // A est supprimée dans Messaging Me ; 1002 est supprimé chez Shopify.
    f.fiches.set(A, { telephone: tel(1), active: false });
    f.catalogue.delete('1002');
    f.horloge.t += RELECTURE_HEURES * 3_600_000 + 1;
    expect(await f.deps.magasin.dues(10)).toHaveLength(1);
    await traiterEtiquettes(f.deps, JOB);
    expect(f.liens.size).toBe(0);
    expect(f.etiquettes.get(A)).toBeUndefined();
    expect(f.etiquettes.get(B)).toBeUndefined();
    // La marque de B est effacée avec son lien : la synchronisation suivante, même quotidienne, la cherche de nouveau.
    expect(f.cherchees.has(B)).toBe(false);
    expect(f.etat()?.comptes).toMatchObject({ sansFiche: 1 });
  });

  it('🔴 coupée, remplacée ou effacée PENDANT le passage : le lot lu n’est pas écrit', async () => {
    for (const relue of [{ ...BOUTIQUE_ETIQUETTES, etat: 'coupee' }, { ...BOUTIQUE_ETIQUETTES, domaine: 'autre.myshopify.com' }, null]) {
      const f = monterEtiquettes({
        fiches: { [A]: { telephone: null, active: true } }, liensDeDepart: [{ clientId: '1001', contactId: A }],
        boutiqueClients: { 1001: { telephone: tel(1), tags: ['VIP'] } }, boutiquesSuivantes: [relue],
      });
      await commencer(f);
      await traiterEtiquettes(f.deps, JOB);
      expect(f.trace.lots).toHaveLength(1);
      expect(f.trace.ecritures).toBe(0);
      expect(f.etiquettes.size).toBe(0);
      expect(f.trace.issues.map((i) => i.issue)).toEqual(relue === null ? [] : ['erreur']);
    }
    // Le même filet sur un lot CHERCHÉ par téléphone : la boutique coupée pendant la recherche, rien n'est écrit.
    const g = monterEtiquettes({
      fiches: { [A]: { telephone: tel(1), active: true } }, boutiqueClients: { 1001: { telephone: tel(1), tags: ['VIP'] } },
      boutiquesSuivantes: [{ ...BOUTIQUE_ETIQUETTES, etat: 'coupee' }],
    });
    await commencer(g);
    await traiterEtiquettes(g.deps, JOB);
    expect(g.trace.recherches).toHaveLength(1);
    expect(g.trace.ecritures).toBe(0);
    expect(g.liens.size).toBe(0);
    expect(g.cherchees.size).toBe(0);
  });

  it('🔴 bail : une synchronisation tenue par un autre passage n’est pas reprise ; elle l’est après son bail ; un jeton périmé n’écrit plus rien', async () => {
    const f = monterEtiquettes({
      fiches: { [A]: { telephone: tel(1), active: true } }, liensDeDepart: [{ clientId: '1001', contactId: A }],
      boutiqueClients: { 1001: { telephone: tel(1), tags: ['VIP'] } },
    });
    await commencer(f);
    const autre = await f.deps.magasin.prendre(T);
    expect(autre).not.toBeNull();
    await traiterEtiquettes(f.deps, JOB);
    expect(f.trace.lots).toEqual([]);
    // On repasse voir après une partie du bail.
    expect(f.trace.jobs).toEqual([{ job: JOB, dansSecondes: Math.ceil(BAIL_SYNCHRO_SECONDES / 3) }]);
    f.horloge.t += BAIL_SYNCHRO_SECONDES * 1000 + 1;
    await traiterEtiquettes(f.deps, JOB);
    expect(f.trace.issues).toEqual([{ issue: 'lue', message: null }]);
    expect(await f.deps.magasin.ecrireClients(T, autre!.jeton, { lus: [{ clientId: '1001', etiquettes: ['périmé'] }], curseur: '1001' })).toBe(false);
    expect(await f.deps.magasin.ecrireRecherche(T, autre!.jeton, { cherchees: [A], trouves: [], complete: true })).toBeNull();
    expect(await f.deps.magasin.finir(T, autre!.jeton, 'erreur', 'périmé')).toBe(false);
    expect(f.etiquettes.get(A)).toEqual(['VIP']);
  });

  it('aucune synchronisation commencée : le job ne fait rien et ne se réenfile pas', async () => {
    const f = monterEtiquettes({ etat: { allumee: true } });
    await traiterEtiquettes(f.deps, JOB);
    expect(f.trace).toMatchObject({ lots: [], recherches: [], jobs: [], droits: 0 });
  });

  it('🔴 le passage est borné : au-delà, le job se réenfile et rend son bail ; le suivant reprend au dernier client lu', async () => {
    const ids = Array.from({ length: CLIENTS_PAR_LOT * 3 }, (_, i) => String(100_000 + i));
    const fiches = Object.fromEntries(ids.map((_id, i) => [`aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`, { telephone: null, active: true }]));
    const contacts = Object.keys(fiches);
    const f = monterEtiquettes({
      fiches, liensDeDepart: ids.map((clientId, i) => ({ clientId, contactId: contacts[i]! })),
      boutiqueClients: Object.fromEntries(ids.map((id, i) => [id, { telephone: tel(i), tags: ['X'] }])), msParLot: PASSAGE_ETIQUETTES_MS / 2,
    });
    await commencer(f);
    await traiterEtiquettes(f.deps, JOB);
    expect(f.trace.lots).toHaveLength(2);
    expect(f.trace.jobs).toEqual([{ job: JOB, dansSecondes: 0 }]);
    expect(f.etat()).toMatchObject({ jeton: null, bail: null, curseur: ids[CLIENTS_PAR_LOT * 2 - 1] });
    await traiterEtiquettes(f.deps, JOB);
    expect(f.trace.lots.map((l) => l[0])).toEqual([ids[0], ids[CLIENTS_PAR_LOT], ids[CLIENTS_PAR_LOT * 2]]);
    expect(f.trace.issues).toEqual([{ issue: 'lue', message: null }]);
  });

  it('🔴 une panne pendant un lot rend son bail AVANT de remonter ; un lot trop lourd se redemande plus petit ; un accès refusé se dit', async () => {
    const base = {
      fiches: { [A]: { telephone: null, active: true } }, liensDeDepart: [{ clientId: '1001', contactId: A }],
      boutiqueClients: { 1001: { telephone: tel(1), tags: ['VIP'] } },
    };
    const panne = monterEtiquettes({ ...base, echecsClients: [{ ok: false, code: 'passager', message: 'Shopify n’a pas répondu' }] });
    await commencer(panne);
    await expect(traiterEtiquettes(panne.deps, JOB)).rejects.toThrow('Shopify n’a pas répondu');
    expect(panne.etat()).toMatchObject({ jeton: null, bail: null });
    expect(panne.etat()?.enCoursDepuis).not.toBeNull();

    const lourd = monterEtiquettes({ ...base, echecsClients: [{ ok: false, code: 'trop_lourd', message: 'trop lourd' }] });
    await commencer(lourd);
    await traiterEtiquettes(lourd.deps, JOB);
    expect(lourd.trace.lots).toEqual([['1001'], ['1001']]);
    expect(lourd.trace.issues).toEqual([{ issue: 'lue', message: null }]);

    const refuse = monterEtiquettes({ ...base, echecsClients: [{ ok: false, code: 'acces_refuse', message: 'Access denied for tags field' }] });
    await commencer(refuse);
    await traiterEtiquettes(refuse.deps, JOB);
    expect(refuse.trace.issues).toEqual([{ issue: 'refusee', message: 'Access denied for tags field' }]);
    expect(refuse.etiquettes.size).toBe(0);
  });

  it('une recherche incomplète se redemande plus petite ; un seul téléphone encore incomplet est écrit et marqué', async () => {
    const fiches = Object.fromEntries([1, 2, 3, 4].map((n) => [`aaaaaaaa-0000-4000-8000-00000000000${n}`, { telephone: tel(n), active: true }]));
    const f = monterEtiquettes({ fiches, boutiqueClients: { 5001: { telephone: tel(1), tags: ['VIP'] } }, incompleteAuDela: 0 });
    await commencer(f);
    await traiterEtiquettes(f.deps, JOB);
    expect(f.trace.recherches.map((r) => r.length)).toEqual([4, 4, 4, 3, 1, 1, 1, 1]);
    expect(f.cherchees.size).toBe(4);
    expect(f.etiquettes.get('aaaaaaaa-0000-4000-8000-000000000001')).toEqual(['VIP']);
  });

  it('🔴 sans le droit read_customers : rien n’est lu, l’état le dit ; jeton ou droits refusés : l’issue le dit ; une panne passagère remonte', async () => {
    const sansDroit = monterEtiquettes({ fiches: { [A]: { telephone: tel(1), active: true } }, droits: ['read_orders'] });
    await commencer(sansDroit);
    await traiterEtiquettes(sansDroit.deps, JOB);
    expect(sansDroit.trace).toMatchObject({ lots: [], recherches: [] });
    expect(sansDroit.trace.issues).toEqual([{ issue: 'sans_droit', message: SANS_READ_CUSTOMERS }]);
    expect(SANS_READ_CUSTOMERS).toContain('read_customers');

    const jeton = monterEtiquettes({ jeton: { ok: false, code: 'identifiants', message: 'clés refusées' } as never });
    await commencer(jeton);
    await traiterEtiquettes(jeton.deps, JOB);
    expect(jeton.trace.issues).toEqual([{ issue: 'refusee', message: 'clés refusées' }]);

    const passager = monterEtiquettes({ droits: { ok: false, code: 'passager', message: 'Shopify absent' } });
    await commencer(passager);
    await expect(traiterEtiquettes(passager.deps, JOB)).rejects.toThrow('Shopify absent');
    expect(passager.trace.issues).toEqual([]);
    expect(passager.etat()).toMatchObject({ jeton: null });
  });

  it('le coût du premier lot de chaque temps est journalisé', async () => {
    const espion = vi.spyOn(journal, 'journaliser');
    const f = monterEtiquettes({
      fiches: { [A]: { telephone: tel(1), active: true }, [B]: { telephone: tel(2), active: true } }, liensDeDepart: [{ clientId: '1001', contactId: A }],
      boutiqueClients: { 1001: { telephone: tel(1), tags: [] } },
    });
    await commencer(f);
    await traiterEtiquettes(f.deps, JOB);
    const couts = espion.mock.calls.filter((c) => c[1] === 'shopify_etiquettes_cout').map((c) => c[2]);
    expect(couts).toEqual([
      { tenantId: T, quoi: 'telephones', taille: TELEPHONES_PAR_RECHERCHE, demande: 50, reel: 10 },
      { tenantId: T, quoi: 'clients', taille: CLIENTS_PAR_LOT, demande: 2, reel: 1 },
    ]);
    espion.mockRestore();
  });

  it('🔴 plusieurs à plusieurs : deux clients d’un numéro relient la fiche, qui porte leurs deux étiquettes ; un client de deux numéros relie les deux fiches', async () => {
    const f = monterEtiquettes({
      fiches: { [A]: { telephone: tel(1), active: true }, [B]: { telephone: tel(2), active: true } },
      boutiqueClients: {
        // Le numéro de A sur les adresses de deux clients ; le second porte aussi celui de B (une adresse de livraison).
        1001: { telephone: null, tags: ['VIP'], numeros: [tel(1)] },
        1002: { telephone: null, tags: ['VIP MM'], numeros: [tel(1), tel(2)] },
      },
    });
    await commencer(f);
    await traiterEtiquettes(f.deps, JOB);
    expect(f.fichesDuClient('1001')).toEqual([A]);
    expect(f.fichesDuClient('1002').sort()).toEqual([A, B].sort());
    expect(f.etiquettes.get(A)).toEqual(['VIP', 'VIP MM']);
    expect(f.etiquettes.get(B)).toEqual(['VIP MM']);
    // Deux fiches reliées par leur numéro ; deux clients lus, chacun une fois.
    expect(f.etat()?.comptes).toEqual({ clientsLus: 2, trouvesParTelephone: 2, sansFiche: 0, fichesEtiquetees: 2 });
    // La lecture d'un client ne touche pas les étiquettes de l'autre client de la même fiche.
    f.catalogue.set('1001', { telephone: null, tags: ['Grossiste'], numeros: [tel(1)] });
    f.horloge.t += RELECTURE_HEURES * 3_600_000 + 1;
    expect(await f.deps.magasin.dues(10)).toHaveLength(1);
    await traiterEtiquettes(f.deps, JOB);
    expect(f.etiquettes.get(A)).toEqual(['Grossiste', 'VIP MM']);
  });

  it('🔴 une recherche COMPLÈTE défait le lien d’un client qui n’a plus le numéro ; une page incomplète n’en défait aucun', async () => {
    const f = monterEtiquettes({
      fiches: { [A]: { telephone: tel(1), active: true } },
      boutiqueClients: { 1001: { telephone: tel(1), tags: ['VIP'] }, 1002: { telephone: null, tags: ['Ancien'], numeros: [tel(1)] } },
    });
    await commencer(f);
    await traiterEtiquettes(f.deps, JOB);
    expect(f.etiquettes.get(A)).toEqual(['VIP', 'Ancien']);
    // Chez Shopify, 1002 n'a plus le numéro de A : le geste suivant le défait, avec ses étiquettes.
    f.catalogue.set('1002', { telephone: null, tags: ['Ancien'], numeros: [] });
    f.horloge.t += 60_000;
    expect(await f.deps.magasin.demander(T, { auPlusUneFoisParJour: false })).toBeInstanceOf(Date);
    await traiterEtiquettes(f.deps, JOB);
    expect(f.fichesDuClient('1002')).toEqual([]);
    expect(f.etiquettes.get(A)).toEqual(['VIP']);

    // Même situation, mais la recherche rend une page incomplète : rien n'est défait.
    const g = monterEtiquettes({
      fiches: { [A]: { telephone: tel(1), active: true } },
      liensDeDepart: [{ clientId: '1002', contactId: A, etiquettes: ['Ancien'] }],
      boutiqueClients: { 1001: { telephone: tel(1), tags: ['VIP'] }, 1002: { telephone: null, tags: ['Ancien'], numeros: [] } },
      incompleteAuDela: 0,
    });
    await commencer(g);
    await traiterEtiquettes(g.deps, JOB);
    expect(g.fichesDuClient('1002')).toEqual([A]);
    expect(g.etiquettes.get(A)).toEqual(['Ancien', 'VIP']);
  });

  it('un job illisible est ignoré', async () => {
    const f = monterEtiquettes();
    await traiterEtiquettes(f.deps, { tenantId: 'pas-un-uuid' });
    expect(f.trace.droits).toBe(0);
  });
});

describe('la gestion partagée par la carte et l’outil', () => {
  it('🔴 allumer : refusé sans boutique ou coupée ; branchée, la synchronisation part aussitôt ; éteindre ne lance rien', async () => {
    for (const boutique of [null, { ...BOUTIQUE_ETIQUETTES, etat: 'coupee' }]) {
      const f = monterEtiquettes({ boutique });
      expect(await reglerEtiquettes(f.deps, T, true)).toMatchObject({ ok: false, statut: 409 });
      expect(f.etat()).toBeNull();
    }
    const f = monterEtiquettes();
    const r = await reglerEtiquettes(f.deps, T, true);
    expect(r).toMatchObject({ ok: true, valeur: { allumee: true, enCours: true, lancee: true } });
    expect(f.trace.jobs).toEqual([{ job: JOB, dansSecondes: 0 }]);
    const off = await reglerEtiquettes(f.deps, T, false);
    expect(off).toMatchObject({ ok: true, valeur: { allumee: false, lancee: false } });
    expect(f.trace.jobs).toHaveLength(1);
  });

  it('« maintenant » : refusé éteinte ; une synchronisation qui tourne n’en lance pas une seconde', async () => {
    const eteinte = monterEtiquettes({ etat: { allumee: false } });
    expect(await synchroniserEtiquettes(eteinte.deps, T)).toEqual({ ok: false, statut: 409, message: SYNCHRO_ETEINTE });
    const f = monterEtiquettes();
    await reglerEtiquettes(f.deps, T, true);
    expect(await synchroniserEtiquettes(f.deps, T)).toMatchObject({ ok: true, valeur: { enCours: true, lancee: false } });
    expect(f.trace.jobs).toHaveLength(1);
  });

  it('🔴 la Free : au plus une synchronisation toutes les 24 h, refusée avant avec le délai ; le Pro, à la demande', async () => {
    const free = monterEtiquettes({ offre: 'base', fiches: {} });
    await reglerEtiquettes(free.deps, T, true);
    await traiterEtiquettes(free.deps, JOB);
    free.horloge.t += 3_600_000;
    const refus = await synchroniserEtiquettes(free.deps, T);
    expect(refus).toMatchObject({ ok: false, statut: 429, reessayerDansS: 23 * 3600 });
    expect(refus.ok ? '' : refus.message).toContain('23 heures');
    free.horloge.t += 23 * 3_600_000 + 1;
    expect(await synchroniserEtiquettes(free.deps, T)).toMatchObject({ ok: true, valeur: { lancee: true } });

    const pro = monterEtiquettes({ offre: 'pro', fiches: {} });
    await reglerEtiquettes(pro.deps, T, true);
    await traiterEtiquettes(pro.deps, JOB);
    expect(await synchroniserEtiquettes(pro.deps, T)).toMatchObject({ ok: true, valeur: { lancee: true } });
  });

  it('🔴 un job qui n’a pas pu être enfilé efface sa demande : rien ne se dit en cours, la Free peut redemander', async () => {
    const f = monterEtiquettes({ offre: 'base' });
    await f.deps.magasin.regler(T, true);
    f.deps.enfiler = async () => { throw new Error('file en panne'); };
    await expect(synchroniserEtiquettes(f.deps, T)).rejects.toThrow('file en panne');
    expect(f.etat()).toMatchObject({ enCoursDepuis: null, demandeeLe: null });
    f.deps.enfiler = async () => undefined;
    expect(await synchroniserEtiquettes(f.deps, T)).toMatchObject({ ok: true, valeur: { lancee: true } });
  });

  it('les étiquettes lues, celles que portent le plus de fiches d’abord, regroupées sans la casse, cherchables', async () => {
    const f = monterEtiquettes({
      liensDeDepart: [
        { clientId: '1', contactId: A, etiquettes: ['VIP', 'Grossiste'] }, { clientId: '2', contactId: B, etiquettes: ['vip'] },
        { clientId: '3', contactId: C, etiquettes: ['Hiver'] },
        // Un second client de A qui porte aussi « VIP » : A ne compte qu'une fois.
        { clientId: '4', contactId: A, etiquettes: ['VIP'] },
      ],
    });
    const v = await lireEtiquettes(f.deps, T, undefined);
    expect(v.etiquettes).toEqual([{ etiquette: 'VIP', fiches: 2 }, { etiquette: 'Grossiste', fiches: 1 }, { etiquette: 'Hiver', fiches: 1 }]);
    expect((await lireEtiquettes(f.deps, T, 'hiv')).etiquettes.map((e) => e.etiquette)).toEqual(['Hiver']);
    expect(v.synchro).toEqual({ allumee: false, synchroLe: null, enCours: false, refus: null, comptes: { clientsLus: 0, trouvesParTelephone: 0, sansFiche: 0, fichesEtiquetees: 0 } });
  });
});

describe('vueSynchro', () => {
  const base = {
    allumee: true, synchroLe: null, demandeeLe: null, enCoursDepuis: null, majLe: null, issue: null, issueLe: null, message: null,
    comptes: { clientsLus: 0, trouvesParTelephone: 0, sansFiche: 0, fichesEtiquetees: 0 }, tenue: false,
  };
  it('🔴 en cours tant qu’un job la tient ou qu’elle a progressé depuis moins d’un quart d’heure ; le refus ne se montre pas pendant', () => {
    const commencee = { ...base, enCoursDepuis: new Date(MIDI_ETIQUETTES - 60_000), majLe: new Date(MIDI_ETIQUETTES - 60_000), issue: 'refusee' as const, message: 'm' };
    expect(vueSynchro(commencee, MIDI_ETIQUETTES)).toMatchObject({ enCours: true, refus: null });
    const perdue = { ...commencee, majLe: new Date(MIDI_ETIQUETTES - SYNCHRO_PERIMEE_MINUTES * 60_000 - 1) };
    expect(vueSynchro(perdue, MIDI_ETIQUETTES)).toMatchObject({ enCours: false, refus: { code: 'refusee', message: 'm' } });
    expect(vueSynchro({ ...perdue, tenue: true }, MIDI_ETIQUETTES).enCours).toBe(true);
    expect(vueSynchro(null, MIDI_ETIQUETTES)).toMatchObject({ allumee: false, synchroLe: null, enCours: false, refus: null });
  });
});

describe('la relecture quotidienne', () => {
  it('🔴 seulement les espaces ALLUMÉS en Pro et au-dessus, boutique branchée, dernière demande de plus de 24 h', async () => {
    const pro = monterEtiquettes({ offre: 'pro' });
    await reglerEtiquettes(pro.deps, T, true);
    await traiterEtiquettes(pro.deps, JOB);
    expect(await relancerEtiquettesDues(pro.deps)).toBe(0);
    pro.horloge.t += RELECTURE_HEURES * 3_600_000 + 1;
    expect(await relancerEtiquettesDues(pro.deps)).toBe(1);
    expect(pro.trace.jobs.at(-1)).toEqual({ job: JOB, dansSecondes: 0 });
    // Une fois relancée, plus rien avant 24 h de plus.
    expect(await relancerEtiquettesDues(pro.deps)).toBe(0);

    for (const o of [{ offre: 'base' as const }, { offre: 'pro' as const, boutique: { ...BOUTIQUE_ETIQUETTES, etat: 'coupee' } }]) {
      const f = monterEtiquettes(o);
      await f.deps.magasin.regler(T, true);
      f.horloge.t += RELECTURE_HEURES * 3_600_000 + 1;
      expect(await relancerEtiquettesDues(f.deps)).toBe(0);
    }
    const eteinte = monterEtiquettes({ offre: 'pro', etat: { allumee: false } });
    eteinte.horloge.t += RELECTURE_HEURES * 3_600_000 + 1;
    expect(await relancerEtiquettesDues(eteinte.deps)).toBe(0);
  });

  it('un job qui n’a pas pu être enfilé efface sa demande : le passage suivant le reprend', async () => {
    const f = monterEtiquettes({ offre: 'pro', etat: { allumee: true } });
    f.deps.enfiler = async () => { throw new Error('file en panne'); };
    expect(await relancerEtiquettesDues(f.deps)).toBe(0);
    expect(f.etat()).toMatchObject({ enCoursDepuis: null, demandeeLe: null });
    f.deps.enfiler = async () => undefined;
    expect(await relancerEtiquettesDues(f.deps)).toBe(1);
  });
});

describe('cablerEtiquettes', () => {
  it('🔴 le magasin passe ENTIER : ses méthodes lisent `this`', async () => {
    class Magasin {
      readonly appels: string[] = [];
      private readonly espace = 'lu par this';
      async etat() { this.appels.push(this.espace); return null; }
      async etiquettes() { this.appels.push(this.espace); return []; }
    }
    const m = new Magasin();
    const deps = cablerEtiquettes({
      magasin: m as unknown as MagasinEtiquettes,
      boutiques: { acces: async () => null, lire: async () => null } as never,
      offre: async () => 'pro',
      enfiler: async () => undefined,
    });
    await lireEtiquettes(deps, T, undefined);
    expect(m.appels).toEqual(['lu par this', 'lu par this']);
  });
});

describe('les étiquettes utiles d’un client', () => {
  it('🔴 sans espaces de bord, dédupliquées, jamais tronquées : au-delà de 255 caractères, écartées et comptées', () => {
    const longue = 'é'.repeat(256);
    expect(etiquettesUtiles([' VIP ', 'VIP', '', '   ', 'Grossiste', longue, 42, 'a\u0000b', 'x\uD83D'])).toEqual({
      etiquettes: ['VIP', 'Grossiste', 'ab', 'x�'], ecartees: 2,
    });
    // 255 caractères en points de code passent, même quand l'UTF-16 en compte plus.
    const emoji = '😀'.repeat(255);
    expect(etiquettesUtiles([emoji]).etiquettes).toEqual([emoji]);
    expect(etiquettesUtiles(Array.from({ length: ETIQUETTES_PAR_CLIENT + 3 }, (_, i) => `e${i}`))).toMatchObject({ ecartees: 3 });
  });
});

describe('la lecture GraphQL des clients', () => {
  const ACCES = { domaine: 'b.myshopify.com', jeton: 'shpat_x' };
  /** Un faux `fetch` qui rend les corps donnés, dans l'ordre, et garde les requêtes. */
  const faux = (...corps: Array<{ statut?: number; json: unknown }>) => {
    const requetes: Array<{ url: string; corps: { query: string; variables: Record<string, unknown> } }> = [];
    const appeler = (async (url: string, init: { body: string }) => {
      requetes.push({ url, corps: JSON.parse(init.body) });
      const c = corps.shift() ?? corps[corps.length - 1] ?? { json: {} };
      return new Response(JSON.stringify(c.json), { status: c.statut ?? 200 });
    }) as unknown as typeof fetch;
    return { appeler, requetes };
  };
  const noeuds = (nodes: unknown[]) => ({ json: { data: { nodes }, extensions: { cost: { requestedQueryCost: 3, actualQueryCost: 2 } } } });

  it('🔴 les GID des clients, la version d’API ; un nœud nul est un client disparu ; un nœud illisible est laissé tel quel', async () => {
    const f = faux(noeuds([{ legacyResourceId: '1001', tags: ['VIP', ' VIP'] }, null, { legacyResourceId: '9999', tags: [] }]));
    const r = await lireClientsParIds(ACCES, { ids: ['1001', '1002', '1003'], delaiMs: 20_000 }, f.appeler);
    expect(f.requetes[0]!.url).toBe(`https://b.myshopify.com/admin/api/${API_VERSION_SHOPIFY}/graphql.json`);
    expect(f.requetes[0]!.corps.variables.ids).toEqual(['gid://shopify/Customer/1001', 'gid://shopify/Customer/1002', 'gid://shopify/Customer/1003']);
    expect(f.requetes[0]!.corps.query).toContain('... on Customer { legacyResourceId tags }');
    expect(r).toEqual({
      ok: true, illisibles: 1, cout: { demande: 3, reel: 2 },
      clients: [{ clientId: '1001', etiquettes: ['VIP'] }, { clientId: '1002', etiquettes: null }],
    });
  });

  it('🔴 une réponse qui n’a pas un nœud par client demandé ne s’écrit pas ; une erreur non plus ; plus de 250 ou un identifiant illisible : refusé avant l’appel', async () => {
    expect(await lireClientsParIds(ACCES, { ids: ['1', '2'], delaiMs: 20_000 }, faux(noeuds([null])).appeler)).toMatchObject({ ok: false, code: 'passager' });
    const erreur = faux({ json: { data: { nodes: [null] }, errors: [{ message: 'Access denied for tags field', extensions: { code: 'ACCESS_DENIED' } }] } });
    expect(await lireClientsParIds(ACCES, { ids: ['1'], delaiMs: 20_000 }, erreur.appeler)).toMatchObject({ ok: false, code: 'acces_refuse' });
    const rien = faux(noeuds([]));
    expect(await lireClientsParIds(ACCES, { ids: Array.from({ length: CLIENTS_PAR_LOT + 1 }, (_, i) => String(i + 1)), delaiMs: 20_000 }, rien.appeler)).toMatchObject({ ok: false });
    expect(await lireClientsParIds(ACCES, { ids: ['1', 'abc'], delaiMs: 20_000 }, rien.appeler)).toMatchObject({ ok: false });
    expect(rien.requetes).toEqual([]);
  });

  it('un 401 est un refus ; un 5xx, un coût dépassé ou un corps trop gros : trop lourd', async () => {
    expect(await lireClientsParIds(ACCES, { ids: ['1'], delaiMs: 20_000 }, faux({ statut: 401, json: {} }).appeler)).toMatchObject({ code: 'acces_refuse' });
    expect(await lireClientsParIds(ACCES, { ids: ['1'], delaiMs: 20_000 }, faux({ statut: 502, json: {} }).appeler)).toMatchObject({ code: 'trop_lourd' });
    expect(await lireClientsParIds(ACCES, { ids: ['1'], delaiMs: 20_000 }, faux({ json: { errors: [{ message: 'x', extensions: { code: 'MAX_COST_EXCEEDED' } }] } }).appeler))
      .toMatchObject({ code: 'trop_lourd' });
  });

  it('🔴 le frein de Shopify attend la recharge du seau, dans le délai de l’appel', async () => {
    const attentes: number[] = [];
    const f = faux(
      { json: { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }], extensions: { cost: { requestedQueryCost: 251, throttleStatus: { currentlyAvailable: 51, restoreRate: 100 } } } } },
      noeuds([null]),
    );
    let t = 0;
    const r = await lireClientsParIds(ACCES, { ids: ['1'], delaiMs: 20_000 }, f.appeler, async (ms) => { attentes.push(ms); t += ms; }, () => t);
    expect(attentes).toEqual([2000]);
    expect(r).toMatchObject({ ok: true, clients: [{ clientId: '1', etiquettes: null }] });
    const lent = faux({ json: { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }], extensions: { cost: { requestedQueryCost: 900, throttleStatus: { currentlyAvailable: 0, restoreRate: 10 } } } } });
    expect(await lireClientsParIds(ACCES, { ids: ['1'], delaiMs: 20_000 }, lent.appeler, async () => undefined, () => 0)).toMatchObject({ ok: false, code: 'passager' });
  });

  it('🔴 la recherche par téléphones : le filtre phone:, dix clients au moins, chaque client REVÉRIFIÉ sur ses numéros', async () => {
    const f = faux({
      json: {
        data: {
          customers: {
            pageInfo: { hasNextPage: false },
            nodes: [
              // Un téléphone saisi à la française, normalisé au pays de la boutique : il désigne bien +33600000001.
              { legacyResourceId: '1001', tags: ['VIP'], defaultPhoneNumber: { phoneNumber: '06 00 00 00 01' } },
              // Un client rendu par un filtre trop large : son téléphone n'est pas demandé, il est écarté.
              { legacyResourceId: '1009', tags: ['Autre'], defaultPhoneNumber: { phoneNumber: '+33699999999' } },
              { legacyResourceId: '1008', tags: ['Sans téléphone'], defaultPhoneNumber: null },
            ],
          },
        },
      },
    });
    const r = await chercherParTelephones(ACCES, { telephones: [tel(1), tel(2)], pays: 'FR', delaiMs: 20_000 }, f.appeler);
    expect(f.requetes[0]!.corps.variables).toEqual({ q: `phone:${tel(1)} OR phone:${tel(2)}`, n: 10 });
    expect(f.requetes[0]!.corps.query).toContain('defaultPhoneNumber { phoneNumber }');
    expect(f.requetes[0]!.corps.query).toContain(`addressesV2(first: ${ADRESSES_PAR_CLIENT}) { nodes { phone countryCodeV2 } }`);
    // La dernière commande n'est pas lue : elle n'apporte aucun numéro que les adresses n'ont pas (mesuré), et demanderait read_orders.
    expect(f.requetes[0]!.corps.query).not.toContain('lastOrder');
    expect(r).toMatchObject({ ok: true, complete: true, trouves: [{ telephone: tel(1), clientId: '1001', etiquettes: ['VIP'] }] });
  });

  it('🔴 tous les numéros d’un client : ses coordonnées et chacune de ses adresses, au pays de L’ADRESSE', async () => {
    const f = faux({
      json: {
        data: {
          customers: {
            pageInfo: { hasNextPage: false },
            nodes: [
              // Une boutique aux États-Unis, un numéro français saisi à la française sur une adresse en France.
              { legacyResourceId: '2001', tags: ['Adresse'], defaultPhoneNumber: null,
                addressesV2: { nodes: [{ phone: null, countryCodeV2: 'US' }, { phone: '06 00 00 00 01', countryCodeV2: 'FR' }] } },
              // Deux adresses, deux numéros : le client se relie aux deux.
              { legacyResourceId: '2002', tags: ['Deux'], defaultPhoneNumber: null,
                addressesV2: { nodes: [{ phone: tel(2), countryCodeV2: 'FR' }, { phone: '0600000003', countryCodeV2: 'FR' }] } },
              // Une adresse illisible ne fait pas perdre le client : ses coordonnées le relient encore.
              { legacyResourceId: '2004', tags: [], defaultPhoneNumber: { phoneNumber: tel(4) }, addressesV2: { nodes: 'illisible' } },
            ],
          },
        },
      },
    });
    const r = await chercherParTelephones(ACCES, { telephones: [tel(1), tel(2), tel(3), tel(4)], pays: 'US', delaiMs: 20_000 }, f.appeler);
    expect(r).toMatchObject({ ok: true, complete: true });
    expect(r.ok ? r.trouves.map((t) => [t.telephone, t.clientId]) : []).toEqual([
      [tel(1), '2001'], [tel(2), '2002'], [tel(3), '2002'], [tel(4), '2004'],
    ]);
    // La borne du coût, dérivée des constantes : Shopify refuse une requête de plus de 1 000 points.
    expect(2 + CLIENTS_PAR_RECHERCHE * COUT_PAR_CLIENT).toBeLessThanOrEqual(1000);
  });

  it('🔴 un client illisible rend la page INCOMPLÈTE : elle ne défera aucun lien ; les clients lisibles sont rendus', async () => {
    const f = faux({
      json: {
        data: {
          customers: {
            pageInfo: { hasNextPage: false },
            nodes: [
              { legacyResourceId: 'pas-un-nombre', tags: [] },
              { legacyResourceId: '1001', tags: ['VIP'], defaultPhoneNumber: { phoneNumber: tel(1) }, addressesV2: { nodes: [] } },
            ],
          },
        },
      },
    });
    expect(await chercherParTelephones(ACCES, { telephones: [tel(1)], pays: 'FR', delaiMs: 20_000 }, f.appeler)).toMatchObject({
      ok: true, complete: false, trouves: [{ telephone: tel(1), clientId: '1001', etiquettes: ['VIP'] }],
    });
  });

  it('🔴 deux clients au même téléphone sont rendus tous les deux ; une page qui continue n’est pas complète ; aucun téléphone E.164, aucun appel', async () => {
    const f = faux({
      json: {
        data: {
          customers: {
            pageInfo: { hasNextPage: true },
            nodes: [
              { legacyResourceId: '1001', tags: [], defaultPhoneNumber: { phoneNumber: tel(1) } },
              { legacyResourceId: '1002', tags: [], defaultPhoneNumber: { phoneNumber: tel(1) } },
            ],
          },
        },
      },
    });
    expect(await chercherParTelephones(ACCES, { telephones: [tel(1)], pays: 'FR', delaiMs: 20_000 }, f.appeler)).toMatchObject({
      ok: true, complete: false, trouves: [{ telephone: tel(1), clientId: '1001' }, { telephone: tel(1), clientId: '1002' }],
    });
    const rien = faux({ json: {} });
    expect(await chercherParTelephones(ACCES, { telephones: ['anon:1', '0600000001'], pays: 'FR', delaiMs: 20_000 }, rien.appeler)).toMatchObject({ ok: true, trouves: [], complete: true });
    expect(rien.requetes).toEqual([]);
    const trop = faux({ json: {} });
    expect(await chercherParTelephones(ACCES, { telephones: Array.from({ length: TELEPHONES_PAR_RECHERCHE + 1 }, (_, i) => tel(i)), pays: 'FR', delaiMs: 20_000 }, trop.appeler))
      .toMatchObject({ ok: false });
  });
});
