import { describe, it, expect } from 'vitest';
import {
  AUCUNE_BOUTIQUE_ETIQUETTES, BOUTIQUE_COUPEE_ETIQUETTES, PASSAGE_ETIQUETTES_MS, REQUETE_ASYNCHRONE_ATTENTE_S, REQUETE_ASYNCHRONE_MAX_MS, SYNCHRO_ETEINTE, lireSegments,
  suivreSegmentsShopify, traiterEtiquettes,
} from '../src/shopify/etiquettes';
import {
  MEMBRES_PAR_PAGE, NOM_SEGMENT_MAX, SEGMENTS_PAR_LISTE, creerRequeteAsynchrone, lirePageMembres, listerSegments, suivreRequeteAsynchrone,
} from '../src/shopify/segments-lues';
import { BORNES_SEGMENTS } from '../web/lib/partage/segments';
import { BOUTIQUE_ETIQUETTES, DROITS_ETIQUETTES, MIDI_ETIQUETTES, T_ETIQUETTES as T, monterEtiquettes } from './etiquettes-faux';

/**
 * LES SEGMENTS NATIFS DE SHOPIFY (segments Shopify enrichis, lot 6c) : le troisième temps de la synchronisation sur un faux
 * Shopify (la liste relue à chaque passage, les segments SUIVIS lus page par page, leurs membres rattachés aux fiches par les
 * liens de tous les numéros, les appartenances remplacées à la dernière page et jamais avant, la requête asynchrone et sa
 * borne, le segment disparu), le choix des segments suivis, leur vue, et les quatre lectures GraphQL sur un faux `fetch`. Le
 * vrai magasin est éprouvé sur PGlite (`tests/integration/shopify-etiquettes.integration.test.ts`).
 */
const JOB = { tenantId: T };
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'aaaaaaaa-0000-4000-8000-000000000002';
const C = 'aaaaaaaa-0000-4000-8000-000000000003';
const tel = (n: number): string => `+3360000${String(n).padStart(4, '0')}`;
const HEURE = 3_600_000;

/** Trois fiches (C supprimée), trois clients Shopify à leurs numéros, un client sans fiche (9999). */
const BASE = {
  fiches: { [A]: { telephone: tel(1), active: true }, [B]: { telephone: tel(2), active: true }, [C]: { telephone: tel(3), active: false } },
  boutiqueClients: {
    1001: { telephone: tel(1), tags: [] }, 1002: { telephone: tel(2), tags: [] }, 1003: { telephone: tel(3), tags: [] }, 9999: { telephone: tel(9), tags: [] },
  },
};

/** Allume et lance une synchronisation, comme la carte ; l'horloge avance d'abord, comme `now()` entre deux synchronisations. */
async function synchroniser(f: ReturnType<typeof monterEtiquettes>): Promise<void> {
  f.horloge.t += HEURE;
  await f.deps.magasin.regler(T, true);
  expect(await f.deps.magasin.demander(T, { auPlusUneFoisParJour: false })).toBeInstanceOf(Date);
  await traiterEtiquettes(f.deps, JOB);
}

describe('le troisième temps : les segments suivis', () => {
  it('🔴 la liste est lue ; seul un segment SUIVI est lu, page par page ; ses membres entrent par les liens, fiches actives seules ; la synchronisation aboutit après lui', async () => {
    const f = monterEtiquettes({
      ...BASE, membresParPage: 2,
      boutiqueSegments: { 11: { nom: 'VIP', requete: 'number_of_orders >= 3', membres: ['1001', '1002', '1003', '9999'] }, 12: { nom: 'Autre', membres: ['1001'] } },
    });
    await synchroniser(f);
    expect(f.trace.listes).toBe(1);
    expect(f.trace.pages).toEqual([]);
    expect((await f.deps.magasin.segments(T)).map((s) => [s.segmentId, s.suivi])).toEqual([['12', false], ['11', false]]);

    f.horloge.t += HEURE;
    expect(await suivreSegmentsShopify(f.deps, T, ['11'])).toMatchObject({ ok: true, valeur: { lancee: true } });
    await traiterEtiquettes(f.deps, JOB);
    expect(f.trace.pages).toEqual([{ segmentId: '11', requete: null, apres: null }, { segmentId: '11', requete: null, apres: '2' }]);
    // Le client 1003 n'a qu'une fiche supprimée, 9999 aucune : ils comptent parmi les membres, sans fiche.
    expect(f.membresDe('11')).toEqual([A, B]);
    expect(f.membresDe('12')).toEqual([]);
    const vip = (await f.deps.magasin.segments(T)).find((s) => s.segmentId === '11');
    expect(vip).toMatchObject({ nom: 'VIP', requete: 'number_of_orders >= 3', suivi: true, absent: false, partiel: false, membres: 4, fiches: 2 });
    expect(vip?.luLe).toBe(new Date(f.horloge.t).toISOString());
    expect(f.trace.issues.at(-1)).toEqual({ issue: 'lue', message: null });
  });

  it('🔴 un client relié par un autre de ses numéros fait entrer cette fiche aussi (le max de numéros)', async () => {
    const f = monterEtiquettes({
      fiches: { [A]: { telephone: tel(1), active: true }, [B]: { telephone: tel(2), active: true } },
      boutiqueClients: { 1001: { telephone: tel(1), tags: [], numeros: [tel(2)] } },
      boutiqueSegments: { 11: { nom: 'VIP', membres: ['1001'] } },
    });
    await synchroniser(f);
    await suivreSegmentsShopify(f.deps, T, ['11']);
    await traiterEtiquettes(f.deps, JOB);
    expect(f.membresDe('11')).toEqual([A, B]);
  });

  it('🔴 la dernière page REMPLACE les appartenances : une fiche sortie du segment chez Shopify en sort ; une lecture inachevée ne rétrécit rien', async () => {
    const depart = { segmentId: '11', nom: 'VIP', suivi: true, luLe: MIDI_ETIQUETTES - 24 * HEURE, membres: 2, fiches: 2, fichesMembres: [A, B] };
    const f = monterEtiquettes({
      ...BASE, membresParPage: 1, segmentsDeDepart: [depart],
      boutiqueSegments: { 11: { nom: 'VIP', membres: ['1001', '1003'] } },
      // La première page passe, la seconde tombe en panne : le passage remonte, rien n'est encore retiré.
      echecsMembres: [null, { ok: false, code: 'passager', message: 'Shopify n’a pas répondu' }],
    });
    f.horloge.t += HEURE;
    await f.deps.magasin.regler(T, true);
    await f.deps.magasin.demander(T, { auPlusUneFoisParJour: false });
    await expect(traiterEtiquettes(f.deps, JOB)).rejects.toThrow('Shopify n’a pas répondu');
    expect(f.membresDe('11')).toEqual([A, B]);
    expect(f.etat()).toMatchObject({ jeton: null, bail: null });
    // Le passage rejoué reprend à la page suivante, et la dernière page retire B.
    await traiterEtiquettes(f.deps, JOB);
    expect(f.trace.pages.map((p) => p.apres)).toEqual([null, '1', '1']);
    expect(f.membresDe('11')).toEqual([A]);
    expect((await f.deps.magasin.segments(T))[0]).toMatchObject({ membres: 2, fiches: 1, partiel: false });
  });

  it('🔴 un accès refusé en pleine lecture : le segment est laissé de côté, partiel, ses membres d’avant restent ; les étiquettes et le segment suivant aboutissent', async () => {
    const f = monterEtiquettes({
      ...BASE, membresParPage: 1,
      segmentsDeDepart: [
        { segmentId: '11', nom: 'VIP', suivi: true, luLe: MIDI_ETIQUETTES - 24 * HEURE, membres: 2, fiches: 2, fichesMembres: [A, B] },
        { segmentId: '12', nom: 'Hiver', suivi: true },
      ],
      boutiqueSegments: { 11: { nom: 'VIP', membres: ['1001', '1003'] }, 12: { nom: 'Hiver', membres: ['1002'] } },
      echecsMembres: [null, { ok: false, code: 'acces_refuse', message: 'Access denied for customerSegmentMembers field' }],
    });
    await synchroniser(f);
    expect(f.trace.issues).toEqual([{ issue: 'lue', message: null }]);
    expect(f.etat()?.synchroLe).toEqual(new Date(f.horloge.t));
    expect(f.membresDe('12')).toEqual([B]);
    expect(f.membresDe('11')).toEqual([A, B]);
    expect((await f.deps.magasin.segments(T)).find((x) => x.segmentId === '11')).toMatchObject({ partiel: true, membres: 2, fiches: 2, luLe: new Date(MIDI_ETIQUETTES - 24 * HEURE).toISOString() });
  });

  it('🔴 un segment lu à la synchronisation précédente est relu ; une lecture commencée par une synchronisation morte repart de zéro', async () => {
    const f = monterEtiquettes({
      ...BASE,
      segmentsDeDepart: [{ segmentId: '11', nom: 'VIP', suivi: true, luLe: MIDI_ETIQUETTES - 24 * HEURE, lectureDebut: MIDI_ETIQUETTES - 2 * HEURE, curseur: '1', lectureMembres: 1 }],
      boutiqueSegments: { 11: { nom: 'VIP', membres: ['1001'] } },
    });
    await synchroniser(f);
    expect(f.trace.pages).toEqual([{ segmentId: '11', requete: null, apres: null }]);
    expect((await f.deps.magasin.segments(T))[0]).toMatchObject({ membres: 1, fiches: 1 });
  });

  it('🔴 un segment lourd passe par la requête asynchrone : créée, suivie ; pas prête, le passage rend son bail et se réenfile ; prête, lue par son identifiant', async () => {
    const f = monterEtiquettes({ ...BASE, boutiqueSegments: { 11: { nom: 'VIP', membres: ['1001'], asynchrone: true, pretApres: 2 } } });
    await synchroniser(f);
    await suivreSegmentsShopify(f.deps, T, ['11']);
    const jobs = f.trace.jobs.length;
    await traiterEtiquettes(f.deps, JOB);
    expect(f.trace.requetesCreees).toEqual(['11']);
    expect(f.trace.jobs.slice(jobs)).toEqual([{ job: JOB, dansSecondes: REQUETE_ASYNCHRONE_ATTENTE_S }]);
    expect(f.etat()).toMatchObject({ jeton: null, bail: null });
    expect(f.membresDe('11')).toEqual([]);
    await traiterEtiquettes(f.deps, JOB);
    const q = 'gid://shopify/CustomerSegmentMembersQuery/1';
    expect(f.trace.suivis).toEqual([q, q]);
    expect(f.trace.pages).toEqual([{ segmentId: '11', requete: null, apres: null }, { segmentId: '11', requete: q, apres: null }]);
    expect(f.membresDe('11')).toEqual([A]);
    expect(f.trace.issues.at(-1)).toEqual({ issue: 'lue', message: null });
  });

  it('🔴 une requête jamais prête : au-delà de la borne, le segment est laissé de côté sans appel, partiel, ses membres d’avant restent ; le suivant est lu, la synchronisation aboutit', async () => {
    const f = monterEtiquettes({
      ...BASE,
      segmentsDeDepart: [
        { segmentId: '11', nom: 'VIP', suivi: true, luLe: MIDI_ETIQUETTES - 24 * HEURE, fiches: 1, fichesMembres: [B] },
        { segmentId: '12', nom: 'Hiver', suivi: true },
      ],
      boutiqueSegments: { 11: { nom: 'VIP', membres: ['1001'], asynchrone: true, pretApres: 1_000 }, 12: { nom: 'Hiver', membres: ['1001'] } },
    });
    await synchroniser(f);
    expect(f.trace.jobs.at(-1)).toEqual({ job: JOB, dansSecondes: REQUETE_ASYNCHRONE_ATTENTE_S });
    f.horloge.t += REQUETE_ASYNCHRONE_MAX_MS - 1;
    await traiterEtiquettes(f.deps, JOB);
    expect(f.trace.issues).toEqual([]);
    const suivis = f.trace.suivis.length;
    f.horloge.t += 1;
    await traiterEtiquettes(f.deps, JOB);
    expect(f.trace.suivis).toHaveLength(suivis);
    expect(f.trace.requetesCreees).toEqual(['11']);
    expect(f.trace.issues).toEqual([{ issue: 'lue', message: null }]);
    expect(f.membresDe('12')).toEqual([A]);
    expect(f.membresDe('11')).toEqual([B]);
    expect((await f.deps.magasin.segments(T)).find((x) => x.segmentId === '11')).toMatchObject({ partiel: true, fiches: 1 });
  });

  it('une requête que Shopify ne connaît plus est oubliée, recréée au passage suivant, puis lue', async () => {
    const f = monterEtiquettes({
      ...BASE, boutiqueSegments: { 11: { nom: 'VIP', membres: ['1001'], asynchrone: true, pretApres: 1 } },
      echecsSuivis: [{ ok: true, etat: 'perdue' }],
    });
    await synchroniser(f);
    await suivreSegmentsShopify(f.deps, T, ['11']);
    await traiterEtiquettes(f.deps, JOB);
    expect(f.trace.jobs.at(-1)).toEqual({ job: JOB, dansSecondes: REQUETE_ASYNCHRONE_ATTENTE_S });
    expect(f.segs.get('11')).toMatchObject({ requeteAsynchrone: null });
    await traiterEtiquettes(f.deps, JOB);
    expect(f.trace.requetesCreees).toEqual(['11', '11']);
    expect(f.membresDe('11')).toEqual([A]);
  });

  it('🔴 un segment disparu d’une liste COMPLÈTE : marqué absent, ses membres partent, il n’est plus lu ; une liste incomplète ne fait disparaître personne', async () => {
    const depart = [{ segmentId: '11', nom: 'VIP', suivi: true, luLe: MIDI_ETIQUETTES - 24 * HEURE, fiches: 1, fichesMembres: [A] }];
    const incomplete = monterEtiquettes({
      ...BASE, segmentsDeDepart: depart, boutiqueSegments: { 11: { nom: 'VIP', membres: ['1001'] } },
      echecsListe: [{ ok: true, segments: [], complete: false, cout: { demande: 13, reel: 3 } }],
    });
    await synchroniser(incomplete);
    expect(incomplete.segs.get('11')).toMatchObject({ absentLe: null });
    expect(incomplete.trace.pages).toHaveLength(1);

    const f = monterEtiquettes({ ...BASE, segmentsDeDepart: depart, boutiqueSegments: {} });
    await synchroniser(f);
    expect(f.segs.get('11')).toMatchObject({ absentLe: f.horloge.t, suivi: true, luLe: null, fiches: 0 });
    expect(f.membresDe('11')).toEqual([]);
    expect(f.trace.pages).toEqual([]);
    expect(f.trace.issues).toEqual([{ issue: 'lue', message: null }]);
    expect((await lireSegments(f.deps, T)).segments[0]).toMatchObject({ segmentId: '11', absent: true });
  });

  it('🔴 la liste refusée ne touche pas les étiquettes : lues, la synchronisation aboutit sans lire un segment ; en panne, le passage remonte et rend son bail', async () => {
    const refus = monterEtiquettes({
      ...BASE, segmentsDeDepart: [{ segmentId: '11', nom: 'VIP', suivi: true }], boutiqueSegments: { 11: { nom: 'VIP', membres: ['1001'] } },
      echecsListe: [{ ok: false, code: 'acces_refuse', message: 'Access denied for segments field' }],
    });
    await synchroniser(refus);
    expect(refus.trace.issues).toEqual([{ issue: 'lue', message: null }]);
    expect(refus.trace.recherches).toHaveLength(1);
    expect(refus.liens.size).toBeGreaterThan(0);
    expect(refus.trace.pages).toEqual([]);

    const panne = monterEtiquettes({ ...BASE, echecsListe: [{ ok: false, code: 'passager', message: 'Shopify absent' }] });
    panne.horloge.t += HEURE;
    await panne.deps.magasin.regler(T, true);
    await panne.deps.magasin.demander(T, { auPlusUneFoisParJour: false });
    await expect(traiterEtiquettes(panne.deps, JOB)).rejects.toThrow('Shopify absent');
    expect(panne.etat()).toMatchObject({ jeton: null, bail: null });
  });
});

describe('le troisième temps : les réponses inattendues', () => {
  it('« pas prête » sans requête asynchrone est une panne : le passage remonte et rend son bail', async () => {
    const f = monterEtiquettes({
      ...BASE, segmentsDeDepart: [{ segmentId: '11', nom: 'VIP', suivi: true }], boutiqueSegments: { 11: { nom: 'VIP', membres: ['1001'] } },
      echecsMembres: [{ ok: false, code: 'pas_fini', message: 'La requête asynchrone de Shopify n’est pas encore prête.' }],
    });
    f.horloge.t += HEURE;
    await f.deps.magasin.regler(T, true);
    await f.deps.magasin.demander(T, { auPlusUneFoisParJour: false });
    await expect(traiterEtiquettes(f.deps, JOB)).rejects.toThrow('pas encore prête');
    expect(f.etat()).toMatchObject({ jeton: null, bail: null });
  });

  it('🔴 une page dont la lecture a bougé entre-temps ne s’écrit pas', async () => {
    const f = monterEtiquettes({
      ...BASE, liensDeDepart: [{ clientId: '1001', contactId: A }], segmentsDeDepart: [{ segmentId: '11', nom: 'VIP', suivi: true, curseur: '5', lectureDebut: MIDI_ETIQUETTES }],
    });
    await f.deps.magasin.regler(T, true);
    await f.deps.magasin.demander(T, { auPlusUneFoisParJour: false });
    const { jeton } = (await f.deps.magasin.prendre(T))!;
    expect(await f.deps.magasin.ecrirePageSegment(T, jeton, '11', { apres: null, clients: ['1001'], suivant: null })).toBe(true);
    expect(f.membresDe('11')).toEqual([]);
    expect(f.segs.get('11')).toMatchObject({ curseur: '5', luLe: null });
  });
});

describe('le choix des segments suivis', () => {
  const connus = (n: number) => Array.from({ length: n }, (_, i) => ({ segmentId: String(100 + i), nom: `S${i}` }));

  it('🔴 refusé sans boutique, coupée, éteinte, au-delà de 20, ou pour un segment inconnu ou disparu : rien ne change', async () => {
    for (const boutique of [null, { ...BOUTIQUE_ETIQUETTES, etat: 'coupee' }]) {
      const f = monterEtiquettes({ boutique, segmentsDeDepart: connus(1), etat: { allumee: true } });
      expect(await suivreSegmentsShopify(f.deps, T, ['100'])).toEqual({ ok: false, statut: 409, message: boutique === null ? AUCUNE_BOUTIQUE_ETIQUETTES : BOUTIQUE_COUPEE_ETIQUETTES });
    }
    const eteinte = monterEtiquettes({ segmentsDeDepart: connus(1), etat: { allumee: false } });
    expect(await suivreSegmentsShopify(eteinte.deps, T, ['100'])).toEqual({ ok: false, statut: 409, message: SYNCHRO_ETEINTE });
    expect(eteinte.segs.get('100')).toMatchObject({ suivi: false });

    const f = monterEtiquettes({ segmentsDeDepart: [...connus(25), { segmentId: '999', nom: 'Parti', absentLe: MIDI_ETIQUETTES }], etat: { allumee: true } });
    const trop = await suivreSegmentsShopify(f.deps, T, connus(BORNES_SEGMENTS.segmentsShopifyMax + 1).map((s) => s.segmentId));
    expect(trop).toMatchObject({ ok: false, statut: 409 });
    expect(trop.ok ? '' : trop.message).toContain('20 segments suivis au plus');
    const inconnu = await suivreSegmentsShopify(f.deps, T, ['100', '555', '999']);
    expect(inconnu.ok ? '' : inconnu.message).toContain('555, 999');
    expect([...f.segs.values()].some((s) => s.suivi)).toBe(false);
    expect(f.trace.jobs).toEqual([]);
  });

  it('🔴 exactement ces segments : un segment quitté perd ses membres et sa lecture ; un choix vide arrête tout sans lancer de synchronisation', async () => {
    const f = monterEtiquettes({
      segmentsDeDepart: [
        { segmentId: '11', nom: 'VIP', suivi: true, luLe: MIDI_ETIQUETTES, membres: 3, fiches: 1, fichesMembres: [A] },
        { segmentId: '12', nom: 'Hiver' },
      ],
      etat: { allumee: true },
    });
    // Les doublons comptent une fois ; le choix lance une synchronisation pour lire le nouveau.
    expect(await suivreSegmentsShopify(f.deps, T, ['12', '12'])).toMatchObject({ ok: true, valeur: { lancee: true } });
    expect(f.segs.get('11')).toMatchObject({ suivi: false, luLe: null, membres: 0, fiches: 0 });
    expect(f.membresDe('11')).toEqual([]);
    expect(f.segs.get('12')).toMatchObject({ suivi: true });
    expect(f.trace.jobs).toHaveLength(1);

    const vide = await suivreSegmentsShopify(f.deps, T, []);
    expect(vide).toMatchObject({ ok: true, valeur: { lancee: false } });
    expect([...f.segs.values()].some((s) => s.suivi)).toBe(false);
    expect(f.trace.jobs).toHaveLength(1);
  });

  it('🔴 la Free qui attend sa prochaine lecture garde le choix : rien n’est lancé, la prochaine synchronisation les lit', async () => {
    const f = monterEtiquettes({
      offre: 'base', segmentsDeDepart: [{ segmentId: '11', nom: 'VIP' }], etat: { allumee: true, demandeeLe: new Date(MIDI_ETIQUETTES - HEURE) },
    });
    expect(await suivreSegmentsShopify(f.deps, T, ['11'])).toMatchObject({ ok: true, valeur: { lancee: false, enCours: false } });
    expect(f.segs.get('11')).toMatchObject({ suivi: true });
    expect(f.trace.jobs).toEqual([]);
  });

  it('la vue : les suivis d’abord, puis par nom, les disparus à la fin ; une lecture en cours se dit partielle', async () => {
    const f = monterEtiquettes({
      segmentsDeDepart: [
        { segmentId: '1', nom: 'zèbre' }, { segmentId: '2', nom: 'Abeille' }, { segmentId: '3', nom: 'Moyen', suivi: true, lectureDebut: MIDI_ETIQUETTES },
        { segmentId: '4', nom: 'Ancien', absentLe: MIDI_ETIQUETTES },
      ],
    });
    const v = await lireSegments(f.deps, T);
    expect(v.segments.map((s) => s.nom)).toEqual(['Moyen', 'Abeille', 'zèbre', 'Ancien']);
    expect(v.segments[0]).toMatchObject({ partiel: true, luLe: null });
    expect(v.synchro).toMatchObject({ allumee: false, enCours: false });
  });
});

describe('la lecture GraphQL des segments', () => {
  const ACCES = { domaine: 'b.myshopify.com', jeton: 'shpat_x' };
  const faux = (...corps: Array<{ statut?: number; json: unknown }>) => {
    const requetes: Array<{ corps: { query: string; variables: Record<string, unknown> } }> = [];
    const appeler = (async (_url: string, init: { body: string }) => {
      requetes.push({ corps: JSON.parse(init.body) });
      const c = corps.shift() ?? { json: {} };
      return new Response(JSON.stringify(c.json), { status: c.statut ?? 200 });
    }) as unknown as typeof fetch;
    return { appeler, requetes };
  };
  const cout = { cost: { requestedQueryCost: 13, actualQueryCost: 3 } };
  const P = { delaiMs: 20_000 };

  it('🔴 la liste : 250 segments d’un appel, les numéros des GID, le nom coupé, un nœud illisible ou une suite rendent la liste INCOMPLÈTE', async () => {
    const long = 'n'.repeat(NOM_SEGMENT_MAX + 10);
    const f = faux({ json: { data: { segments: { pageInfo: { hasNextPage: false }, nodes: [
      { id: 'gid://shopify/Segment/11', name: ' VIP ', query: 'number_of_orders >= 3' }, { id: 'gid://shopify/Segment/12', name: long, query: null },
      { id: 'gid://shopify/Segment/13', name: '', query: '' },
    ] } }, extensions: cout } });
    const r = await listerSegments(ACCES, { ...P, appeler: f.appeler });
    expect(f.requetes[0]!.corps.variables).toEqual({ n: SEGMENTS_PAR_LISTE });
    expect(r).toEqual({
      ok: true, complete: true, cout: { demande: 13, reel: 3 },
      segments: [
        { segmentId: '11', nom: 'VIP', requete: 'number_of_orders >= 3' }, { segmentId: '12', nom: 'n'.repeat(NOM_SEGMENT_MAX), requete: null },
        { segmentId: '13', nom: '13', requete: null },
      ],
    });
    const illisible = faux({ json: { data: { segments: { pageInfo: { hasNextPage: false }, nodes: [{ id: 'gid://shopify/Segment/abc', name: 'x' }, { id: 'gid://shopify/Segment/14', name: 'y' }] } } } });
    expect(await listerSegments(ACCES, { ...P, appeler: illisible.appeler })).toMatchObject({ ok: true, complete: false, segments: [{ segmentId: '14' }] });
    const double = faux({ json: { data: { segments: { pageInfo: { hasNextPage: false }, nodes: [{ id: 'gid://shopify/Segment/14', name: 'y' }, { id: 'gid://shopify/Segment/14', name: 'z' }] } } } });
    expect(await listerSegments(ACCES, { ...P, appeler: double.appeler })).toMatchObject({ ok: true, complete: true, segments: [{ segmentId: '14', nom: 'y' }] });
    const suite = faux({ json: { data: { segments: { pageInfo: { hasNextPage: true }, nodes: [] } } } });
    expect(await listerSegments(ACCES, { ...P, appeler: suite.appeler })).toMatchObject({ ok: true, complete: false });
    expect(await listerSegments(ACCES, { ...P, appeler: faux({ json: { data: {} } }).appeler })).toMatchObject({ ok: false, code: 'passager' });
  });

  it('🔴 une page de membres : par le segment ou par sa requête, 1 000 d’un appel, les numéros des clients dédupliqués ; une suite sans curseur ne se lit pas', async () => {
    const page = (edges: unknown[], pageInfo: unknown) => ({ json: { data: { customerSegmentMembers: { pageInfo, edges } }, extensions: cout } });
    const f = faux(page([
      { node: { id: 'gid://shopify/CustomerSegmentMember/1001' } }, { node: { id: 'gid://shopify/CustomerSegmentMember/1001' } },
      { node: { id: 'gid://shopify/CustomerSegmentMember/x' } }, { node: { id: 'gid://shopify/CustomerSegmentMember/1002' } },
    ], { hasNextPage: true, endCursor: 'c1' }));
    expect(await lirePageMembres(ACCES, { ...P, segmentId: '11', requete: null, apres: null, appeler: f.appeler }))
      .toEqual({ ok: true, clients: ['1001', '1002'], suivant: 'c1', cout: { demande: 13, reel: 3 } });
    expect(f.requetes[0]!.corps.variables).toEqual({ segment: 'gid://shopify/Segment/11', n: MEMBRES_PAR_PAGE, apres: null });
    expect(f.requetes[0]!.corps.query).toContain('customerSegmentMembers(segmentId: $segment');

    const q = faux(page([], { hasNextPage: false, endCursor: null }));
    expect(await lirePageMembres(ACCES, { ...P, segmentId: '11', requete: 'gid://shopify/CustomerSegmentMembersQuery/7', apres: 'c1', appeler: q.appeler }))
      .toMatchObject({ ok: true, clients: [], suivant: null });
    expect(q.requetes[0]!.corps.variables).toEqual({ requete: 'gid://shopify/CustomerSegmentMembersQuery/7', n: MEMBRES_PAR_PAGE, apres: 'c1' });
    expect(q.requetes[0]!.corps.query).toContain('customerSegmentMembers(queryId: $requete');

    const sansCurseur = faux(page([], { hasNextPage: true, endCursor: null }));
    expect(await lirePageMembres(ACCES, { ...P, segmentId: '11', requete: null, apres: null, appeler: sansCurseur.appeler })).toMatchObject({ ok: false, code: 'passager' });
    const plusLoin = faux(page([], { hasNextPage: true, endCursor: null }));
    expect(await lirePageMembres(ACCES, { ...P, segmentId: '11', requete: null, apres: 'c1', appeler: plusLoin.appeler })).toMatchObject({ ok: false, code: 'passager' });
    const surPlace = faux(page([{ node: { id: 'gid://shopify/CustomerSegmentMember/1001' } }], { hasNextPage: true, endCursor: 'c1' }));
    expect(await lirePageMembres(ACCES, { ...P, segmentId: '11', requete: null, apres: 'c1', appeler: surPlace.appeler })).toMatchObject({ ok: false, code: 'passager' });
  });

  it('🔴 les deux codes de Shopify : un segment trop lourd demande la requête asynchrone ; une requête lue trop tôt n’est pas prête', async () => {
    const erreur = (code: string) => faux({ json: { errors: [{ message: code, extensions: { code } }] } });
    expect(await lirePageMembres(ACCES, { ...P, segmentId: '11', requete: null, apres: null, appeler: erreur('USE_CUSTOMER_SEGMENT_MEMBERS_QUERY_CREATE_MUTATION').appeler }))
      .toMatchObject({ ok: false, code: 'asynchrone' });
    expect(await lirePageMembres(ACCES, { ...P, segmentId: '11', requete: 'q', apres: null, appeler: erreur('QUERY_NOT_COMPLETE').appeler }))
      .toMatchObject({ ok: false, code: 'pas_fini' });
  });

  it('la requête asynchrone : créée pour le segment, suivie jusqu’à prête ; perdue quand Shopify ne la connaît plus ; un refus de création se dit', async () => {
    const creation = faux({ json: { data: { customerSegmentMembersQueryCreate: { customerSegmentMembersQuery: { id: 'gid://shopify/CustomerSegmentMembersQuery/7', done: false }, userErrors: [] } } } });
    expect(await creerRequeteAsynchrone(ACCES, { ...P, segmentId: '11', appeler: creation.appeler }))
      .toEqual({ ok: true, requete: 'gid://shopify/CustomerSegmentMembersQuery/7', fini: false });
    expect(creation.requetes[0]!.corps.variables).toEqual({ segment: 'gid://shopify/Segment/11' });
    const refus = faux({ json: { data: { customerSegmentMembersQueryCreate: { customerSegmentMembersQuery: null, userErrors: [{ message: 'Segment does not exist' }] } } } });
    const r = await creerRequeteAsynchrone(ACCES, { ...P, segmentId: '11', appeler: refus.appeler });
    expect(r).toMatchObject({ ok: false, code: 'passager' });
    expect(r.ok ? '' : r.message).toContain('Segment does not exist');

    const suivi = (q: unknown) => faux({ json: { data: { customerSegmentMembersQuery: q } } }).appeler;
    expect(await suivreRequeteAsynchrone(ACCES, { ...P, requete: 'q', appeler: suivi({ id: 'q', done: true }) })).toEqual({ ok: true, etat: 'prete' });
    expect(await suivreRequeteAsynchrone(ACCES, { ...P, requete: 'q', appeler: suivi({ id: 'q', done: false }) })).toEqual({ ok: true, etat: 'en_cours' });
    expect(await suivreRequeteAsynchrone(ACCES, { ...P, requete: 'q', appeler: suivi(null) })).toEqual({ ok: true, etat: 'perdue' });
    expect(await suivreRequeteAsynchrone(ACCES, { ...P, requete: 'q', appeler: faux({ json: { data: { autre: 1 } } }).appeler })).toEqual({ ok: true, etat: 'perdue' });
  });
});

describe('les étiquettes en direct : l’abonnement en début de synchronisation (lot 6d)', () => {
  it('🔴 une boutique de la console s’abonne aux deux sujets d’étiquettes au début d’une synchronisation, une fois', async () => {
    const f = monterEtiquettes({ ...BASE });
    await synchroniser(f);
    expect(f.trace.abonnements).toEqual([['CUSTOMER_TAGS_ADDED', 'CUSTOMER_TAGS_REMOVED']]);
    expect(f.trace.issues).toEqual([{ issue: 'lue', message: null }]);
  });

  it('🔴 jamais en Free (qui synchronise à la demande)', async () => {
    const f = monterEtiquettes({ ...BASE, offre: 'base' });
    await synchroniser(f);
    expect(f.trace.abonnements).toEqual([]);
    expect(f.trace.issues).toEqual([{ issue: 'lue', message: null }]);
  });

  it('🔴 une recherche par téléphone en plusieurs passages n’abonne qu’une fois, avant le premier client lu', async () => {
    const fiches = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`, { telephone: tel(100 + i), active: true }]));
    const f = monterEtiquettes({
      fiches, boutiqueClients: { 2001: { telephone: tel(100), tags: ['VIP'] }, 2002: { telephone: tel(159), tags: [] } }, msParLot: PASSAGE_ETIQUETTES_MS / 2,
    });
    const abonner = f.deps.abonner.bind(f.deps);
    const lusALAbonnement: number[] = [];
    f.deps.abonner = async (acces, sujets) => { lusALAbonnement.push(f.trace.lots.length); return abonner(acces, sujets); };
    await synchroniser(f);
    expect(f.trace.recherches.length).toBeGreaterThan(0);
    expect(f.trace.issues).toEqual([]);
    expect(f.trace.abonnements).toEqual([]);
    for (let i = 0; i < 6 && f.trace.issues.length === 0; i += 1) await traiterEtiquettes(f.deps, JOB);
    expect(f.trace.abonnements).toHaveLength(1);
    expect(lusALAbonnement).toEqual([0]);
    expect(f.trace.lots.length).toBeGreaterThan(0);
    expect(f.trace.issues).toEqual([{ issue: 'lue', message: null }]);
  });

  it('🔴 jamais une boutique de Claude Code (ses webhooks sont dans son app)', async () => {
    const f = monterEtiquettes({ ...BASE, boutique: { ...BOUTIQUE_ETIQUETTES, origine: 'claude_code' } });
    await synchroniser(f);
    expect(f.trace.abonnements).toEqual([]);
    expect(f.trace.issues).toEqual([{ issue: 'lue', message: null }]);
  });

  it('🔴 un refus ou une panne de l’abonnement ne bloque rien : la synchronisation aboutit', async () => {
    for (const abonnement of [{ ok: false as const, message: 'Shopify refuse' }, 'leve' as const]) {
      const f = monterEtiquettes({ ...BASE, abonnement });
      await synchroniser(f);
      expect(f.trace.issues, JSON.stringify(abonnement)).toEqual([{ issue: 'lue', message: null }]);
    }
  });

  it('🔴 lot 7d : avec le droit read_customer_merge, la fusion s’abonne aussi, à part ; sans lui, jamais', async () => {
    const avec = monterEtiquettes({ ...BASE, droits: [...DROITS_ETIQUETTES, 'read_customer_merge'] });
    await synchroniser(avec);
    expect(avec.trace.abonnements).toEqual([['CUSTOMER_TAGS_ADDED', 'CUSTOMER_TAGS_REMOVED'], ['CUSTOMERS_MERGE']]);
    const sans = monterEtiquettes({ ...BASE });
    await synchroniser(sans);
    expect(sans.trace.abonnements).toEqual([['CUSTOMER_TAGS_ADDED', 'CUSTOMER_TAGS_REMOVED']]);
    // Ni en Free, ni pour une boutique de Claude Code (la skill déclare le sujet dans son app).
    for (const o of [{ offre: 'base' as const }, { boutique: { ...BOUTIQUE_ETIQUETTES, origine: 'claude_code' as const } }]) {
      const f = monterEtiquettes({ ...BASE, ...o, droits: [...DROITS_ETIQUETTES, 'read_customer_merge'] });
      await synchroniser(f);
      expect(f.trace.abonnements, JSON.stringify(o)).toEqual([]);
    }
  });

  it('un passage repris en cours de lecture des clients ne se réabonne pas', async () => {
    const f = monterEtiquettes({ ...BASE, liensDeDepart: [{ clientId: '1001', contactId: A }] });
    await f.deps.magasin.regler(T, true);
    await f.deps.magasin.demander(T, { auPlusUneFoisParJour: false });
    f.etat()!.curseur = '1000';
    await traiterEtiquettes(f.deps, JOB);
    expect(f.trace.abonnements).toEqual([]);
  });
});
