import { describe, it, expect } from 'vitest';
import { accepter, proposer, reprendre } from '../src/mise-en-ligne/mise-en-ligne';
import type { Offre } from '../src/offres/offres';
import { OUTILS, outilsPour, type DepsMcp } from '../src/mcp/outils';
import type { DepsEnvoisAuOui } from '../src/mise-en-ligne/envois';
import { envoisAuOuiInertes } from './routes-inertes';
import { ADMIN, CSM, T, AUTRE, monter } from './mise-en-ligne-fixtures';

/**
 * LA POUSSÉE DES DÉSABONNEMENTS AU OUI (lot 1 du CSM virtuel, B10, livraison 1c) : choisir l'appel de connecteur prévenu à
 * chaque désabonnement fait partir des données de contact chez un tiers, donc l'outil prépare et un admin clique. Le clic
 * relit que l'appel existe DANS l'espace et que le réglage n'a pas bougé depuis ce qui a été montré. Le réglage est un faux
 * dont les méthodes lisent `this`, qui note l'espace visé.
 */
const APPEL = '11111111-1111-4111-8111-111111111111';
const AUTRE_APPEL = '22222222-2222-4222-8222-222222222222';
const MOI = { userId: CSM.userId, autorisationId: CSM.autorisationId };

class FauxReglage {
  readonly choix: Array<{ tenant: string; requete: string | null }> = [];
  appels = [{ id: APPEL, label: 'Prévenir le CRM' }, { id: AUTRE_APPEL, label: 'Prévenir le back-office' }];
  /** Une coupure, une fois : avant l'écriture (rien n'est posé), ou après (posé, mais le résultat n'est pas noté). */
  panne: 'avant' | 'apres' | null = null;
  constructor(public actuel: string | null = null) {}
  async lister(tenant: string) { return tenant === T ? this.appels : []; }
  async actuelle(tenant: string) { return tenant === T ? this.actuel : null; }
  async choisir(tenant: string, requete: string | null) {
    const panne = this.panne;
    this.panne = null;
    if (panne === 'avant') throw new Error('coupure avant l’écriture');
    this.choix.push({ tenant, requete });
    this.actuel = requete;
    if (panne === 'apres') throw new Error('coupure après l’écriture');
  }
}

function monterPoussee(actuel: string | null = null, offre: Offre = 'pro') {
  const reglage = new FauxReglage(actuel);
  const envois: DepsEnvoisAuOui = { ...envoisAuOuiInertes, pousseeOptout: reglage };
  return { m: monter({ envois, offre }), reglage };
}

describe('la poussée des désabonnements au oui (CSM, B10, livraison 1c)', () => {
  it('🔴 brancher un appel : préparé sans rien écrire, le bouton nomme l’effet, le récapitulatif dit ce qui part ; le clic branche', async () => {
    const { m, reglage } = monterPoussee();
    const r = await proposer(m.deps, T, CSM, [{ type: 'poussee_optout', requete: APPEL }]);
    if (!r.ok) throw new Error(r.erreur);
    expect(r.valeur.libelle).toBe('Prévenir cet appel à chaque désabonnement');
    expect(r.valeur.recapitulatif.join(' ')).toMatch(/l’appel « Prévenir le CRM » reçoit le numéro de la personne[\s\S]*partent chez ce tiers/);
    expect(reglage.choix).toEqual([]);
    const clic = await accepter(m.deps, T, r.valeur.id, ADMIN);
    if (!clic.ok) throw new Error(clic.erreur);
    expect(clic.valeur.actions[0]!.resultat).toEqual({ ok: true, etat: 'branche' });
    expect(reglage.choix).toEqual([{ tenant: T, requete: APPEL }]);
    // La trace dit quel appel, à la place duquel, au nom de l'admin qui a cliqué.
    expect(m.audit.filter((a) => a.action === 'settings.poussee_optout')).toEqual([
      { action: 'settings.poussee_optout', userId: ADMIN.userId, detail: { requestId: APPEL, avant: null } },
    ]);
  });

  it('🔴 la Free va au bout : préparé, cliqué, branché (aucune fonction exigée, au relevé comme au clic)', async () => {
    const { m, reglage } = monterPoussee(null, 'base');
    const r = await proposer(m.deps, T, CSM, [{ type: 'poussee_optout', requete: APPEL }]);
    if (!r.ok) throw new Error(r.erreur);
    const clic = await accepter(m.deps, T, r.valeur.id, ADMIN);
    expect(clic.ok && clic.valeur).toMatchObject({ etat: 'faite', actions: [{ resultat: { ok: true, etat: 'branche' } }] });
    expect(reglage.choix).toEqual([{ tenant: T, requete: APPEL }]);
  });

  it('le récapitulatif nomme l’appel remplacé, ou celui qu’on coupe', async () => {
    const { m } = monterPoussee(APPEL);
    const remplace = await proposer(m.deps, T, CSM, [{ type: 'poussee_optout', requete: AUTRE_APPEL }]);
    expect(remplace.ok && remplace.valeur.recapitulatif.join(' ')).toMatch(/Il remplace l’appel « Prévenir le CRM », prévenu jusqu’ici/);
    const coupe = await proposer(m.deps, T, CSM, [{ type: 'poussee_optout', requete: null }]);
    expect(coupe.ok && coupe.valeur.recapitulatif.join(' ')).toMatch(/L’appel « Prévenir le CRM » n’est plus prévenu/);
  });

  it('🔴 une reprise après une coupure relit : un réglage changé entre-temps n’est pas écrasé', async () => {
    const { m, reglage } = monterPoussee();
    const r = await proposer(m.deps, T, CSM, [{ type: 'poussee_optout', requete: APPEL }]);
    if (!r.ok) throw new Error(r.erreur);
    reglage.panne = 'avant';
    const coupee = await accepter(m.deps, T, r.valeur.id, ADMIN);
    expect(coupee.ok && coupee.valeur.etat).toBe('interrompue');
    reglage.actuel = AUTRE_APPEL; // un autre admin, dans Sécurité > Consentement
    const v = await reprendre(m.deps, T, r.valeur.id);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'echouee', actions: [{ resultat: { ok: false, code: 'modifiee' } }] });
    expect(reglage.choix).toEqual([]);
    expect(reglage.actuel).toBe(AUTRE_APPEL);
  });

  it('une reprise après une coupure qui suivait l’écriture rend le résultat sans réécrire', async () => {
    const { m, reglage } = monterPoussee();
    const r = await proposer(m.deps, T, CSM, [{ type: 'poussee_optout', requete: APPEL }]);
    if (!r.ok) throw new Error(r.erreur);
    reglage.panne = 'apres';
    const coupee = await accepter(m.deps, T, r.valeur.id, ADMIN);
    expect(coupee.ok && coupee.valeur.etat).toBe('interrompue');
    const v = await reprendre(m.deps, T, r.valeur.id);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'faite', actions: [{ resultat: { ok: true, etat: 'branche' } }] });
    expect(reglage.choix).toEqual([{ tenant: T, requete: APPEL }]);
  });

  it('couper la poussée : « none » quand un appel est prévenu, le clic débranche ; rien à couper sinon', async () => {
    const { m, reglage } = monterPoussee(APPEL);
    const r = await proposer(m.deps, T, CSM, [{ type: 'poussee_optout', requete: null }]);
    if (!r.ok) throw new Error(r.erreur);
    expect(r.valeur.libelle).toBe('Couper la poussée des désabonnements');
    const clic = await accepter(m.deps, T, r.valeur.id, ADMIN);
    if (!clic.ok) throw new Error(clic.erreur);
    expect(clic.valeur.actions[0]!.resultat).toEqual({ ok: true, etat: 'debranche' });
    expect(reglage.choix).toEqual([{ tenant: T, requete: null }]);
    const rien = await proposer(monterPoussee(null).m.deps, T, CSM, [{ type: 'poussee_optout', requete: null }]);
    expect(rien).toMatchObject({ ok: false, statut: 409 });
  });

  it('🔴 un appel d’un autre espace, ou inconnu, est refusé à la préparation ; le même appel aussi (rien à changer)', async () => {
    const { m } = monterPoussee(APPEL);
    expect(await proposer(m.deps, T, CSM, [{ type: 'poussee_optout', requete: '33333333-3333-4333-8333-000000000000' }])).toMatchObject({ ok: false, statut: 404 });
    // L'espace vient de la préparation : le même identifiant, lu depuis un autre espace, n'y existe pas.
    expect(await proposer(m.deps, AUTRE, CSM, [{ type: 'poussee_optout', requete: APPEL }])).toMatchObject({ ok: false, statut: 404 });
    expect(await proposer(m.deps, T, CSM, [{ type: 'poussee_optout', requete: APPEL }])).toMatchObject({ ok: false, statut: 409 });
  });

  it('🔴 le clic relit : un réglage changé depuis, ou un appel supprimé, et rien n’est écrit', async () => {
    const a = monterPoussee();
    const r = await proposer(a.m.deps, T, CSM, [{ type: 'poussee_optout', requete: APPEL }]);
    if (!r.ok) throw new Error(r.erreur);
    a.reglage.actuel = AUTRE_APPEL; // changé dans la console entre-temps
    expect(await accepter(a.m.deps, T, r.valeur.id, ADMIN)).toMatchObject({ ok: false });
    expect(a.reglage.choix).toEqual([]);
    const b = monterPoussee();
    const s = await proposer(b.m.deps, T, CSM, [{ type: 'poussee_optout', requete: APPEL }]);
    if (!s.ok) throw new Error(s.erreur);
    b.reglage.appels = b.reglage.appels.filter((x) => x.id !== APPEL); // l'appel supprimé entre-temps
    expect(await accepter(b.m.deps, T, s.valeur.id, ADMIN)).toMatchObject({ ok: false });
    expect(b.reglage.choix).toEqual([]);
  });

  it('les outils : get_optout_push lit le réglage et les appels ; set_optout_push prépare le bouton, sans rien écrire', async () => {
    const { m, reglage } = monterPoussee(APPEL);
    const deps = { misesEnLigne: m.deps } as unknown as DepsMcp;
    const outil = (nom: string) => OUTILS.find((o) => o.nom === nom)!;
    expect(await outil('get_optout_push').executer(deps, T, {}, MOI)).toEqual({
      request_id: APPEL,
      requests: [{ id: APPEL, label: 'Prévenir le CRM' }, { id: AUTRE_APPEL, label: 'Prévenir le back-office' }],
    });
    const r = await outil('set_optout_push').executer(deps, T, { request_id: AUTRE_APPEL }, MOI) as { go_live: { bouton: string; go_live_id: string } };
    expect(r.go_live.bouton).toBe('Prévenir cet appel à chaque désabonnement');
    expect(reglage.choix).toEqual([]);
    const coupe = await outil('set_optout_push').executer(deps, T, { request_id: 'none' }, MOI) as { go_live: { bouton: string } };
    expect(coupe.go_live.bouton).toBe('Couper la poussée des désabonnements');
    await expect(outil('set_optout_push').executer(deps, T, { request_id: 'inconnu' }, MOI)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('🔴 les deux outils sont réservés à une personne : une clé d’API ne les voit pas', () => {
    const cle = outilsPour({ scopes: ['mcp:read', 'mcp:write'], personne: null }).map((o) => o.nom);
    for (const nom of ['get_optout_push', 'set_optout_push']) expect(cle, nom).not.toContain(nom);
  });
});
