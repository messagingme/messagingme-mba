import { describe, it, expect } from 'vitest';
import { accepter, proposer, reprendre } from '../src/mise-en-ligne/mise-en-ligne';
import type { Offre } from '../src/offres/offres';
import { OUTILS, outilsPour, type DepsMcp } from '../src/mcp/outils';
import type { DepsEnvoisAuOui } from '../src/mise-en-ligne/envois';
import { envoisAuOuiInertes } from './routes-inertes';
import { ADMIN, CSM, T, AUTRE, monter } from './mise-en-ligne-fixtures';

/**
 * LA SUPPRESSION D'UN AGENT IA AU OUI (lot 1 du CSM virtuel, B10, livraison 3b) : rien ne rattrape une suppression (ses
 * conversations, ses outils et sa connaissance partent avec lui), donc l'outil prépare et un admin clique, comme le bouton
 * de sa page lui est réservé. Le clic relit que l'agent est DANS l'espace, sous le nom montré, et s'il répond au client.
 * Le dépôt est un faux dont les méthodes lisent `this`, qui note l'espace visé et lève, comme Postgres, sur un identifiant
 * qui n'est pas un uuid.
 */
const AGENT = '77777777-7777-4777-8777-777777777777';
const MOI = { userId: CSM.userId, autorisationId: CSM.autorisationId };
const SUPPRIMER = [{ type: 'suppression_agent' as const, agent: AGENT }];
const CE_QUI_PART = 'L’agent IA « Conseiller » est supprimé pour de bon : ses conversations, ses outils et sa base de connaissance '
  + 'partent avec lui, et les blocs de scénario qui l’utilisent cesseront de répondre.';

class FauxAgents {
  readonly supprimes: Array<{ tenant: string; agent: string }> = [];
  /** Les espaces lus, dans l'ordre : un identifiant mal formé n'en ajoute aucun. */
  readonly lus: string[] = [];
  /** Le nom de l'agent ; `null` : il n'existe plus. */
  label: string | null = 'Conseiller';
  /** Une coupure, une fois : avant la suppression (rien ne part), ou après (supprimé, mais le résultat n'est pas noté). */
  panne: 'avant' | 'apres' | null = null;
  private lire(tenant: string, id: string): boolean {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('22P02 : invalid input syntax for type uuid');
    this.lus.push(tenant);
    return tenant === T && id === AGENT && this.label !== null;
  }
  async complet(tenant: string, id: string) {
    return this.lire(tenant, id) ? { id, label: this.label! } : null;
  }
  async remove(tenant: string, id: string) {
    if (!this.lire(tenant, id)) return false;
    const panne = this.panne;
    this.panne = null;
    if (panne === 'avant') throw new Error('coupure avant la suppression');
    this.supprimes.push({ tenant, agent: id });
    this.label = null;
    if (panne === 'apres') throw new Error('coupure après la suppression');
    return true;
  }
}

class FauxReglages {
  /** L'agent qui répond au client dans l'espace `T`. */
  repondeur: string | null = null;
  async get(tenant: string) { return { repondeurAgentId: tenant === T ? this.repondeur : null }; }
}

function monterSuppression(offre: Offre = 'pro') {
  const agents = new FauxAgents();
  const reglages = new FauxReglages();
  const envois: DepsEnvoisAuOui = { ...envoisAuOuiInertes, suppressionAgent: { agents, reglages } };
  return { m: monter({ envois, offre }), agents, reglages };
}

describe('la suppression d’un agent IA au oui (CSM, B10, livraison 3b)', () => {
  it('🔴 préparée sans rien supprimer, le bouton nomme l’agent, le récapitulatif dit ce qui part ; le clic supprime, une fois', async () => {
    const { m, agents } = monterSuppression();
    const r = await proposer(m.deps, T, CSM, SUPPRIMER);
    if (!r.ok) throw new Error(r.erreur);
    expect(r.valeur.libelle).toBe('Supprimer l’agent');
    expect(r.valeur.recapitulatif).toEqual([
      CE_QUI_PART,
      'Claude vous a montré lequel dans la conversation, avant de vous envoyer ici. La suppression ne se rattrape pas.',
    ]);
    // Ce que le clic relira : l'agent, le nom montré, et s'il répond au client.
    expect((await m.store.lire(T, r.valeur.id))!.actions[0]).toMatchObject({ type: 'suppression_agent', agent: AGENT, label: 'Conseiller', repondeur: false });
    expect(agents.supprimes).toEqual([]);
    const clic = await accepter(m.deps, T, r.valeur.id, ADMIN);
    if (!clic.ok) throw new Error(clic.erreur);
    expect(clic.valeur).toMatchObject({ etat: 'faite', actions: [{ resultat: { ok: true, etat: 'agent_supprime' } }] });
    expect(agents.supprimes).toEqual([{ tenant: T, agent: AGENT }]);
    // Un second clic rend le résultat, sans rien refaire.
    await accepter(m.deps, T, r.valeur.id, ADMIN);
    expect(agents.supprimes).toHaveLength(1);
  });

  it('🔴 l’agent qui répond au client : le récapitulatif dit que ses messages iront à l’équipe', async () => {
    const { m, reglages } = monterSuppression();
    reglages.repondeur = AGENT;
    const r = await proposer(m.deps, T, CSM, SUPPRIMER);
    if (!r.ok) throw new Error(r.erreur);
    expect(r.valeur.recapitulatif).toEqual([
      CE_QUI_PART,
      'C’est lui qui répond au client : les messages que personne ne tient iront à l’équipe.',
      'Claude vous a montré lequel dans la conversation, avant de vous envoyer ici. La suppression ne se rattrape pas.',
    ]);
    expect((await m.store.lire(T, r.valeur.id))!.actions[0]).toMatchObject({ repondeur: true });
  });

  it('🔴 un nom de 120 caractères : le bouton tient dans la borne du libellé (80), le récapitulatif le nomme en entier', async () => {
    const { m, agents } = monterSuppression();
    agents.label = 'C'.repeat(120);
    const r = await proposer(m.deps, T, CSM, SUPPRIMER);
    if (!r.ok) throw new Error(r.erreur);
    expect(r.valeur.libelle.length).toBeLessThanOrEqual(80);
    expect(r.valeur.recapitulatif[0]).toContain(`« ${'C'.repeat(120)} »`);
  });

  it('rien d’autre n’est gardé que ce que l’admin lit : l’agent, son nom, son rôle de répondeur', async () => {
    const { m } = monterSuppression();
    const r = await proposer(m.deps, T, CSM, SUPPRIMER);
    if (!r.ok) throw new Error(r.erreur);
    const gardee = await m.store.lire(T, r.valeur.id);
    expect(Object.keys(gardee!.actions[0]!).sort()).toEqual(['agent', 'label', 'nom', 'repondeur', 'type']);
  });

  it('🔴 un agent d’un autre espace, inconnu ou mal formé est introuvable ; un identifiant mal formé ne va pas jusqu’à la base', async () => {
    const { m, agents } = monterSuppression();
    expect(await proposer(m.deps, AUTRE, CSM, SUPPRIMER)).toMatchObject({ ok: false, statut: 404 });
    expect(await proposer(m.deps, T, CSM, [{ type: 'suppression_agent', agent: '55555555-5555-4555-8555-555555555555' }]))
      .toMatchObject({ ok: false, statut: 404 });
    expect(agents.lus).toEqual([AUTRE, T]);
    expect(await proposer(m.deps, T, CSM, [{ type: 'suppression_agent', agent: 'agent-1' }])).toMatchObject({ ok: false, statut: 404 });
    expect(agents.lus).toHaveLength(2);
    expect(agents.supprimes).toEqual([]);
  });

  it('🔴 ouverte à toutes les offres, comme le bouton de sa page : un espace en Free prépare et supprime', async () => {
    const { m, agents } = monterSuppression('base');
    const r = await proposer(m.deps, T, CSM, SUPPRIMER);
    if (!r.ok) throw new Error(r.erreur);
    expect(await accepter(m.deps, T, r.valeur.id, ADMIN)).toMatchObject({ ok: true, valeur: { etat: 'faite' } });
    expect(agents.supprimes).toHaveLength(1);
  });

  it('🔴 le clic relit : renommé, devenu répondeur ou déjà parti depuis la préparation, et rien n’est supprimé', async () => {
    for (const changer of [
      (s: ReturnType<typeof monterSuppression>) => { s.agents.label = 'Vendeur'; },
      (s: ReturnType<typeof monterSuppression>) => { s.reglages.repondeur = AGENT; },
      (s: ReturnType<typeof monterSuppression>) => { s.agents.label = null; },
    ]) {
      const s = monterSuppression();
      const r = await proposer(s.m.deps, T, CSM, SUPPRIMER);
      if (!r.ok) throw new Error(r.erreur);
      changer(s);
      expect(await accepter(s.m.deps, T, r.valeur.id, ADMIN)).toMatchObject({ ok: false, statut: 409 });
      expect(s.agents.supprimes).toEqual([]);
    }
  });

  it('🔴 une reprise après une coupure relit : renommé entre-temps, rien n’est supprimé', async () => {
    const { m, agents } = monterSuppression();
    const r = await proposer(m.deps, T, CSM, SUPPRIMER);
    if (!r.ok) throw new Error(r.erreur);
    agents.panne = 'avant';
    const coupee = await accepter(m.deps, T, r.valeur.id, ADMIN);
    expect(coupee.ok && coupee.valeur.etat).toBe('interrompue');
    agents.label = 'Vendeur';
    const v = await reprendre(m.deps, T, r.valeur.id);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'echouee', actions: [{ resultat: { ok: false, code: 'modifiee' } }] });
    expect(agents.supprimes).toEqual([]);
  });

  it('🔴 une reprise après une coupure relit aussi le rôle : devenu répondeur entre-temps, rien n’est supprimé', async () => {
    const { m, agents, reglages } = monterSuppression();
    const r = await proposer(m.deps, T, CSM, SUPPRIMER);
    if (!r.ok) throw new Error(r.erreur);
    agents.panne = 'avant';
    await accepter(m.deps, T, r.valeur.id, ADMIN);
    reglages.repondeur = AGENT; // le récapitulatif lu ne disait pas « c'est lui qui répond au client »
    const v = await reprendre(m.deps, T, r.valeur.id);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'echouee', actions: [{ resultat: { ok: false, code: 'modifiee' } }] });
    expect(agents.supprimes).toEqual([]);
  });

  it('une reprise après une coupure qui précédait la suppression supprime l’agent montré', async () => {
    const { m, agents } = monterSuppression();
    const r = await proposer(m.deps, T, CSM, SUPPRIMER);
    if (!r.ok) throw new Error(r.erreur);
    agents.panne = 'avant';
    await accepter(m.deps, T, r.valeur.id, ADMIN);
    const v = await reprendre(m.deps, T, r.valeur.id);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'faite', actions: [{ resultat: { ok: true, etat: 'agent_supprime' } }] });
    expect(agents.supprimes).toEqual([{ tenant: T, agent: AGENT }]);
  });

  it('une reprise après une coupure qui suivait la suppression dit « déjà supprimé » sans rien refaire', async () => {
    const { m, agents } = monterSuppression();
    const r = await proposer(m.deps, T, CSM, SUPPRIMER);
    if (!r.ok) throw new Error(r.erreur);
    agents.panne = 'apres';
    const coupee = await accepter(m.deps, T, r.valeur.id, ADMIN);
    expect(coupee.ok && coupee.valeur.etat).toBe('interrompue');
    const v = await reprendre(m.deps, T, r.valeur.id);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'faite', actions: [{ resultat: { ok: true, etat: 'agent_deja_supprime' } }] });
    expect(agents.supprimes).toHaveLength(1);
  });

  it('l’outil prépare le bouton, sans rien supprimer ; un agent inconnu ou absent est refusé', async () => {
    const { m, agents } = monterSuppression();
    const deps = { misesEnLigne: m.deps } as unknown as DepsMcp;
    const outil = OUTILS.find((o) => o.nom === 'delete_agent')!;
    const r = await outil.executer(deps, T, { agent_id: AGENT }, MOI) as { go_live: { bouton: string }; a_savoir: string };
    expect(r.go_live.bouton).toBe('Supprimer l’agent');
    expect(r.a_savoir).toMatch(/^Rien n’est supprimé : un administrateur clique « Supprimer l’agent »/);
    expect(agents.supprimes).toEqual([]);
    await expect(outil.executer(deps, T, { agent_id: 'agent-1' }, MOI)).rejects.toMatchObject({ code: 'not_found' });
    await expect(outil.executer(deps, T, {}, MOI)).rejects.toMatchObject({ code: 'invalid_args' });
  });

  it('🔴 l’outil est réservé à une personne : une clé d’API ne le voit pas', () => {
    const cle = outilsPour({ scopes: ['mcp:read', 'mcp:write'], personne: null }).map((o) => o.nom);
    expect(cle).not.toContain('delete_agent');
  });
});
