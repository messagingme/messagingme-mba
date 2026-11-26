import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import {
  apercuReprise, cablerReprise, debutDeFenetre, etatReprise, FENETRE_LONGUE_MOIS, FENETRE_REPRISE_JOURS, lancerReprise, PAR_PAGE_REPRISE,
  READ_ALL_ORDERS_RETIRE, repriseLongue,
  PHRASE_ATTESTATION_RATTRAPAGE, PHRASE_ATTESTATION_RATTRAPAGE_CLAUDE, PHRASE_ATTESTATION_RETIREE, rattacher,
  SANS_READ_PRODUCTS, sourceDuConsentement, traiterReprise, vueReprise, type JobReprise, type Simulation,
} from '../src/shopify/reprise';
import { BAIL_REPRISE_SECONDES, ERREUR_ABANDON, type PgReprisesStore, type Reprise } from '../src/shopify/reprises.pg';
import type { PgShopifyStore } from '../src/shopify/store.pg';
import { PgContactStore as PgContactStoreReel, type PgContactStore } from '../src/crm/contact-store.pg';
import type { LotContacts } from '../src/crm/import';
import { OUTILS, type DepsMcp } from '../src/mcp/outils';
import { MESSAGE_OPERATIONS_LOURDES } from '../src/auth/plafond-partage';
import {
  ATTESTATION_REPRISE, BOUTIQUE_REPRISE, commandeLue, connue, DROITS_A_JOUR, MIDI_REPRISE, monterReprise, page, SOURCE_REPRISE,
} from './reprise-faux';

/**
 * LE RATTRAPAGE DES COMMANDES SHOPIFY DES 60 DERNIERS JOURS (segments Shopify enrichis, lots 5 et 5b). Ce qu'il fait : une
 * commande connue garde sa fiche (et reçoit ses lignes s'il lui en manque), une inconnue rejoint la fiche active de son
 * numéro utilisable, ou de son acheteur, ou, depuis le lot 5b (décisions de Julien du 2026-11-24), la fiche de l'ACHETEUR
 * qu'il crée, consentante sous l'attestation de la boutique, une par numéro, dans les places de l'offre. Ce qu'il ne fait
 * jamais : créer une fiche sans mobile d'acheteur (un destinataire de cadeau n'entre pas), recréer un contact supprimé pour
 * une commande payée avant sa suppression, recréer un STOP effacé, refaire la fiche d'un numéro que WhatsApp a refusé,
 * dépasser la limite de l'offre, rien faire sans l'attestation, continuer sur une autre boutique. Le job tient la reprise
 * par un bail, passe deux minutes au plus, puis se réenfile à son curseur.
 */

const T = '11111111-1111-4111-8111-111111111111';
const FENETRE = '2026-09-24T00:00:00.000Z';
/** La fenêtre de 24 mois (lot 7a), au même jour du mois. */
const FENETRE_LONGUE = '2024-11-23T00:00:00.000Z';
const LONGER_SANS_DROIT = 'add the read_all_orders scope to the store app (the shopify skill does), then the catch-up reads 24 months';
const NUMERO_A = '+33612345678';
const NUMERO_B = '+33698765432';
const NUMERO_C = '+33611112222';
const FIXE = '+33145678901';
const ECRIRE = { source: SOURCE_REPRISE };
const zero = { lues: 0, rattachees: 0, deja: 0, sansFiche: 0, sansNumero: 0, fichesCreees: 0, horsPlafond: 0 };
const simulation = (libres = Infinity): Simulation => ({ libres, creees: new Set(), refusees: new Set() });

describe('la fenêtre lue', () => {
  it('commence à minuit (UTC) il y a 60 jours : la limite de read_orders', () => {
    expect(FENETRE_REPRISE_JOURS).toBe(60);
    expect(debutDeFenetre(MIDI_REPRISE, false).toISOString()).toBe(FENETRE);
  });
});

describe('le rattachement d’une page', () => {
  it('🔴 une commande connue garde SA fiche ; une inconnue rejoint la fiche de son numéro, ou celle créée pour son acheteur ; sans numéro utilisable, comptée, jamais gardée', async () => {
    const { deps, trace } = monterReprise({ connues: { '1': connue('fiche-connue', true) }, fiches: { [NUMERO_A]: 'fiche-a' } });
    const commandes = [
      // Connue, sans lignes, et son numéro mène à une AUTRE fiche : elle garde la sienne et reçoit ses lignes.
      commandeLue(1, { telephone: NUMERO_A }),
      commandeLue(2, { telephone: NUMERO_A, client: 77 }),
      commandeLue(3, { telephone: NUMERO_B }),
      commandeLue(4, { telephone: null }),
      // Un fixe : WhatsApp ne le porte pas, et la commande n'a pas d'autre numéro.
      commandeLue(5, { telephone: FIXE }),
    ];
    const c = await rattacher(deps, T, commandes, BOUTIQUE_REPRISE, ECRIRE);
    expect(c).toEqual({ ...zero, lues: 5, rattachees: 2, deja: 1, sansNumero: 2, fichesCreees: 1 });
    expect(trace.liees.map((l) => [l.commandeId, l.contactId, l.clientId])).toEqual([
      ['1', 'fiche-connue', null], ['2', 'fiche-a', '77'], ['3', `fiche-${NUMERO_B}`, null],
    ]);
    // La fiche créée : son numéro, consentante sur la foi de l'attestation, la trace qui la nomme.
    expect(trace.creees).toEqual([{ numero: NUMERO_B, nom: null, source: SOURCE_REPRISE, contactId: `fiche-${NUMERO_B}` }]);
    // Le montant, la date de Shopify et les lignes, comme le webhook les aurait écrits.
    expect(trace.liees[1]!.details).toMatchObject({ montant: '42.00', devise: 'EUR', test: false, payeeLe: new Date('2026-11-01T10:00:00Z') });
    expect(trace.liees[1]!.details.lignes?.lignes).toHaveLength(1);
    // 🔴 Une seule écriture pour la page : la fiche et les trois commandes, dans la même transaction.
    expect(trace.ecrites).toHaveLength(1);
    expect(trace.ecrites[0]!.liaisons.map((l) => ('numero' in l ? `numero:${l.numero}` : `fiche:${l.contactId}`)))
      .toEqual(['fiche:fiche-connue', 'fiche:fiche-a', `numero:${NUMERO_B}`]);
  });

  it('🔴 deux commandes du même numéro dans une page : UNE fiche, les deux commandes y sont rattachées', async () => {
    const { deps, trace } = monterReprise();
    const c = await rattacher(deps, T, [commandeLue(1, { telephone: NUMERO_B }), commandeLue(2, { telephone: NUMERO_B })], BOUTIQUE_REPRISE, ECRIRE);
    expect(c).toMatchObject({ lues: 2, rattachees: 2, fichesCreees: 1 });
    expect(trace.ecrites[0]!.fiches).toEqual([{ numero: NUMERO_B, nom: null }]);
    expect(trace.liees.map((l) => l.contactId)).toEqual([`fiche-${NUMERO_B}`, `fiche-${NUMERO_B}`]);
  });

  it('🔴 un fixe est sauté : le mobile suivant de la commande fonde la fiche ; sans mobile, rien n’est créé', async () => {
    const { deps, trace } = monterReprise();
    // Le fixe de livraison masquait le mobile de la commande.
    const c = await rattacher(deps, T, [commandeLue(1, { livraison: { telephone: '01 45 67 89 01' }, telephone: NUMERO_C })], BOUTIQUE_REPRISE, ECRIRE);
    expect(c).toMatchObject({ rattachees: 1, fichesCreees: 1, sansNumero: 0 });
    expect(trace.creees.map((f) => f.numero)).toEqual([NUMERO_C]);
    const fixeSeul = monterReprise();
    expect(await rattacher(fixeSeul.deps, T, [commandeLue(2, { telephone: FIXE })], BOUTIQUE_REPRISE, ECRIRE)).toEqual({ ...zero, lues: 1, sansNumero: 1 });
    expect(fixeSeul.trace.ecrites).toEqual([]);
    // Le numéro du client Shopify est un fixe : la fiche de l'acheteur naît sur le mobile que la commande porte pour lui.
    const clientFixe = monterReprise();
    expect(await rattacher(clientFixe.deps, T, [commandeLue(3, { client: 79, clientTelephone: FIXE, telephone: NUMERO_A })], BOUTIQUE_REPRISE, ECRIRE))
      .toEqual({ ...zero, lues: 1, rattachees: 1, fichesCreees: 1 });
    expect(clientFixe.trace.creees.map((f) => f.numero)).toEqual([NUMERO_A]);
  });

  it('🔴 la fiche créée est celle de l’ACHETEUR, à son nom (le client, puis la facturation) ; jamais celle de la livraison : un destinataire de cadeau n’entre pas', async () => {
    const { deps, trace } = monterReprise();
    const D = '+33633334444';
    const c = await rattacher(deps, T, [
      // Un cadeau : la livraison porte le numéro et le nom du destinataire, la commande ceux de l'acheteur.
      commandeLue(1, { client: 77, telephone: NUMERO_A, livraison: { telephone: NUMERO_B, prenom: 'Léa', nom: 'Dupont' } }),
      // Le numéro du client Shopify d'abord, son nom avec.
      commandeLue(2, { client: 78, clientTelephone: NUMERO_C, telephone: null }),
      // Ni client ni numéro de commande : la facturation, à son nom.
      commandeLue(3, { telephone: null, facturation: { telephone: D, prenom: '  Jean ', nom: 'Moulin' } }),
      // Seule la livraison porte un numéro : la commande est comptée sans fiche, rien n'est créé.
      commandeLue(4, { telephone: null, livraison: { telephone: '+33655556666', prenom: 'Zoé' } }),
    ], BOUTIQUE_REPRISE, ECRIRE);
    expect(c).toEqual({ ...zero, lues: 4, rattachees: 3, sansFiche: 1, fichesCreees: 3 });
    expect(trace.creees.map((f) => [f.numero, f.nom])).toEqual([[NUMERO_A, 'Camille Martin'], [NUMERO_C, 'Camille Martin'], [D, 'Jean Moulin']]);
    expect(trace.liees.map((l) => [l.commandeId, l.contactId])).toEqual([['1', `fiche-${NUMERO_A}`], ['2', `fiche-${NUMERO_C}`], ['3', `fiche-${D}`]]);
  });

  it('🔴 le rattachement garde les candidats du lot 5 : la fiche déjà là du numéro de livraison reçoit la commande ; sinon celle de l’acheteur', async () => {
    const { deps, trace } = monterReprise({ fiches: { [NUMERO_B]: 'fiche-destinataire', [NUMERO_C]: 'fiche-acheteur' } });
    const c = await rattacher(deps, T, [
      commandeLue(1, { telephone: NUMERO_A, livraison: { telephone: NUMERO_B } }),
      commandeLue(2, { telephone: NUMERO_C, livraison: { telephone: '+33655556666' } }),
    ], BOUTIQUE_REPRISE, ECRIRE);
    expect(c).toEqual({ ...zero, lues: 2, rattachees: 2 });
    expect(trace.liees.map((l) => [l.commandeId, l.contactId])).toEqual([['1', 'fiche-destinataire'], ['2', 'fiche-acheteur']]);
    // 🔴 Aucune fiche demandée : une fiche déjà là ne repasse jamais par le chemin de l'import (consentement, étiquette).
    expect(trace.ecrites.map((p) => p.fiches)).toEqual([[]]);
    expect(trace.creees).toEqual([]);
  });

  it('🔴 un contact supprimé n’est JAMAIS recréé : une commande payée avant son effacement ne fonde aucune fiche ; payée après, si', async () => {
    // Effacé le 10 novembre : la commande payée le 1er ne le recrée pas, celle du 15 est une nouvelle commande.
    const { deps, trace } = monterReprise({ effacements: { [NUMERO_B]: '2026-11-10T08:00:00Z' } });
    expect(await rattacher(deps, T, [commandeLue(1, { telephone: NUMERO_B })], BOUTIQUE_REPRISE, ECRIRE)).toEqual({ ...zero, lues: 1, sansFiche: 1 });
    expect(trace.ecrites).toEqual([]);
    const apres = await rattacher(deps, T, [commandeLue(2, { telephone: NUMERO_B, payeeLe: '2026-11-15T10:00:00Z' })], BOUTIQUE_REPRISE, ECRIRE);
    expect(apres).toEqual({ ...zero, lues: 1, rattachees: 1, fichesCreees: 1 });
    expect(trace.creees.map((f) => f.numero)).toEqual([NUMERO_B]);
  });

  it('🔴 la trace vaut pour TOUS les numéros de la commande ; un paiement à la seconde de l’effacement, ou à une date illisible, vaut un paiement d’avant', async () => {
    const { deps, trace } = monterReprise({ effacements: { [NUMERO_B]: '2026-11-10T08:00:00Z' } });
    const c = await rattacher(deps, T, [
      // Le contact effacé portait le numéro de livraison : l'acheteur peut être la même personne, rien ne naît.
      commandeLue(1, { telephone: NUMERO_C, livraison: { telephone: NUMERO_B } }),
      commandeLue(2, { telephone: NUMERO_B, payeeLe: '2026-11-10T08:00:00Z' }),
      commandeLue(3, { telephone: NUMERO_B, payeeLe: null }),
    ], BOUTIQUE_REPRISE, ECRIRE);
    expect(c).toEqual({ ...zero, lues: 3, sansFiche: 3 });
    expect(trace.ecrites).toEqual([]);
    // Lue une fois pour la page, sur les numéros sans fiche.
    expect(trace.effacements).toEqual([[NUMERO_B, NUMERO_C]]);
  });

  it('la trace ne garde que la CRÉATION : la fiche active d’un numéro effacé (revenue par un autre chemin) reçoit la commande', async () => {
    const { deps, trace } = monterReprise({ fiches: { [NUMERO_B]: 'fiche-revenue' }, effacements: { [NUMERO_B]: '2026-11-10T08:00:00Z' } });
    expect(await rattacher(deps, T, [commandeLue(1, { telephone: NUMERO_B })], BOUTIQUE_REPRISE, ECRIRE)).toEqual({ ...zero, lues: 1, rattachees: 1 });
    expect(trace.liees.map((l) => l.contactId)).toEqual(['fiche-revenue']);
    expect(trace.effacements).toEqual([]);
  });

  it('🔴 un numéro de la liste de refus (une fiche effacée en STOP) ne revient pas ; une fiche en STOP reçoit sa commande sans rien d’autre', async () => {
    const { deps, trace } = monterReprise({ refus: [NUMERO_B], fiches: { [NUMERO_A]: 'fiche-en-stop' } });
    const c = await rattacher(deps, T, [commandeLue(1, { telephone: NUMERO_B }), commandeLue(2, { telephone: NUMERO_A })], BOUTIQUE_REPRISE, ECRIRE);
    expect(c).toEqual({ ...zero, lues: 2, rattachees: 1, sansFiche: 1 });
    // Aucune fiche créée : la fiche existante n'est jamais réécrite (ni consentement, ni étiquette), elle reçoit la commande.
    expect(trace.creees).toEqual([]);
    expect(trace.ecrites[0]!.fiches).toEqual([]);
    expect(trace.liees.map((l) => [l.commandeId, l.contactId])).toEqual([['2', 'fiche-en-stop']]);
  });

  it('🔴 un numéro que WhatsApp a déjà refusé (131026, fiche supprimée depuis) ne refait pas sa fiche, pour aucune commande de la page', async () => {
    const { deps, trace } = monterReprise({ sansWhatsapp: ['1'] });
    const c = await rattacher(deps, T, [commandeLue(1, { telephone: NUMERO_B }), commandeLue(2, { telephone: NUMERO_B }), commandeLue(3, { telephone: NUMERO_C })], BOUTIQUE_REPRISE, ECRIRE);
    expect(c).toEqual({ ...zero, lues: 3, rattachees: 1, sansFiche: 2, fichesCreees: 1 });
    expect(trace.creees.map((f) => f.numero)).toEqual([NUMERO_C]);
    // Seules les commandes sans fiche à leur numéro sont cherchées.
    expect(trace.sansWhatsapp).toEqual([['1', '2', '3']]);
  });

  it('🔴 la limite de contacts de l’offre n’est jamais dépassée : au-delà des places, la commande est comptée hors plafond', async () => {
    // Deux places : les deux premiers numéros naissent, le troisième non, et sa seconde commande non plus.
    const { deps, trace } = monterReprise({ limite: 3, fiches: { [NUMERO_A]: 'fa' } });
    const D = '+33633334444';
    const c = await rattacher(deps, T, [
      commandeLue(1, { telephone: NUMERO_B }), commandeLue(2, { telephone: NUMERO_C }), commandeLue(3, { telephone: D }),
      commandeLue(4, { telephone: NUMERO_B }), commandeLue(5, { telephone: D }), commandeLue(6, { telephone: NUMERO_A }),
    ], BOUTIQUE_REPRISE, ECRIRE);
    expect(c).toEqual({ ...zero, lues: 6, rattachees: 4, fichesCreees: 2, horsPlafond: 2 });
    expect(trace.creees.map((f) => f.numero)).toEqual([NUMERO_B, NUMERO_C]);
    expect(trace.liees.map((l) => l.commandeId)).toEqual(['1', '2', '4', '6']);
    // Plein : plus rien ne naît, une fiche déjà là reçoit encore ses commandes.
    const plein = await rattacher(deps, T, [commandeLue(7, { telephone: '+33655556666' }), commandeLue(8, { telephone: NUMERO_A })], BOUTIQUE_REPRISE, ECRIRE);
    expect(plein).toEqual({ ...zero, lues: 2, rattachees: 1, horsPlafond: 1 });
  });

  it('les lectures sont groupées par page, jamais une par commande ; les numéros des commandes connues ne sont pas cherchés', async () => {
    const { deps, trace } = monterReprise({ connues: { '1': connue('f1') }, fiches: { [NUMERO_A]: 'fa' } });
    await rattacher(deps, T, [commandeLue(1, { telephone: NUMERO_B }), commandeLue(2), commandeLue(3), commandeLue(4, { telephone: NUMERO_B })], BOUTIQUE_REPRISE, ECRIRE);
    expect(trace.connues).toEqual([['1', '2', '3', '4']]);
    expect(trace.numeros).toEqual([[NUMERO_A, NUMERO_B]]);
    expect(trace.refus).toEqual([[NUMERO_B]]);
    expect(trace.effacements).toEqual([[NUMERO_B]]);
    expect(trace.sansWhatsapp).toEqual([['4']]);
    expect(trace.places).toBe(1);
    // Toutes connues : aucun numéro à chercher, aucune place lue.
    const tout = monterReprise({ connues: { '1': connue('f1') } });
    await rattacher(tout.deps, T, [commandeLue(1)], BOUTIQUE_REPRISE, ECRIRE);
    expect(tout.trace.numeros).toEqual([]);
    expect(tout.trace.places).toBe(0);
  });

  it('🔴 à l’aperçu (simulation), il compte la même chose sans rien écrire, et garde d’une page à l’autre ce qu’il aurait créé', async () => {
    const { deps, trace } = monterReprise({ connues: { '1': connue('f1', true) }, fiches: { [NUMERO_A]: 'fa' } });
    const sim = simulation(1);
    const c = await rattacher(deps, T, [commandeLue(1), commandeLue(2), commandeLue(3, { telephone: NUMERO_B }), commandeLue(4, { telephone: NUMERO_C })], BOUTIQUE_REPRISE, { simulation: sim });
    expect(c).toEqual({ ...zero, lues: 4, rattachees: 2, deja: 1, fichesCreees: 1, horsPlafond: 1 });
    expect(trace.ecrites).toEqual([]);
    expect(trace.places).toBe(0);
    expect(sim).toEqual({ libres: 0, creees: new Set([NUMERO_B]), refusees: new Set([NUMERO_C]) });
    // Page suivante : B se rattache à la fiche « créée », C reste hors plafond ; seul C, sans fiche, se juge encore.
    const suite = await rattacher(deps, T, [commandeLue(5, { telephone: NUMERO_B }), commandeLue(6, { telephone: NUMERO_C })], BOUTIQUE_REPRISE, { simulation: sim });
    expect(suite).toEqual({ ...zero, lues: 2, rattachees: 1, horsPlafond: 1 });
    expect(trace.refus.at(-1)).toEqual([NUMERO_C]);
    expect(trace.places).toBe(0);
  });

  it('une commande lue incomplète chez Shopify (plus de 50 lignes) le dit sur ses lignes', async () => {
    const { deps, trace } = monterReprise({ fiches: { [NUMERO_A]: 'fa' } });
    await rattacher(deps, T, [commandeLue(1, { lignes: 2, tronquees: true }), commandeLue(2)], BOUTIQUE_REPRISE, ECRIRE);
    expect(trace.liees.map((l) => l.details.lignes?.tronquees)).toEqual([true, false]);
  });

  it('🔴 une commande connue qui a déjà ses lignes, ou dont la fiche n’est plus active, n’est jamais réécrite', async () => {
    // Le webhook en a gardé 120 lignes ; relue à 50 avec une suite, la réécrire la dirait tronquée à tort.
    const { deps, trace } = monterReprise({ connues: { '1': connue('f1'), '2': connue('f-supprimee', false) } });
    const c = await rattacher(deps, T, [commandeLue(1, { lignes: 50, tronquees: true }), commandeLue(2)], BOUTIQUE_REPRISE, ECRIRE);
    expect(c).toMatchObject({ lues: 2, deja: 2, rattachees: 0, fichesCreees: 0 });
    expect(trace.ecrites).toEqual([]);
  });

  it('une page vide ne lit rien', async () => {
    const { deps, trace } = monterReprise();
    expect(await rattacher(deps, T, [], BOUTIQUE_REPRISE, ECRIRE)).toEqual(zero);
    expect(trace.connues).toEqual([]);
  });
});

describe('la trace du consentement', () => {
  it('nomme l’attestation qui fonde l’accord : sa date et sa boutique', () => {
    expect(sourceDuConsentement('b.myshopify.com', ATTESTATION_REPRISE)).toBe(SOURCE_REPRISE);
  });
});

describe('l’aperçu', () => {
  it('lit toute la fenêtre, page après page, compte sans rien écrire et le dit complet, places libres comprises', async () => {
    const { deps, trace } = monterReprise({
      connues: { '1': connue('f1') }, fiches: { [NUMERO_A]: 'fa' }, limite: 100, autresFiches: 40,
      pages: { '': page([commandeLue(1), commandeLue(2)], 'c1', 3), c1: page([commandeLue(3, { telephone: NUMERO_B }), commandeLue(4, { telephone: null })], null, 1) },
    });
    const r = await apercuReprise(deps, T);
    expect(r).toEqual({ ok: true, valeur: {
      fenetreDebut: FENETRE, lues: 4, deja: 1, rattachables: 2, fichesACreer: 1, horsPlafond: 0, placesLibres: 59,
      remplitLesPlaces: false, sansFiche: 0, sansNumero: 1, ecartees: 4, complet: true, fenetre: { longue: false, limite: 'sans_droit' },
    } });
    expect(trace.lectures.map((l) => [l.apres, l.parPage, l.depuis])).toEqual([[null, PAR_PAGE_REPRISE, FENETRE], ['c1', PAR_PAGE_REPRISE, FENETRE]]);
    expect(trace.ecrites).toEqual([]);
  });

  it('🔴 il annonce ce que la limite empêcherait : les fiches dans les places, le reste hors plafond ; sans limite, places nulles', async () => {
    const pages = { '': page([commandeLue(1, { telephone: NUMERO_B }), commandeLue(2, { telephone: NUMERO_C })], 'c1'), c1: page([commandeLue(3, { telephone: '+33633334444' }), commandeLue(4, { telephone: NUMERO_C })], null) };
    const limite = await apercuReprise(monterReprise({ limite: 1, pages }).deps, T);
    expect(limite.ok && limite.valeur).toMatchObject({ fichesACreer: 1, rattachables: 1, horsPlafond: 3, placesLibres: 1 });
    const libre = await apercuReprise(monterReprise({ pages }).deps, T);
    expect(libre.ok && libre.valeur).toMatchObject({ fichesACreer: 3, rattachables: 4, horsPlafond: 0, placesLibres: null });
  });

  it('🔴 il prévient quand ces fiches prendraient les DERNIÈRES places d’une offre qui compte tous les contacts (un inconnu qui écrit le premier n’entrerait plus)', async () => {
    const pages = { '': page([commandeLue(1, { telephone: NUMERO_B }), commandeLue(2, { telephone: NUMERO_C })], null) };
    const apercu = async (o: Parameters<typeof monterReprise>[0]) => {
      const r = await apercuReprise(monterReprise({ ...o, pages }).deps, T);
      return r.ok ? r.valeur : null;
    };
    // Deux places, deux fiches : l'offre est pleine ensuite ; une place, une fiche et le reste hors plafond : pleine aussi.
    expect(await apercu({ limite: 2 })).toMatchObject({ fichesACreer: 2, placesLibres: 2, remplitLesPlaces: true });
    expect(await apercu({ limite: 1 })).toMatchObject({ fichesACreer: 1, horsPlafond: 1, remplitLesPlaces: true });
    // Une place de reste, ou sans limite : rien à dire.
    expect(await apercu({ limite: 3 })).toMatchObject({ remplitLesPlaces: false });
    expect(await apercu({})).toMatchObject({ placesLibres: null, remplitLesPlaces: false });
    // Déjà pleine, il ne crée rien : ce n'est pas lui qui la remplit.
    expect(await apercu({ limite: 0 })).toMatchObject({ fichesACreer: 0, horsPlafond: 2, remplitLesPlaces: false });
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

  it('🔴 sans l’attestation en vigueur de la boutique, un refus qui dit de la cocher, sans rien demander à Shopify', async () => {
    for (const attestation of [null, { ...ATTESTATION_REPRISE, domaine: 'autre.myshopify.com' }]) {
      const { deps, trace } = monterReprise({ attestation });
      expect(await apercuReprise(deps, T)).toEqual({ ok: false, statut: 409, message: PHRASE_ATTESTATION_RATTRAPAGE, cause: 'attestation_absente' });
      expect(trace.jetons).toBe(0);
      expect(trace.lectures).toEqual([]);
    }
  });

  it('🔴 les phrases de l’attestation : la console dit où cocher, sans un nom d’outil ; Claude Code, quoi demander et quel outil rappeler ; l’arrêt du job, ni l’un ni l’autre', () => {
    expect(PHRASE_ATTESTATION_RATTRAPAGE).toMatch(/offres comprises.*Scénario > Automation > Shopify/);
    // Un nom d'outil porte un tiret bas : aucun devant l'utilisateur de la console.
    expect(PHRASE_ATTESTATION_RATTRAPAGE).not.toMatch(/_/);
    expect(PHRASE_ATTESTATION_RATTRAPAGE_CLAUDE).toMatch(/offres comprises.*Posez-lui la question.*import_shopify_order_history.*customers_consent_attested/);
    // Lue par la console ET par Claude Code : ni chemin d'écran, ni nom d'outil.
    expect(PHRASE_ATTESTATION_RETIREE).not.toMatch(/_|Scénario >/);
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
    expect(r.valeur).toMatchObject({ statut: 'en_attente', interrompue: false, fenetreDebut: FENETRE, finiLe: null, erreur: null, comptes: zero });
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

  it('🔴 sans l’attestation, ou sans le droit read_products, le lancement est refusé avec sa phrase, sans rien inscrire ni enfiler', async () => {
    const cas: Array<[Parameters<typeof monterReprise>[0], object]> = [
      [{ attestation: null }, { message: PHRASE_ATTESTATION_RATTRAPAGE, cause: 'attestation_absente' }],
      [{ droits: ['read_orders'] }, { message: SANS_READ_PRODUCTS }],
    ];
    for (const [o, refus] of cas) {
      const { deps, trace, lignes } = monterReprise(o);
      expect(await lancerReprise(deps, T, null)).toEqual({ ok: false, statut: 409, ...refus });
      expect(lignes).toEqual([]);
      expect(trace.jobs).toEqual([]);
    }
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

  it('lit la fenêtre jusqu’au bout, crée les fiches manquantes, écrit, cumule les comptes et finit en « termine »', async () => {
    const { deps, trace, job, ligne } = await lance({
      connues: { '1': connue('f1', true) }, fiches: { [NUMERO_A]: 'fa' },
      pages: { '': page([commandeLue(1), commandeLue(2)], 'c1'), c1: page([commandeLue(3, { telephone: NUMERO_B }), commandeLue(4, { telephone: null })], null) },
    });
    await traiterReprise(deps, job);
    expect(ligne().r).toMatchObject({
      statut: 'termine', curseur: 'c1', erreur: null, comptes: { ...zero, lues: 4, rattachees: 2, deja: 1, sansNumero: 1, fichesCreees: 1 },
    });
    expect(ligne().r.finiLe).not.toBeNull();
    expect(ligne().jeton).toBeNull();
    expect(trace.liees.map((l) => l.commandeId)).toEqual(['1', '2', '3']);
    expect(trace.creees).toEqual([{ numero: NUMERO_B, nom: null, source: SOURCE_REPRISE, contactId: `fiche-${NUMERO_B}` }]);
    expect(trace.jobs).toEqual([]);
  });

  it('🔴 relancé, il ne crée rien de plus : les commandes rattrapées sont connues, les fiches créées déjà là', async () => {
    const pages = { '': page([commandeLue(1, { telephone: NUMERO_B }), commandeLue(2, { telephone: NUMERO_C })], null) };
    const faux = await lance({ pages });
    await traiterReprise(faux.deps, faux.job);
    expect(faux.ligne().r.comptes).toMatchObject({ fichesCreees: 2, rattachees: 2 });
    const second = await lancerReprise(faux.deps, T, null);
    if (!second.ok) throw new Error(second.message);
    await traiterReprise(faux.deps, { tenantId: T, repriseId: second.valeur.id });
    expect(faux.lignes[1]!.r).toMatchObject({ statut: 'termine', comptes: { ...zero, lues: 2, deja: 2 } });
    expect(faux.trace.creees).toHaveLength(2);
  });

  it('🔴 les places se relisent à chaque page : une page pleine compte hors plafond, sans jamais dépasser la limite', async () => {
    const { deps, trace, job, ligne } = await lance({
      limite: 2, fiches: { [NUMERO_A]: 'fa' },
      pages: { '': page([commandeLue(1, { telephone: NUMERO_B })], 'c1'), c1: page([commandeLue(2, { telephone: NUMERO_C }), commandeLue(3, { telephone: NUMERO_A })], null) },
    });
    await traiterReprise(deps, job);
    expect(ligne().r).toMatchObject({ statut: 'termine', comptes: { ...zero, lues: 3, rattachees: 2, fichesCreees: 1, horsPlafond: 1 } });
    expect(trace.places).toBe(2);
    expect(trace.creees.map((f) => f.numero)).toEqual([NUMERO_B]);
  });

  it('🔴 l’attestation retirée pendant le passage : la page lue n’est pas écrite, la reprise se clôt en « refuse » avec sa phrase', async () => {
    const { deps, trace, job, ligne } = await lance({ pages: { '': page([commandeLue(1, { telephone: NUMERO_B })], 'c1'), c1: page([commandeLue(2, { telephone: NUMERO_C })], null) } });
    const lire = deps.lirePage;
    let pages = 0;
    deps.lirePage = async (acces, p) => {
      const r = await lire(acces, p);
      // Décochée juste après la lecture de la deuxième page.
      if (++pages === 2) deps.attestation = async () => null;
      return r;
    };
    await traiterReprise(deps, job);
    expect(trace.creees.map((f) => f.numero)).toEqual([NUMERO_B]);
    expect(ligne().r).toMatchObject({ statut: 'refuse', erreur: PHRASE_ATTESTATION_RETIREE, comptes: { lues: 1, fichesCreees: 1 } });
  });

  it('🔴 sans attestation au passage du job (retirée après le lancement) : « refuse », rien n’est lu', async () => {
    const { deps, trace, job, ligne } = await lance({ pages: { '': page([commandeLue(1)], null) } });
    deps.attestation = async () => null;
    await traiterReprise(deps, job);
    expect(ligne().r).toMatchObject({ statut: 'refuse', erreur: PHRASE_ATTESTATION_RETIREE });
    expect(trace.lectures).toEqual([]);
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

  it('🔴 une panne de la base au milieu (une écriture qui lève, une place prise entre-temps) libère AUSSI le bail : le rejeu la prend', async () => {
    const { deps, trace, job, ligne } = await lance({
      fiches: { [NUMERO_A]: 'fa' },
      pages: { '': page([commandeLue(1)], 'c1'), c1: page([commandeLue(2, { telephone: NUMERO_B })], null) },
    });
    const ecrire = deps.ecrirePage;
    let pannes = 1;
    deps.ecrirePage = async (t, p) => { if (p.liaisons.some((l) => l.commandeId === '2') && pannes-- > 0) throw new Error('connexion perdue'); return ecrire(t, p); };
    await expect(traiterReprise(deps, job)).rejects.toThrow('connexion perdue');
    expect(ligne().bail).toBeNull();
    expect(ligne().r).toMatchObject({ statut: 'en_cours', curseur: 'c1' });
    // Le rejeu de pg-boss la PREND (il ne la trouve pas tenue) et finit.
    await traiterReprise(deps, job);
    expect(trace.jobs).toEqual([]);
    expect(ligne().r).toMatchObject({ statut: 'termine', comptes: { lues: 2, rattachees: 2, fichesCreees: 1 } });
  });

  it('🔴 la dernière page se compte UNE fois, même quand sa fin a échoué une première fois', async () => {
    const { deps, job, ligne } = await lance({ fiches: { [NUMERO_A]: 'fa' }, pages: { '': page([commandeLue(1), commandeLue(2)], null) } });
    const finir = deps.reprises.finir;
    let pannes = 1;
    deps.reprises.finir = async (...a) => { if (pannes-- > 0) throw new Error('connexion perdue'); return finir(...a); };
    await expect(traiterReprise(deps, job)).rejects.toThrow('connexion perdue');
    await traiterReprise(deps, job);
    // Écrites au premier passage, ses commandes sont connues au rejeu : lues une fois, comptées une fois.
    expect(ligne().r).toMatchObject({ statut: 'termine', comptes: { lues: 2, deja: 2, rattachees: 0 } });
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
    // L'attestation suit la boutique : celle d'avant vaudrait pour l'autre, la reprise s'arrête sur le changement.
    deps.attestation = async () => ATTESTATION_REPRISE;
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
    comptes: { ...zero, lues: 1, rattachees: 1 },
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
    expect(await etatReprise(deps, T)).toMatchObject({ statut: 'en_attente', comptes: { lues: 0, fichesCreees: 0, horsPlafond: 0 } });
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
      async attestation() { return { ...ATTESTATION_REPRISE, domaine: this.acces_.domaine }; }
      async lierCommandeDans() { this.vue.devise = 'ecrite'; }
    }
    class Contacts {
      private readonly fiches = new Map([['+41790000000', 'fiche']]);
      private readonly refus = new Set(['+41791111111']);
      private readonly effaces = new Map([['+41792222222', new Date('2026-11-10T08:00:00Z')]]);
      async fichesParNumeros() { return this.fiches; }
      async numerosEnRefus() { return this.refus; }
      async effacementsDesNumeros() { return this.effaces; }
      async placesContacts() { return { limite: 100, comptees: this.fiches.size, presents: new Set<string>() }; }
      async upsertManyByPhone() { return ['created' as const]; }
    }
    const jobs: Array<Date | undefined> = [];
    const pool = { query: async () => ({ rows: [{ commande_id: '9' }] }), connect: async () => ({ query: async () => ({ rows: [] }), release: () => undefined }) } as unknown as Pool;
    const deps = cablerReprise({
      offre: async () => 'pro',
      pool,
      reprises: {} as PgReprisesStore,
      boutiques: new Boutiques() as unknown as Pick<PgShopifyStore, 'acces' | 'lire' | 'commandesConnues' | 'lierCommandeDans' | 'attestation'>,
      contacts: new Contacts() as unknown as Pick<PgContactStore, 'fichesParNumeros' | 'numerosEnRefus' | 'effacementsDesNumeros' | 'placesContacts' | 'upsertManyByPhone'>,
      enfiler: async (_job, quand) => { jobs.push(quand); },
    });
    expect(await deps.boutique(T)).toMatchObject({ domaine: 'b.myshopify.com', pays: 'CH', devise: 'CHF', etat: 'connectee' });
    expect(await deps.attestation(T, 'b.myshopify.com')).toMatchObject({ coche: true });
    expect(await deps.attestation(T, 'autre.myshopify.com')).toBeNull();
    expect(await deps.commandesConnues(T, ['1'])).toEqual(new Map([['1', { contactId: 'CHF', aCompleter: false }]]));
    expect(await deps.fichesParNumeros(T, [])).toEqual(new Map([['+41790000000', 'fiche']]));
    expect(await deps.numerosEnRefus(T, [])).toEqual(new Set(['+41791111111']));
    expect(await deps.effacements(T, [])).toEqual(new Map([['+41792222222', new Date('2026-11-10T08:00:00Z')]]));
    expect(await deps.places(T)).toEqual({ limite: 100, comptees: 1 });
    expect(await deps.commandesSansWhatsapp(T, ['9'])).toEqual(new Set(['9']));
    await deps.ecrirePage(T, { fiches: [], source: SOURCE_REPRISE, liaisons: [{ commandeId: '1', clientId: null, contactId: 'fiche', details: { payeeLe: new Date(), montant: null, devise: null, test: false } }] });
    expect(await deps.boutique(T)).toMatchObject({ devise: 'ecrite' });
    const avant = Date.now();
    await deps.enfiler({ tenantId: T, repriseId: T }, 0);
    await deps.enfiler({ tenantId: T, repriseId: T }, 60);
    expect(jobs[0]).toBeUndefined();
    expect(jobs[1]!.getTime()).toBeGreaterThanOrEqual(avant + 60_000);
  });

  it('🔴 une page écrite en UNE transaction, par le chemin de l’import des abonnés : consentante, « Shopify », autorité import, marquée née Shopify ; puis ses commandes, par le client de la transaction', async () => {
    const requetes: string[] = [];
    const client = { query: async (sql: string) => { requetes.push(sql); return { rows: [] }; }, release: () => { requetes.push('release'); } };
    const pool = { connect: async () => client, query: async () => ({ rows: [] }) } as unknown as Pool;
    const lots: Array<{ lot: LotContacts; q: unknown }> = [];
    const liees: Array<{ q: unknown; commandeId: string; contactId: string }> = [];
    const deps = cablerReprise({
      offre: async () => 'pro',
      pool,
      reprises: {} as PgReprisesStore,
      boutiques: {
        lierCommandeDans: async (q: unknown, _t: string, commandeId: string, _c: string | null, contactId: string) => { liees.push({ q, commandeId, contactId }); },
      } as unknown as Pick<PgShopifyStore, 'acces' | 'lire' | 'commandesConnues' | 'lierCommandeDans' | 'attestation'>,
      contacts: {
        upsertManyByPhone: async (lot: LotContacts, q: unknown) => { lots.push({ lot, q }); return lot.contacts.map(() => 'created' as const); },
        fichesParNumeros: async (_t: string, numeros: readonly string[], q: unknown) => {
          expect(q).toBe(client);
          return new Map(numeros.map((n) => [n, `fiche-${n}`]));
        },
      } as unknown as Pick<PgContactStore, 'fichesParNumeros' | 'numerosEnRefus' | 'effacementsDesNumeros' | 'placesContacts' | 'upsertManyByPhone'>,
      enfiler: async () => undefined,
    });
    const details = { payeeLe: new Date(), montant: '10', devise: 'EUR', test: false };
    const r = await deps.ecrirePage(T, {
      fiches: [{ numero: NUMERO_B, nom: 'Léa Dupont' }], source: SOURCE_REPRISE,
      liaisons: [{ commandeId: '1', clientId: null, numero: NUMERO_B, details }, { commandeId: '2', clientId: null, contactId: 'fa', details }],
    });
    expect(r).toEqual({ creees: 1 });
    expect(lots).toEqual([{
      q: client,
      lot: {
        tenantId: T, optInStatus: 'opted_in', optInSource: SOURCE_REPRISE, tags: ['Shopify'], autorite: 'import', neeDe: 'shopify',
        contacts: [{ phoneE164: NUMERO_B, profileName: 'Léa Dupont', fields: {} }],
      },
    }]);
    expect(liees).toEqual([{ q: client, commandeId: '1', contactId: `fiche-${NUMERO_B}` }, { q: client, commandeId: '2', contactId: 'fa' }]);
    expect(requetes).toEqual(['begin', 'commit', 'release']);
  });

  it('🔴 une écriture qui lève annule la transaction entière : rollback, rien de validé', async () => {
    const requetes: string[] = [];
    const client = { query: async (sql: string) => { requetes.push(sql); return { rows: [] }; }, release: () => undefined };
    const pool = { connect: async () => client, query: async () => ({ rows: [] }) } as unknown as Pool;
    const deps = cablerReprise({
      offre: async () => 'pro',
      pool,
      reprises: {} as PgReprisesStore,
      boutiques: { lierCommandeDans: async () => { throw new Error('commande refusée'); } } as unknown as Pick<PgShopifyStore, 'acces' | 'lire' | 'commandesConnues' | 'lierCommandeDans' | 'attestation'>,
      contacts: {
        upsertManyByPhone: async () => ['created' as const],
        fichesParNumeros: async (_t: string, numeros: readonly string[]) => new Map(numeros.map((n) => [n, `fiche-${n}`])),
      } as unknown as Pick<PgContactStore, 'fichesParNumeros' | 'numerosEnRefus' | 'effacementsDesNumeros' | 'placesContacts' | 'upsertManyByPhone'>,
      enfiler: async () => undefined,
    });
    await expect(deps.ecrirePage(T, {
      fiches: [{ numero: NUMERO_B, nom: null }], source: SOURCE_REPRISE,
      liaisons: [{ commandeId: '1', clientId: null, numero: NUMERO_B, details: { payeeLe: new Date(), montant: null, devise: null, test: false } }],
    })).rejects.toThrow('commande refusée');
    expect(requetes).toEqual(['begin', 'rollback']);
  });
});

describe('les outils MCP du rattrapage', () => {
  const PERSONNE = { userId: 'u1', autorisationId: 'aut-1' } as never;
  const outil = (nom: string) => OUTILS.find((o) => o.nom === nom)!;
  const mcp = (reprise: ReturnType<typeof monterReprise>['deps'], accepte = true, lignes?: unknown) => ({
    shopify: { reprise, lignes }, couteux: { consommer: async () => ({ accepte, attenteMs: 4_000 }) },
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
    const { deps } = monterReprise({
      connues: { '1': connue('f1') }, fiches: { [NUMERO_A]: 'fa' }, limite: 50,
      pages: { '': page([commandeLue(1), commandeLue(2), commandeLue(3, { telephone: null }), commandeLue(4, { telephone: NUMERO_B })], null, 2) },
    });
    expect(await outil('get_shopify_order_history').executer(mcp(deps), T, {}, PERSONNE)).toMatchObject({ started: false });
    expect(await outil('preview_shopify_order_history').executer(mcp(deps), T, {}, PERSONNE)).toEqual({
      window_start: FENETRE, window: '60 days', longer_window: LONGER_SANS_DROIT, paid_orders_read: 4, already_known: 1, attachable: 2,
      records_to_create: 1, over_plan_limit: 0, free_places: 49, fills_free_places: false, without_record: 0, without_usable_phone: 1,
      never_paid: 2, complete: true,
    });
    const lance = await outil('import_shopify_order_history').executer(mcp(deps), T, {}, PERSONNE);
    expect(lance).toMatchObject({
      status: 'en_attente', window_start: FENETRE, counts: { paid_orders_read: 0, records_created: 0, over_plan_limit: 0 },
      next_step: expect.stringMatching(/get_shopify_order_history/),
    });
    await expect(outil('import_shopify_order_history').executer(mcp(deps), T, {}, PERSONNE)).rejects.toThrow(/déjà en cours/);
    expect(await outil('get_shopify_order_history').executer(mcp(deps), T, {}, PERSONNE)).toMatchObject({ started: true, status: 'en_attente', interrupted: false });
  });

  it('🔴 sans attestation, l’aperçu et le lancement refusent avec la phrase de Claude Code ; customers_consent_attested l’enregistre au nom de la personne, puis lance', async () => {
    const { deps, lignes } = monterReprise({ attestation: null });
    // La voix de Claude Code (quoi demander, quel outil rappeler), jamais celle de la console, qui dit où cocher.
    for (const nom of ['preview_shopify_order_history', 'import_shopify_order_history']) {
      await expect(outil(nom).executer(mcp(deps), T, {}, PERSONNE), nom).rejects.toMatchObject({
        name: 'RefusOutil', code: 'conflict', message: PHRASE_ATTESTATION_RATTRAPAGE_CLAUDE,
      });
    }
    expect(lignes).toEqual([]);
    // La case cochée par Claude Code, sur le oui du marchand : l'historique de l'attestation, puis le rattrapage.
    const attestations: Array<{ coche: boolean; par: string | null; origine: string }> = [];
    const store = {
      lire: async () => ({ domaine: BOUTIQUE_REPRISE.domaine, etat: 'connectee' }),
      attester: async (_t: string, a: { coche: boolean; par: string | null; origine: string }) => {
        attestations.push({ coche: a.coche, par: a.par, origine: a.origine });
        deps.attestation = async () => ATTESTATION_REPRISE;
      },
      attestation: async () => ATTESTATION_REPRISE,
    };
    const r = await outil('import_shopify_order_history').executer(mcp(deps, true, { store }), T, { customers_consent_attested: true }, PERSONNE);
    expect(attestations).toEqual([{ coche: true, par: 'u1', origine: 'claude_code' }]);
    expect(r).toMatchObject({ status: 'en_attente' });
    expect(lignes).toHaveLength(1);
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

/**
 * LA FENÊTRE DE 24 MOIS (segments Shopify enrichis, lot 7a) : hors Free, quand l'app a `read_all_orders` ; sinon 60
 * jours, et la raison dite. Une reprise longue dont l'app perd le droit s'arrête au lieu de se dire finie sur 60 jours.
 */
describe('la fenêtre de 24 mois (lot 7a)', () => {
  const TOUT = [...DROITS_A_JOUR, 'read_all_orders'];

  it('🔴 24 mois au même jour du mois ; une reprise est longue au-delà de 90 jours avant son lancement', () => {
    expect(FENETRE_LONGUE_MOIS).toBe(24);
    expect(debutDeFenetre(MIDI_REPRISE, true).toISOString()).toBe(FENETRE_LONGUE);
    expect(repriseLongue(new Date(FENETRE_LONGUE), MIDI_REPRISE)).toBe(true);
    expect(repriseLongue(new Date(FENETRE), MIDI_REPRISE)).toBe(false);
    expect(repriseLongue(new Date(FENETRE), MIDI_REPRISE + 40 * 86_400_000)).toBe(true);
  });

  it('🔴 l’aperçu lit 24 mois hors Free avec read_all_orders ; sans le droit, ou en Free, 60 jours et la raison', async () => {
    for (const [offre, droits, debut, fenetre] of [
      ['pro', TOUT, FENETRE_LONGUE, { longue: true, limite: null }],
      ['entreprise', TOUT, FENETRE_LONGUE, { longue: true, limite: null }],
      ['business', DROITS_A_JOUR, FENETRE, { longue: false, limite: 'sans_droit' }],
      ['base', TOUT, FENETRE, { longue: false, limite: 'free' }],
    ] as const) {
      const { deps, trace } = monterReprise({ offre, droits: [...droits], pages: { '': page([commandeLue(1)], null) } });
      const a = await apercuReprise(deps, T);
      expect(a, offre).toMatchObject({ ok: true, valeur: { fenetreDebut: debut, fenetre, lues: 1, complet: true } });
      expect(trace.lectures.map((l) => l.depuis), offre).toEqual([debut]);
    }
  });

  it('🔴 le lancement écrit la longue fenêtre sur la reprise, et le job lit depuis elle', async () => {
    const { deps, trace, lignes } = monterReprise({ droits: [...TOUT], pages: { '': page([commandeLue(1)], null) } });
    const r = await lancerReprise(deps, T, 'u1');
    expect(r).toMatchObject({ ok: true, valeur: { fenetreDebut: FENETRE_LONGUE } });
    await traiterReprise(deps, trace.jobs[0]!.job);
    expect(trace.lectures.map((l) => l.depuis)).toEqual([FENETRE_LONGUE]);
    expect(lignes[0]!.r).toMatchObject({ statut: 'termine', erreur: null });
  });

  it('🔴 une reprise longue dont l’app a perdu read_all_orders s’arrête en « refuse » avec sa phrase, sans rien lire', async () => {
    const droits = [...TOUT];
    const { deps, trace, lignes } = monterReprise({ droits, pages: { '': page([commandeLue(1)], null) } });
    const r = await lancerReprise(deps, T, null);
    expect(r.ok).toBe(true);
    droits.pop();
    await traiterReprise(deps, trace.jobs[0]!.job);
    expect(trace.lectures).toEqual([]);
    expect(lignes[0]!.r).toMatchObject({ statut: 'refuse', erreur: READ_ALL_ORDERS_RETIRE });
  });

  it('🔴 une reprise courte poursuit sans le droit, même reprise des semaines plus tard : longue se juge au lancement', async () => {
    const { deps, trace, lignes, horloge } = monterReprise({ pages: { '': page([commandeLue(1)], null) } });
    const r = await lancerReprise(deps, T, null);
    expect(r).toMatchObject({ ok: true, valeur: { fenetreDebut: FENETRE } });
    horloge.t += 45 * 86_400_000;
    await traiterReprise(deps, trace.jobs[0]!.job);
    expect(trace.lectures.map((l) => l.depuis)).toEqual([FENETRE]);
    expect(lignes[0]!.r).toMatchObject({ statut: 'termine' });
  });

  it('🔴 l’outil dit la fenêtre et ce qui l’allongerait : 24 mois, ou l’offre Pro, ou le droit', async () => {
    const PERSONNE = { userId: 'u1', autorisationId: 'aut-1' } as never;
    const outil = (nom: string) => OUTILS.find((o) => o.nom === nom)!;
    const mcp = (reprise: ReturnType<typeof monterReprise>['deps']) => ({
      shopify: { reprise }, couteux: { consommer: async () => ({ accepte: true, attenteMs: 0 }) },
    }) as unknown as DepsMcp;
    const attendu: Array<[Parameters<typeof monterReprise>[0], Record<string, unknown>]> = [
      [{ droits: [...TOUT] }, { window_start: FENETRE_LONGUE, window: '24 months', longer_window: null }],
      [{}, { window_start: FENETRE, window: '60 days', longer_window: LONGER_SANS_DROIT }],
      [{ offre: 'base', droits: [...TOUT] }, { window_start: FENETRE, window: '60 days', longer_window: 'a paid plan (Pro and above), with the read_all_orders scope on the store app: the catch-up then reads 24 months' }],
    ];
    for (const [o, sortie] of attendu) {
      const { deps } = monterReprise(o);
      expect(await outil('preview_shopify_order_history').executer(mcp(deps), T, {}, PERSONNE), JSON.stringify(o)).toMatchObject(sortie);
    }
  });
});

/**
 * 🔴 UN CONTACT PURGÉ AVANT LA TRACE NE RENAÎT PAS (lot 7a, relecture) : la trace des numéros effacés date du 2026-11-24 ;
 * dans un espace qui a purgé un contact avant, une commande payée avant elle ne fonde aucune fiche. Elle se rattache
 * encore à une fiche déjà là. Le SQL de la question est éprouvé sur PGlite (`shopify-fiches-acheteurs`).
 */
describe('les purges d’avant la trace des numéros effacés (lot 7a)', () => {
  it('🔴 un espace qui a purgé avant la trace : la commande payée avant elle ne crée aucune fiche, celle d’après si', async () => {
    const { deps, trace } = monterReprise({ purgesAvantTrace: true });
    const c = await rattacher(deps, T, [
      commandeLue(1, { telephone: NUMERO_A, payeeLe: '2026-11-20T10:00:00Z' }),
      commandeLue(2, { telephone: NUMERO_B, payeeLe: '2026-11-25T10:00:00Z' }),
    ], BOUTIQUE_REPRISE, { source: SOURCE_REPRISE });
    expect(c).toMatchObject({ sansFiche: 1, rattachees: 1, fichesCreees: 1 });
    expect(trace.creees.map((x) => x.numero)).toEqual([NUMERO_B]);
    expect(trace.purgesAvantTrace).toBe(1);
  });

  it('🔴 une date de paiement illisible vaut un paiement d’avant ; un espace sans purge d’avant crée comme avant', async () => {
    const purge = monterReprise({ purgesAvantTrace: true });
    expect(await rattacher(purge.deps, T, [commandeLue(1, { telephone: NUMERO_A, payeeLe: null })], BOUTIQUE_REPRISE, { source: SOURCE_REPRISE }))
      .toMatchObject({ sansFiche: 1, fichesCreees: 0 });
    const propre = monterReprise({});
    expect(await rattacher(propre.deps, T, [commandeLue(1, { telephone: NUMERO_A, payeeLe: '2026-11-20T10:00:00Z' })], BOUTIQUE_REPRISE, { source: SOURCE_REPRISE }))
      .toMatchObject({ sansFiche: 0, fichesCreees: 1 });
  });

  it('une fiche déjà là reçoit sa commande d’avant ; sans commande à juger d’avant la trace, l’espace n’est pas lu', async () => {
    const { deps, trace } = monterReprise({ purgesAvantTrace: true, fiches: { [NUMERO_A]: 'fa' } });
    expect(await rattacher(deps, T, [commandeLue(1, { telephone: NUMERO_A, payeeLe: '2026-11-20T10:00:00Z' })], BOUTIQUE_REPRISE, { source: SOURCE_REPRISE }))
      .toMatchObject({ rattachees: 1, sansFiche: 0 });
    await rattacher(deps, T, [commandeLue(2, { telephone: NUMERO_B, payeeLe: '2026-11-26T10:00:00Z' })], BOUTIQUE_REPRISE, { source: SOURCE_REPRISE });
    expect(trace.purgesAvantTrace).toBe(0);
  });

  it('🔴 un aperçu partiel prévient que les places peuvent se remplir : la suite de la fenêtre n’est pas lue', async () => {
    const { deps } = monterReprise({ limite: 50, msParPage: 30_000, pages: { '': page([commandeLue(1, { telephone: NUMERO_A })], 'c1'), c1: page([commandeLue(2, { telephone: NUMERO_B })], null) } });
    const a = await apercuReprise(deps, T);
    expect(a).toMatchObject({ ok: true, valeur: { complet: false, remplitLesPlaces: true } });
  });
});
