import { describe, it, expect } from 'vitest';
import { planifierDependances, rebrancherCible, sortDeLOutil, type DependancesSource, type NomsPris, type OutilSource } from '../src/ops/duplication/dependances';
import type { ReferenceDependance } from '../src/ops/duplication/graphe';
import { normaliserEtiquette } from '../src/crm/poser-etiquette';

/**
 * LES DÉPENDANCES D'UN SCÉNARIO DUPLIQUÉ (lot 2, tâche 2 du plan `docs/superpowers/plans/2026-11-17-duplication-scenario-lot-2.md`).
 * Ce qui suit un agent coché, les noms des copies, les dépendances partagées copiées une fois, les champs et tags que les
 * copies nomment, et les choix bornés aux références du scénario.
 */

const SCN = '0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b';
const AUTRE_SCN = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const CODE = 'nod_src01_01J00000000000000000000001';
/** Le scénario copié : ses blocs ont un équivalent dans la copie, dont CODE. */
const SCENARIO = { id: SCN, codes: new Set([CODE]) };

const outil = (id: string, over: Partial<OutilSource> = {}): OutilSource => ({
  id, nom: id, origine: 'mba', proprietaire: true, binding: { handler: 'terminer' }, requeteId: null, gestes: [], ...over,
});

const deps = (): DependancesSource => ({
  agents: [{
    id: 'ag-1', label: 'Conseiller', fiches: 3,
    outils: [
      outil('o-tag', { nom: 'mba_poser_tag', binding: { handler: 'poser_tag', tag: 'Client VIP' } }),
      outil('o-bloc', { nom: 'envoyer_relance', binding: { handler: 'envoyer_bloc', workflowId: SCN, code: CODE } }),
      outil('o-autre', { nom: 'lancer_autre', binding: { handler: 'lancer_scenario', workflowId: AUTRE_SCN } }),
      outil('o-champ', { nom: 'noter_ville', binding: { handler: 'ecrire_variable', champ: 'ville_rdv', valeurs: [] } }),
      outil('o-http', { nom: 'creer_lead', origine: 'http', proprietaire: false, binding: {}, requeteId: 'rq-1' }),
      outil('o-mcp', { nom: 'agenda', origine: 'mcp', proprietaire: false, binding: {} }),
    ],
  }],
  requetes: [
    { id: 'rq-1', label: 'Créer le lead', sourceId: 'src-1', variables: [{ nom: 'ville', type: 'string', origine: { type: 'champ', cle: 'ville' } }] },
    { id: 'rq-2', label: 'Lire le lead', sourceId: 'src-1', variables: [] },
  ],
  sources: [{ id: 'src-1', label: 'CRM', secret: true }],
  modelesEmail: [{ id: 'me-1', nom: 'Confirmation', sujet: 'Bonjour {{prenom}}', corps: 'Votre code : {{code_promo}}' }],
});

const refs: ReferenceDependance[] = [
  { nodeId: 'g1', sorte: 'agent', id: 'ag-1' },
  { nodeId: 'h2', sorte: 'requete', id: 'rq-1' },
  { nodeId: 'h3', sorte: 'requete', id: 'rq-2' },
  { nodeId: 'm4', sorte: 'modele_email', id: 'me-1' },
];
const vides: NomsPris = { agents: [], requetes: [], sources: [], modelesEmail: [], outils: [], flows: [] };

describe('sortDeLOutil', () => {
  it('un outil MCP ne suit pas ; un outil maison vers un AUTRE scénario non plus ; vers le scénario copié, oui', () => {
    const d = deps().agents[0]!.outils;
    expect(sortDeLOutil(d.find((o) => o.id === 'o-mcp')!, SCENARIO)).toEqual({ suit: false, raison: 'mcp' });
    expect(sortDeLOutil(d.find((o) => o.id === 'o-autre')!, SCENARIO)).toEqual({ suit: false, raison: 'autre_scenario' });
    expect(sortDeLOutil(d.find((o) => o.id === 'o-bloc')!, SCENARIO)).toEqual({ suit: true });
    expect(sortDeLOutil(d.find((o) => o.id === 'o-http')!, SCENARIO)).toEqual({ suit: true });
    expect(sortDeLOutil(outil('x', { binding: { handler: 'terminer' } }), SCENARIO)).toEqual({ suit: true });
  });
});

describe('planifierDependances', () => {
  it('sans choix : aucune copie, et l’aperçu nomme chaque dépendance (le secret signalé)', () => {
    const p = planifierDependances(deps(), vides, SCENARIO, refs);
    expect(p.copies).toEqual({ sources: [], requetes: [], modelesEmail: [], agents: [] });
    expect(p.apercu.agents[0]).toMatchObject({ nom: 'Conseiller', nomCopie: 'Conseiller', fiches: 3 });
    expect(p.apercu.agents[0]!.outilsNonCopies).toEqual([{ nom: 'lancer_autre', raison: 'autre_scenario' }, { nom: 'agenda', raison: 'mcp' }]);
    expect(p.apercu.requetes[0]!.source).toEqual({ nom: 'CRM', nomCopie: 'CRM', secret: true });
  });

  it('un agent coché emporte ses outils qui suivent, et la requête et la source de son outil d’appel', () => {
    const p = planifierDependances(deps(), vides, SCENARIO, refs, { agents: ['ag-1'], requetes: [], modelesEmail: [] });
    expect(p.copies.agents[0]!.outils.map((o) => o.id)).toEqual(['o-tag', 'o-bloc', 'o-champ', 'o-http']);
    expect(p.copies.requetes.map((r) => r.id)).toEqual(['rq-1']);
    expect(p.copies.sources.map((s) => s.id)).toEqual(['src-1']);
  });

  it('une requête cochée ET appelée par l’agent n’est copiée qu’une fois ; une source partagée aussi', () => {
    const p = planifierDependances(deps(), vides, SCENARIO, refs, { agents: ['ag-1'], requetes: ['rq-1', 'rq-2'], modelesEmail: [] });
    expect(p.copies.requetes.map((r) => r.id).sort()).toEqual(['rq-1', 'rq-2']);
    expect(p.copies.sources).toEqual([{ id: 'src-1', label: 'CRM' }]);
  });

  it('les champs et tags que les copies nomment : variable d’une requête, {{clé}} d’un e-mail, cible d’un outil', () => {
    const p = planifierDependances(deps(), vides, SCENARIO, refs, { agents: ['ag-1'], requetes: [], modelesEmail: ['me-1'] });
    expect([...p.clesDeChamp].sort()).toEqual(['code_promo', 'prenom', 'ville', 'ville_rdv']);
    expect(p.tags).toHaveLength(1);
  });

  it('les homonymes de la destination : « (copie) » ; un outil de l’espace homonyme : _copie', () => {
    const pris: NomsPris = { agents: ['conseiller'], requetes: ['Créer le lead'], sources: ['CRM'], modelesEmail: ['Confirmation'], outils: ['creer_lead'], flows: [] };
    const p = planifierDependances(deps(), pris, SCENARIO, refs, { agents: ['ag-1'], requetes: [], modelesEmail: ['me-1'] });
    expect(p.copies.agents[0]!.label).toBe('Conseiller (copie)');
    expect(p.copies.requetes[0]!.label).toBe('Créer le lead (copie)');
    expect(p.copies.sources[0]!.label).toBe('CRM (copie)');
    expect(p.copies.modelesEmail[0]!.nom).toBe('Confirmation (copie)');
    expect(p.copies.agents[0]!.outils.find((o) => o.id === 'o-http')!.nom).toBe('creer_lead_copie');
    // Un outil de l'agent garde son nom : il est unique par agent, et l'agent est neuf.
    expect(p.copies.agents[0]!.outils.find((o) => o.id === 'o-tag')!.nom).toBe('mba_poser_tag');
  });

  it('🔴 renommé, un outil de l’espace ne prend pas le nom d’une action de l’agent qui le consomme (un nom par consommateur)', () => {
    const d = deps();
    // L'agent a déjà une action `creer_lead_copie` : la copie de `creer_lead`, pris dans la destination, ne peut pas la doubler.
    d.agents[0]!.outils.push(outil('o-action', { nom: 'creer_lead_copie' }));
    const p = planifierDependances(d, { ...vides, outils: ['creer_lead'] }, SCENARIO, refs, { agents: ['ag-1'], requetes: [], modelesEmail: [] });
    const noms = p.copies.agents[0]!.outils.map((o) => o.nom);
    expect(noms).toContain('creer_lead_copie_2');
    expect(new Set(noms).size).toBe(noms.length);
    expect(p.apercu.agents[0]!.outilsCopies).toContainEqual({ nom: 'creer_lead', nomCopie: 'creer_lead_copie_2' });
  });

  it('🔴 un choix hors des références du scénario : choixInvalides, et AUCUNE copie', () => {
    const tiers = 'ag-dun-autre-espace';
    const p = planifierDependances(deps(), vides, SCENARIO, refs, { agents: ['ag-1', tiers], requetes: [], modelesEmail: [] });
    expect(p.choixInvalides).toEqual([tiers]);
    expect(p.copies).toEqual({ sources: [], requetes: [], modelesEmail: [], agents: [] });
  });
});

describe('rebrancherCible', () => {
  const codes = new Map([[CODE, 'nod_dst02_01J00000000000000000000009']]);
  it('un bloc du scénario copié vise la copie et son nouveau code ; une étape d’enchaînement aussi', () => {
    expect(rebrancherCible({ handler: 'envoyer_bloc', workflowId: SCN, code: CODE }, SCN, 'scn-copie', codes))
      .toEqual({ handler: 'envoyer_bloc', workflowId: 'scn-copie', code: 'nod_dst02_01J00000000000000000000009' });
    const r = rebrancherCible({ handler: 'enchainer', etapes: [{ type: 'tag', tag: 'vip' }, { type: 'bloc', workflowId: SCN, code: CODE }] }, SCN, 'scn-copie', codes);
    expect(r).toEqual({ handler: 'enchainer', etapes: [{ type: 'tag', tag: 'vip' }, { type: 'bloc', workflowId: 'scn-copie', code: 'nod_dst02_01J00000000000000000000009' }] });
  });

  it('une cible sans scénario passe telle quelle', () => {
    const b = { handler: 'poser_tag', tag: 'vip' };
    expect(rebrancherCible(b, SCN, 'scn-copie', codes)).toEqual(b);
  });
});

describe('relecture du lot 2 (jaunes partis avec le lot 3)', () => {
  it('🔴 un outil maison qui vise un bloc que la version copiée n’a plus : cible_illisible, il ne suit pas', () => {
    const sansLeBloc = { id: SCN, codes: new Set<string>() };
    const bloc = deps().agents[0]!.outils.find((o) => o.id === 'o-bloc')!;
    expect(sortDeLOutil(bloc, sansLeBloc)).toEqual({ suit: false, raison: 'cible_illisible' });
    const chaine = outil('o-chaine', { binding: { handler: 'enchainer', etapes: [{ type: 'tag', tag: 'vip' }, { type: 'bloc', workflowId: SCN, code: CODE }] } });
    expect(sortDeLOutil(chaine, SCENARIO)).toEqual({ suit: true });
    expect(sortDeLOutil(chaine, sansLeBloc)).toEqual({ suit: false, raison: 'cible_illisible' });
  });

  it('un handler à cible dont la cible ne se lit pas : cible_illisible (la liste des handlers vient du schéma)', () => {
    expect(sortDeLOutil(outil('x', { binding: { handler: 'poser_tag' } }), SCENARIO)).toEqual({ suit: false, raison: 'cible_illisible' });
    expect(sortDeLOutil(outil('y', { binding: { handler: 'qualifier_transferer' } }), SCENARIO)).toEqual({ suit: false, raison: 'cible_illisible' });
  });

  it('les gestes d’un outil copié : leurs tags déclarés, leurs clés de champ créées', () => {
    const d = deps();
    d.agents[0]!.outils.push(outil('o-moment', {
      nom: 'prendre_rdv', origine: 'http', proprietaire: false, requeteId: 'rq-1', binding: {},
      gestes: [{ type: 'tag', valeur: 'RDV demandé' }, { type: 'variable', champ: 'date_rdv', valeur: 'demandée' }],
    }));
    const p = planifierDependances(d, vides, SCENARIO, refs, { agents: ['ag-1'], requetes: [], modelesEmail: [] });
    expect(p.clesDeChamp).toContain('date_rdv');
    expect(p.tags).toContain(normaliserEtiquette('RDV demandé'));
    expect(p.apercu.agents[0]!.champs).toContain('date_rdv');
  });

  it('une requête que seul l’agent appelle : sans case, sous son agent ; une requête de bloc garde la sienne', () => {
    const d = deps();
    d.requetes.push({ id: 'rq-3', label: 'Lire le stock', sourceId: 'src-1', variables: [] });
    d.agents[0]!.outils.push(outil('o-stock', { nom: 'lire_stock', origine: 'http', proprietaire: false, binding: {}, requeteId: 'rq-3' }));
    const p = planifierDependances(d, vides, SCENARIO, refs);
    expect(p.apercu.requetes.map((r) => [r.id, r.parUnBloc])).toEqual([['rq-1', true], ['rq-2', true], ['rq-3', false]]);
    expect(p.apercu.agents[0]!.requetes).toEqual(['rq-1', 'rq-3']);
    // Elle part avec l'agent coché ; cochée seule, elle reste un choix invalide (aucun bloc ne la désigne).
    const avecLAgent = planifierDependances(d, vides, SCENARIO, refs, { agents: ['ag-1'], requetes: [], modelesEmail: [] });
    expect(avecLAgent.copies.requetes.map((r) => r.id)).toEqual(['rq-1', 'rq-3']);
    expect(planifierDependances(d, vides, SCENARIO, refs, { agents: [], requetes: ['rq-3'], modelesEmail: [] }).choixInvalides).toEqual(['rq-3']);
  });

  it('les clés de champ que nomme chaque dépendance, cochée ou non', () => {
    const p = planifierDependances(deps(), vides, SCENARIO, refs);
    expect([...p.apercu.agents[0]!.champs].sort()).toEqual(['ville', 'ville_rdv']);
    expect(p.apercu.requetes.find((r) => r.id === 'rq-1')!.champs).toEqual(['ville']);
    expect(p.apercu.modelesEmail[0]!.champs).toEqual(['prenom', 'code_promo']);
  });
});
