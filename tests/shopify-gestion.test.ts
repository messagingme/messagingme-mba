import { describe, it, expect, vi } from 'vitest';
import type { AgentResume } from '../src/agent/agent-store';
import type { IssueCreationDeBloc } from '../src/workflow/modeles-de-bloc';
import { corpsStandard } from '../src/shopify/messages-standard';
import { EVENEMENTS_SHOPIFY } from '../src/shopify/donnees';

import { TEXTE_ATTESTATION_SHOPIFY } from '../web/lib/partage/shopify-messages';
import {
  apercuImportClients, brancherMessage, CLIENTS_LUS_MAX, connecterShopify, couperShopify, etatShopify, IMPORT_MAX, importerClients,
  PHRASE_SHOPIFY_QR_CODE, type DepsGestionShopify,
} from '../src/shopify/gestion';
import type { ClientAbonne, LectureClients } from '../src/shopify/clients';
import type { IssueJeton } from '../src/shopify/connexion';
import type { ImportInput } from '../src/crm/import';
import { LimiteOffreError } from '../src/offres/refus';
import type { LectureModele } from '../src/api/modele-envoi';
import type { AccesBoutique, MessageBranche, VueBoutique } from '../src/shopify/store.pg';
import { OUTILS, type DepsMcp } from '../src/mcp/outils';
import type { Filiere } from '../src/application/comptes';
import { MESSAGE_OPERATIONS_LOURDES } from '../src/auth/plafond-partage';
import { addDays, todayParis, type DateRange } from '../src/stats/range';
import type { ChiffreVentes } from '../src/shopify/chiffre';
import { reglerLigne } from '../src/shopify/lignes-gestion';
import { blocVerrouille } from '../src/shopify/premier-bloc';
import { DROITS, type Offre } from '../src/offres/offres';
import type { TemplateSummary } from '../src/meta/templates';
import type { WorkflowGraph } from '../src/workflow/graph';
import { modeleMeta, monterLignes } from './shopify-lignes-faux';

const DOMAINE = 'b.myshopify.com';

/** Le chiffre que rend la lecture des ventes (plan 2026-10-30, lot 2) : seuls ses paniers entrent dans l'état. */
const CHIFFRE: ChiffreVentes = {
  periode: { from: '2026-10-24', to: '2026-10-30' },
  reel: { totaux: [{ devise: 'EUR', brut: '99.9', prouve: '59.9', commandes: 2 }], sources: [] },
  test: { totaux: [], sources: [] },
  paniers: { relances: 4, recuperes: 2, montants: [{ devise: 'EUR', montant: '59.9' }], recuperesTest: 1 },
};

/**
 * LA GESTION DU CONNECTEUR SHOPIFY (plan 2026-10-21, lot 1), porte unique des outils MCP et de la console. Chaque refus
 * dit le geste qui le règle ; aucun secret n'est gardé sans que Shopify ait accepté la connexion. Depuis le menu
 * « Scénario » (lot 5), un message Shopify est le PREMIER BLOC du scénario de la ligne de son événement.
 */

const T = 't1';
const VUE: VueBoutique = {
  domaine: 'b.myshopify.com', nom: 'Essai', pays: 'FR', devise: 'EUR', etat: 'connectee', motifCoupure: null, coupeeLe: null,
  connecteeLe: '2026-10-21T00:00:00.000Z', dernierEvenementLe: null, delaiPanierMinutes: 60, origine: 'claude_code', pauseLe: null,
};
const PERSONNE = { userId: 'u1', autorisationId: 'aut-1' } as never;

function monter(o: {
  boutique?: VueBoutique | null; modele?: LectureModele; ailleurs?: boolean; verif?: Awaited<ReturnType<DepsGestionShopify['verifier']>>;
  jeton?: Awaited<ReturnType<DepsGestionShopify['jeton']>>; abonnement?: Awaited<ReturnType<DepsGestionShopify['abonner']>>;
  acces?: Awaited<ReturnType<DepsGestionShopify['store']['acces']>>;
  anciens?: MessageBranche[]; filiere?: Filiere | null; modeles?: TemplateSummary[]; arretLeve?: boolean;
  creation?: IssueCreationDeBloc | 'leve'; agents?: AgentResume[];
} = {}) {
  // La boutique vit dans le faux des lignes : la gestion et les lignes lisent la MÊME (une coupure se voit des deux côtés).
  const lignes = monterLignes({
    vue: o.boutique === undefined ? VUE : o.boutique, modeles: o.modeles ?? [modeleMeta({ buttons: [] }), modeleMeta({ id: 'm2', name: 'relance', category: 'MARKETING', buttons: [] })],
    arretLeve: o.arretLeve, creation: o.creation, filiere: o.filiere, agents: o.agents,
  });
  const journal = { connexions: [] as unknown[], coupes: 0, verifs: 0, abonnements: [] as unknown[], lecturesModele: 0, chiffres: [] as DateRange[] };
  const deps: DepsGestionShopify = {
    store: {
      lire: () => lignes.store.lire(),
      connecter: async (_t, c) => { journal.connexions.push(c); if (o.ailleurs) return 'boutique_ailleurs'; lignes.store.vue = { ...VUE, domaine: c.domaine }; return 'ok'; },
      couper: async () => {
        journal.coupes += 1;
        const v = lignes.store.vue;
        const deja = v?.etat === 'coupee';
        if (v) lignes.store.vue = { ...v, etat: 'coupee' };
        return !deja;
      },
      messages: async () => o.anciens ?? [],
      compteurs: async () => ({ envoye: 3 }),
      compteursPaniers: async () => ({ relances: { envoye: 1 }, fermesATemps: 2, enAttente: 3 }),
      acces: async () => o.acces ?? null,
      attentes: async () => [],
    },
    verifier: async () => { journal.verifs += 1; return o.verif ?? { ok: true, nom: 'Essai', pays: 'FR', devise: 'EUR' }; },
    lireModele: async () => { journal.lecturesModele += 1; return o.modele ?? { statut: 'approuve', categorie: 'utility', variables: 2 }; },
    chiffrementPret: true,
    jeton: async () => o.jeton ?? { ok: true, jeton: 'jeton-de-test' },
    lireClients: async () => { throw new Error('lireClients : hors de ce test'); },
    places: async () => { throw new Error('places : hors de ce test'); },
    importer: async () => { throw new Error('importer : hors de ce test'); },
    abonner: async (acces) => { journal.abonnements.push(acces); return o.abonnement ?? { ok: true, abonnes: ['ORDERS_PAID'], deja: [] }; },
    // La filière API par défaut : tous les tests d'avant le texte simple (plan 2026-10-23) restent ceux de l'API.
    filiere: async () => (o.filiere === undefined ? 'api' : o.filiere),
    chiffreVentes: async (_t, range) => { journal.chiffres.push(range); return CHIFFRE; },
    lignes: lignes.deps,
  };
  return { deps, journal, lignes };
}

/** Les dépendances des outils MCP : la gestion, et l'offre de l'espace (la Free n'a pas les scénarios). */
const mcpDe = (deps: DepsGestionShopify, offre: Offre = 'pro'): DepsMcp => ({
  shopify: deps, offres: { offreDe: async () => ({ offre, droits: DROITS[offre], retourEnBaseLe: null }) },
}) as unknown as DepsMcp;

describe('connecter une boutique', () => {
  it('vérifie chez Shopify, puis garde la boutique ; le domaine se normalise', async () => {
    const { deps, journal } = monter({ boutique: null });
    const r = await connecterShopify(deps, T, { boutique: 'B.myshopify.com', clientId: 'cid', secret: 'shpss_x' }, 'u1', 'claude_code');
    expect(r.ok).toBe(true);
    expect(journal.connexions).toEqual([{ domaine: 'b.myshopify.com', clientId: 'cid', secretClair: 'shpss_x', nom: 'Essai', pays: 'FR', devise: 'EUR', par: 'u1', origine: 'claude_code' }]);
    // Claude Code : les webhooks sont dans l'app de la CLI, rien ne s'abonne par l'API.
    expect(journal.abonnements).toEqual([]);
  });

  it('🔴 le branchement propose les trois messages standard (2026-11-20), lignes ÉTEINTES ; Meta en panne ne fait pas échouer le branchement', async () => {
    const { deps, lignes } = monter({ boutique: null });
    expect((await connecterShopify(deps, T, { boutique: 'b.myshopify.com', clientId: 'cid', secret: 's' }, 'u1', 'claude_code')).ok).toBe(true);
    expect(lignes.creation.appels.map((a) => a.corps)).toEqual(EVENEMENTS_SHOPIFY.map((e) => corpsStandard(e, DOMAINE).corps));
    expect([...lignes.store.lignesEnBase.values()].map((l) => l.actif)).toEqual([false, false, false]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const panne = monter({ boutique: null, creation: 'leve' });
    expect((await connecterShopify(panne.deps, T, { boutique: 'b.myshopify.com', clientId: 'cid', secret: 's' }, 'u1', 'claude_code')).ok).toBe(true);
    vi.restoreAllMocks();
    // Un branchement refusé ne propose rien.
    const refusee = monter({ boutique: null, verif: { ok: false, code: 'app_non_installee', message: 'cliquez Installer' } });
    await connecterShopify(refusee.deps, T, { boutique: 'b.myshopify.com', clientId: 'cid', secret: 's' }, 'u1', 'claude_code');
    expect(refusee.lignes.creation.appels).toEqual([]);
  });

  it('🔴 rebrancher la MÊME boutique ne propose rien (« nouvelles seulement ») ; une autre boutique, si', async () => {
    const meme = monter();
    expect((await connecterShopify(meme.deps, T, { boutique: 'b.myshopify.com', clientId: 'cid', secret: 's' }, 'u1', 'claude_code')).ok).toBe(true);
    expect(meme.lignes.creation.appels).toEqual([]);
    const autre = monter();
    expect((await connecterShopify(autre.deps, T, { boutique: 'autre.myshopify.com', clientId: 'cid', secret: 's' }, 'u1', 'claude_code')).ok).toBe(true);
    expect(autre.lignes.creation.appels).toHaveLength(3);
  });

  it('🔴 un refus de Shopify ne garde rien ; une saisie mal formée ne va même pas chez Shopify', async () => {
    const refusee = monter({ verif: { ok: false, code: 'app_non_installee', message: 'cliquez Installer' } });
    expect(await connecterShopify(refusee.deps, T, { boutique: 'b.myshopify.com', clientId: 'cid', secret: 's' }, null, 'claude_code')).toEqual({ ok: false, statut: 422, message: 'cliquez Installer' });
    expect(refusee.journal.connexions).toEqual([]);
    const passagere = monter({ verif: { ok: false, code: 'passager', message: 'réessayez' } });
    expect(await connecterShopify(passagere.deps, T, { boutique: 'b.myshopify.com', clientId: 'cid', secret: 's' }, null, 'claude_code')).toMatchObject({ ok: false, statut: 503 });
    const malFormee = monter();
    for (const s of [{ boutique: 'evil.com', clientId: 'cid', secret: 's' }, { boutique: 'b', clientId: 'c id', secret: 's' }, { boutique: 'b', clientId: 'cid', secret: '' }]) {
      expect(await connecterShopify(malFormee.deps, T, s, null, 'claude_code')).toMatchObject({ ok: false, statut: 400 });
    }
    expect(malFormee.journal.verifs).toBe(0);
  });

  it('une boutique tenue par un autre espace : 409, avec la phrase', async () => {
    const { deps } = monter({ ailleurs: true });
    expect(await connecterShopify(deps, T, { boutique: 'b.myshopify.com', clientId: 'cid', secret: 's' }, null, 'claude_code')).toMatchObject({ ok: false, statut: 409 });
  });
});

describe('brancher une boutique depuis la console (conception 2026-10-22)', () => {
  it('🔴 origine console : les six webhooks s’abonnent par l’API avec le jeton de l’app, et l’origine est gardée', async () => {
    const { deps, journal } = monter({ boutique: null });
    const r = await connecterShopify(deps, T, { boutique: 'b.myshopify.com', clientId: ' cid ', secret: 'shpss_x\n' }, 'u1', 'console');
    expect(r.ok).toBe(true);
    // Les clés collées depuis la page de Shopify sont nettoyées avant la vérification.
    expect(journal.connexions).toMatchObject([{ clientId: 'cid', secretClair: 'shpss_x', origine: 'console' }]);
    expect(journal.abonnements).toEqual([{ domaine: 'b.myshopify.com', jeton: 'jeton-de-test' }]);
  });

  it('🔴 la boutique de Claude Code rebranchée depuis la console avec les clés de SON app reste claude_code, sans abonnement', async () => {
    const cli = { domaine: 'b.myshopify.com', clientId: 'cid', secret: 'shpss_x', pays: 'FR', etat: 'coupee' as const, origine: 'claude_code' as const };
    const meme = monter({ boutique: null, acces: cli });
    expect((await connecterShopify(meme.deps, T, { boutique: 'b.myshopify.com', clientId: 'cid', secret: 'shpss_x' }, 'u1', 'console')).ok).toBe(true);
    expect(meme.journal.connexions).toMatchObject([{ origine: 'claude_code' }]);
    expect(meme.journal.abonnements).toEqual([]);
    // Une AUTRE app (créée à la main) fait d'elle une boutique de la console, abonnée par l'API.
    const autre = monter({ boutique: null, acces: cli });
    expect((await connecterShopify(autre.deps, T, { boutique: 'b.myshopify.com', clientId: 'cid-console', secret: 'shpss_y' }, 'u1', 'console')).ok).toBe(true);
    expect(autre.journal.connexions).toMatchObject([{ origine: 'console' }]);
    expect(autre.journal.abonnements).toHaveLength(1);
  });

  it('un abonnement qui échoue rend 503 et le dit : la boutique reste branchée, un nouvel essai est idempotent', async () => {
    const { deps, journal } = monter({ boutique: null, abonnement: { ok: false, message: 'Shopify refuse (ORDERS_PAID).' } });
    const r = await connecterShopify(deps, T, { boutique: 'b.myshopify.com', clientId: 'cid', secret: 'shpss_x' }, 'u1', 'console');
    expect(r).toMatchObject({ ok: false, statut: 503, message: expect.stringContaining('ORDERS_PAID') });
    expect(journal.connexions).toHaveLength(1);
    const sansJeton = monter({ boutique: null, jeton: { ok: false, code: 'app_non_installee', message: 'Installez l’app.' } });
    expect(await connecterShopify(sansJeton.deps, T, { boutique: 'b.myshopify.com', clientId: 'cid', secret: 'shpss_x' }, 'u1', 'console'))
      .toMatchObject({ ok: false, statut: 422, message: 'Installez l’app.' });
    expect(sansJeton.journal.abonnements).toEqual([]);
  });
});

/**
 * 🔴 UN MESSAGE SHOPIFY EST LE PREMIER BLOC DU SCÉNARIO DE SA LIGNE (menu « Scénario », lot 5, tâche 8). Les attentes
 * de ces tests ont changé avec la bascule : `set_shopify_message` ne remplit plus l'ancienne table des messages, il pose
 * le template dans le bloc verrouillé du scénario (la ligne et son scénario naissent s'ils manquent) et règle
 * l'interrupteur de la ligne ; éteindre arrête ses parcours.
 */
describe('brancher un message : le premier bloc du scénario de sa ligne', () => {
  const branchement = { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: ['first_name', 'order_number'], actif: true };

  it('un modèle utility approuvé, autant de variables que lui : la ligne naît, son premier bloc le reçoit, elle s’allume', async () => {
    const { deps, lignes } = monter();
    const r = await brancherMessage(deps, T, branchement, 'u1');
    expect(r).toMatchObject({ ok: true, valeur: { programmationAnnulee: false, lignes: [{ evenement: 'order_paid', actif: true, modele: 'commande_payee', langue: 'fr', blocs: 1 }] } });
    const ligne = (await lignes.store.ligne(T, 'order_paid'))!;
    expect(blocVerrouille((await lignes.workflows.getById(ligne.workflowId, T))!.graph)?.data).toMatchObject({
      templateName: 'commande_payee', language: 'fr',
      variables: [{ position: 1, source: { type: 'variable', key: 'first_name' } }, { position: 2, source: { type: 'variable', key: 'order_number' } }],
    });
    expect(lignes.store.gestes).toEqual(['allumer:order_paid']);
  });

  it('🔴 refusé : modèle marketing, non approuvé, ou dont le nombre de variables diffère ; rien ne naît', async () => {
    for (const modele of [
      { statut: 'approuve', categorie: 'marketing', variables: 2 }, { statut: 'absent' }, { statut: 'approuve', categorie: 'utility', variables: 3 },
    ] as LectureModele[]) {
      const { deps, lignes } = monter({ modele });
      expect(await brancherMessage(deps, T, branchement, null)).toMatchObject({ ok: false, statut: 422 });
      expect([lignes.store.lignesEnBase.size, lignes.workflows.parId.size]).toEqual([0, 0]);
    }
  });

  it('🔴 refusé : une donnée que l’événement ne porte pas, une boutique absente ou coupée', async () => {
    const { deps } = monter();
    expect(await brancherMessage(deps, T, { ...branchement, variables: ['tracking_url'] }, null)).toMatchObject({ ok: false, statut: 400 });
    expect(await brancherMessage(monter({ boutique: null }).deps, T, branchement, null)).toMatchObject({ ok: false, statut: 409 });
    expect(await brancherMessage(monter({ boutique: { ...VUE, etat: 'coupee' } }).deps, T, branchement, null)).toMatchObject({ ok: false, statut: 409 });
  });

  it('allumer exige un template ; des variables sans template sont refusées', async () => {
    const { deps, lignes } = monter();
    expect(await brancherMessage(deps, T, { ...branchement, modele: undefined, variables: undefined }, null))
      .toMatchObject({ ok: false, statut: 400, message: expect.stringContaining('template') });
    expect(await brancherMessage(deps, T, { ...branchement, modele: undefined, actif: false }, null))
      .toMatchObject({ ok: false, statut: 400, message: expect.stringContaining('variables') });
    expect(lignes.workflows.parId.size).toBe(0);
  });

  it('🔴 éteindre ne relit pas le modèle chez Meta : le template se pose, la ligne s’éteint et ses parcours s’arrêtent', async () => {
    const { deps, journal, lignes } = monter();
    await brancherMessage(deps, T, branchement, 'u1');
    expect(journal.lecturesModele).toBe(1);
    const r = await brancherMessage(deps, T, { ...branchement, actif: false }, 'u1');
    expect(r).toMatchObject({ ok: true, valeur: { lignes: [{ evenement: 'order_paid', actif: false, modele: 'commande_payee' }] } });
    expect(journal.lecturesModele).toBe(1);
    expect(lignes.parcours.arrets).toEqual([{ prefixe: 'shopify:b.myshopify.com:orders/paid:', motif: 'ligne éteinte' }]);
  });

  it('éteindre sans template : la ligne s’éteint ; sans ligne, rien ne se crée', async () => {
    const { deps, lignes } = monter();
    expect(await brancherMessage(deps, T, { evenement: 'order_paid', modele: undefined, langue: 'fr', variables: undefined, actif: false }, null))
      .toEqual({ ok: true, valeur: { lignes: [], programmationAnnulee: false } });
    expect(lignes.workflows.parId.size).toBe(0);
    await brancherMessage(deps, T, branchement, 'u1');
    expect(await brancherMessage(deps, T, { evenement: 'order_paid', modele: undefined, langue: 'fr', variables: undefined, actif: false }, null))
      .toMatchObject({ ok: true, valeur: { lignes: [{ evenement: 'order_paid', actif: false, modele: 'commande_payee' }] } });
  });

  it('🔴 la version programmée que la publication annule est rendue', async () => {
    const { deps, lignes } = monter();
    await brancherMessage(deps, T, branchement, 'u1');
    const ligne = (await lignes.store.ligne(T, 'order_paid'))!;
    lignes.workflows.programmees.set(ligne.workflowId, { graphe: { nodes: [], edges: [] }, le: '2026-11-19T10:00:00.000Z', par: 'u2' });
    expect(await brancherMessage(deps, T, branchement, 'u1')).toMatchObject({ ok: true, valeur: { programmationAnnulee: true } });
  });
});

describe('la relance de panier (lot 2)', () => {
  const panier = { evenement: 'checkout_abandoned', modele: 'relance', langue: 'fr', variables: ['first_name', 'checkout_url'], actif: true };
  const marketing: LectureModele = { statut: 'approuve', categorie: 'marketing', variables: 2 };

  it('🔴 elle s’allume sans aucune affirmation du consentement (décision de Julien du 2026-10-26)', async () => {
    const { deps } = monter({ modele: marketing });
    expect(await brancherMessage(deps, T, panier, 'u1')).toMatchObject({ ok: true, valeur: { lignes: [{ evenement: 'checkout_abandoned', actif: true, modele: 'relance' }] } });
  });

  it('un modèle marketing est admis pour le panier, et le délai se règle dans ses bornes', async () => {
    const { deps, lignes } = monter({ modele: marketing });
    expect((await brancherMessage(deps, T, { ...panier, delaiMinutes: 30 }, null)).ok).toBe(true);
    expect(lignes.store.gestes).toEqual(['allumer:checkout_abandoned', 'delai:30']);
    for (const delaiMinutes of [14, 4321, 30.5, '60']) {
      expect(await brancherMessage(deps, T, { ...panier, delaiMinutes }, null)).toMatchObject({ ok: false, statut: 400 });
    }
    const commande = { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: [], actif: true };
    expect(await brancherMessage(deps, T, { ...commande, delaiMinutes: 30 }, null)).toMatchObject({ ok: false, statut: 400 });
  });

  it('éteindre la relance n’exige rien', async () => {
    const { deps } = monter({ modele: marketing });
    expect((await brancherMessage(deps, T, { ...panier, actif: false }, null)).ok).toBe(true);
  });
});

/**
 * 🔴 SUR UN NUMÉRO RELIÉ PAR QR CODE, AUCUN MESSAGE SHOPIFY NE S'ALLUME (décision de Julien du 2026-10-24) : ce numéro ne
 * fait que répondre, et un message Shopify écrirait en premier. L'éteindre reste permis. Le texte simple de ce numéro
 * n'existe plus depuis le lot 5 : son automation est un scénario, qu'il ne peut pas envoyer.
 */
describe('un message Shopify sur un numéro relié par QR code', () => {
  it('🔴 allumer est refusé (409, la phrase de ce numéro), pour chacun des trois, sans rien lire ni créer', async () => {
    for (const [evenement, modele] of [['order_paid', 'commande_payee'], ['order_fulfilled', 'expedition'], ['checkout_abandoned', 'relance']] as const) {
      for (const actif of [true, undefined]) {
        const { deps, journal, lignes } = monter({ filiere: 'application' });
        expect(await brancherMessage(deps, T, { evenement, modele, langue: 'fr', variables: undefined, actif }, 'u1'), evenement)
          .toEqual({ ok: false, statut: 409, message: PHRASE_SHOPIFY_QR_CODE });
        expect([journal.lecturesModele, lignes.workflows.parId.size], evenement).toEqual([0, 0]);
      }
    }
    // La coexistence (plan 2026-10-24, tâche 4) : le même numéro, l'application gardée, et les messages partent en modèles.
    expect(PHRASE_SHOPIFY_QR_CODE).toBe('Sur un numéro relié par QR code, les messages Shopify ne peuvent pas partir : WhatsApp ne '
      + 'laisse pas écrire en premier à un client. Pour écrire en premier tout en gardant l’application WhatsApp Business, '
      + 'passez ce même numéro sur l’API officielle de WhatsApp : demandez-le à Claude, puis, sur la page qu’il vous donne, '
      + 'appuyez sur « Ouvrir la fenêtre de Meta ».');
    // 🔴 Sans le mot de Meta (Julien, 2026-10-25) : le client ne le comprend pas.
    expect(PHRASE_SHOPIFY_QR_CODE).not.toMatch(/coexistence/i);
  });

  it('🔴 l’éteindre reste permis : active false, sans template ni lecture chez Meta, et ses parcours s’arrêtent', async () => {
    const { deps, journal, lignes } = monter({ filiere: 'application' });
    // Une ligne allumée quand le numéro était sur l'API (sur un numéro relié par QR code, l'allumer est refusé).
    await reglerLigne({ ...lignes.deps, filiere: async () => 'api' }, T, 'order_paid', { actif: true }, 'u1');
    const r = await brancherMessage(deps, T, { evenement: 'order_paid', modele: undefined, langue: 'fr', variables: undefined, actif: false }, 'u1');
    expect(r).toMatchObject({ ok: true, valeur: { lignes: [{ evenement: 'order_paid', actif: false }] } });
    expect(journal.lecturesModele).toBe(0);
    expect(lignes.parcours.arrets).toEqual([{ prefixe: 'shopify:b.myshopify.com:orders/paid:', motif: 'ligne éteinte' }]);
  });

  it('un template y est refusé, même pour éteindre ; un active qui n’est pas un booléen aussi', async () => {
    const { deps, lignes } = monter({ filiere: 'application' });
    expect(await brancherMessage(deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: undefined, actif: false }, 'u1'))
      .toMatchObject({ ok: false, statut: 400, message: expect.stringContaining('template') });
    expect(await brancherMessage(deps, T, { evenement: 'order_paid', modele: undefined, langue: 'fr', variables: undefined, actif: 'non' }, 'u1'))
      .toMatchObject({ ok: false, statut: 400, message: 'active : vrai ou faux.' });
    expect(lignes.workflows.parId.size).toBe(0);
  });
});

describe('l’état et la coupure', () => {
  it('l’état porte les chiffres des 30 jours, la page des apps de la boutique et les lignes', async () => {
    const { deps } = monter();
    await brancherMessage(deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: ['first_name', 'order_number'], actif: true }, 'u1');
    const e = await etatShopify(deps, T);
    expect(e.compteurs).toEqual({ envoye: 3 });
    expect(e.pageApps).toBe('https://admin.shopify.com/store/b/settings/apps');
    expect(e.lignes).toMatchObject([{ evenement: 'order_paid', actif: true, modele: 'commande_payee', blocs: 1 }]);
    expect(await etatShopify(monter({ boutique: null }).deps, T)).toEqual({
      boutique: null, messages: [], compteurs: {}, pageApps: null, attentes: [], lignes: [], attestation: null,
      paniers: { relances: {}, fermesATemps: 0, enAttente: 0, relancesParties: 0, recuperes: 0, montantsRecuperes: [], recuperesTest: 0 },
    });
  });

  it('les paniers portent les récupérés des 7 derniers jours de Paris, par la lecture du chiffre (plan 2026-10-30)', async () => {
    const { deps, journal } = monter();
    const e = await etatShopify(deps, T);
    expect(journal.chiffres).toEqual([{ from: addDays(todayParis(), -6), to: todayParis() }]);
    // 🔴 Relancées et récupérés sur la MÊME date (celle de la relance), sinon la carte peut montrer plus de récupérés que de
    // relances parties (relecture du lot A) : `relancesParties` vient de la même lecture que les récupérés.
    expect(e.paniers).toEqual({
      relances: { envoye: 1 }, fermesATemps: 2, enAttente: 3,
      relancesParties: 4, recuperes: 2, montantsRecuperes: [{ devise: 'EUR', montant: '59.9' }], recuperesTest: 1,
    });
    // Sans boutique, rien n'est lu.
    const sans = monter({ boutique: null });
    await etatShopify(sans.deps, T);
    expect(sans.journal.chiffres).toEqual([]);
  });

  it('get_shopify_state rend les paniers récupérés des 7 jours et leur montant, par devise', async () => {
    const { deps } = monter();
    const etat = await OUTILS.find((x) => x.nom === 'get_shopify_state')!.executer(mcpDe(deps), T, {}, PERSONNE);
    expect(etat).toMatchObject({
      checkouts: {
        sent_reminders_last_7_days: 4, recovered_last_7_days: 2, recovered_amount_last_7_days: [{ currency: 'EUR', amount: '59.9' }],
      },
    });
  });

  it('get_shopify_state rend les produits vus des commandes (lot 3) ; une lecture en panne rend une liste vide, jamais un outil en échec', async () => {
    const { deps } = monter();
    const outil = OUTILS.find((x) => x.nom === 'get_shopify_state')!;
    const lus: Array<[string, string | undefined, number]> = [];
    const avec = { ...mcpDe(deps), contacts: { produitsVus: async (t: string, r: string | undefined, n: number) => {
      lus.push([t, r, n]);
      return [{ produitId: '8801', sku: 'SER-30', titre: 'Sérum vitamine C', varianteTitre: '30 ml', commandes: 4 }];
    } } } as unknown as DepsMcp;
    expect(await outil.executer(avec, T, {}, PERSONNE)).toMatchObject({
      products_seen: [{ product_id: '8801', sku: 'SER-30', title: 'Sérum vitamine C', variant: '30 ml', orders: 4 }],
    });
    expect(lus).toEqual([[T, undefined, 20]]);
    const enPanne = { ...mcpDe(deps), contacts: { produitsVus: async () => { throw new Error('relation "shopify_commande_lignes" does not exist'); } } } as unknown as DepsMcp;
    expect(await outil.executer(enPanne, T, {}, PERSONNE)).toMatchObject({ store: 'b.myshopify.com', products_seen: [] });
  });

  it('couper est idempotent et rend la page d’où désinstaller l’app', async () => {
    const { deps } = monter();
    expect(await couperShopify(deps, T)).toEqual({ ok: true, valeur: { dejaCoupee: false, pageApps: 'https://admin.shopify.com/store/b/settings/apps' } });
    expect(await couperShopify(deps, T)).toMatchObject({ ok: true, valeur: { dejaCoupee: true } });
  });

  it('🔴 couper arrête les parcours de toute la boutique, une fois ; un arrêt en panne n’empêche pas la coupure', async () => {
    const { deps, lignes } = monter();
    await couperShopify(deps, T);
    await couperShopify(deps, T);
    expect(lignes.parcours.arrets).toEqual([{ prefixe: 'shopify:b.myshopify.com:', motif: 'boutique coupée' }]);
    const panne = monter({ arretLeve: true });
    expect(await couperShopify(panne.deps, T)).toMatchObject({ ok: true, valeur: { dejaCoupee: false } });
  });
});

describe('les outils MCP du connecteur', () => {
  const regler = () => OUTILS.find((x) => x.nom === 'set_shopify_message')!;
  const lire = () => OUTILS.find((x) => x.nom === 'get_shopify_state')!;

  it('🔴 l’attestation (2026-11-20) : sans elle, set_shopify_message n’allume rien et dit de demander au marchand ; avec, elle est historisée (claude_code, la personne) et l’allumage passe', async () => {
    const { deps, lignes } = monter();
    lignes.store.attestationInitiale = null;
    const args = { event: 'order_paid', template: 'commande_payee', language: 'fr', variables: ['first_name', 'order_number'] };
    await expect(regler().executer(mcpDe(deps), T, args, PERSONNE)).rejects.toThrow(/customers_consent_attested/);
    // Refusé AVANT toute écriture : ni ligne, ni scénario, ni publication.
    expect([lignes.store.lignesEnBase.size, lignes.workflows.parId.size, lignes.workflows.publications.length]).toEqual([0, 0, 0]);
    expect((await lire().executer(mcpDe(deps), T, {}, PERSONNE))).toMatchObject({ customers_consent_attested: false });
    const r = await regler().executer(mcpDe(deps), T, { ...args, customers_consent_attested: true }, PERSONNE);
    expect(r).toMatchObject({ automations: [{ event: 'order_paid', active: true }] });
    expect(lignes.store.attestations).toEqual([{ domaine: 'b.myshopify.com', coche: true, texte: TEXTE_ATTESTATION_SHOPIFY.fr, par: 'u1', origine: 'claude_code' }]);
    expect((await lire().executer(mcpDe(deps), T, {}, PERSONNE))).toMatchObject({ customers_consent_attested: true });
    expect(Object.keys(regler().entree.properties)).toContain('customers_consent_attested');
  });

  it('🔴 les quatre exigent une personne nommée et sont ouverts à toutes les offres', () => {
    for (const nom of ['connect_shopify', 'set_shopify_message', 'get_shopify_state', 'disconnect_shopify']) {
      const o = OUTILS.find((x) => x.nom === nom);
      expect(o, nom).toBeDefined();
      expect(o!.exigePersonne, nom).toBe(true);
      expect(o!.fonction, nom).toBeNull();
    }
  });

  it('le schéma annoncé porte les bornes que la gestion applique (événements du lot, données permises), sans le texte d’avant', () => {
    const o = regler();
    // La relance de panier avec agent IA (2026-11-20) : une automation de plus, sur le panier abandonné.
    expect(o.entree.properties.event!.enum).toEqual(['order_paid', 'order_fulfilled', 'checkout_abandoned', 'checkout_abandoned_agent']);
    expect(o.entree.properties.variables!.maxItems).toBe(10);
    expect(o.entree.properties.variables!.items!.enum).toContain('checkout_url');
    expect([o.entree.properties.delay_minutes!.minimum, o.entree.properties.delay_minutes!.maximum]).toEqual([15, 4320]);
    // Le texte d'un numéro relié par QR code n'existe plus (lot 5) : une automation est un scénario.
    expect(Object.keys(o.entree.properties)).not.toContain('text');
    expect(o.entree.required).toEqual(['event', 'language']);
  });

  it('🔴 set_shopify_message rend l’automation, dit les étapes qu’il ne change pas (décision 7) et la version programmée annulée', async () => {
    const { deps, lignes } = monter();
    const args = { event: 'order_paid', template: 'commande_payee', language: 'fr', variables: ['first_name', 'order_number'] };
    expect(await regler().executer(mcpDe(deps), T, args, PERSONNE)).toEqual({
      automations: [{
        event: 'order_paid', active: true, scenario: 'Commande payée', template: 'commande_payee', language: 'fr',
        template_status: 'APPROVED', steps: 1, message: 'Merci {{1}}', variables: ['first_name'],
      }],
    });
    // La suite écrite dans la console : deux étapes de plus, et une version qui attendait Meta.
    const ligne = (await lignes.store.ligne(T, 'order_paid'))!;
    const wf = (await lignes.workflows.getById(ligne.workflowId, T))!;
    const suite: WorkflowGraph = {
      nodes: [...wf.graph.nodes, { id: 'a', type: 'quick_message', position: { x: 0, y: 1 }, data: {} }, { id: 'b', type: 'quick_message', position: { x: 0, y: 2 }, data: {} }],
      edges: [{ id: 'e1', source: 'depart', target: 'a' }, { id: 'e2', source: 'a', target: 'b' }],
    };
    await lignes.workflows.publish(ligne.workflowId, T, suite);
    lignes.workflows.programmees.set(ligne.workflowId, { graphe: suite, le: '2026-11-19T10:00:00.000Z', par: 'u2' });
    const r = await regler().executer(mcpDe(deps), T, args, PERSONNE) as { automations: Array<{ steps: number; note?: string }>; scheduled_version_cancelled?: string };
    expect(r.automations[0]!.steps).toBe(3);
    expect(r.automations[0]!.note).toMatch(/2 more steps.*console/);
    expect(r.scheduled_version_cancelled).toMatch(/cancelled/);
  });

  it('🔴 la relance avec agent IA (2026-11-20) : sans agent_id, refus ; avec, le message standard se crée, l’automation s’allume et dit son agent', async () => {
    const AG = { id: '11111111-1111-4111-8111-111111111111', label: 'Conseiller', status: 'active' as const, sorties: [], modele: 'm' };
    const { deps, lignes } = monter({
      agents: [AG],
      creation: { ok: true, modele: 'panier_agent', langue: 'fr', etat: 'en_validation', categorie: 'MARKETING', boutons: [{ type: 'URL', text: 'Reprendre mon panier' }, { type: 'QUICK_REPLY', text: 'Vous avez une question ?' }] },
    });
    const args = { event: 'checkout_abandoned_agent', language: 'fr' };
    await expect(regler().executer(mcpDe(deps), T, args, PERSONNE)).rejects.toThrow(/agent IA actif/);
    const r = await regler().executer(mcpDe(deps), T, { ...args, agent_id: AG.id }, PERSONNE) as { automations: Array<Record<string, unknown>> };
    expect(r.automations).toEqual([expect.objectContaining({
      event: 'checkout_abandoned_agent', active: true, agent: { id: AG.id, name: 'Conseiller', active: true }, warnings: ['modele_en_attente'],
    })]);
    expect(lignes.creation.appels).toHaveLength(1);
  });

  it('🔴 en Free, un scénario de plusieurs étapes n’envoie que la première : les deux outils le disent', async () => {
    const { deps, lignes } = monter();
    await brancherMessage(deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: ['first_name', 'order_number'], actif: true }, 'u1');
    const ligne = (await lignes.store.ligne(T, 'order_paid'))!;
    const wf = (await lignes.workflows.getById(ligne.workflowId, T))!;
    await lignes.workflows.publish(ligne.workflowId, T, {
      nodes: [...wf.graph.nodes, { id: 'a', type: 'quick_message', position: { x: 0, y: 1 }, data: {} }], edges: [{ id: 'e1', source: 'depart', target: 'a' }],
    });
    const etat = await lire().executer(mcpDe(deps, 'base'), T, {}, PERSONNE) as { automations: Array<{ note?: string }> };
    expect(etat.automations[0]!.note).toMatch(/only the first step/i);
    const pro = await lire().executer(mcpDe(deps, 'pro'), T, {}, PERSONNE) as { automations: Array<{ note?: string }> };
    expect(pro.automations[0]!.note).toMatch(/console/);
  });

  it('get_shopify_state rend la pause, les automations, et les anciens messages pour les plugins d’avant', async () => {
    const ancien: MessageBranche = { evenement: 'order_paid', modele: 'commande_payee', texte: null, langue: 'fr', variables: [], actif: false, modifieLe: '' };
    const { deps, lignes } = monter({ anciens: [ancien] });
    await brancherMessage(deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: ['first_name', 'order_number'], actif: true }, 'u1');
    lignes.store.pause = true;
    expect(await lire().executer(mcpDe(deps), T, {}, PERSONNE)).toMatchObject({
      connected: true, paused: true,
      automations: [{ event: 'order_paid', active: true, template: 'commande_payee', steps: 1 }],
      messages: [{ event: 'order_paid', template: 'commande_payee', active: false }],
    });
  });

  it('🔴 sur un numéro relié par QR code, l’outil refuse d’allumer avec la phrase, et éteint', async () => {
    const { deps } = monter({ filiere: 'application' });
    await expect(regler().executer(mcpDe(deps), T, { event: 'order_paid', template: 'commande_payee', language: 'fr' }, PERSONNE))
      .rejects.toThrow(PHRASE_SHOPIFY_QR_CODE);
    expect(await regler().executer(mcpDe(deps), T, { event: 'order_paid', language: 'fr', active: false }, PERSONNE)).toEqual({ automations: [] });
  });

  it('🔴 plus aucune question du consentement (2026-10-26) : ni annoncée ni rendue, et celle d’un ancien plugin est ignorée', async () => {
    expect(Object.keys(regler().entree.properties)).not.toContain('customers_consented');
    for (const o of [regler(), lire()]) expect(o.description, o.nom).not.toMatch(/customers_consented|affirm/i);
    // Le serveur MCP ne valide pas les arguments contre le schéma : un plugin d'avant le 2026-10-26 envoie encore
    // `customers_consented`, vrai ou faux. La relance s'allume pareil, et rien d'autre n'est rendu.
    for (const customers_consented of [false, true]) {
      const { deps } = monter({ modele: { statut: 'approuve', categorie: 'marketing', variables: 1 } });
      const r = await regler().executer(mcpDe(deps), T, {
        event: 'checkout_abandoned', template: 'relance', language: 'fr', variables: ['checkout_url'], customers_consented,
      }, PERSONNE);
      expect(r, String(customers_consented)).toEqual({
        automations: [{
          event: 'checkout_abandoned', active: true, scenario: 'Panier abandonné', template: 'relance', language: 'fr',
          template_status: 'APPROVED', steps: 1, message: 'Merci {{1}}', variables: ['checkout_url'],
        }],
      });
    }
    const lu = await lire().executer(mcpDe(monter().deps), T, {}, PERSONNE);
    expect(lu).toMatchObject({ connected: true, store: 'b.myshopify.com' });
    expect(lu).not.toHaveProperty('customers_consented_at');
  });
});

describe('l’import des clients abonnés (lot 3)', () => {
  const ABONNES: ClientAbonne[] = [
    { telephone: '+33600000001', nom: 'Le plus récent' },
    { telephone: '+33600000002', nom: 'Déjà là' },
    { telephone: '+33600000003', nom: null },
    { telephone: '+33600000004', nom: 'Le plus ancien' },
  ];
  function monterImport(o: {
    acces?: AccesBoutique | null; jeton?: IssueJeton; lecture?: LectureClients; limite?: number | null; comptees?: number;
    importerLeve?: Error;
  } = {}) {
    const journal = { imports: [] as ImportInput[], lectures: [] as unknown[] };
    const { deps } = monter();
    const d: DepsGestionShopify = {
      ...deps,
      store: {
        ...deps.store,
        acces: async () => (o.acces === undefined
          ? { domaine: 'b.myshopify.com', clientId: 'cid', secret: 'shpss_x', pays: 'FR', etat: 'connectee', origine: 'claude_code' } : o.acces),
      },
      jeton: async () => o.jeton ?? { ok: true, jeton: 'jeton' },
      lireClients: async (acces, plafond) => { journal.lectures.push({ acces, plafond }); return o.lecture ?? { ok: true, abonnes: ABONNES, sansTelephone: 2, complet: true }; },
      places: async (_t, numeros) => ({
        limite: o.limite === undefined ? 100 : o.limite, comptees: o.comptees ?? 90,
        presents: new Set(numeros.filter((n) => n === '+33600000002')),
      }),
      importer: async (input) => {
        journal.imports.push(input);
        if (o.importerLeve) throw o.importerLeve;
        return { created: input.rows.length, updated: 0, skipped: 0, errors: [] };
      },
    };
    return { deps: d, journal };
  }

  it('compte sans rien écrire : abonnés, déjà là, nouveaux, places libres, importables ; le jeton sert à la lecture', async () => {
    const { deps, journal } = monterImport();
    expect(await apercuImportClients(deps, T)).toEqual({ ok: true, valeur: {
      abonnes: 4, sansTelephone: 2, dejaDansLEspace: 1, nouveaux: 3, placesLibres: 10, importables: 3, complet: true,
    } });
    expect(journal.imports).toEqual([]);
    expect(journal.lectures).toEqual([{ acces: { domaine: 'b.myshopify.com', jeton: 'jeton', pays: 'FR' }, plafond: CLIENTS_LUS_MAX }]);
    // Sans limite (Entreprise), et une offre pleine.
    expect(await apercuImportClients(monterImport({ limite: null }).deps, T)).toMatchObject({ ok: true, valeur: { placesLibres: null, importables: 3 } });
    expect(await apercuImportClients(monterImport({ comptees: 120 }).deps, T)).toMatchObject({ ok: true, valeur: { placesLibres: 0, importables: 0 } });
  });

  it('🔴 depuis la console : les nouveaux les plus récents, au nombre choisi, SANS consentement, autorité import, étiquette Shopify', async () => {
    const { deps, journal } = monterImport();
    expect(await importerClients(deps, T, 2, null)).toEqual({ ok: true, valeur: {
      importes: 2, retablis: 0, restent: 1, placesLibres: 8, etiquette: 'Shopify', complet: true,
    } });
    expect(journal.imports).toEqual([{
      rows: [{ phone: '+33600000001', name: 'Le plus récent' }, { phone: '+33600000003', name: '' }],
      mapping: { columns: { phone: { target: 'phone' }, name: { target: 'name' } } },
      tenantId: T, optIn: false, tags: ['Shopify'], autorite: 'import',
    }]);
  });

  it('🔴 depuis Claude : consentants par principe, l’accord déclaré par le client et signé de la personne connectée', async () => {
    // Décision de Julien du 2026-10-25 : « par principe, sur Claude Code, les contacts importés sont opt in », la
    // responsabilité du client. L'autorité `import` ne lève toujours pas un STOP (`importContacts`).
    const { deps, journal } = monterImport();
    expect(await importerClients(deps, T, 2, 'u1')).toMatchObject({ ok: true, valeur: { importes: 2 } });
    expect(journal.imports).toEqual([{
      rows: [{ phone: '+33600000001', name: 'Le plus récent' }, { phone: '+33600000003', name: '' }],
      mapping: { columns: { phone: { target: 'phone' }, name: { target: 'name' } } },
      tenantId: T, tags: ['Shopify'], autorite: 'import', optIn: true, optInSource: 'import Shopify, déclaré dans Claude par u1',
    }]);
  });

  it('🔴 l’outil de Claude importe au nom de la personne connectée, et dit les fiches consentantes', async () => {
    const outil = OUTILS.find((o) => o.nom === 'import_shopify_customers')!;
    const { deps, journal } = monterImport();
    const depsMcp = { couteux: { consommer: async () => ({ accepte: true, attenteMs: 0 }) }, shopify: deps } as unknown as DepsMcp;
    const r = await outil.executer(depsMcp, T, { max_contacts: 2 }, { userId: 'u1', autorisationId: 'aut-1' }) as { consent: string };
    expect(journal.imports[0]).toMatchObject({ optIn: true, optInSource: 'import Shopify, déclaré dans Claude par u1' });
    expect(r.consent).toMatch(/^opted_in/);
  });

  it('🔴 au-delà des places libres : refusé, rien n’est écrit ; le marchand gère sa limite', async () => {
    const { deps, journal } = monterImport({ comptees: 99 });
    const r = await importerClients(deps, T, 2, null);
    expect(r).toMatchObject({ ok: false, statut: 402 });
    expect((r as { message: string }).message).toContain('1 place de contacts');
    expect(journal.imports).toEqual([]);
    // Ce qui serait ÉCRIT compte, pas le nombre demandé : 100 demandés pour 1 nouveau et 1 place, ça passe.
    const un = monterImport({ comptees: 99, lecture: { ok: true, abonnes: [ABONNES[0]!], sansTelephone: 0, complet: true } });
    expect(await importerClients(un.deps, T, 100, null)).toMatchObject({ ok: true, valeur: { importes: 1, placesLibres: 0 } });
    // Deux écritures à la dernière place : le refus de l'import est rendu, pas une panne.
    const course = monterImport({ importerLeve: new LimiteOffreError(T, 'contacts', 100) });
    expect(await importerClients(course.deps, T, 1, null)).toMatchObject({ ok: false, statut: 402 });
  });

  it('le nombre choisi est un entier de 1 à la borne d’un appel ; rien à importer ne lance rien', async () => {
    for (const m of [0, IMPORT_MAX + 1, 1.5, '3', undefined]) {
      expect(await importerClients(monterImport().deps, T, m, null), String(m)).toMatchObject({ ok: false, statut: 400 });
    }
    const vide = monterImport({ lecture: { ok: true, abonnes: [], sansTelephone: 0, complet: true } });
    expect(await importerClients(vide.deps, T, 5, null)).toMatchObject({ ok: true, valeur: { importes: 0, restent: 0 } });
    expect(vide.journal.imports).toEqual([]);
  });

  it('sans boutique, boutique coupée, jeton refusé, accès aux clients refusé : chaque refus dit le geste', async () => {
    expect(await apercuImportClients(monterImport({ acces: null }).deps, T)).toMatchObject({ ok: false, statut: 409 });
    const coupee = monterImport({ acces: { domaine: 'b.myshopify.com', clientId: 'cid', secret: 's', pays: 'FR', etat: 'coupee', origine: 'claude_code' } });
    expect(await importerClients(coupee.deps, T, 1, null)).toMatchObject({ ok: false, statut: 409, message: expect.stringContaining('coupée') });
    expect(coupee.journal.lectures).toEqual([]);
    const jeton = monterImport({ jeton: { ok: false, code: 'app_non_installee', message: 'Installez l’app.' } });
    expect(await apercuImportClients(jeton.deps, T)).toEqual({ ok: false, statut: 409, message: 'Installez l’app.' });
    const acces = monterImport({ lecture: { ok: false, code: 'acces_refuse', message: 'Données protégées.' } });
    expect(await apercuImportClients(acces.deps, T)).toEqual({ ok: false, statut: 409, message: 'Données protégées.' });
    const panne = monterImport({ lecture: { ok: false, code: 'passager', message: 'Réessayez.' } });
    expect(await apercuImportClients(panne.deps, T)).toMatchObject({ ok: false, statut: 503 });
  });

  it('🔴 les deux outils consomment le plafond des opérations coûteuses AVANT de lire chez Shopify', async () => {
    for (const [nom, args] of [['preview_shopify_customers', {}], ['import_shopify_customers', { max_contacts: 1 }]] as const) {
      const { deps, journal } = monterImport();
      const refusant = { couteux: { consommer: async () => ({ accepte: false, attenteMs: 2000 }) }, shopify: deps } as unknown as DepsMcp;
      await expect(OUTILS.find((x) => x.nom === nom)!.executer(refusant, T, args, { userId: 'u1', autorisationId: 'aut-1' } as never), nom)
        .rejects.toThrow(MESSAGE_OPERATIONS_LOURDES);
      expect([journal.lectures, journal.imports], nom).toEqual([[], []]);
      const acceptant = { couteux: { consommer: async () => ({ accepte: true, attenteMs: 0 }) }, shopify: deps } as unknown as DepsMcp;
      await OUTILS.find((x) => x.nom === nom)!.executer(acceptant, T, args, { userId: 'u1', autorisationId: 'aut-1' } as never);
      expect(journal.lectures, nom).toHaveLength(1);
    }
  });

  it('🔴 les deux outils exigent une personne nommée, toutes offres ; l’import exige le nombre choisi, dans sa borne', () => {
    for (const nom of ['preview_shopify_customers', 'import_shopify_customers']) {
      const o = OUTILS.find((x) => x.nom === nom);
      expect(o, nom).toBeDefined();
      expect(o!.exigePersonne, nom).toBe(true);
      expect(o!.fonction, nom).toBeNull();
    }
    expect(OUTILS.find((x) => x.nom === 'preview_shopify_customers')!.annotations.readOnlyHint).toBe(true);
    const imp = OUTILS.find((x) => x.nom === 'import_shopify_customers')!;
    expect(imp.entree.required).toEqual(['max_contacts']);
    expect([imp.entree.properties.max_contacts!.minimum, imp.entree.properties.max_contacts!.maximum]).toEqual([1, IMPORT_MAX]);
  });
});
