import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BLOC_AGENT_PANIER, BLOC_FIN_AGENT_PANIER, PHRASE_AGENT_REQUIS, avecLAgent, avertissementsDeLaLigneAgent, etatDesLignes, grapheDUneLigne, proposerMessageStandard, reglerLigne,
} from '../src/shopify/lignes-gestion';
import { corpsStandard } from '../src/shopify/messages-standard';
import { sourceDeLaLigne } from '../src/shopify/perimetre-leviers';
import { NOM_DU_SCENARIO } from '../src/shopify/lignes';
import { blocVerrouille } from '../src/shopify/premier-bloc';
import {
  AUTOMATIONS_SHOPIFY, BOUTON_QUESTION, LIGNE_PANIER_AGENT, LIGNES_DU_PANIER, autreRelanceDuPanier, evenementDe, lignesDe,
} from '../web/lib/partage/shopify-messages';
import { SORTIE_ECHEC, SORTIE_HUMAIN, SORTIE_PLAFOND, SORTIE_SANS_SOURCE, SORTIE_TIMEOUT } from '../web/lib/partage/sorties-agent';
import type { AgentResume } from '../src/agent/agent-store';
import type { WorkflowGraph } from '../src/workflow/graph';
import { DOMAINE, monterLignes } from './shopify-lignes-faux';

/**
 * LA RELANCE DE PANIER AVEC AGENT IA (plan 2026-11-20, lot 2, tâches 2 à 4) : une quatrième ligne Shopify, exclusive avec la
 * relance normale, dont le scénario standard relie la réponse rapide « Vous avez une question ? » au bloc Agent IA choisi
 * à l'allumage.
 */

const T = 't1';
const AGENT: AgentResume = { id: '11111111-1111-4111-8111-111111111111', label: 'Conseiller', status: 'active', sorties: [{ code: 'rdv_pris', label: 'RDV pris' }], modele: 'm' };
const AUTRE_AGENT: AgentResume = { ...AGENT, id: '22222222-2222-4222-8222-222222222222', label: 'Vendeur', sorties: [] };
const ETEINT: AgentResume = { ...AGENT, id: '33333333-3333-4333-8333-333333333333', status: 'disabled' };
const CREATION_AGENT = {
  ok: true as const, modele: 'panier_agent_x', langue: 'fr', etat: 'approuve' as const, categorie: 'MARKETING' as const,
  boutons: [{ type: 'URL' as const, text: 'Reprendre mon panier' }, { type: 'QUICK_REPLY' as const, text: BOUTON_QUESTION.fr }],
};

const monter = (o: Parameters<typeof monterLignes>[0] = {}) => monterLignes({ agents: [AGENT, AUTRE_AGENT, ETEINT], creation: CREATION_AGENT, ...o });

async function publieDe(m: ReturnType<typeof monter>): Promise<WorkflowGraph> {
  const l = (await m.store.ligne(T, LIGNE_PANIER_AGENT))!;
  return (await m.workflows.getById(l.workflowId, T))!.graph;
}

describe('les automations Shopify', () => {
  it('la relance avec agent IA part sur le panier abandonné, et les deux relances du panier s’excluent', () => {
    expect(AUTOMATIONS_SHOPIFY).toEqual(['order_paid', 'order_fulfilled', 'checkout_abandoned', 'checkout_abandoned_agent']);
    expect(evenementDe(LIGNE_PANIER_AGENT)).toBe('checkout_abandoned');
    expect(evenementDe('order_paid')).toBe('order_paid');
    expect(lignesDe('checkout_abandoned')).toEqual(['checkout_abandoned', 'checkout_abandoned_agent']);
    expect(lignesDe('order_paid')).toEqual(['order_paid']);
    expect(autreRelanceDuPanier('checkout_abandoned')).toBe(LIGNE_PANIER_AGENT);
    expect(autreRelanceDuPanier(LIGNE_PANIER_AGENT)).toBe('checkout_abandoned');
    expect(autreRelanceDuPanier('order_fulfilled')).toBeNull();
    expect(NOM_DU_SCENARIO[LIGNE_PANIER_AGENT]).toBe('Panier abandonné avec agent IA');
  });

  it('🔴 la réclamation des paniers et sa reprise lisent les DEUX relances du panier, mot pour mot `LIGNES_DU_PANIER`', () => {
    const sql = readFileSync(new URL('../src/shopify/store.pg.ts', import.meta.url), 'utf8');
    const liste = `l.evenement in (${LIGNES_DU_PANIER.map((l) => `'${l}'`).join(', ')})`;
    expect(sql.split(liste).length - 1, 'PANIERS_DUS et la reprise de la réclamation').toBe(2);
    expect(sql).not.toMatch(/l\.evenement = 'checkout_abandoned'/);
  });

  it('🔴 le retour sur investissement compte les deux relances du panier comme une seule automation', () => {
    expect(sourceDeLaLigne('lg')).toContain("when 'checkout_abandoned_agent' then 'relance_panier'");
  });

  it('le bouton tient dans la borne de Meta (25 caractères), dans les deux langues', () => {
    expect(BOUTON_QUESTION.fr.length).toBeLessThanOrEqual(25);
    expect(BOUTON_QUESTION.en.length).toBeLessThanOrEqual(25);
  });
});

describe('le message standard de la relance avec agent IA', () => {
  it('🔴 le même message que la relance normale, plus la réponse rapide « Vous avez une question ? » après le lien', () => {
    const normal = corpsStandard('checkout_abandoned', DOMAINE).corps;
    const agent = corpsStandard(LIGNE_PANIER_AGENT, DOMAINE).corps;
    expect({ ...agent, buttons: undefined }).toEqual({ ...normal, buttons: undefined });
    expect(agent.buttons).toEqual([...normal.buttons!, { type: 'QUICK_REPLY', text: 'Vous avez une question ?' }]);
    expect(agent.category).toBe('MARKETING');
  });
});

describe('le scénario de la relance avec agent IA', () => {
  const premier = (g: WorkflowGraph) => blocVerrouille(g)!;

  it('🔴 la réponse rapide mène au bloc Agent IA ; ses règles d’arrêt à une fin ; escalade, inactivité, échec, plafond et sans source SANS arête', () => {
    const g = avecLAgent(grapheDUneLigne(), AGENT, 1);
    const agent = g.nodes.find((n) => n.id === BLOC_AGENT_PANIER)!;
    expect(agent).toMatchObject({ type: 'agent', data: { agentId: AGENT.id, agentLabel: 'Conseiller', sorties: [{ code: 'rdv_pris', label: 'RDV pris' }] } });
    expect(g.edges).toContainEqual(expect.objectContaining({ source: premier(g).id, target: BLOC_AGENT_PANIER, sourceHandle: 'btn:1' }));
    const versLaFin = g.edges.filter((e) => e.source === BLOC_AGENT_PANIER).map((e) => [e.sourceHandle, e.target]);
    expect(versLaFin).toEqual([['sortie:rdv_pris', BLOC_FIN_AGENT_PANIER]]);
    // L'escalade et l'inactivité finissent sans arête comme vers une fin muette (le moteur, `advance` et la reprise) :
    // un bloc vide « choisir une action » laissait croire qu'il y avait quelque chose à régler (Julien, 2026-11-25).
    for (const h of [SORTIE_HUMAIN, SORTIE_TIMEOUT, SORTIE_ECHEC, SORTIE_PLAFOND, SORTIE_SANS_SOURCE]) {
      expect(g.edges.some((e) => e.source === BLOC_AGENT_PANIER && (e.sourceHandle === h || e.sourceHandle === `sortie:${h}`)), h).toBe(false);
    }
    expect(g.nodes.find((n) => n.id === BLOC_FIN_AGENT_PANIER)).toMatchObject({ type: 'action', data: {} });
  });

  it('🔴 un agent SANS règle d’arrêt n’a ni fin ni flèche après lui : rien à régler à l’écran', () => {
    const g = avecLAgent(grapheDUneLigne(), { ...AGENT, sorties: [] }, 1);
    expect(g.nodes.some((n) => n.id === BLOC_FIN_AGENT_PANIER)).toBe(false);
    expect(g.edges.filter((e) => e.source === BLOC_AGENT_PANIER)).toEqual([]);
  });

  it('un graphe qui a déjà son bloc Agent IA ne reçoit que l’agent : la flèche du marchand n’est pas refaite', () => {
    const g = avecLAgent(grapheDUneLigne(), AGENT, 1);
    const deplace: WorkflowGraph = { ...g, edges: g.edges.map((e) => (e.sourceHandle === 'btn:1' ? { ...e, id: 'du-marchand' } : e)) };
    const h = avecLAgent(deplace, AUTRE_AGENT, 1);
    expect(h.edges).toEqual(deplace.edges);
    expect(h.nodes.find((n) => n.id === BLOC_AGENT_PANIER)?.data).toMatchObject({ agentId: AUTRE_AGENT.id, agentLabel: 'Vendeur' });
  });

  it('🔴 le message standard crée le template, puis relie sa réponse rapide (index parmi TOUS les boutons) au bloc de l’agent choisi', async () => {
    const m = monter();
    expect(await proposerMessageStandard(m.deps, T, LIGNE_PANIER_AGENT, 'u1', AGENT)).toBe('propose');
    expect(m.creation.appels[0]?.corps).toEqual(corpsStandard(LIGNE_PANIER_AGENT, DOMAINE).corps);
    const g = await publieDe(m);
    expect(g.edges).toContainEqual(expect.objectContaining({ target: BLOC_AGENT_PANIER, sourceHandle: 'btn:1' }));
    expect(g.nodes.find((n) => n.id === BLOC_AGENT_PANIER)?.data).toMatchObject({ agentId: AGENT.id });
  });
});

describe('l’allumage de la relance avec agent IA', () => {
  it('🔴 sans agent, avec un agent inconnu ou inactif : refus, rien n’est créé ni allumé', async () => {
    const m = monter();
    for (const agentId of [undefined, '99999999-9999-4999-8999-999999999999', ETEINT.id]) {
      const r = await reglerLigne(m.deps, T, LIGNE_PANIER_AGENT, { actif: true, ...(agentId ? { agentId } : {}) }, 'u1');
      expect(r, String(agentId)).toEqual({ ok: false, statut: 422, message: PHRASE_AGENT_REQUIS });
    }
    expect(m.workflows.parId.size).toBe(0);
    expect(m.store.gestes).toEqual([]);
  });

  it('un agent donné pour une autre automation est refusé', async () => {
    const m = monter();
    expect(await reglerLigne(m.deps, T, 'checkout_abandoned', { actif: true, agentId: AGENT.id }, 'u1')).toMatchObject({ ok: false, statut: 400 });
  });

  it('🔴 allumer la relance avec agent éteint la relance normale ET arrête ses parcours ; l’inverse aussi (point de relecture 1)', async () => {
    const m = monter();
    await reglerLigne(m.deps, T, 'checkout_abandoned', { actif: true }, 'u1');
    expect(await reglerLigne(m.deps, T, LIGNE_PANIER_AGENT, { actif: true, agentId: AGENT.id }, 'u1')).toMatchObject({ ok: true, valeur: { actif: true } });
    expect((await m.store.ligne(T, 'checkout_abandoned'))?.actif).toBe(false);
    expect(m.parcours.arrets).toEqual([{ prefixe: `shopify:${DOMAINE}:checkouts/abandoned:`, motif: 'relance de panier remplacée' }]);

    await reglerLigne(m.deps, T, 'checkout_abandoned', { actif: true }, 'u1');
    expect((await m.store.ligne(T, LIGNE_PANIER_AGENT))?.actif).toBe(false);
    expect((await m.store.ligne(T, 'checkout_abandoned'))?.actif).toBe(true);
    expect(m.parcours.arrets).toHaveLength(2);
  });

  it('allumer quand l’autre relance est éteinte n’arrête aucun parcours', async () => {
    const m = monter();
    await reglerLigne(m.deps, T, LIGNE_PANIER_AGENT, { actif: true, agentId: AGENT.id }, 'u1');
    expect(m.parcours.arrets).toEqual([]);
  });

  it('🔴 ligne allumée : un autre agent change le bloc du scénario publié, sans éteindre ni refuser', async () => {
    const m = monter();
    await reglerLigne(m.deps, T, LIGNE_PANIER_AGENT, { actif: true, agentId: AGENT.id }, 'u1');
    expect(await reglerLigne(m.deps, T, LIGNE_PANIER_AGENT, { actif: true, agentId: AUTRE_AGENT.id }, 'u1')).toMatchObject({ ok: true, valeur: { actif: true } });
    expect((await publieDe(m)).nodes.find((n) => n.id === BLOC_AGENT_PANIER)?.data).toMatchObject({ agentId: AUTRE_AGENT.id });
    expect(m.store.gestes.filter((g) => g.startsWith('eteindre:'))).toEqual([]);
  });

  it('ligne allumée sans agent dans le corps (un nouveau délai) : rien ne change, aucun refus', async () => {
    const m = monter();
    await reglerLigne(m.deps, T, LIGNE_PANIER_AGENT, { actif: true, agentId: AGENT.id }, 'u1');
    expect(await reglerLigne(m.deps, T, LIGNE_PANIER_AGENT, { actif: true, delaiMinutes: 45 }, 'u1')).toMatchObject({ ok: true });
    expect(m.store.gestes).toContain('delai:45');
  });

  it('l’état des lignes range la relance avec agent après les trois autres', async () => {
    const m = monter();
    await reglerLigne(m.deps, T, LIGNE_PANIER_AGENT, { actif: true, agentId: AGENT.id }, 'u1');
    await reglerLigne(m.deps, T, 'order_paid', { actif: false }, 'u1');
    await reglerLigne(m.deps, T, 'order_paid', { actif: true }, 'u1');
    expect((await etatDesLignes(m.deps, T)).map((l) => l.evenement)).toEqual(['order_paid', LIGNE_PANIER_AGENT]);
  });
});

describe('les avertissements de la relance avec agent IA (spec § 5.3)', () => {
  const sain = (): WorkflowGraph => {
    const g = avecLAgent(grapheDUneLigne(), AGENT, 1);
    return { ...g, nodes: g.nodes.map((n) => (n.type === 'template' ? { ...n, data: { ...n.data, templateButtons: [{ type: 'URL' }, { type: 'QUICK_REPLY' }] } } : n)) };
  };
  const meta = { enValidation: false, etatChezMeta: 'APPROVED' };

  it('une ligne saine : aucun avertissement', () => {
    expect(avertissementsDeLaLigneAgent(sain(), [AGENT], meta)).toEqual([]);
  });

  it('🔴 le bouton retiré, déplacé, ou le template changé sans réponse rapide : `bouton_absent` (point de relecture 4)', () => {
    const g = sain();
    expect(avertissementsDeLaLigneAgent({ ...g, edges: g.edges.filter((e) => e.sourceHandle !== 'btn:1') }, [AGENT], meta)).toEqual(['bouton_absent']);
    const sansReponse = { ...g, nodes: g.nodes.map((n) => (n.type === 'template' ? { ...n, data: { ...n.data, templateButtons: [{ type: 'URL' }, { type: 'URL' }] } } : n)) };
    expect(avertissementsDeLaLigneAgent(sansReponse, [AGENT], meta)).toEqual(['bouton_absent']);
    expect(avertissementsDeLaLigneAgent(null, [AGENT], meta)).toEqual(['bouton_absent']);
  });

  it('🔴 l’agent désactivé ou supprimé : `agent_inactif` (point de relecture 3)', () => {
    expect(avertissementsDeLaLigneAgent(sain(), [{ ...AGENT, status: 'disabled' }], meta)).toEqual(['agent_inactif']);
    expect(avertissementsDeLaLigneAgent(sain(), [], meta)).toEqual(['agent_inactif']);
  });

  it('le template en attente de Meta, ou refusé', () => {
    expect(avertissementsDeLaLigneAgent(sain(), [AGENT], { enValidation: true, etatChezMeta: null })).toEqual(['modele_en_attente']);
    expect(avertissementsDeLaLigneAgent(sain(), [AGENT], { enValidation: false, etatChezMeta: 'REJECTED' })).toEqual(['modele_refuse']);
  });

  it('🔴 l’état des lignes porte l’agent et les avertissements de la relance avec agent ; les autres n’en ont pas', async () => {
    const m = monter();
    await reglerLigne(m.deps, T, LIGNE_PANIER_AGENT, { actif: true, agentId: AGENT.id }, 'u1');
    await reglerLigne(m.deps, T, 'order_paid', { actif: false }, 'u1');
    await reglerLigne(m.deps, T, 'order_paid', { actif: true }, 'u1');
    const etats = await etatDesLignes(m.deps, T);
    const agent = etats.find((l) => l.evenement === LIGNE_PANIER_AGENT)!;
    expect(agent.agent).toEqual({ id: AGENT.id, label: 'Conseiller', actif: true });
    expect(etats.find((l) => l.evenement === 'order_paid')).toMatchObject({ agent: null, avertissements: [] });
  });
});
