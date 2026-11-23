import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { relancerPaniers, type DepsRelance } from '../src/shopify/relance';
import { PgShopifyStore, type PanierDu } from '../src/shopify/store.pg';
import type { RapportEnvoi, ResultatEnvoiPublic } from '../src/api/envoi-public';
import type { Emission } from '../src/emails-produit/emission';
import type { Filiere } from '../src/application/comptes';
import type { DonneeShopify } from '../src/shopify/donnees';
import { MARQUE_PREMIER_BLOC } from '../src/shopify/premier-bloc';
import type { ParamHint } from '../src/crm/template-hints.pg';
import { DROITS } from '../src/offres/offres';
import type { OffreEspace } from '../src/offres/offre.pg';
import type { WorkflowNode } from '../src/workflow/graph';
import type { WorkflowRow } from '../src/workflow/store.pg';

/**
 * LA RELANCE DES PANIERS ABANDONNÉS (plan 2026-10-21, lot 2), un passage du balayage ; depuis le lot 5 du menu
 * « Scénario », le premier bloc du scénario de la ligne du panier. La réclamation (une écriture atomique en base) est
 * prouvée par le test d'intégration ; ici, ce qu'un panier réclamé devient.
 */

const panier = (over: Partial<PanierDu> = {}): PanierDu => ({
  tenantId: 't1', jeton: 'jeton-1', telephone: '+33633921577', nom: 'Julien', lien: 'https://b.myshopify.com/1/checkouts/ac/x/recover?key=k',
  domaine: 'b.myshopify.com', workflowId: 'wf-panier', ...over,
});
const rapport = (over: Partial<RapportEnvoi> = {}): RapportEnvoi => ({
  sendId: 's1', opening: 'whatsapp_template', recipientCount: 1, created: 1, matched: 0, skipped: [], skippedTotal: 0, ...over,
});

/** Le premier bloc du scénario de la ligne du panier : un template, ses variables rangées sur le bloc. */
interface BlocDeTest { modele: string | null; langue: string; variables: DonneeShopify[]; suite?: boolean }
const BLOC: BlocDeTest = { modele: 'relance_panier', langue: 'fr', variables: ['first_name', 'checkout_url'] };

const scenarioDe = (tenantId: string, b: BlocDeTest): WorkflowRow => {
  const depart: WorkflowNode = {
    id: 'depart', type: 'template', position: { x: 0, y: 0 },
    data: {
      [MARQUE_PREMIER_BLOC]: true,
      ...(b.modele !== null ? { templateName: b.modele, language: b.langue } : {}),
      templateButtons: b.suite ? [{ type: 'QUICK_REPLY', text: 'Oui' }] : [],
      variables: b.variables.map((key, i) => ({ position: i + 1, source: { type: 'variable', key } })),
    },
  };
  const suite: WorkflowNode = { id: 'suite', type: 'template', position: { x: 0, y: 1 }, data: { templateName: 'merci', language: 'fr' } };
  return {
    id: 'wf-panier', tenantId, name: 'Panier abandonné', rayon: 'shopify', draftGraph: null,
    publishedAt: '2026-11-19T00:00:00.000Z', createdAt: '2026-11-19T00:00:00.000Z', updatedAt: '2026-11-19T00:00:00.000Z',
    graph: b.suite
      ? { nodes: [depart, suite], edges: [{ id: 'e1', source: 'depart', target: 'suite', sourceHandle: 'btn:0' }] }
      : { nodes: [depart], edges: [] },
  };
};

/** Les faux des magasins injectés : des CLASSES dont les méthodes lisent `this`, passés ENTIERS. */
class FauxScenarios {
  lus: string[] = [];
  constructor(private readonly bloc: BlocDeTest) {}
  async getById(id: string, tenantId: string): Promise<WorkflowRow | null> {
    this.lus.push(`${tenantId}:${id}`);
    return id === 'wf-panier' ? scenarioDe(tenantId, this.bloc) : null;
  }
}
class FauxIndices {
  private readonly indices: ParamHint[] = [];
  async get(): Promise<ParamHint[]> { return this.indices; }
}
class FauxOffres {
  constructor(private readonly offre: 'base' | 'pro') {}
  async offreDe(): Promise<OffreEspace> { return { offre: this.offre, droits: DROITS[this.offre], retourEnBaseLe: null }; }
}
type CibleArret = { origine: string } | { prefixe: string; waId?: string } | { workflowIds: readonly string[] };
class FauxParcours {
  arrets: CibleArret[] = [];
  constructor(private readonly ordre: string[], private readonly leve: boolean) {}
  async arreterParcours(_t: string, cible: CibleArret, _motif: string): Promise<number> {
    this.ordre.push('arret');
    if (this.leve) throw new Error('base indisponible');
    this.arrets.push(cible);
    return 0;
  }
}

function monter(
  paniers: PanierDu[], reponse: (corps: unknown) => Promise<ResultatEnvoiPublic> = async () => ({ statut: 201, corps: rapport() }),
  fermes: readonly string[] = [],
  o: { bloc?: BlocDeTest; filiere?: (t: string) => Filiere | null; offre?: 'base' | 'pro'; arretLeve?: boolean } = {},
) {
  const journal = {
    limites: [] as number[], issues: [] as Array<[string, string]>, envois: [] as Array<{ corps: unknown; options: unknown }>,
    emails: [] as Emission[], comptees: [] as Array<[string, string]>, ordre: [] as string[],
  };
  const scenarios = new FauxScenarios(o.bloc ?? BLOC);
  const parcours = new FauxParcours(journal.ordre, o.arretLeve === true);
  const deps: DepsRelance = {
    store: {
      reclamerPaniersDus: async (limite) => { journal.limites.push(limite); return paniers; },
      noterIssuePanier: async (_t, jeton, issue) => { journal.issues.push([jeton, issue]); },
      panierOuvert: async (_t, jeton) => !fermes.includes(jeton),
      compterRelance: async (t, le) => { journal.comptees.push([t, le.toISOString()]); },
    },
    filiere: async (t) => (o.filiere ? o.filiere(t) : 'api'),
    lectures: { workflows: scenarios, indices: new FauxIndices() },
    offres: new FauxOffres(o.offre ?? 'pro'),
    parcours,
    envoyer: async (_t, corps, compter, options) => {
      journal.ordre.push('envoi');
      journal.envois.push({ corps, options });
      expect(await compter(1)).toBe(true);
      return reponse(corps);
    },
    emails: { emettre: async (e) => { journal.emails.push(e); return {}; } },
    pageOffre: 'https://console.test/offre',
    maintenant: () => Date.parse('2026-10-22T10:00:00Z'),
  };
  return { deps, journal, scenarios, parcours };
}

/**
 * LES PANIERS DUS, DANS LE SQL DU STORE (2026-10-26, lot 5) : plus aucune affirmation du marchand n'y est lue ; la ligne
 * du panier, la pause et `paniers_depuis`, si. Le test d'intégration le prouve sur une vraie base, mais seulement en CI ;
 * celui-ci le voit partout, sur le SQL lui-même.
 */
describe('les paniers dus, dans le SQL du store', () => {
  it('🔴 la réclamation ne lit pas l’affirmation du consentement ; elle lit la ligne allumée, la pause et `paniers_depuis`', async () => {
    const lus: string[] = [];
    const pool = { query: async (sql: string) => { lus.push(sql); return { rows: [] }; } } as unknown as Pool;
    const store = new PgShopifyStore(pool, 'cle-de-test');
    expect(await store.reclamerPaniersDus(50)).toEqual([]);
    expect(lus).toHaveLength(1);
    expect(lus[0]).not.toMatch(/consentement/);
    expect(lus[0]).not.toMatch(/shopify_messages/);
    expect(lus[0]).toContain("b.etat = 'connectee' and b.pause_le is null and l.actif");
    expect(lus[0]).toContain('(b.paniers_depuis is null or p.maj_le >= b.paniers_depuis)');
  });
});

describe('la relance d’un panier réclamé', () => {
  it('🔴 part consentante (le marchand en répond, sans affirmation), avec le lien de reprise et le prénom, sous sa clé métier', async () => {
    const { deps, journal } = monter([panier()]);
    const bilan = await relancerPaniers(deps);
    expect(bilan).toEqual({ reclames: 1, issues: { envoye: 1 } });
    expect(journal.envois[0]!.corps).toMatchObject({
      idempotencyKey: 'shopify:b.myshopify.com:checkouts/abandoned:jeton-1',
      target: { template: { name: 'relance_panier', language: 'fr' } },
      recipients: [{
        phone: '+33633921577', consent: 'opted_in', consentSource: 'shopify:b.myshopify.com',
        variables: { first_name: 'Julien', checkout_url: 'https://b.myshopify.com/1/checkouts/ac/x/recover?key=k' },
      }],
    });
    expect(journal.envois[0]!.options).toEqual({ nom: 'Shopify · panier abandonné', sansCampagneVide: true, neeDe: 'shopify' });
    expect(journal.issues).toEqual([['jeton-1', 'envoye']]);
  });

  it('🔴 un prénom absent (facultatif chez Shopify) : la relance part avec son mot de secours, dans la langue du bloc', async () => {
    const fr = monter([panier({ nom: null })]);
    await relancerPaniers(fr.deps);
    expect(fr.journal.issues).toEqual([['jeton-1', 'envoye']]);
    expect(fr.journal.envois[0]!.corps).toMatchObject({ recipients: [{ variables: { first_name: 'à vous' } }] });
    const en = monter([panier({ nom: null })], undefined, [], { bloc: { ...BLOC, langue: 'en_US' } });
    await relancerPaniers(en.deps);
    expect(en.journal.envois[0]!.corps).toMatchObject({ recipients: [{ variables: { first_name: 'there' } }] });
  });

  it('une autre donnée absente (le lien du panier) alors que le bloc la demande : rien ne part, l’issue le dit', async () => {
    const { deps, journal } = monter([panier({ lien: '' })]);
    await relancerPaniers(deps);
    expect(journal.envois).toEqual([]);
    expect(journal.issues).toEqual([['jeton-1', 'donnee_manquante']]);
  });

  it('une relance envoyée compte une fois, à l’heure du passage ; refusée, fermée ou en panne, elle ne compte pas (plan 2026-10-28)', async () => {
    const { deps, journal } = monter([panier(), panier({ jeton: 'jeton-2' }), panier({ jeton: 'jeton-3', lien: '' })], async (corps) => {
      if (JSON.stringify(corps).includes('jeton-2')) throw new Error('panne');
      return { statut: 201, corps: rapport() };
    }, ['jeton-4']);
    await relancerPaniers(deps);
    expect(journal.comptees).toEqual([['t1', '2026-10-22T10:00:00.000Z']]);
    const ferme = monter([panier({ jeton: 'jeton-4' })], undefined, ['jeton-4']);
    await relancerPaniers(ferme.deps);
    expect(ferme.journal.comptees).toEqual([]);
  });

  it('un compteur en panne ne change rien à la relance ni à son issue', async () => {
    const { deps, journal } = monter([panier()]);
    deps.store.compterRelance = async () => { throw new Error('base indisponible'); };
    expect(await relancerPaniers(deps)).toEqual({ reclames: 1, issues: { envoye: 1 } });
    expect(journal.issues).toEqual([['jeton-1', 'envoye']]);
  });

  it('🔴 une panne en route : la relance est perdue mais notée, jamais renvoyée (une seule relance)', async () => {
    const { deps, journal } = monter([panier(), panier({ jeton: 'jeton-2' })], async (corps) => {
      if (JSON.stringify(corps).includes('jeton-1')) throw new Error('panne');
      return { statut: 201, corps: rapport() };
    });
    const bilan = await relancerPaniers(deps);
    expect(bilan.issues).toEqual({ erreur: 1, envoye: 1 });
    expect(journal.issues).toEqual([['jeton-1', 'erreur'], ['jeton-2', 'envoye']]);
  });

  it('un écart de l’envoi public devient l’issue (STOP, limite de contacts, modèles du mois) ; une clé tenue ailleurs n’écrit rien', async () => {
    const ecarte = (reason: RapportEnvoi['skipped'][number]['reason']): ResultatEnvoiPublic =>
      ({ statut: 200, corps: rapport({ sendId: '', recipientCount: 0, skipped: [{ index: 0, reason }] }) });
    const stop = monter([panier()], async () => ecarte('opted_out'));
    await relancerPaniers(stop.deps);
    expect(stop.journal.issues).toEqual([['jeton-1', 'desabonne']]);
    const limite = monter([panier()], async () => ecarte('plan_limit_reached'));
    await relancerPaniers(limite.deps);
    expect(limite.journal.issues).toEqual([['jeton-1', 'limite_contacts']]);
    // La limite prévient les admins, une fois par mois civil (l'occasion), comme un message de commande.
    expect(limite.journal.emails).toMatchObject([{ cle: 'shopify_limite_contacts', a: 'admins', occasion: '2026-10', valeurs: { boutique: 'b.myshopify.com', lien_offre: 'https://console.test/offre' } }]);
    expect(stop.journal.emails).toEqual([]);
    // La limite des modèles du mois garde son issue : la relance est consommée (une seule relance).
    const mois = monter([panier()], async () => ({ statut: 402, corps: { code: 'plan_limit_reached', limite: 'envoisModelesMois' } }));
    await relancerPaniers(mois.deps);
    expect(mois.journal.issues).toEqual([['jeton-1', 'limite_modeles']]);
    const tenue = monter([panier()], async () => ({ statut: 409, corps: { code: 'idempotency_in_progress' } }));
    expect((await relancerPaniers(tenue.deps)).issues).toEqual({ en_cours: 1 });
    expect(tenue.journal.issues).toEqual([]);
  });

  it('🔴 un panier fermé depuis sa réclamation (une commande est arrivée entre-temps) ne part pas', async () => {
    const { deps, journal } = monter([panier(), panier({ jeton: 'jeton-2' })], undefined, ['jeton-1']);
    expect((await relancerPaniers(deps)).issues).toEqual({ ferme: 1, envoye: 1 });
    expect(journal.envois).toHaveLength(1);
    expect(journal.issues).toEqual([['jeton-1', 'ferme'], ['jeton-2', 'envoye']]);
  });

  it('le passage est borné, et rien de réclamé ne fait rien', async () => {
    const { deps, journal } = monter([]);
    expect(await relancerPaniers(deps, 7)).toEqual({ reclames: 0, issues: {} });
    expect(journal.limites).toEqual([7]);
  });

  it('🔴 le premier bloc, un template, ne part pas d’un numéro relié par QR code : filiere_differente, l’issue est gardée', async () => {
    const { deps, journal } = monter([panier()], undefined, [], { filiere: () => 'application' });
    await relancerPaniers(deps);
    expect([journal.envois, journal.issues]).toEqual([[], [['jeton-1', 'filiere_differente']]]);
  });
});

/** Le premier bloc de la ligne du panier, le pont et la décision 33 (lot 5 du menu « Scénario »). */
describe('la relance du lot 5 : premier bloc, pont et place du panier le plus récent', () => {
  it('🔴 le premier bloc se lit UNE fois par espace et par passage, pas une fois par panier', async () => {
    const { deps, scenarios } = monter([panier(), panier({ jeton: 'jeton-2' }), panier({ tenantId: 't2', jeton: 'jeton-3' })]);
    await relancerPaniers(deps);
    expect(scenarios.lus).toEqual(['t1:wf-panier', 't2:wf-panier']);
  });

  it('🔴 un scénario sans premier bloc prêt : l’issue premier_message_absent, rien ne part, la relance est consommée', async () => {
    const { deps, journal } = monter([panier()], undefined, [], { bloc: { ...BLOC, modele: null } });
    expect((await relancerPaniers(deps)).issues).toEqual({ premier_message_absent: 1 });
    expect([journal.envois, journal.issues]).toEqual([[], [['jeton-1', 'premier_message_absent']]]);
  });

  it('🔴 décision 33 : avant la relance, les parcours des AUTRES paniers du contact s’arrêtent (préfixe des paniers, son numéro)', async () => {
    const { deps, journal, parcours } = monter([panier()]);
    await relancerPaniers(deps);
    expect(parcours.arrets).toEqual([{ prefixe: 'shopify:b.myshopify.com:checkouts/abandoned:', waId: '33633921577' }]);
    expect(journal.ordre).toEqual(['arret', 'envoi']);
  });

  it('🔴 un arrêt en panne n’empêche pas la relance', async () => {
    const { deps, journal } = monter([panier()], undefined, [], { arretLeve: true });
    expect((await relancerPaniers(deps)).issues).toEqual({ envoye: 1 });
    expect(journal.issues).toEqual([['jeton-1', 'envoye']]);
  });

  it('un panier fermé ou dont une donnée manque n’arrête aucun parcours', async () => {
    const { deps, parcours } = monter([panier({ jeton: 'ferme' }), panier({ jeton: 'sans-lien', lien: '' })], undefined, ['ferme']);
    await relancerPaniers(deps);
    expect(parcours.arrets).toEqual([]);
  });

  it('🔴 le pont : posé quand le bloc a une suite et que l’offre a `scenarios`, l’origine étant le jeton ; jamais en Free', async () => {
    const pro = monter([panier()], undefined, [], { bloc: { ...BLOC, suite: true } });
    await relancerPaniers(pro.deps);
    expect(pro.journal.envois[0]!.options).toEqual({
      nom: 'Shopify · panier abandonné', sansCampagneVide: true, neeDe: 'shopify',
      parcoursEvenement: {
        workflowId: 'wf-panier', noeudId: 'depart', type: 'evenement_shopify',
        origine: 'shopify:b.myshopify.com:checkouts/abandoned:jeton-1', boutons: [{ type: 'QUICK_REPLY', text: 'Oui' }],
      },
    });
    const free = monter([panier()], undefined, [], { bloc: { ...BLOC, suite: true }, offre: 'base' });
    await relancerPaniers(free.deps);
    expect(free.journal.envois[0]!.options).toEqual({ nom: 'Shopify · panier abandonné', sansCampagneVide: true, neeDe: 'shopify' });
  });

  it('🔴 un jeton qui porte l’origine au-delà de 200 caractères : la relance part seule, sans pont, sous sa clé coupée', async () => {
    const { deps, journal } = monter([panier({ jeton: 'j'.repeat(190) })], undefined, [], { bloc: { ...BLOC, suite: true } });
    await relancerPaniers(deps);
    expect(journal.envois[0]!.options).toEqual({ nom: 'Shopify · panier abandonné', sansCampagneVide: true, neeDe: 'shopify' });
    expect((journal.envois[0]!.corps as { idempotencyKey: string }).idempotencyKey).toHaveLength(200);
  });
});
