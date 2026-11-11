import { describe, it, expect } from 'vitest';
import {
  balayerInbox, expediteur, versConnecteur, ligneE164, e164Accepte, UUID_ZERO, LOT_INBOX, AFFECTATIONS_PAR_TOUR,
  FERMETURES_PAR_TOUR, PAR_FERMETURE_HUBSPOT,
  type InboxHubspotStore, type EspaceBranche, type LigneEspace, type LigneMessage, type AffectationAPousser, type FilALire,
} from '../src/hubspot/inbox';
import type { AffectationInbox, IssueAffectations, IssueEtats, IssueInbox, MessageInboxHubspot } from '../src/crm/hubspot-service';
import type { AuteurDuChangement } from '../src/inbox/evenements';
import type { IssueRendreLaMain } from '../src/inbox/fil';

/**
 * Le balayage `hubspot-inbox` (lot 1 de l'Inbox HubSpot, tâche 6). Ce qu'il garantit : il ne pousse que les messages
 * WhatsApp d'un espace branché, d'une ligne reliée ; le curseur n'avance qu'après un lot accepté (une panne rejoue le
 * même lot, que HubSpot déduplique) ; un espace silencieux ou en pause avance sans rattrapage ; un espace en panne
 * n'arrête pas les autres.
 */
const BORNE = '2026-11-06T12:00:00.000000Z';
const LIGNE: LigneEspace = { affichage: '+33 1 00 00 00 00', connectee: true, enPause: false };

const message = (over: Partial<LigneMessage> = {}): LigneMessage => ({
  id: '11111111-1111-1111-1111-111111111111', conversationId: 'conv-1', direction: 'in', type: 'text', body: 'Bonjour',
  buttonPayload: null, origin: null, createdAt: '2026-11-06T11:59:00.043689Z', waId: '33612345678', nom: 'Jeanne', membre: null,
  ...over,
});

class StoreMemoire implements InboxHubspotStore {
  curseurs = new Map<string, { le: string; id: string }>();
  debranches: string[] = [];
  /** Le journal des appels qui comptent pour l'ordre : sorties, poussées, entrées. */
  journal: string[] = [];
  /** Les conversations à faire entrer, par espace, et leur contexte. */
  aEntrer: Record<string, string[]> = {};
  contextes: Record<string, LigneMessage[]> = {};
  entrees: string[] = [];
  /** Lot 3 : les affectations à pousser, par espace, et ce qui a été noté. */
  aAffecter: Record<string, AffectationAPousser[]> = {};
  notees: { entreeId: string; valeur: string | null }[] = [];
  panneAffectations = false;
  constructor(
    public espaces: EspaceBranche[],
    public messages: Record<string, LigneMessage[]> = {},
    public lignes: Record<string, LigneEspace | null> = {},
    public panneSur: string | null = null,
  ) {}
  async espacesBranches(): Promise<EspaceBranche[]> { return this.espaces; }
  async lireBoite(): Promise<string | null> { return null; }
  async brancher(): Promise<void> {}
  async debrancher(tenantId: string): Promise<void> { this.debranches.push(tenantId); }
  async ligne(tenantId: string): Promise<LigneEspace | null> {
    if (this.panneSur === tenantId) throw new Error('base indisponible');
    return tenantId in this.lignes ? this.lignes[tenantId]! : LIGNE;
  }
  async borne(): Promise<string> { return BORNE; }
  async messagesApres(e: EspaceBranche, _borne: string, limite: number): Promise<LigneMessage[]> { return (this.messages[e.tenantId] ?? []).slice(0, limite); }
  async avancer(tenantId: string, le: string, id: string): Promise<void> { this.curseurs.set(tenantId, { le, id }); }
  async fermerSorties(tenantId: string): Promise<number> { this.journal.push(`sorties:${tenantId}`); return 0; }
  async aFaireEntrer(tenantId: string, limite: number): Promise<string[]> { return (this.aEntrer[tenantId] ?? []).slice(0, limite); }
  async contexte(_tenantId: string, conversationId: string): Promise<LigneMessage[]> { return this.contextes[conversationId] ?? []; }
  async ouvrirEntree(_tenantId: string, conversationId: string): Promise<boolean> {
    this.journal.push(`entree:${conversationId}`);
    this.entrees.push(conversationId);
    return true;
  }
  async affectationsAPousser(tenantId: string, limite: number): Promise<AffectationAPousser[]> {
    if (this.panneAffectations) throw new Error('base indisponible');
    this.journal.push(`affectations:${tenantId}`);
    return (this.aAffecter[tenantId] ?? []).slice(0, limite);
  }
  async noterAffectation(_tenantId: string, entreeId: string, valeur: string | null): Promise<void> { this.notees.push({ entreeId, valeur }); }
  /** Lot 4 : les fils à relire, par espace, et les relectures notées. */
  aLire: Record<string, FilALire[]> = {};
  lus: string[] = [];
  panneFermetures = false;
  async fermeturesALire(tenantId: string, limite: number): Promise<FilALire[]> {
    if (this.panneFermetures) throw new Error('base indisponible');
    this.journal.push(`fermetures:${tenantId}`);
    return (this.aLire[tenantId] ?? []).slice(0, limite);
  }
  async noterEtatsLus(_tenantId: string, entreeIds: readonly string[]): Promise<void> { this.lus.push(...entreeIds); }
  /** Les conversations qui ne sont plus à fermer quand on les relit juste avant le geste. */
  plusAFermer = new Set<string>();
  async toujoursAFermer(_tenantId: string, conversationId: string): Promise<boolean> { return !this.plusAFermer.has(conversationId); }
}

/**
 * Le connecteur des états et les deux gestes de la console (lot 4) : rend `issue`, retient les lots reçus et les gestes
 * faits, dans l'ordre.
 */
function fermeur(
  issue: IssueEtats | (() => Promise<IssueEtats>) = { issue: 'fait', resultats: [] },
  rendu: IssueRendreLaMain | 'contact_muet' | ((waId: string) => Promise<IssueRendreLaMain | 'contact_muet'>) = 'app_workflow',
) {
  const lots: { tenantId: string; ligne: string; conversationIds: string[] }[] = [];
  const gestes: string[] = [];
  const auteurs: AuteurDuChangement[] = [];
  return {
    lots, gestes, auteurs,
    etats: async (corps: { tenantId: string; ligne: string; conversationIds: string[] }): Promise<IssueEtats> => {
      lots.push(corps);
      return typeof issue === 'function' ? issue() : issue;
    },
    rendreLaMain: async (tenantId: string, waId: string, par: AuteurDuChangement): Promise<IssueRendreLaMain | 'contact_muet'> => {
      gestes.push(`rendre:${tenantId}:${waId}`);
      auteurs.push(par);
      return typeof rendu === 'function' ? rendu(waId) : rendu;
    },
    marquerTraitee: async (tenantId: string, conversationId: string, traitee: boolean, par: AuteurDuChangement): Promise<boolean> => {
      gestes.push(`traitee:${tenantId}:${conversationId}:${traitee}`);
      auteurs.push(par);
      return true;
    },
  };
}
/** Rien à relire dans les tests des lots 1 à 3 : les fiches du lot 4, inertes. */
const sansFermeture = (({ etats, rendreLaMain, marquerTraitee }) => ({ etats, rendreLaMain, marquerTraitee }))(fermeur());

/** Le connecteur d'affectation (lot 3) : rend `issue`, et retient les lots reçus. */
function affecteur(issue: IssueAffectations | ((corps: { affectations: AffectationInbox[] }) => IssueAffectations) = (c) => ({
  issue: 'fait', resultats: c.affectations.map((a) => ({ conversationId: a.conversationId, issue: 'fait' as const })),
})) {
  const lots: { tenantId: string; ligne: string; affectations: AffectationInbox[] }[] = [];
  return {
    lots,
    affecter: async (corps: { tenantId: string; ligne: string; affectations: AffectationInbox[] }): Promise<IssueAffectations> => {
      lots.push(corps);
      return typeof issue === 'function' ? issue(corps) : issue;
    },
  };
}
/** Aucun appel attendu : les tests des lots 1 et 1 bis n'ont rien à affecter. */
const sansAffectation = affecteur().affecter;

const espace = (tenantId = 't1'): EspaceBranche => ({ tenantId, boite: '77', curseurLe: '2026-11-06T11:00:00.000000Z', curseurId: UUID_ZERO });

function pousseur(issue: IssueInbox | ((corps: { tenantId: string }) => IssueInbox) = { issue: 'fait', publies: 1, refuses: 0 }) {
  const lots: { tenantId: string; ligne: string; messages: MessageInboxHubspot[] }[] = [];
  return {
    lots,
    pousser: async (corps: { tenantId: string; ligne: string; messages: MessageInboxHubspot[] }): Promise<IssueInbox> => {
      lots.push(corps);
      return typeof issue === 'function' ? issue(corps) : issue;
    },
  };
}

describe('balayerInbox', () => {
  it('pousse les messages de l’espace avec la ligne en E.164, puis avance le curseur au DERNIER message poussé', async () => {
    const m2 = message({ id: '22222222-2222-2222-2222-222222222222', createdAt: '2026-11-06T11:59:30.123456Z' });
    const store = new StoreMemoire([espace()], { t1: [message(), m2] });
    const p = pousseur({ issue: 'fait', publies: 2, refuses: 0 });
    expect(await balayerInbox({ store, pousser: p.pousser, affecter: sansAffectation, ...sansFermeture })).toBe(2);
    expect(p.lots).toHaveLength(1);
    expect(p.lots[0]).toMatchObject({ tenantId: 't1', ligne: '+33100000000' });
    expect(store.curseurs.get('t1')).toEqual({ le: m2.createdAt, id: m2.id });
  });

  it('🔴 une panne du connecteur (le pousseur LÈVE) : le curseur ne bouge pas, le tour suivant rejoue le même lot', async () => {
    const store = new StoreMemoire([espace()], { t1: [message()] });
    const enPanne = async (): Promise<IssueInbox> => { throw new Error('connecteur HTTP 503'); };
    await balayerInbox({ store, pousser: enPanne, affecter: sansAffectation, ...sansFermeture });
    expect(store.curseurs.has('t1')).toBe(false);
  });

  it('🔴 un espace en panne n’arrête pas les autres', async () => {
    const store = new StoreMemoire([espace('t1'), espace('t2')], { t2: [message()] }, {}, 't1');
    const p = pousseur();
    await balayerInbox({ store, pousser: p.pousser, affecter: sansAffectation, ...sansFermeture });
    expect(p.lots.map((l) => l.tenantId)).toEqual(['t2']);
  });

  it('rien d’arrivé : le curseur avance à la borne, pour qu’un espace silencieux ne relise pas demain tout ce qui précède', async () => {
    const store = new StoreMemoire([espace()]);
    const p = pousseur();
    await balayerInbox({ store, pousser: p.pousser, affecter: sansAffectation, ...sansFermeture });
    expect(p.lots).toHaveLength(0);
    expect(store.curseurs.get('t1')).toEqual({ le: BORNE, id: UUID_ZERO });
  });

  it('🔴 une ligne non reliée à HubSpot, en pause, ou sans numéro : rien poussé, et pas de rattrapage à la reprise', async () => {
    for (const ligne of [{ ...LIGNE, connectee: false }, { ...LIGNE, enPause: true }, null]) {
      const store = new StoreMemoire([espace()], { t1: [message()] }, { t1: ligne });
      const p = pousseur();
      await balayerInbox({ store, pousser: p.pousser, affecter: sansAffectation, ...sansFermeture });
      expect(p.lots).toHaveLength(0);
      expect(store.curseurs.get('t1')).toEqual({ le: BORNE, id: UUID_ZERO });
    }
  });

  it('le connecteur n’a plus de compte de canal ou de portail : l’espace est débranché ici aussi', async () => {
    for (const issue of [{ issue: 'non_branche' }, { issue: 'non_relie' }] as IssueInbox[]) {
      const store = new StoreMemoire([espace()], { t1: [message()] });
      await balayerInbox({ store, pousser: pousseur(issue).pousser, affecter: sansAffectation, ...sansFermeture });
      expect(store.debranches).toEqual(['t1']);
    }
  });

  it('un contact sans numéro (BSUID) n’est pas poussé, mais le curseur passe son message', async () => {
    const seul = message({ waId: 'FR.1234567890abcdef' });
    const store = new StoreMemoire([espace()], { t1: [seul] });
    const p = pousseur();
    await balayerInbox({ store, pousser: p.pousser, affecter: sansAffectation, ...sansFermeture });
    expect(p.lots).toHaveLength(0);
    expect(store.curseurs.get('t1')).toEqual({ le: seul.createdAt, id: seul.id });
  });

  it('🔴 un refus qui se répare (401 signature, 404 sans code) garde le curseur ; seul un refus du contrat (400) saute le lot', async () => {
    for (const status of [401, 403, 404]) {
      const store = new StoreMemoire([espace()], { t1: [message()] });
      await balayerInbox({ store, pousser: pousseur({ issue: 'refuse', status, code: undefined }).pousser, affecter: sansAffectation, ...sansFermeture });
      expect(store.curseurs.has('t1')).toBe(false);
    }
    const store = new StoreMemoire([espace()], { t1: [message()] });
    await balayerInbox({ store, pousser: pousseur({ issue: 'refuse', status: 400, code: 'corps invalide' }).pousser, affecter: sansAffectation, ...sansFermeture });
    expect(store.curseurs.get('t1')?.id).toBe(message().id);
  });

  it('🔴 lot 1 bis : une conversation qui attend un humain publie son CONTEXTE, puis son entrée s’inscrit (dans cet ordre)', async () => {
    const store = new StoreMemoire([espace()]);
    store.aEntrer = { t1: ['conv-9'] };
    store.contextes = { 'conv-9': [message({ id: 'c1', conversationId: 'conv-9' }), message({ id: 'c2', conversationId: 'conv-9', direction: 'out', origin: 'ia' })] };
    const p = pousseur({ issue: 'fait', publies: 2, refuses: 0 });
    const pousserTrace = async (corps: Parameters<typeof p.pousser>[0]) => { store.journal.push(`pousse:${corps.messages.map((m) => m.id).join(',')}`); return p.pousser(corps); };
    expect(await balayerInbox({ store, pousser: pousserTrace, affecter: sansAffectation, ...sansFermeture })).toBe(2);
    expect(store.journal).toEqual(['sorties:t1', 'pousse:c1,c2', 'entree:conv-9', 'affectations:t1', 'fermetures:t1']);
  });

  it('🔴 une panne pendant le contexte n’inscrit PAS l’entrée : le tour suivant rejoue l’entrée entière', async () => {
    const store = new StoreMemoire([espace()]);
    store.aEntrer = { t1: ['conv-9'] };
    store.contextes = { 'conv-9': [message({ id: 'c1', conversationId: 'conv-9' })] };
    const enPanne = async (): Promise<IssueInbox> => { throw new Error('connecteur HTTP 503'); };
    await balayerInbox({ store, pousser: enPanne, affecter: sansAffectation, ...sansFermeture });
    expect(store.entrees).toEqual([]);
  });

  it('un refus du contrat sur le contexte inscrit l’entrée quand même (rejouer rendrait le même refus)', async () => {
    const store = new StoreMemoire([espace()]);
    store.aEntrer = { t1: ['conv-9'] };
    store.contextes = { 'conv-9': [message({ id: 'c1', conversationId: 'conv-9' })] };
    await balayerInbox({ store, pousser: pousseur({ issue: 'refuse', status: 400, code: 'corps invalide' }).pousser, affecter: sansAffectation, ...sansFermeture });
    expect(store.entrees).toEqual(['conv-9']);
  });

  it('un refus qui se répare (401) sur le contexte : ni entrée, ni suite, ni curseur', async () => {
    const store = new StoreMemoire([espace()], { t1: [message()] });
    store.aEntrer = { t1: ['conv-9'] };
    store.contextes = { 'conv-9': [message({ id: 'c1', conversationId: 'conv-9' })] };
    const p = pousseur({ issue: 'refuse', status: 401, code: undefined });
    await balayerInbox({ store, pousser: p.pousser, affecter: sansAffectation, ...sansFermeture });
    expect(store.entrees).toEqual([]);
    expect(p.lots).toHaveLength(1);
    expect(store.curseurs.has('t1')).toBe(false);
  });

  it('une conversation sans message à publier (contexte vide) entre quand même, sans appel au connecteur', async () => {
    const store = new StoreMemoire([espace()]);
    store.aEntrer = { t1: ['conv-9'] };
    const p = pousseur();
    await balayerInbox({ store, pousser: p.pousser, affecter: sansAffectation, ...sansFermeture });
    expect(p.lots).toHaveLength(0);
    expect(store.entrees).toEqual(['conv-9']);
  });

  it(`un lot au plus par espace et par tour (${LOT_INBOX} messages)`, async () => {
    const beaucoup = Array.from({ length: LOT_INBOX + 10 }, (_, i) => message({ id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}` }));
    const store = new StoreMemoire([espace()], { t1: beaucoup });
    const p = pousseur();
    await balayerInbox({ store, pousser: p.pousser, affecter: sansAffectation, ...sansFermeture });
    expect(p.lots[0]?.messages).toHaveLength(LOT_INBOX);
  });
});

describe('balayerInbox : l’affectation du fil (lot 3)', () => {
  const a = (n: number, email: string | null = 'conseil@mutac.fr', dejaPose = false): AffectationAPousser => ({
    entreeId: `e${n}`, conversationId: `conv-${n}`, email, contactE164: '+33612345678', dejaPose,
  });

  it('pousse les affectations qui ont changé, avec la ligne, et note ce qui a été posé (`` pour personne)', async () => {
    const store = new StoreMemoire([espace()]);
    store.aAffecter = { t1: [a(1), a(2, null, true)] };
    const af = affecteur();
    await balayerInbox({ store, pousser: pousseur().pousser, affecter: af.affecter, ...sansFermeture });
    // Le numéro du contact et `dejaPose` partent avec chaque affectation : le connecteur en tire le propriétaire de la fiche.
    expect(af.lots).toEqual([{ tenantId: 't1', ligne: '+33100000000', affectations: [
      { conversationId: 'conv-1', email: 'conseil@mutac.fr', contactE164: '+33612345678', dejaPose: false },
      { conversationId: 'conv-2', email: null, contactE164: '+33612345678', dejaPose: true },
    ] }]);
    expect(store.notees).toEqual([{ entreeId: 'e1', valeur: 'conseil@mutac.fr' }, { entreeId: 'e2', valeur: '' }]);
  });

  it('`inconnu` et `refuse` sont notés (pas redemandés à chaque tour) ; `fil_inconnu` ne note que sa tentative (rejoué)', async () => {
    const store = new StoreMemoire([espace()]);
    store.aAffecter = { t1: [a(1), a(2), a(3)] };
    const af = affecteur({ issue: 'fait', resultats: [
      { conversationId: 'conv-1', issue: 'inconnu' }, { conversationId: 'conv-2', issue: 'refuse' }, { conversationId: 'conv-3', issue: 'fil_inconnu' },
    ] });
    await balayerInbox({ store, pousser: pousseur().pousser, affecter: af.affecter, ...sansFermeture });
    expect(store.notees).toEqual([
      { entreeId: 'e1', valeur: 'conseil@mutac.fr' }, { entreeId: 'e2', valeur: 'conseil@mutac.fr' }, { entreeId: 'e3', valeur: null },
    ]);
  });

  it('rien à affecter : le connecteur n’est pas appelé', async () => {
    const store = new StoreMemoire([espace()]);
    const af = affecteur();
    await balayerInbox({ store, pousser: pousseur().pousser, affecter: af.affecter, ...sansFermeture });
    expect(af.lots).toHaveLength(0);
  });

  it('🔴 portée absente, refus, panne du connecteur ou de la base : rien n’est noté, et les MESSAGES partent quand même', async () => {
    const pannes: (() => Promise<IssueAffectations>)[] = [
      async () => ({ issue: 'portees' }),
      async () => ({ issue: 'refuse', status: 400, code: 'corps invalide' }),
      async () => { throw new Error('connecteur HTTP 503'); },
    ];
    for (const affecter of pannes) {
      const store = new StoreMemoire([espace()], { t1: [message()] });
      store.aAffecter = { t1: [a(1)] };
      const p = pousseur();
      await balayerInbox({ store, pousser: p.pousser, affecter, ...sansFermeture });
      expect(store.notees).toEqual([]);
      expect(p.lots).toHaveLength(1);
      expect(store.curseurs.get('t1')?.id).toBe(message().id);
    }
    const store = new StoreMemoire([espace()], { t1: [message()] });
    store.panneAffectations = true;
    const p = pousseur();
    await balayerInbox({ store, pousser: p.pousser, affecter: sansAffectation, ...sansFermeture });
    expect(p.lots).toHaveLength(1);
  });

  it('l’affectation passe APRÈS les entrées (le fil d’une conversation qui entre est déjà connu du connecteur)', async () => {
    const store = new StoreMemoire([espace()]);
    store.aEntrer = { t1: ['conv-9'] };
    store.contextes = { 'conv-9': [message({ id: 'c1', conversationId: 'conv-9' })] };
    await balayerInbox({ store, pousser: pousseur().pousser, affecter: sansAffectation, ...sansFermeture });
    expect(store.journal).toEqual(['sorties:t1', 'entree:conv-9', 'affectations:t1', 'fermetures:t1']);
  });

  it(`au plus ${AFFECTATIONS_PAR_TOUR} affectations par espace et par tour`, async () => {
    const store = new StoreMemoire([espace()]);
    store.aAffecter = { t1: Array.from({ length: AFFECTATIONS_PAR_TOUR + 5 }, (_, i) => a(i)) };
    const af = affecteur();
    await balayerInbox({ store, pousser: pousseur().pousser, affecter: af.affecter, ...sansFermeture });
    expect(af.lots[0]?.affectations).toHaveLength(AFFECTATIONS_PAR_TOUR);
  });
});

describe('balayerInbox : un fil fermé dans HubSpot rend la main (lot 4)', () => {
  const DEPUIS = '2026-11-11T13:20:00.000Z';
  const f = (n: number): FilALire => ({ entreeId: `e${n}`, conversationId: `conv-${n}`, waId: `3361234567${n}`, depuis: DEPUIS });
  const ferme = (n: number, fermeLe = '2026-11-11T13:24:05.120Z') => ({ conversationId: `conv-${n}`, etat: 'ferme' as const, fermeLe });
  const balayer = (store: StoreMemoire, fe: ReturnType<typeof fermeur>, p = pousseur()) =>
    balayerInbox({ store, pousser: p.pousser, affecter: sansAffectation, etats: fe.etats, rendreLaMain: fe.rendreLaMain, marquerTraitee: fe.marquerTraitee });

  it('🔴 un fil fermé APRÈS le dernier message : la main est rendue PUIS la conversation passe en « Traité », par la cause HubSpot', async () => {
    const store = new StoreMemoire([espace()]);
    store.aLire = { t1: [f(1)] };
    const fe = fermeur({ issue: 'fait', resultats: [ferme(1)] });
    await balayer(store, fe);
    expect(fe.lots).toEqual([{ tenantId: 't1', ligne: '+33100000000', conversationIds: ['conv-1'] }]);
    expect(fe.gestes).toEqual(['rendre:t1:33612345671', 'traitee:t1:conv-1:true']);
    expect(fe.auteurs).toEqual([PAR_FERMETURE_HUBSPOT, PAR_FERMETURE_HUBSPOT]);
    expect(PAR_FERMETURE_HUBSPOT).toEqual({ cause: 'automatique : fil fermé dans l’Inbox HubSpot' });
    expect(store.lus).toEqual(['e1']);
  });

  it('🔴 un fil fermé AVANT (ou à l’instant de) son dernier message, ouvert ou inconnu : rien n’est rendu, la relecture est notée', async () => {
    const store = new StoreMemoire([espace()]);
    store.aLire = { t1: [f(1), f(2), f(3), f(4)] };
    const fe = fermeur({ issue: 'fait', resultats: [
      ferme(1, '2026-11-11T13:19:59.999Z'), ferme(2, DEPUIS), { conversationId: 'conv-3', etat: 'ouvert' }, { conversationId: 'conv-4', etat: 'fil_inconnu' },
    ] });
    await balayer(store, fe);
    expect(fe.gestes).toEqual([]);
    expect(store.lus).toEqual(['e1', 'e2', 'e3', 'e4']);
  });

  it('une conversation que le connecteur n’a pas demandée n’est jamais touchée', async () => {
    const store = new StoreMemoire([espace()]);
    store.aLire = { t1: [f(1)] };
    const fe = fermeur({ issue: 'fait', resultats: [ferme(9)] });
    await balayer(store, fe);
    expect(fe.gestes).toEqual([]);
  });

  it('un mode « agent de Meta » sans numéro, ou un contact STOP (rien n’est rendu) : la conversation n’est pas rangée en « Traité »', async () => {
    for (const rendu of ['aucun_numero', 'contact_muet'] as const) {
      const store = new StoreMemoire([espace()]);
      store.aLire = { t1: [f(1)] };
      const fe = fermeur({ issue: 'fait', resultats: [ferme(1)] }, rendu);
      await balayer(store, fe);
      expect(fe.gestes).toEqual(['rendre:t1:33612345671']);
    }
  });

  it('🔴 relue juste avant le geste : plus tenue par l’équipe, ou le client a écrit pendant la lecture, rien n’est rendu', async () => {
    const store = new StoreMemoire([espace()]);
    store.aLire = { t1: [f(1), f(2)] };
    store.plusAFermer.add('conv-1');
    const fe = fermeur({ issue: 'fait', resultats: [ferme(1), ferme(2)] });
    await balayer(store, fe);
    expect(fe.gestes).toEqual(['rendre:t1:33612345672', 'traitee:t1:conv-2:true']);
  });

  it('un geste qui échoue sur une conversation n’arrête pas les autres', async () => {
    const store = new StoreMemoire([espace()]);
    store.aLire = { t1: [f(1), f(2)] };
    const fe = fermeur({ issue: 'fait', resultats: [ferme(1), ferme(2)] },
      async (waId) => { if (waId.endsWith('1')) throw new Error('Meta a refusé'); return 'app_workflow'; });
    await balayer(store, fe);
    expect(fe.gestes).toEqual(['rendre:t1:33612345671', 'rendre:t1:33612345672', 'traitee:t1:conv-2:true']);
  });

  it('🔴 refus, portées absentes, panne du connecteur ou de la base : rien n’est noté ni rendu, et les MESSAGES partent quand même', async () => {
    const pannes: (() => Promise<IssueEtats>)[] = [
      async () => ({ issue: 'portees' }),
      async () => ({ issue: 'refuse', status: 502, code: 'reponse_illisible' }),
      async () => { throw new Error('connecteur HTTP 503'); },
    ];
    for (const etats of pannes) {
      const store = new StoreMemoire([espace()], { t1: [message()] });
      store.aLire = { t1: [f(1)] };
      const fe = fermeur(etats);
      const p = pousseur();
      await balayer(store, fe, p);
      expect(store.lus).toEqual([]);
      expect(fe.gestes).toEqual([]);
      expect(p.lots).toHaveLength(1);
      expect(store.curseurs.get('t1')?.id).toBe(message().id);
    }
    const store = new StoreMemoire([espace()], { t1: [message()] });
    store.panneFermetures = true;
    const p = pousseur();
    await balayer(store, fermeur(), p);
    expect(p.lots).toHaveLength(1);
  });

  it('rien à relire : le connecteur n’est pas appelé ; au plus FERMETURES_PAR_TOUR fils par espace et par tour', async () => {
    const vide = fermeur();
    await balayer(new StoreMemoire([espace()]), vide);
    expect(vide.lots).toHaveLength(0);
    const store = new StoreMemoire([espace()]);
    store.aLire = { t1: Array.from({ length: FERMETURES_PAR_TOUR + 5 }, (_, i) => f(i)) };
    const fe = fermeur();
    await balayer(store, fe);
    expect(fe.lots[0]?.conversationIds).toHaveLength(FERMETURES_PAR_TOUR);
  });

  it('les fermetures passent APRÈS les affectations, avant la suite des messages', async () => {
    const store = new StoreMemoire([espace()], { t1: [message()] });
    const p = pousseur();
    const pousserTrace = async (corps: { tenantId: string; ligne: string; messages: MessageInboxHubspot[] }): Promise<IssueInbox> => {
      store.journal.push('suite');
      return p.pousser(corps);
    };
    await balayerInbox({ store, pousser: pousserTrace, affecter: sansAffectation, ...sansFermeture });
    expect(store.journal).toEqual(['sorties:t1', 'affectations:t1', 'fermetures:t1', 'suite']);
  });
});

describe('e164Accepte (lot 3)', () => {
  it('ne laisse passer que ce que le connecteur accepte', () => {
    expect(e164Accepte('+33612345678')).toBe('+33612345678');
    expect(e164Accepte('+0612345678')).toBeNull();
    expect(e164Accepte('+123')).toBeNull();
    expect(e164Accepte(null)).toBeNull();
    expect(e164Accepte(undefined)).toBeNull();
  });
});

describe('versConnecteur', () => {
  it('un message du client : son numéro en E.164, son nom, sans expéditeur', () => {
    expect(versConnecteur(message())).toEqual({
      id: '11111111-1111-1111-1111-111111111111', conversationId: 'conv-1', sens: 'in', texte: 'Bonjour',
      le: '2026-11-06T11:59:00.043Z', contactE164: '+33612345678', contactNom: 'Jeanne', expediteur: null,
    });
  });

  it('un message sans texte garde une trace lisible, un bouton tapé son libellé', () => {
    expect(versConnecteur(message({ body: null, type: 'image' }))?.texte).toBe('[image]');
    expect(versConnecteur(message({ body: null, buttonPayload: 'Oui' }))?.texte).toBe('Oui');
  });

  it('un nom de plus de 200 caractères est tronqué (le connecteur refuserait tout le lot)', () => {
    const long = 'x'.repeat(300);
    expect(versConnecteur(message({ nom: long }))?.contactNom).toHaveLength(200);
    expect(versConnecteur(message({ direction: 'out', origin: 'humain', membre: long }))?.expediteur).toHaveLength(200);
  });

  it('un message sortant porte qui l’a écrit', () => {
    expect(versConnecteur(message({ direction: 'out', origin: 'humain', membre: 'Julie' }))?.expediteur).toBe('Julie');
    expect(versConnecteur(message({ direction: 'out', origin: 'ia' }))?.expediteur).toBe('Agent IA');
  });
});

describe('expediteur et ligneE164', () => {
  it('chaque origine a un nom lisible', () => {
    expect(expediteur('scenario', null)).toBe('Scénario');
    expect(expediteur('mba', null)).toBe('Meta Business Agent');
    expect(expediteur(null, null)).toBe('Messaging Me');
  });

  it('l’affichage de Meta devient un E.164, un affichage illisible rien', () => {
    expect(ligneE164(LIGNE)).toBe('+33100000000');
    expect(ligneE164({ ...LIGNE, affichage: 'pas un numéro' })).toBeNull();
    expect(ligneE164(null)).toBeNull();
  });
});
