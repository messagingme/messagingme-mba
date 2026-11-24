import { describe, it, expect } from 'vitest';
import {
  apercuReprise, cablerReprise, debutDeFenetre, etatReprise, FENETRE_REPRISE_JOURS, lancerReprise, PAR_PAGE_REPRISE, rattacher,
  SANS_READ_PRODUCTS, traiterReprise, vueReprise, type JobReprise,
} from '../src/shopify/reprise';
import { BAIL_REPRISE_SECONDES, ERREUR_ABANDON, type PgReprisesStore, type Reprise } from '../src/shopify/reprises.pg';
import type { PgShopifyStore } from '../src/shopify/store.pg';
import { PgContactStore as PgContactStoreReel, type PgContactStore } from '../src/crm/contact-store.pg';
import { OUTILS, type DepsMcp } from '../src/mcp/outils';
import { MESSAGE_OPERATIONS_LOURDES } from '../src/auth/plafond-partage';
import { BOUTIQUE_REPRISE, commandeLue, connue, MIDI_REPRISE, monterReprise, page } from './reprise-faux';

/**
 * LE RATTRAPAGE DES COMMANDES SHOPIFY DES 60 DERNIERS JOURS (segments Shopify enrichis, lot 5). Ce qu'il fait : une
 * commande connue garde sa fiche (et reçoit ses lignes s'il lui en manque), une inconnue rejoint la fiche active de son
 * numéro utilisable. Ce qu'il ne fait jamais : créer une fiche, garder une commande sans fiche, continuer sur une autre
 * boutique. Le job tient la reprise par un bail, passe deux minutes au plus, puis se réenfile à son curseur.
 */

const T = '11111111-1111-4111-8111-111111111111';
const FENETRE = '2026-09-24T00:00:00.000Z';
const NUMERO_A = '+33612345678';
const NUMERO_B = '+33698765432';

describe('la fenêtre lue', () => {
  it('commence à minuit (UTC) il y a 60 jours : la limite de read_orders', () => {
    expect(FENETRE_REPRISE_JOURS).toBe(60);
    expect(debutDeFenetre(MIDI_REPRISE).toISOString()).toBe(FENETRE);
  });
});

describe('le rattachement d’une page', () => {
  it('🔴 une commande connue garde SA fiche ; une inconnue rejoint la fiche de son numéro ; sans fiche ou sans numéro, comptée, jamais gardée', async () => {
    const { deps, trace } = monterReprise({ connues: { '1': connue('fiche-connue', true) }, fiches: { [NUMERO_A]: 'fiche-a' } });
    const commandes = [
      // Connue, sans lignes, et son numéro mène à une AUTRE fiche : elle garde la sienne et reçoit ses lignes.
      commandeLue(1, { telephone: NUMERO_A }),
      commandeLue(2, { telephone: NUMERO_A, client: 77 }),
      commandeLue(3, { telephone: NUMERO_B }),
      commandeLue(4, { telephone: null }),
      // Un fixe : WhatsApp ne le porte pas.
      commandeLue(5, { telephone: '+33145678901' }),
    ];
    const c = await rattacher(deps, T, commandes, BOUTIQUE_REPRISE, true);
    expect(c).toEqual({ lues: 5, rattachees: 1, deja: 1, sansFiche: 1, sansNumero: 2 });
    expect(trace.liees.map((l) => [l.commandeId, l.contactId, l.clientId])).toEqual([['1', 'fiche-connue', null], ['2', 'fiche-a', '77']]);
    // Le montant, la date de Shopify et les lignes, comme le webhook les aurait écrits.
    expect(trace.liees[1]!.details).toMatchObject({ montant: '42.00', devise: 'EUR', test: false, payeeLe: new Date('2026-11-01T10:00:00Z') });
    expect(trace.liees[1]!.details.lignes?.lignes).toHaveLength(1);
  });

  it('🔴 une commande connue qui a déjà ses lignes, ou dont la fiche n’est plus active, n’est jamais réécrite', async () => {
    // Le webhook en a gardé 120 lignes ; relue à 50 avec une suite, la réécrire la dirait tronquée à tort.
    const { deps, trace } = monterReprise({ connues: { '1': connue('f1'), '2': connue('f-supprimee', false) } });
    const c = await rattacher(deps, T, [commandeLue(1, { lignes: 50, tronquees: true }), commandeLue(2)], BOUTIQUE_REPRISE, true);
    expect(c).toMatchObject({ lues: 2, deja: 2, rattachees: 0 });
    expect(trace.liees).toEqual([]);
  });

  it('deux lectures groupées par page, jamais une par commande ; les numéros des commandes connues ne sont pas cherchés', async () => {
    const { deps, trace } = monterReprise({ connues: { '1': connue('f1') }, fiches: { [NUMERO_A]: 'fa' } });
    await rattacher(deps, T, [commandeLue(1, { telephone: NUMERO_B }), commandeLue(2), commandeLue(3), commandeLue(4, { telephone: NUMERO_B })], BOUTIQUE_REPRISE, true);
    expect(trace.connues).toEqual([['1', '2', '3', '4']]);
    expect(trace.numeros).toEqual([[NUMERO_A, NUMERO_B]]);
    // Toutes connues : aucun numéro à chercher.
    const tout = monterReprise({ connues: { '1': connue('f1') } });
    await rattacher(tout.deps, T, [commandeLue(1)], BOUTIQUE_REPRISE, true);
    expect(tout.trace.numeros).toEqual([]);
  });

  it('à faux, il compte la même chose sans rien écrire (l’aperçu)', async () => {
    const { deps, trace } = monterReprise({ connues: { '1': connue('f1', true) }, fiches: { [NUMERO_A]: 'fa' } });
    const c = await rattacher(deps, T, [commandeLue(1), commandeLue(2), commandeLue(3, { telephone: NUMERO_B })], BOUTIQUE_REPRISE, false);
    expect(c).toEqual({ lues: 3, rattachees: 1, deja: 1, sansFiche: 1, sansNumero: 0 });
    expect(trace.liees).toEqual([]);
  });

  it('une commande lue incomplète chez Shopify (plus de 50 lignes) le dit sur ses lignes', async () => {
    const { deps, trace } = monterReprise({ fiches: { [NUMERO_A]: 'fa' } });
    await rattacher(deps, T, [commandeLue(1, { lignes: 2, tronquees: true }), commandeLue(2)], BOUTIQUE_REPRISE, true);
    expect(trace.liees.map((l) => l.details.lignes?.tronquees)).toEqual([true, false]);
  });

  it('une page vide ne lit rien', async () => {
    const { deps, trace } = monterReprise();
    expect(await rattacher(deps, T, [], BOUTIQUE_REPRISE, true)).toEqual({ lues: 0, rattachees: 0, deja: 0, sansFiche: 0, sansNumero: 0 });
    expect(trace.connues).toEqual([]);
  });
});

describe('l’aperçu', () => {
  it('lit toute la fenêtre, page après page, compte sans rien écrire et le dit complet', async () => {
    const { deps, trace } = monterReprise({
      connues: { '1': connue('f1') }, fiches: { [NUMERO_A]: 'fa' },
      pages: { '': page([commandeLue(1), commandeLue(2)], 'c1', 3), c1: page([commandeLue(3, { telephone: NUMERO_B }), commandeLue(4, { telephone: null })], null, 1) },
    });
    const r = await apercuReprise(deps, T);
    expect(r).toEqual({ ok: true, valeur: { fenetreDebut: FENETRE, lues: 4, deja: 1, rattachables: 1, sansFiche: 1, sansNumero: 1, ecartees: 4, complet: true } });
    expect(trace.lectures.map((l) => [l.apres, l.parPage, l.depuis])).toEqual([[null, PAR_PAGE_REPRISE, FENETRE], ['c1', PAR_PAGE_REPRISE, FENETRE]]);
    expect(trace.liees).toEqual([]);
  });

  it('🔴 à court de temps, il rend des comptes PARTIELS et le dit (complet faux), jamais un total', async () => {
    const pages = { '': page([commandeLue(1)], 'c1'), c1: page([commandeLue(2)], 'c2'), c2: page([commandeLue(3)], 'c3'), c3: page([commandeLue(4)], null) };
    const { deps, trace } = monterReprise({ fiches: { [NUMERO_A]: 'fa' }, pages, msParPage: 10_000 });
    const r = await apercuReprise(deps, T);
    expect(r.ok && r.valeur).toMatchObject({ lues: 3, rattachables: 3, complet: false });
    // Le délai d'une page est borné au temps qui reste.
    expect(trace.lectures.map((l) => l.delaiMs)).toEqual([20_000, 15_000, 5_000]);
  });

  it('🔴 une panne passagère APRÈS des pages lues rend leurs comptes, partiels ; un accès refusé reste un refus', async () => {
    const passager = { ok: false as const, code: 'passager' as const, message: 'réessayez' };
    const panne = monterReprise({ fiches: { [NUMERO_A]: 'fa' }, pages: { '': page([commandeLue(1), commandeLue(2)], 'c1'), c1: passager } });
    expect(await apercuReprise(panne.deps, T)).toMatchObject({ ok: true, valeur: { lues: 2, rattachables: 2, complet: false } });
    const refus = { ok: false as const, code: 'acces_refuse' as const, message: 'données client protégées' };
    const refusee = monterReprise({ pages: { '': page([commandeLue(1)], 'c1'), c1: refus } });
    expect(await apercuReprise(refusee.deps, T)).toEqual({ ok: false, statut: 409, message: 'données client protégées' });
  });

  it('une page trop lourde pour Shopify se redemande deux fois plus petite ; à une commande, le refus se dit', async () => {
    const lourd = { ok: false as const, code: 'trop_lourd' as const, message: 'Shopify trouve la page de commandes trop lourde (MAX_COST_EXCEEDED).' };
    const ok = monterReprise({ fiches: { [NUMERO_A]: 'fa' }, pages: { '': [lourd, page([commandeLue(1)], null)] } });
    expect((await apercuReprise(ok.deps, T)).ok).toBe(true);
    expect(ok.trace.lectures.map((l) => l.parPage)).toEqual([PAR_PAGE_REPRISE, Math.floor(PAR_PAGE_REPRISE / 2)]);

    const jamais = monterReprise({ pages: { '': lourd } });
    expect(await apercuReprise(jamais.deps, T)).toEqual({ ok: false, statut: 503, message: lourd.message });
    expect(jamais.trace.lectures.map((l) => l.parPage)).toEqual([5, 2, 1]);
  });

  it('🔴 sans le droit read_products, un refus qui dit comment l’ajouter, sans rien lire chez Shopify (mesuré le 2026-11-24)', async () => {
    const { deps, trace } = monterReprise({ droits: ['read_customers', 'read_orders', 'read_checkouts', 'read_fulfillments'] });
    expect(await apercuReprise(deps, T)).toEqual({ ok: false, statut: 409, message: SANS_READ_PRODUCTS });
    expect(SANS_READ_PRODUCTS).toMatch(/read_products.*réinstallez-la/);
    expect(trace.lectures).toEqual([]);
    // Les droits illisibles : Shopify absent (503), ou l'app refusée (409).
    expect(await apercuReprise(monterReprise({ droits: { ok: false, code: 'passager', message: 'droits illisibles' } }).deps, T)).toEqual({ ok: false, statut: 503, message: 'droits illisibles' });
    expect(await apercuReprise(monterReprise({ droits: { ok: false, code: 'acces_refuse', message: 'app refusée' } }).deps, T)).toEqual({ ok: false, statut: 409, message: 'app refusée' });
  });

  it('les refus : aucune boutique, boutique coupée, app refusée (409), Shopify absent (503)', async () => {
    expect(await apercuReprise(monterReprise({ boutique: null }).deps, T)).toMatchObject({ ok: false, statut: 409, message: expect.stringMatching(/Aucune boutique Shopify/) });
    expect(await apercuReprise(monterReprise({ boutique: { ...BOUTIQUE_REPRISE, etat: 'coupee' } }).deps, T)).toMatchObject({ ok: false, statut: 409, message: expect.stringMatching(/coupée/) });
    expect(await apercuReprise(monterReprise({ jeton: { ok: false, code: 'identifiants', message: 'identifiants refusés' } }).deps, T)).toEqual({ ok: false, statut: 409, message: 'identifiants refusés' });
    expect(await apercuReprise(monterReprise({ jeton: { ok: false, code: 'passager', message: 'Shopify ne répond pas' } }).deps, T)).toEqual({ ok: false, statut: 503, message: 'Shopify ne répond pas' });
    const refus = { ok: false as const, code: 'acces_refuse' as const, message: 'données client protégées' };
    expect(await apercuReprise(monterReprise({ pages: { '': refus } }).deps, T)).toEqual({ ok: false, statut: 409, message: 'données client protégées' });
    const passager = { ok: false as const, code: 'passager' as const, message: 'réessayez' };
    expect(await apercuReprise(monterReprise({ pages: { '': passager } }).deps, T)).toEqual({ ok: false, statut: 503, message: 'réessayez' });
  });
});

describe('le lancement', () => {
  it('inscrit la reprise sur la fenêtre du jour et la boutique, et enfile son job tout de suite', async () => {
    const { deps, trace, lignes } = monterReprise();
    const r = await lancerReprise(deps, T, 'u1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valeur).toMatchObject({ statut: 'en_attente', interrompue: false, fenetreDebut: FENETRE, finiLe: null, erreur: null });
    expect(lignes[0]!.r).toMatchObject({ par: 'u1', domaine: 'b.myshopify.com' });
    expect(trace.jobs).toEqual([{ job: { tenantId: T, repriseId: r.valeur.id }, dansSecondes: 0 }]);
  });

  it('🔴 refusé tant qu’une reprise vit, avec sa date ; une reprise ABANDONNÉE (15 minutes, bail mort) est close au lancement suivant', async () => {
    const { deps, horloge, lignes } = monterReprise();
    const premier = await lancerReprise(deps, T, null);
    expect(await lancerReprise(deps, T, null)).toEqual({ ok: false, statut: 409, message: expect.stringMatching(/déjà en cours.*2026-11-23/) });
    horloge.t += 16 * 60_000;
    const second = await lancerReprise(deps, T, null);
    expect(second.ok).toBe(true);
    expect(lignes[0]!.r).toMatchObject({ id: premier.ok ? premier.valeur.id : '', statut: 'erreur', erreur: ERREUR_ABANDON });
  });

  it('🔴 un job qui n’a pas pu être enfilé clôt sa reprise : la relance suivante part tout de suite', async () => {
    const { deps, lignes } = monterReprise();
    deps.enfiler = async () => { throw new Error('file indisponible'); };
    await expect(lancerReprise(deps, T, null)).rejects.toThrow('file indisponible');
    expect(lignes[0]!.r).toMatchObject({ statut: 'erreur', erreur: expect.stringMatching(/n’a pas pu démarrer.*file indisponible/) });
    deps.enfiler = async () => undefined;
    expect((await lancerReprise(deps, T, null)).ok).toBe(true);
  });

  it('🔴 sans le droit read_products, le lancement est refusé avec la même phrase, sans rien inscrire ni enfiler', async () => {
    const { deps, trace, lignes } = monterReprise({ droits: ['read_orders'] });
    expect(await lancerReprise(deps, T, null)).toEqual({ ok: false, statut: 409, message: SANS_READ_PRODUCTS });
    expect(lignes).toEqual([]);
    expect(trace.jobs).toEqual([]);
  });

  it('refusé sans boutique ou boutique coupée, sans rien inscrire', async () => {
    for (const boutique of [null, { ...BOUTIQUE_REPRISE, etat: 'coupee' }]) {
      const { deps, trace, lignes } = monterReprise({ boutique });
      expect(await lancerReprise(deps, T, null)).toMatchObject({ ok: false, statut: 409 });
      expect(lignes).toEqual([]);
      expect(trace.jobs).toEqual([]);
    }
  });
});

describe('le job', () => {
  async function lance(o: Parameters<typeof monterReprise>[0] = {}) {
    const faux = monterReprise(o);
    const r = await lancerReprise(faux.deps, T, null);
    if (!r.ok) throw new Error(r.message);
    faux.trace.jobs.length = 0;
    const job: JobReprise = { tenantId: T, repriseId: r.valeur.id };
    return { ...faux, job, ligne: () => faux.lignes[0]! };
  }

  it('lit la fenêtre jusqu’au bout, écrit, cumule les comptes et finit en « termine »', async () => {
    const { deps, trace, job, ligne } = await lance({
      connues: { '1': connue('f1', true) }, fiches: { [NUMERO_A]: 'fa' },
      pages: { '': page([commandeLue(1), commandeLue(2)], 'c1'), c1: page([commandeLue(3, { telephone: NUMERO_B }), commandeLue(4, { telephone: null })], null) },
    });
    await traiterReprise(deps, job);
    expect(ligne().r).toMatchObject({ statut: 'termine', curseur: 'c1', erreur: null, comptes: { lues: 4, rattachees: 1, deja: 1, sansFiche: 1, sansNumero: 1 } });
    expect(ligne().r.finiLe).not.toBeNull();
    expect(ligne().jeton).toBeNull();
    expect(trace.liees.map((l) => l.commandeId)).toEqual(['1', '2']);
    expect(trace.jobs).toEqual([]);
  });

  it('🔴 au bout de deux minutes, il enfile la suite PUIS libère le bail ; la suite reprend au curseur et finit', async () => {
    const pages = { '': page([commandeLue(1)], 'c1'), c1: page([commandeLue(2)], 'c2'), c2: page([commandeLue(3)], 'c3'), c3: page([commandeLue(4)], null) };
    const { deps, trace, job, ligne } = await lance({ fiches: { [NUMERO_A]: 'fa' }, pages, msParPage: 50_000 });
    await traiterReprise(deps, job);
    expect(ligne().r).toMatchObject({ statut: 'en_cours', curseur: 'c3', comptes: { lues: 3, rattachees: 3 } });
    expect(ligne().bail).toBeNull();
    expect(trace.jobs).toEqual([{ job, dansSecondes: 0 }]);
    await traiterReprise(deps, job);
    expect(trace.lectures.map((l) => l.apres)).toEqual([null, 'c1', 'c2', 'c3']);
    expect(ligne().r).toMatchObject({ statut: 'termine', comptes: { lues: 4, rattachees: 4 } });
  });

  it('🔴 une panne passagère de Shopify au milieu libère le bail et remonte (pg-boss rejoue) ; le rejeu reprend APRÈS la dernière page faite', async () => {
    const passager = { ok: false as const, code: 'passager' as const, message: 'Shopify n’a pas répondu' };
    const { deps, trace, job, ligne } = await lance({
      fiches: { [NUMERO_A]: 'fa' },
      pages: { '': page([commandeLue(1)], 'c1'), c1: [passager, page([commandeLue(2)], null)] },
    });
    await expect(traiterReprise(deps, job)).rejects.toThrow('Shopify n’a pas répondu');
    expect(ligne().r).toMatchObject({ statut: 'en_cours', curseur: 'c1', comptes: { lues: 1 } });
    expect(ligne().bail).toBeNull();
    await traiterReprise(deps, job);
    expect(trace.lectures.map((l) => l.apres)).toEqual([null, 'c1', 'c1']);
    expect(ligne().r).toMatchObject({ statut: 'termine', comptes: { lues: 2, rattachees: 2 } });
  });

  it('🔴 une panne de la base au milieu (une écriture qui lève) libère AUSSI le bail : le rejeu la prend, au lieu de se réenfiler sans fin', async () => {
    const { deps, trace, job, ligne } = await lance({
      fiches: { [NUMERO_A]: 'fa' },
      pages: { '': page([commandeLue(1)], 'c1'), c1: page([commandeLue(2)], null) },
    });
    const lier = deps.lierCommande;
    let pannes = 1;
    deps.lierCommande = async (...a) => { if (a[1] === '2' && pannes-- > 0) throw new Error('connexion perdue'); return lier(...a); };
    await expect(traiterReprise(deps, job)).rejects.toThrow('connexion perdue');
    expect(ligne().bail).toBeNull();
    expect(ligne().r).toMatchObject({ statut: 'en_cours', curseur: 'c1' });
    // Le rejeu de pg-boss la PREND (il ne la trouve pas tenue) et finit.
    await traiterReprise(deps, job);
    expect(trace.jobs).toEqual([]);
    expect(ligne().r).toMatchObject({ statut: 'termine', comptes: { lues: 2, rattachees: 2 } });
  });

  it('🔴 la dernière page se compte UNE fois, même quand sa fin a échoué une première fois', async () => {
    const { deps, job, ligne } = await lance({ fiches: { [NUMERO_A]: 'fa' }, pages: { '': page([commandeLue(1), commandeLue(2)], null) } });
    const finir = deps.reprises.finir;
    let pannes = 1;
    deps.reprises.finir = async (...a) => { if (pannes-- > 0) throw new Error('connexion perdue'); return finir(...a); };
    await expect(traiterReprise(deps, job)).rejects.toThrow('connexion perdue');
    await traiterReprise(deps, job);
    expect(ligne().r).toMatchObject({ statut: 'termine', comptes: { lues: 2, rattachees: 2 } });
  });

  it('un accès refusé au milieu clôt la reprise en « refuse », ce qui est fait reste compté', async () => {
    const refus = { ok: false as const, code: 'acces_refuse' as const, message: 'données client protégées' };
    const { deps, job, ligne } = await lance({ fiches: { [NUMERO_A]: 'fa' }, pages: { '': page([commandeLue(1)], 'c1'), c1: refus } });
    await traiterReprise(deps, job);
    expect(ligne().r).toMatchObject({ statut: 'refuse', erreur: 'données client protégées', comptes: { lues: 1, rattachees: 1 } });
  });

  it('une page trop lourde se redemande plus petite, sans perdre sa place', async () => {
    const lourd = { ok: false as const, code: 'trop_lourd' as const, message: 'trop lourde' };
    const { deps, trace, job, ligne } = await lance({ pages: { '': [lourd, lourd, page([commandeLue(1)], null)] } });
    await traiterReprise(deps, job);
    expect(trace.lectures.map((l) => [l.apres, l.parPage])).toEqual([[null, 5], [null, 2], [null, 1]]);
    expect(ligne().r.statut).toBe('termine');
  });

  it('la boutique coupée ou retirée clôt en « erreur », l’app refusée en « refuse », Shopify absent libère et remonte', async () => {
    const coupee = await lance();
    coupee.deps.boutique = async () => ({ ...BOUTIQUE_REPRISE, etat: 'coupee' });
    await traiterReprise(coupee.deps, coupee.job);
    expect(coupee.ligne().r).toMatchObject({ statut: 'erreur', erreur: expect.stringMatching(/coupée/) });

    // Lancées avec une app valide, puis l'app refusée ou Shopify absent au passage du job.
    const refusee = await lance();
    refusee.deps.jeton = async () => ({ ok: false, code: 'app_non_installee', message: 'app désinstallée' });
    await traiterReprise(refusee.deps, refusee.job);
    expect(refusee.ligne().r).toMatchObject({ statut: 'refuse', erreur: 'app désinstallée' });

    const absent = await lance();
    absent.deps.jeton = async () => ({ ok: false, code: 'passager', message: 'Shopify ne répond pas' });
    await expect(traiterReprise(absent.deps, absent.job)).rejects.toThrow('Shopify ne répond pas');
    expect(absent.ligne().r.statut).toBe('en_cours');
    expect(absent.ligne().bail).toBeNull();
  });

  it('🔴 une autre boutique que celle du lancement : la reprise se clôt, son curseur ne sert jamais ailleurs', async () => {
    const { deps, trace, job, ligne } = await lance({ fiches: { [NUMERO_A]: 'fa' }, pages: { '': page([commandeLue(1)], null) } });
    deps.boutique = async () => ({ ...BOUTIQUE_REPRISE, domaine: 'autre.myshopify.com' });
    await traiterReprise(deps, job);
    expect(ligne().r).toMatchObject({ statut: 'erreur', erreur: expect.stringMatching(/a changé/) });
    expect(trace.lectures).toEqual([]);
  });

  it('🔴 la boutique coupée PENDANT le passage : la page lue n’est pas écrite, la reprise se clôt', async () => {
    const { deps, trace, job, ligne } = await lance({ fiches: { [NUMERO_A]: 'fa' }, pages: { '': page([commandeLue(1)], 'c1'), c1: page([commandeLue(2)], null) } });
    const lire = deps.lirePage;
    let pages = 0;
    deps.lirePage = async (acces, p) => {
      const r = await lire(acces, p);
      // Coupée juste après la lecture de la deuxième page.
      if (++pages === 2) deps.boutique = async () => ({ ...BOUTIQUE_REPRISE, etat: 'coupee' });
      return r;
    };
    await traiterReprise(deps, job);
    expect(trace.liees.map((l) => l.commandeId)).toEqual(['1']);
    expect(ligne().r).toMatchObject({ statut: 'erreur', erreur: expect.stringMatching(/coupée/), comptes: { lues: 1 } });
  });

  it('🔴 une reprise tenue par un autre passage : rien n’est lu, le job repasse après un tiers du bail ; une reprise finie : rien', async () => {
    const { deps, trace, job, ligne, horloge } = await lance();
    await deps.reprises.prendre(job.repriseId, T);
    await traiterReprise(deps, job);
    expect(trace.lectures).toEqual([]);
    expect(trace.jobs).toEqual([{ job, dansSecondes: BAIL_REPRISE_SECONDES / 3 }]);

    // Le bail mort (le worker qui la tenait a disparu), un passage la reprend.
    horloge.t += (BAIL_REPRISE_SECONDES + 1) * 1000;
    await traiterReprise(deps, job);
    expect(ligne().r.statut).toBe('termine');
    trace.jobs.length = 0;
    await traiterReprise(deps, job);
    expect(trace.jobs).toEqual([]);
    expect(trace.lectures).toHaveLength(1);
  });

  it('🔴 le bail perdu en route (son jeton n’est plus le bon), le passage s’arrête sans clore ni lire plus loin', async () => {
    const { deps, trace, job, ligne } = await lance({ pages: { '': page([commandeLue(1)], 'c1'), c1: page([commandeLue(2)], null) } });
    const lire = deps.lirePage;
    deps.lirePage = async (acces, p) => { ligne().jeton = 'vole'; return lire(acces, p); };
    await traiterReprise(deps, job);
    expect(trace.lectures).toHaveLength(1);
    expect(ligne().r).toMatchObject({ statut: 'en_cours', curseur: null });
  });

  it('🔴 le droit read_products retiré après le lancement : la reprise se clôt en « refuse » avec sa phrase, rien n’est lu', async () => {
    const { deps, trace, job, ligne } = await lance({ pages: { '': page([commandeLue(1)], null) } });
    deps.droits = async () => ({ ok: true, droits: ['read_orders'] });
    await traiterReprise(deps, job);
    expect(ligne().r).toMatchObject({ statut: 'refuse', erreur: SANS_READ_PRODUCTS });
    expect(trace.lectures).toEqual([]);
  });

  it('un job illisible est journalisé et ne prend rien', async () => {
    const { deps, lignes } = await lance();
    await traiterReprise(deps, { tenantId: 'pas-un-uuid', repriseId: lignes[0]!.r.id });
    expect(lignes[0]!.r.statut).toBe('en_attente');
  });
});

describe('l’état', () => {
  const r = (o: Partial<Reprise>): Reprise => ({
    id: 'r1', statut: 'en_cours', domaine: 'b.myshopify.com', fenetreDebut: new Date(FENETRE), curseur: null,
    comptes: { lues: 1, rattachees: 1, deja: 0, sansFiche: 0, sansNumero: 0 },
    erreur: null, par: 'u1', commenceLe: new Date(MIDI_REPRISE), majLe: new Date(MIDI_REPRISE), finiLe: null, tenue: false, ...o,
  });

  it('🔴 « interrompue » : vivante, sans bail, et rien depuis 15 minutes ; jamais une reprise tenue ou finie', () => {
    const plusTard = MIDI_REPRISE + 16 * 60_000;
    expect(vueReprise(r({}), plusTard).interrompue).toBe(true);
    expect(vueReprise(r({ statut: 'en_attente' }), plusTard).interrompue).toBe(true);
    expect(vueReprise(r({}), MIDI_REPRISE + 14 * 60_000).interrompue).toBe(false);
    expect(vueReprise(r({ tenue: true }), plusTard).interrompue).toBe(false);
    expect(vueReprise(r({ statut: 'termine', finiLe: new Date(MIDI_REPRISE) }), plusTard).interrompue).toBe(false);
  });

  it('rend la dernière reprise de l’espace, ou rien', async () => {
    const { deps } = monterReprise();
    expect(await etatReprise(deps, T)).toBeNull();
    await lancerReprise(deps, T, null);
    expect(await etatReprise(deps, T)).toMatchObject({ statut: 'en_attente', comptes: { lues: 0 } });
  });
});

describe('le câblage commun de l’API et du worker', () => {
  it('🔴 les magasins gardent leur `this` ; la boutique porte sa devise ; un job différé part à son heure', async () => {
    class Boutiques {
      private readonly vue = { devise: 'CHF' };
      private readonly acces_ = { domaine: 'b.myshopify.com', clientId: 'cid', secret: 's', pays: 'CH', etat: 'connectee' as const };
      async acces() { return this.acces_; }
      async lire() { return this.vue; }
      async commandesConnues() { return new Map([['1', { contactId: this.vue.devise, aCompleter: false }]]); }
      async lierCommande() { this.vue.devise = 'ecrite'; }
    }
    class Contacts {
      private readonly fiches = new Map([['+41790000000', 'fiche']]);
      async fichesParNumeros() { return this.fiches; }
    }
    const jobs: Array<Date | undefined> = [];
    const deps = cablerReprise({
      reprises: {} as PgReprisesStore,
      boutiques: new Boutiques() as unknown as Pick<PgShopifyStore, 'acces' | 'lire' | 'commandesConnues' | 'lierCommande'>,
      contacts: new Contacts() as unknown as Pick<PgContactStore, 'fichesParNumeros'>,
      enfiler: async (_job, quand) => { jobs.push(quand); },
    });
    expect(await deps.boutique(T)).toMatchObject({ domaine: 'b.myshopify.com', pays: 'CH', devise: 'CHF', etat: 'connectee' });
    expect(await deps.commandesConnues(T, ['1'])).toEqual(new Map([['1', { contactId: 'CHF', aCompleter: false }]]));
    expect(await deps.fichesParNumeros(T, [])).toEqual(new Map([['+41790000000', 'fiche']]));
    await deps.lierCommande(T, '1', null, 'fiche', { payeeLe: new Date(), montant: null, devise: null, test: false });
    expect(await deps.boutique(T)).toMatchObject({ devise: 'ecrite' });
    const avant = Date.now();
    await deps.enfiler({ tenantId: T, repriseId: T }, 0);
    await deps.enfiler({ tenantId: T, repriseId: T }, 60);
    expect(jobs[0]).toBeUndefined();
    expect(jobs[1]!.getTime()).toBeGreaterThanOrEqual(avant + 60_000);
  });
});

describe('les outils MCP du rattrapage', () => {
  const PERSONNE = { userId: 'u1', autorisationId: 'aut-1' } as never;
  const outil = (nom: string) => OUTILS.find((o) => o.nom === nom)!;
  const mcp = (reprise: ReturnType<typeof monterReprise>['deps'], accepte = true) => ({
    shopify: { reprise }, couteux: { consommer: async () => ({ accepte, attenteMs: 4_000 }) },
  }) as unknown as DepsMcp;

  it('ouverts à toutes les offres, une personne nommée, l’aperçu et le lancement sous le plafond des opérations lourdes', async () => {
    for (const nom of ['preview_shopify_order_history', 'import_shopify_order_history', 'get_shopify_order_history']) {
      expect(outil(nom), nom).toMatchObject({ fonction: null, exigePersonne: true });
    }
    expect(outil('import_shopify_order_history').scope).toBe('mcp:write');
    const { deps, lignes } = monterReprise();
    for (const nom of ['preview_shopify_order_history', 'import_shopify_order_history']) {
      await expect(outil(nom).executer(mcp(deps, false), T, {}, PERSONNE)).rejects.toThrow(MESSAGE_OPERATIONS_LOURDES);
    }
    expect(lignes).toEqual([]);
  });

  it('compter, lancer, suivre : les comptes sous leurs noms anglais, un second lancement refusé', async () => {
    const { deps } = monterReprise({ connues: { '1': connue('f1') }, fiches: { [NUMERO_A]: 'fa' }, pages: { '': page([commandeLue(1), commandeLue(2), commandeLue(3, { telephone: null })], null, 2) } });
    expect(await outil('get_shopify_order_history').executer(mcp(deps), T, {}, PERSONNE)).toMatchObject({ started: false });
    expect(await outil('preview_shopify_order_history').executer(mcp(deps), T, {}, PERSONNE)).toEqual({
      window_start: FENETRE, paid_orders_read: 3, already_known: 1, attachable: 1, without_record: 0, without_usable_phone: 1, never_paid: 2, complete: true,
    });
    const lance = await outil('import_shopify_order_history').executer(mcp(deps), T, {}, PERSONNE);
    expect(lance).toMatchObject({ status: 'en_attente', window_start: FENETRE, counts: { paid_orders_read: 0 }, next_step: expect.stringMatching(/get_shopify_order_history/) });
    await expect(outil('import_shopify_order_history').executer(mcp(deps), T, {}, PERSONNE)).rejects.toThrow(/déjà en cours/);
    expect(await outil('get_shopify_order_history').executer(mcp(deps), T, {}, PERSONNE)).toMatchObject({ started: true, status: 'en_attente', interrupted: false });
  });

  it('un refus de la gestion devient le refus de l’outil, avec sa phrase', async () => {
    const { deps } = monterReprise({ boutique: null });
    await expect(outil('preview_shopify_order_history').executer(mcp(deps), T, {}, PERSONNE)).rejects.toThrow(/Aucune boutique Shopify/);
    await expect(outil('import_shopify_order_history').executer(mcp(deps), T, {}, PERSONNE)).rejects.toThrow(/Aucune boutique Shopify/);
  });
});

describe('le suivi des segments dit le dernier rattrapage terminé, au mieux', () => {
  /** Un faux pool : la boutique, puis la lecture des reprises (une ligne, aucune, ou la table absente). */
  const suivi = (reprises: 'absente' | Array<{ fenetre_debut: Date; fini_le: Date }>, lus: unknown[][] = []) => {
    const pool = {
      query: async (sql: string, p: unknown[]) => {
        if (/from shopify_boutiques/.test(sql)) return { rows: [{ devise: 'EUR', commandes_depuis: new Date('2026-11-03T10:00:00Z'), coupee_le: null, etat: 'connectee' }] };
        if (/from shopify_reprises/.test(sql)) {
          lus.push(p);
          expect(sql).toMatch(/tenant_id = \$1 and genre = 'commandes' and statut = 'termine' and fini_le >= \$2/);
          if (reprises === 'absente') throw Object.assign(new Error('relation "shopify_reprises" does not exist'), { code: '42P01' });
          return { rows: reprises };
        }
        throw new Error(`requête inattendue : ${sql}`);
      },
    } as unknown as import('pg').Pool;
    return new PgContactStoreReel(pool).suiviSegments(T);
  };

  it('🔴 la fenêtre et la fin du dernier rattrapage fini APRÈS le début du suivi ; rien sans lui ; la table absente ne fait jamais échouer le suivi', async () => {
    const fin = new Date('2026-11-23T12:05:00Z');
    const lus: unknown[][] = [];
    expect((await suivi([{ fenetre_debut: new Date(FENETRE), fini_le: fin }], lus)).boutique).toMatchObject({ rattrapage: { depuis: new Date(FENETRE), le: fin } });
    // Le début du suivi courant est passé à la lecture : un rattrapage fini avant lui ne dit rien.
    expect(lus[0]).toEqual([T, new Date('2026-11-03T10:00:00Z')]);
    expect((await suivi([])).boutique).not.toHaveProperty('rattrapage');
    const sansTable = await suivi('absente');
    expect(sansTable.boutique).toEqual({ devise: 'EUR', commandesDepuis: new Date('2026-11-03T10:00:00Z'), coupeeLe: null });
  });
});
