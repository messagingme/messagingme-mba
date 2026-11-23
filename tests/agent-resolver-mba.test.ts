import { describe, it, expect, vi } from 'vitest';
import { COMMANDES_POUR_LE_MODELE, creerResolveurMba, type DepsResolveurMba, BLOC_DEJA_ENVOYE } from '../src/agent/resolvers/mba';
import type { ContexteAppel } from '../src/agent/executor';
import type { OutilDefini } from '../src/agent/catalog';
import { SANS_MCP } from './outils-mcp';
import { AUCUN_GESTE } from './gestes';

/**
 * Tâche 16 : les outils maison. Ce sont les seuls outils dont nous écrivons le comportement, donc les seuls
 * sur lesquels on peut promettre quelque chose.
 */

const CTX: ContexteAppel = {
  tenantId: 't1', agentId: 'ag1', sessionId: 's1', runId: 'r1', workflowId: 'wf1', waId: '33600',
  contact: { wa_id: '33600', prenom: 'Julien' },
  contactInconnu: 'tous', appelsRestants: 5, budgetRestantMicroEur: 10_000, deadline: Date.now() + 30_000,
};

const outil = (handler: string, binding: Record<string, unknown> = { handler }): OutilDefini => ({ ...SANS_MCP, ...AUCUN_GESTE(),
  id: 'to1', tenantId: 't1', origin: 'mba', name: `mba_${handler}`, description: '',
  params: [], binding, sourceId: null, requestId: null, nePasUtiliser: '', nature: 'integre' as const, outputPaths: [], risk: 'write', timeoutMs: 5_000, maxBytes: 16_384, autonome: false,
});

/** Les cibles fixées par l'administrateur (RC4), telles que la pose les écrit dans `binding`. */
const WF_CIBLE = '0b7e2c1a-4d5e-4f60-8a9b-1c2d3e4f5a6b';
const CIBLES = {
  tag: { handler: 'poser_tag', tag: 'rdv_pris' },
  champ: { handler: 'ecrire_variable', champ: 'statut', valeurs: [] as string[] },
  champBorne: { handler: 'ecrire_variable', champ: 'statut', valeurs: ['client', 'prospect'] },
  bloc: { handler: 'envoyer_bloc', workflowId: WF_CIBLE, code: 'nod_t1_01HZX5Y6Z7A8B9C0D1E2F3G4H5' },
  scenario: { handler: 'lancer_scenario', workflowId: WF_CIBLE },
} as const;

function harnais(over: Partial<DepsResolveurMba> = {}) {
  const journal: string[] = [];
  const deps: DepsResolveurMba = {
    envoyerBloc: async (i) => { journal.push(`bloc:${i.workflowId}:${i.code}`); return { ok: true }; },
    lancerScenario: async (i) => { journal.push(`scenario:${i.workflowId}:${i.runId}:${i.sessionId}`); return { ok: true }; },
    escaladerVersHumain: async (i) => { journal.push(`escalade:${i.waId}:${i.sessionId}:${i.agentId}`); return true; },
    marquerUrgente: async (i) => { journal.push(`urgent:${i.tenantId}:${i.waId}:${i.agentId}`); return true; },
    declencherAction: async (i) => { journal.push(`action:${i.actionId}:${i.nom}`); return 'declenchee'; },
    poserTag: async (_t, _w, tag) => { journal.push(`tag:${tag}`); },
    ecrireChamp: async (_t, _w, cle, valeur) => { journal.push(`champ:${cle}=${valeur}`); },
    lireAnalyse: async (t, w) => { journal.push(`analyse:${t}:${w}`); return null; },
    // Un espace sans boutique par défaut : la fiche se lit comme avant le 2026-11-23.
    lireAchatsShopify: async () => null,
    // La recherche a sa propre suite (`tests/agent-knowledge.test.ts`) : ici elle ne rend rien.
    connaissance: { chercher: async () => [] },
    ...over,
  };
  return { resolveur: creerResolveurMba(deps), journal };
}

const appel = (handler: string, args: Record<string, unknown> = {}, ctx: ContexteAppel = CTX) =>
  ({ outil: outil(handler), args, ctx, signal: new AbortController().signal });

/** Un appel d'outil à cible : le `binding` porte la cible fixée, les arguments sont ceux du modèle. */
const appelCible = (cible: { handler: string }, args: Record<string, unknown> = {}, ctx: ContexteAppel = CTX) =>
  ({ outil: outil(cible.handler, { ...cible }), args, ctx, signal: new AbortController().signal });

describe('résolveur maison (tâche 16)', () => {
  it('« terminer » remonte la sortie, que le tour transformera en handle sortie:<code>', async () => {
    const { resolveur } = harnais();
    const r = await resolveur(appel('terminer', { sortie: 'besoin_cerne' }));
    expect(r.sortie).toBe('besoin_cerne');
    expect(r.ok).not.toBe(false);
  });

  it('🔴 « terminer » rend le dernier message ROGNÉ, et rien pour un message absent, vide ou blanc', async () => {
    // Le cerveau l'envoie au contact quand le modèle a appelé l'outil sans rien écrire à côté. Une chaîne
    // vide rendue ici ferait croire qu'il y a quelque chose à envoyer.
    const { resolveur } = harnais();
    const r = await resolveur(appel('terminer', { sortie: 'fini', message: '  Merci, à bientôt.\n' }));
    expect(r).toEqual({ contenu: { sortie: 'fini' }, sortie: 'fini', dernierMessage: 'Merci, à bientôt.' });
    for (const vide of [{}, { message: '' }, { message: '  \n ' }]) {
      const sans = await resolveur(appel('terminer', { sortie: 'fini', ...vide }));
      expect(sans, JSON.stringify(vide)).toEqual({ contenu: { sortie: 'fini' }, sortie: 'fini' });
      expect(sans, JSON.stringify(vide)).not.toHaveProperty('dernierMessage');
    }
  });

  it('🔴 « marquer_urgent » marque la conversation du contact du TOUR, et d’aucun autre', async () => {
    // L'outil n'a aucun paramètre : un numéro glissé dans les arguments (injection réussie) n'atteint pas l'écriture.
    const { resolveur, journal } = harnais();
    const r = await resolveur(appel('marquer_urgent', { wa_id: '33699999999', conversation_id: 'une-autre' }));
    expect(r.ok).not.toBe(false);
    expect(r.contenu).toEqual({ urgente: true });
    expect(journal).toEqual(['urgent:t1:33600:ag1']);
  });

  it('🔴 « marquer_urgent » ne termine rien : ni sortie, ni main rendue, l’agent continue de répondre', async () => {
    // Urgent n'est pas un transfert (décision de Julien du 2026-10-06) : `rendu` arrêterait le tour, `sortie` ferait
    // quitter le bloc. La preuve de bout en bout : `tests/agent-run-turn.test.ts`.
    const { resolveur } = harnais();
    const r = await resolveur(appel('marquer_urgent'));
    expect(r).not.toHaveProperty('rendu');
    expect(r).not.toHaveProperty('sortie');
    expect(r).not.toHaveProperty('mainPrise');
  });

  it('« marquer_urgent » sans conversation pour ce contact : un échec dit au modèle, jamais levé', async () => {
    const { resolveur } = harnais({ marquerUrgente: async () => false });
    const r = await resolveur(appel('marquer_urgent'));
    expect(r.ok).toBe(false);
  });

  it('🔴 RC4 : chaque handler à cible agit sur SA cible, quels que soient les arguments du modèle', async () => {
    // Le modèle glisse une autre cible dans ses arguments (injection réussie, ou simple invention) : le tag, le champ,
    // le bloc et le scénario restent ceux que l'administrateur a fixés.
    const { resolveur, journal } = harnais();
    expect((await resolveur(appelCible(CIBLES.tag, { tag: 'autre' }))).ok).not.toBe(false);
    expect((await resolveur(appelCible(CIBLES.champ, { cle: 'opt_in', champ: 'opt_in', valeur: 'client' }))).ok).not.toBe(false);
    expect((await resolveur(appelCible(CIBLES.bloc, { code: 'nod_t1_AUTRE', workflowId: 'wf-autre' }))).ok).not.toBe(false);
    const lance = await resolveur(appelCible(CIBLES.scenario, { workflowId: 'wf-autre' }));
    expect(lance.ok).not.toBe(false);
    expect(journal).toEqual([
      'tag:rdv_pris',
      'champ:statut=client',
      `bloc:${WF_CIBLE}:nod_t1_01HZX5Y6Z7A8B9C0D1E2F3G4H5`,
      `scenario:${WF_CIBLE}:r1:s1`,
    ]);
  });

  it('🔴 RC4 : le modèle ne lit jamais le nom du tag ni du champ (des noms internes qu’il répéterait au contact)', async () => {
    const { resolveur } = harnais();
    expect((await resolveur(appelCible(CIBLES.tag))).contenu).toEqual({ pose: true });
    expect((await resolveur(appelCible(CIBLES.champ, { valeur: 'client' }))).contenu).toEqual({ ecrit: true });
  });

  it('🔴 RC4 : une cible illisible, absente ou d’un autre handler REFUSE l’appel, sans rien faire', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { resolveur, journal } = harnais();
    // Un outil posé avant RC4 : `binding` ne porte que le handler.
    for (const h of ['poser_tag', 'ecrire_variable', 'envoyer_bloc', 'lancer_scenario']) {
      const r = await resolveur(appel(h, { tag: 'vip', cle: 'statut', valeur: 'x', code: 'nod_t1_X' }));
      expect(r.ok, h).toBe(false);
      expect(r.contenu, h).toEqual({ erreur: expect.stringContaining('outil mal configuré') });
    }
    // Une cible d'un autre handler sous ce handler (binding réécrit à la main), et une clé en trop.
    expect((await resolveur({ ...appel('poser_tag'), outil: outil('poser_tag', { ...CIBLES.scenario, handler: 'poser_tag' }) })).ok).toBe(false);
    expect((await resolveur({ ...appel('poser_tag'), outil: outil('poser_tag', { ...CIBLES.tag, intrus: 1 }) })).ok).toBe(false);
    expect(journal).toEqual([]);
  });

  it('« ecrire_variable » : une valeur hors de la liste permise est refusée, une valeur vide aussi', async () => {
    const { resolveur, journal } = harnais();
    expect((await resolveur(appelCible(CIBLES.champBorne, { valeur: 'inventee' }))).ok).toBe(false);
    expect((await resolveur(appelCible(CIBLES.champ, { valeur: '  ' }))).ok).toBe(false);
    expect((await resolveur(appelCible(CIBLES.champBorne, { valeur: 'prospect' }))).ok).not.toBe(false);
    expect(journal).toEqual(['champ:statut=prospect']);
  });

  it('« lire_contact » rend la fiche DEJA lue par le tour, sans jamais accepter d identifiant du modele', async () => {
    // Le modèle ne fournit aucun identifiant ici : il n'existe donc aucun chemin pour lire la fiche de
    // quelqu'un d'autre, même en cas d'injection réussie dans le message du contact.
    const { resolveur, journal } = harnais();
    const r = await resolveur(appel('lire_contact', { wa_id: '33699999999' }));
    expect(r.contenu).toEqual({ connu: true, champs: { wa_id: '33600', prenom: 'Julien' }, derniere_analyse: null, resume: null });
    // L'analyse se lit pour le contact du TOUR, jamais pour le numéro que le modèle a glissé dans ses arguments.
    expect(journal).toEqual(['analyse:t1:33600']);

    const inconnu = await resolveur(appel('lire_contact', {}, { ...CTX, contact: null }));
    expect(inconnu.contenu).toEqual({ connu: false });
    expect(journal).toEqual(['analyse:t1:33600']); // contact inconnu : aucune lecture de plus
  });

  it('🔴 « lire_contact » rend la dernière analyse et son résumé ; une note à 0 reste 0, `false` reste `false`', async () => {
    const { resolveur } = harnais({
      lireAnalyse: async () => ({
        analyse: {
          intention: 'reclamation', sentiment: 'negatif', satisfaction: 0, urgence: null, resolue: false, sujet: 'colis perdu',
          traiteePar: 'humain', action: 'rappeler', analyseLe: new Date('2026-09-26T14:32:00.000Z'),
          fenetreFin: new Date('2026-09-26T14:30:00.000Z'), conversationId: 'c1',
        },
        resume: 'Le client attend son colis depuis dix jours.',
      }),
    });
    const r = await resolveur(appel('lire_contact'));
    expect(r.contenu).toEqual({
      connu: true, champs: { wa_id: '33600', prenom: 'Julien' },
      derniere_analyse: {
        intention: 'reclamation', sentiment: 'negatif', satisfaction: 0, urgence: null, resolue: false, sujet: 'colis perdu',
        traitee_par: 'humain', action_suggeree: 'rappeler', analysee_le: '2026-09-26T14:32:00.000Z',
      },
      resume: 'Le client attend son colis depuis dix jours.',
    });
  });

  it('⚠️ « lire_contact » : une lecture d’analyse ratée rend la fiche et le dit, sans prétendre « jamais analysé »', async () => {
    const { resolveur } = harnais({ lireAnalyse: async () => { throw new Error('connexion perdue'); } });
    const r = await resolveur(appel('lire_contact'));
    expect(r.contenu).toEqual({ connu: true, champs: { wa_id: '33600', prenom: 'Julien' }, analyse_indisponible: true });
  });

  /**
   * 🔴 LES ACHATS SHOPIFY DANS LA FICHE (2026-11-23) : de quoi répondre « où en est ma commande ? ». Les commandes
   * récentes, jamais ce que WhatsApp a rapporté ni les paniers (de l'interne marchand, qui partirait chez le fournisseur).
   */
  const commandeVue = (i: number, over: Record<string, unknown> = {}) => ({
    commandeId: String(1000 + i), payeeLe: `2026-11-${String(10 + i).padStart(2, '0')}T10:00:00.000Z`, montant: '49.9', devise: 'EUR',
    test: false, attribution: { source: 'campagne' as const, campagne: 'Soldes', preuve: 'utm' as const },
    lignes: [{ titre: 'Sérum', varianteTitre: '30 ml', sku: 'SER-30', quantite: 2, carteCadeau: false }], lignesTronquees: false,
    expedieeLe: null, ...over,
  });
  const achats = (commandes: unknown[], avecBoutique = true) => ({
    boutique: !avecBoutique ? null : { nom: 'Demo', domaine: 'demo.myshopify.com', devise: 'EUR', commandesDepuis: '2026-11-01T00:00:00.000Z', coupeeLe: null },
    resume: { commandes: 7, commandesTest: 0, depense: '349.3', derniereLe: '2026-11-17T10:00:00.000Z' },
    rapporte: [{ devise: 'EUR', montant: '49.9', prouve: '49.9', commandes: 1 }],
    commandes, paniers: [{ ouvertLe: '2026-11-10T10:00:00.000Z', relanceLe: null, fermeLe: null, issue: null }],
  }) as never;

  it('🔴 « lire_contact » rend les commandes Shopify récentes du contact : paiement, montant, produits, expédition', async () => {
    const commandes = [
      commandeVue(7, { expedieeLe: '2026-11-18T08:00:00.000Z' }),
      commandeVue(6, { montant: null, devise: null, lignes: undefined }),
      commandeVue(5, { devise: null }),
      commandeVue(4), commandeVue(3), commandeVue(2),
    ];
    const lus: string[] = [];
    const { resolveur } = harnais({ lireAchatsShopify: async (t, w) => { lus.push(`${t}:${w}`); return achats(commandes); } });
    const r = await resolveur(appel('lire_contact'));
    expect(lus).toEqual(['t1:33600']); // le contact du TOUR, jamais un autre
    const shopify = (r.contenu as { shopify: { commandes_en_tout: number; commandes: unknown[] } }).shopify;
    expect(shopify.commandes_en_tout).toBe(7);
    expect(shopify.commandes).toHaveLength(COMMANDES_POUR_LE_MODELE);
    expect(shopify.commandes.slice(0, 3)).toEqual([
      { payee_le: '2026-11-17T10:00:00.000Z', montant: '49.9 EUR', expediee_le: '2026-11-18T08:00:00.000Z', produits: ['2 × Sérum (30 ml)'] },
      // Des lignes qu'on ne sait pas lire ne s'annoncent pas vides.
      { payee_le: '2026-11-16T10:00:00.000Z', montant: null, expediee_le: null },
      { payee_le: '2026-11-15T10:00:00.000Z', montant: '49.9', expediee_le: null, produits: ['2 × Sérum (30 ml)'] },
    ]);
    // Ni l'attribution, ni le rapporté, ni les paniers.
    expect(JSON.stringify(r.contenu)).not.toMatch(/Soldes|utm|rapporte|paniers|attribution/);
  });

  it('« lire_contact » sans boutique dans l’espace : aucune clé Shopify, pas même vide', async () => {
    const { resolveur } = harnais({ lireAchatsShopify: async () => achats([], false) });
    const r = await resolveur(appel('lire_contact'));
    expect(r.contenu).toEqual({ connu: true, champs: { wa_id: '33600', prenom: 'Julien' }, derniere_analyse: null, resume: null });
  });

  it('⚠️ « lire_contact » : des achats illisibles rendent la fiche et le disent', async () => {
    const { resolveur } = harnais({ lireAchatsShopify: async () => { throw new Error('connexion perdue'); } });
    const r = await resolveur(appel('lire_contact'));
    expect(r.contenu).toEqual({
      connu: true, champs: { wa_id: '33600', prenom: 'Julien' }, derniere_analyse: null, resume: null, shopify_indisponible: true,
    });
  });

  it('🔴 « escalader » appelle la dep d escalade et rend « rendu » : le tour doit s arreter', async () => {
    // `rendu` est ce qui empêche l'agent d'écrire un message de plus alors que la main n'est plus à lui.
    const { resolveur, journal } = harnais();
    const r = await resolveur(appel('escalader'));
    expect(journal).toEqual([`escalade:33600:s1:ag1`]);
    expect(r.rendu).toBe(true);
    expect(r.sortie).toBeUndefined(); // la dep a DÉJÀ tout fait : une seconde sortie doublerait la reprise
    // La bascule a EU LIEU, donc c'est nous qui tenons la main : le tour a le droit d'écrire sa dernière
    // phrase, celle qui dit au contact que l'équipe est fermée (revue du 2026-09-18).
    expect(r.mainPrise).toBe(true);
  });

  it('🔴 « escalader » rend le `message` imposé, ROGNÉ, en dernier message ; rien pour un message absent, vide ou blanc', async () => {
    // Même contrat que « terminer » : le cerveau l'envoie quand le modèle n'a rien écrit à côté de l'appel.
    const { resolveur } = harnais();
    expect(await resolveur(appel('escalader', { message: '  Un conseiller prend le relais.\n' }))).toMatchObject({
      rendu: true, mainPrise: true, dernierMessage: 'Un conseiller prend le relais.',
    });
    for (const vide of [{}, { message: '' }, { message: '  \n ' }]) {
      expect(await resolveur(appel('escalader', vide)), JSON.stringify(vide)).not.toHaveProperty('dernierMessage');
    }
  });

  it('🔴 « escalader » quand un OPÉRATEUR avait déjà la main : `mainPrise` est faux', async () => {
    // La preuve inverse, et elle est le contrat entier de ce booléen. `setControlOwner` rend `false` quand le
    // fil n'était pas `app_workflow` : le tour doit alors se taire, exactement comme avant, plutôt que
    // d'écrire par-dessus la conversation qu'un humain vient de reprendre.
    const { resolveur } = harnais({ escaladerVersHumain: async () => false });
    const r = await resolveur(appel('escalader'));
    expect(r.rendu).toBe(true);
    expect(r.mainPrise).toBe(false);
  });

  it('🔴 « envoyer_bloc » déjà parti pour ce message : le modèle lit « déjà envoyé » et de ne pas rappeler', async () => {
    const { resolveur } = harnais({ envoyerBloc: async () => ({ ok: true, deja: true }) });
    const r = await resolveur(appelCible(CIBLES.bloc));
    expect(r).toEqual({ contenu: { deja_envoye: true, note: BLOC_DEJA_ENVOYE } });
    expect(BLOC_DEJA_ENVOYE).toMatch(/ne rappelle pas cet outil/);
  });

  it('« envoyer_bloc » rend le refus du parcours au modele', async () => {
    const ko = harnais({ envoyerBloc: async () => ({ ok: false, raison: 'ce bloc attend une réponse du client' }) });
    const r = await ko.resolveur(appelCible(CIBLES.bloc));
    expect(r.ok).toBe(false);
    expect(r.contenu).toEqual({ erreur: 'ce bloc attend une réponse du client' });
  });

  it('🔴 « lancer_scenario » réussi est TERMINAL : `scenarioLance`, ni sortie ni main rendue', async () => {
    const { resolveur } = harnais();
    const r = await resolveur(appelCible(CIBLES.scenario));
    expect(r).toEqual({ contenu: { lance: true }, scenarioLance: true });
  });

  it('🔴 « lancer_scenario » refusé (dépublié, supprimé, désabonné) : la raison au modèle, et RIEN de terminal', async () => {
    const { resolveur } = harnais({ lancerScenario: async () => ({ ok: false, raison: 'le scénario est vide' }) });
    const r = await resolveur(appelCible(CIBLES.scenario));
    expect(r.ok).toBe(false);
    expect(r.contenu).toEqual({ erreur: 'le scénario est vide' });
    expect(r).not.toHaveProperty('scenarioLance');
  });

  it('🔴 « lancer_scenario » refuse de relancer le scénario où l’agent parle, sans rien lancer', async () => {
    // Le scénario retomberait sur l'agent, qui pourrait le relancer encore : une boucle facturée sans message du contact.
    const { resolveur, journal } = harnais();
    const r = await resolveur(appelCible(CIBLES.scenario, {}, { ...CTX, workflowId: WF_CIBLE }));
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty('scenarioLance');
    expect(journal).toEqual([]);
  });

  it('un handler inconnu ou absent est refuse proprement, jamais une exception', async () => {
    const { resolveur } = harnais();
    expect((await resolveur(appel('handler_qui_n_existe_pas'))).ok).toBe(false);
    const sansHandler = { ...appel('terminer'), outil: { ...outil('terminer'), binding: {} } };
    expect((await resolveur(sansHandler)).ok).toBe(false);
  });

  it('un handler nommé comme une méthode du prototype est refuse, pas appele', async () => {
    // `binding` est du jsonb écrit par la console : un accès direct à la table retrouverait
    // `Object.prototype.valueOf`, appelé sans `this` donc en exception, là où on veut un refus propre.
    const { resolveur } = harnais();
    for (const nom of ['valueOf', 'toString', 'constructor', 'hasOwnProperty']) {
      const r = await resolveur(appel(nom));
      expect(r.ok).toBe(false);
      expect(r.contenu).toMatchObject({ erreur: expect.stringContaining('inconnu') });
    }
  });

  it('le comportement suit le HANDLER, pas le nom expose au modele', async () => {
    // Le client peut renommer un outil dans sa console (un nom parlant fait un meilleur agent) : le
    // comportement ne doit pas suivre le nom.
    const { resolveur, journal } = harnais();
    const renomme = { ...appelCible(CIBLES.tag), outil: { ...outil('poser_tag', { ...CIBLES.tag }), name: 'marquer_le_client' } };
    await resolveur(renomme);
    expect(journal).toEqual(['tag:rdv_pris']);
  });

});
