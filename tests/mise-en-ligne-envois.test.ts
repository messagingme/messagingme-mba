import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FicheASupprimer } from '../src/crm/contact-store.pg';

/**
 * LES ENVOIS AU OUI (lot 1 du CSM virtuel, B8, plan `docs/superpowers/plans/2026-11-26-csm-lot1-h-envois-au-oui.md`) : une
 * campagne ne part, et des contacts ne s'effacent, que sur le clic d'un admin, qui relit ce qui a été montré ; une
 * exécution coupée se reprend sans rien renvoyer. Le lancement et l'effacement réels sont ceux de la console
 * (`lancerCampagne`, `effacerContacts`) : ici des espions, pour compter ce qui part.
 */
const lancements = vi.hoisted(() => ({
  appels: [] as Array<{ campagne: string; quand: Date | null }>,
  issue: null as unknown,
  /** Après un lancement réussi : ce que la base en a fait (le run a démarré). */
  apres: null as null | (() => void),
  /** Avant de lever : ce que la base a fait de la campagne (la coupure tombe APRÈS le lancement). */
  panne: null as null | (() => void),
}));
vi.mock('../src/campaign/lancement', async (orig) => ({
  ...(await orig<typeof import('../src/campaign/lancement')>()),
  lancerCampagne: vi.fn(async (_d: unknown, _t: string, campagne: string, quand: Date | null) => {
    lancements.appels.push({ campagne, quand });
    if (lancements.panne) { const p = lancements.panne; lancements.panne = null; p(); throw new Error('coupure'); }
    if (lancements.apres) { const a = lancements.apres; lancements.apres = null; a(); }
    return lancements.issue ?? (quand ? { ok: true, programmee: quand } : { ok: true, enfilee: true });
  }),
}));
const effacements = vi.hoisted(() => ({
  appels: [] as string[][],
  refus: null as null | { max: number },
  /** Les fiches vivantes de l'espace, que l'effacement retire. */
  fiches: new Map<string, FicheASupprimer>(),
  /** Coupé après la première fiche effacée. */
  panne: false,
}));
vi.mock('../src/crm/effacement', async (orig) => ({
  ...(await orig<typeof import('../src/crm/effacement')>()),
  effacerContacts: vi.fn(async (_d: unknown, _t: string, ids: readonly string[]) => {
    effacements.appels.push([...ids]);
    if (effacements.refus) return { ok: false, max: effacements.refus.max };
    if (effacements.panne) { effacements.panne = false; effacements.fiches.delete(ids[0]!); throw new Error('coupure'); }
    for (const id of ids) effacements.fiches.delete(id);
    return { ok: true, bilan: { purges: ids.length, conversations: 2 * ids.length, messages: 5 * ids.length }, retirerChezMeta: () => {} };
  }),
}));

import { accepter, proposer, reprendre } from '../src/mise-en-ligne/mise-en-ligne';
import type { DepsEnvoisAuOui } from '../src/mise-en-ligne/envois';
import type { EtatConfirme } from '../src/campaign/confirmation';
import type { MotifDePause } from '../src/campaign/pause';
import { ADMIN, AUTRE, CSM, T, WF, monter } from './mise-en-ligne-fixtures';

const CAMPAGNE = '44444444-4444-4444-8444-444444444444';
const C1 = '55555555-5555-4555-8555-555555555551';
const C2 = '55555555-5555-4555-8555-555555555552';
const C3 = '55555555-5555-4555-8555-555555555553';
const brouillon = (o: Partial<EtatConfirme> = {}): EtatConfirme => ({
  templateName: 'promo_noel', templateLanguage: 'fr', category: 'marketing', prevueLe: null, paramMapping: [], recipientCount: 12, status: 'draft', ...o,
});

function monterEnvois(o: { offre?: 'base' | 'pro' } = {}) {
  const campagnes = new Map<string, EtatConfirme>();
  const pauses = new Map<string, MotifDePause>();
  const envois = {
    campagnes: {
      repo: {
        etatPourConfirmation: async (t: string, id: string) => (t === T ? campagnes.get(id) ?? null : null),
        pauseDe: async (t: string, id: string) => (t === T ? { motif: pauses.get(id) ?? null, jusqua: null } : null),
      },
    },
    suppression: {
      selection: async (t: string, cible: { ids?: string[] }, limite: number) => (t !== T || !cible.ids
        ? []
        : cible.ids.map((id) => effacements.fiches.get(id)).filter((f): f is FicheASupprimer => f !== undefined).slice(0, limite)),
      effacement: {},
    },
  } as unknown as DepsEnvoisAuOui;
  const m = monter({ envois, ...(o.offre ? { offre: o.offre } : {}) });
  return { ...m, campagnes, pauses };
}

const fiche = (id: string, nom: string): FicheASupprimer => ({ id, profileName: nom, phoneE164: '+33612345678', bsuid: null, createdAt: '2026-01-01T00:00:00.000Z' });

beforeEach(() => {
  lancements.appels.length = 0; lancements.issue = null; lancements.panne = null; lancements.apres = null;
  effacements.appels.length = 0; effacements.refus = null; effacements.panne = false; effacements.fiches.clear();
});

async function proposeeCampagne(m: ReturnType<typeof monterEnvois>): Promise<string> {
  const r = await proposer(m.deps, T, CSM, [{ type: 'campagne', campagne: CAMPAGNE }]);
  if (!r.ok) throw new Error(`refusée : ${r.erreur}`);
  return r.valeur.id;
}

describe('le oui d’une campagne (CSM, B8)', () => {
  it('le bouton nomme l’effet (envoyer, programmer, reprendre) ; le récapitulatif dit le modèle et le nombre', async () => {
    const m = monterEnvois();
    m.campagnes.set(CAMPAGNE, brouillon());
    let r = await proposer(m.deps, T, CSM, [{ type: 'campagne', campagne: CAMPAGNE }]);
    expect(r.ok && r.valeur.libelle).toBe('Envoyer à 12 contacts');
    expect(r.ok && r.valeur.recapitulatif.join(' ')).toContain('« promo_noel » (fr, marketing) à 12 contacts');
    m.campagnes.set(CAMPAGNE, brouillon({ prevueLe: new Date(m.horloge.now + 3_600_000).toISOString() }));
    r = await proposer(m.deps, T, CSM, [{ type: 'campagne', campagne: CAMPAGNE }]);
    expect(r.ok && r.valeur.libelle).toBe('Programmer l’envoi à 12 contacts');
    m.campagnes.set(CAMPAGNE, brouillon({ status: 'paused', recipientCount: 1 }));
    r = await proposer(m.deps, T, CSM, [{ type: 'campagne', campagne: CAMPAGNE }]);
    expect(r.ok && r.valeur.libelle).toBe('Reprendre l’envoi à 1 contact');
  });

  it('🔴 rien ne part avant le clic ; le clic lance par le chemin de la console, UNE fois', async () => {
    const m = monterEnvois();
    m.campagnes.set(CAMPAGNE, brouillon());
    const id = await proposeeCampagne(m);
    expect(lancements.appels).toEqual([]);
    const v = await accepter(m.deps, T, id, ADMIN);
    expect(lancements.appels).toEqual([{ campagne: CAMPAGNE, quand: null }]);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'faite', actions: [{ type: 'campagne', campagne: CAMPAGNE, resultat: { ok: true, etat: 'envoyee', destinataires: 12 } }] });
    // Un second clic rend le résultat, sans rien relancer.
    await accepter(m.deps, T, id, ADMIN);
    expect(lancements.appels).toHaveLength(1);
  });

  it('🔴 une campagne datée est PROGRAMMÉE à sa date', async () => {
    const m = monterEnvois();
    const date = new Date(m.horloge.now + 3_600_000);
    m.campagnes.set(CAMPAGNE, brouillon({ prevueLe: date.toISOString() }));
    const v = await accepter(m.deps, T, await proposeeCampagne(m), ADMIN);
    expect(lancements.appels).toEqual([{ campagne: CAMPAGNE, quand: date }]);
    expect(v.ok && v.valeur.actions[0]!.resultat).toEqual({ ok: true, etat: 'programmee', destinataires: 12 });
  });

  it('🔴 la reprise d’une campagne en pause repart TOUT DE SUITE : sa date passée ne la fait pas refuser', async () => {
    const m = monterEnvois();
    m.campagnes.set(CAMPAGNE, brouillon({ status: 'paused', recipientCount: 4, prevueLe: new Date(m.horloge.now - 86_400_000).toISOString() }));
    const v = await accepter(m.deps, T, await proposeeCampagne(m), ADMIN);
    expect(lancements.appels).toEqual([{ campagne: CAMPAGNE, quand: null }]);
    expect(v.ok && v.valeur.actions[0]!.resultat).toEqual({ ok: true, etat: 'reprise', destinataires: 4 });
  });

  it('🔴 une pause que seul un autre geste lève (numéro délié) : refusée dès la préparation', async () => {
    const m = monterEnvois();
    m.campagnes.set(CAMPAGNE, brouillon({ status: 'paused' }));
    m.pauses.set(CAMPAGNE, 'numero_delie');
    const r = await proposer(m.deps, T, CSM, [{ type: 'campagne', campagne: CAMPAGNE }]);
    expect(r).toMatchObject({ ok: false, statut: 409 });
  });

  it('🔴 la campagne a changé depuis le bouton : le clic est refusé, rien ne part', async () => {
    const m = monterEnvois();
    m.campagnes.set(CAMPAGNE, brouillon());
    const id = await proposeeCampagne(m);
    m.campagnes.set(CAMPAGNE, brouillon({ recipientCount: 13 }));
    expect(await accepter(m.deps, T, id, ADMIN)).toMatchObject({ ok: false, statut: 409, details: { code: 'modifiee' } });
    expect(lancements.appels).toEqual([]);
  });

  it('🔴 lancée entre-temps depuis la console : le clic est refusé, et ne renvoie JAMAIS vers prepare_campaign', async () => {
    const m = monterEnvois();
    m.campagnes.set(CAMPAGNE, brouillon());
    const id = await proposeeCampagne(m);
    m.campagnes.set(CAMPAGNE, brouillon({ status: 'running' }));
    const r = await accepter(m.deps, T, id, ADMIN);
    expect(r).toMatchObject({ ok: false, statut: 409, details: { code: 'impossible' } });
    expect(r.ok ? '' : r.erreur).not.toContain('prepare_campaign');
    expect(lancements.appels).toEqual([]);
  });

  it('une date devenue passée avant le clic : refusée, rien ne part', async () => {
    const m = monterEnvois();
    m.campagnes.set(CAMPAGNE, brouillon({ prevueLe: new Date(m.horloge.now + 3_600_000).toISOString() }));
    const id = await proposeeCampagne(m);
    m.horloge.now += 2 * 3_600_000;
    expect(await accepter(m.deps, T, id, ADMIN)).toMatchObject({ ok: false, statut: 409 });
    expect(lancements.appels).toEqual([]);
  });

  it('🔴 le Crédit WhatsApp manque, ou la limite des modèles du mois : le clic note le refus, rien n’est parti', async () => {
    const m = monterEnvois();
    m.campagnes.set(CAMPAGNE, brouillon());
    lancements.issue = { ok: false, raison: 'credit_whatsapp', manqueMicroEur: 5_000_000, montantMicroEur: 6_000_000 };
    let v = await accepter(m.deps, T, await proposeeCampagne(m), ADMIN);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'echouee', actions: [{ resultat: { ok: false, code: 'whatsapp_credit_exhausted' } }] });
    lancements.issue = { ok: false, raison: 'limite', max: 1000, reste: 0, demandes: 12 };
    v = await accepter(m.deps, T, await proposeeCampagne(m), ADMIN);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'echouee', actions: [{ resultat: { ok: false, code: 'plan_limit_reached' } }] });
  });

  it('🔴 une exécution coupée APRÈS le lancement ne relance rien : la reprise rend « déjà partie »', async () => {
    const m = monterEnvois();
    m.campagnes.set(CAMPAGNE, brouillon());
    const id = await proposeeCampagne(m);
    lancements.panne = () => m.campagnes.set(CAMPAGNE, brouillon({ status: 'running' }));
    const coupee = await accepter(m.deps, T, id, ADMIN);
    expect(coupee.ok && coupee.valeur.etat).toBe('interrompue');
    const v = await reprendre(m.deps, T, id);
    expect(lancements.appels).toHaveLength(1);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'faite', actions: [{ resultat: { ok: true, etat: 'deja_partie', destinataires: 12 } }] });
  });

  /** Une coupure APRÈS le lancement, avant que le résultat soit noté : l'écriture du résultat lève une fois. */
  function couperApresLeLancement(m: ReturnType<typeof monterEnvois>): void {
    const noter = m.store.noterResultat.bind(m.store);
    let panne = true;
    m.store.noterResultat = (async (...a: Parameters<typeof noter>) => {
      if (panne) { panne = false; throw new Error('base en panne'); }
      return noter(...a);
    }) as typeof m.store.noterResultat;
  }

  it('🔴 coupée APRÈS le lancement d’un brouillon, puis mise en pause par l’admin : la reprise ne relance RIEN', async () => {
    const m = monterEnvois();
    m.campagnes.set(CAMPAGNE, brouillon());
    const id = await proposeeCampagne(m);
    lancements.apres = () => m.campagnes.set(CAMPAGNE, brouillon({ status: 'running' }));
    couperApresLeLancement(m);
    await expect(accepter(m.deps, T, id, ADMIN)).rejects.toThrow('base en panne');
    // L'admin voit l'envoi partir et le met en pause ; le bail de l'exécution coupée échoit.
    m.campagnes.set(CAMPAGNE, brouillon({ status: 'paused', recipientCount: 7 }));
    m.pauses.set(CAMPAGNE, 'manuelle' as MotifDePause);
    m.horloge.now += 121_000;
    const v = await reprendre(m.deps, T, id);
    expect(lancements.appels).toHaveLength(1);
    expect(v.ok && v.valeur.actions[0]!.resultat).toEqual({ ok: true, etat: 'deja_partie', destinataires: 12 });
  });

  it('🔴 coupée APRÈS une reprise, puis remise en pause : la reprise rejouée refuse, rien n’est relancé', async () => {
    const m = monterEnvois();
    m.campagnes.set(CAMPAGNE, brouillon({ status: 'paused', recipientCount: 4 }));
    m.pauses.set(CAMPAGNE, 'debit');
    const id = await proposeeCampagne(m);
    lancements.apres = () => m.campagnes.set(CAMPAGNE, brouillon({ status: 'running', recipientCount: 4 }));
    couperApresLeLancement(m);
    await expect(accepter(m.deps, T, id, ADMIN)).rejects.toThrow('base en panne');
    // Remise en pause pour la qualité du numéro, que seul un humain lève ; le bail échoit.
    m.campagnes.set(CAMPAGNE, brouillon({ status: 'paused', recipientCount: 4 }));
    m.pauses.set(CAMPAGNE, 'qualite' as MotifDePause);
    m.horloge.now += 121_000;
    const v = await reprendre(m.deps, T, id);
    expect(lancements.appels).toHaveLength(1);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'echouee', actions: [{ resultat: { ok: false, code: 'modifiee' } }] });
  });

  it('le motif de la pause est montré au-dessus du bouton de reprise', async () => {
    const m = monterEnvois();
    m.campagnes.set(CAMPAGNE, brouillon({ status: 'paused' }));
    m.pauses.set(CAMPAGNE, 'debit');
    const r = await proposer(m.deps, T, CSM, [{ type: 'campagne', campagne: CAMPAGNE }]);
    expect(r.ok && r.valeur.recapitulatif.join(' ')).toContain('Elle s’était arrêtée');
  });

  it('🔴 l’offre est relue à la reprise : un espace redescendu en Free depuis le clic ne relance rien', async () => {
    const m = monterEnvois();
    m.campagnes.set(CAMPAGNE, brouillon());
    const id = await proposeeCampagne(m);
    lancements.panne = () => {};
    expect((await accepter(m.deps, T, id, ADMIN)).ok).toBe(true);
    m.offre.valeur = 'base';
    const v = await reprendre(m.deps, T, id);
    expect(lancements.appels).toHaveLength(1);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'echouee', actions: [{ resultat: { ok: false, code: 'plan_feature_unavailable' } }] });
  });

  it('🔴 sans la console (Free) : refusée à la préparation', async () => {
    const m = monterEnvois({ offre: 'base' });
    m.campagnes.set(CAMPAGNE, brouillon());
    const r = await proposer(m.deps, T, CSM, [{ type: 'campagne', campagne: CAMPAGNE }]);
    expect(r).toMatchObject({ ok: false, details: { code: 'plan_feature_unavailable' } });
  });

  it('un envoi est SEUL dans sa mise en ligne ; une campagne d’un autre espace est introuvable', async () => {
    const m = monterEnvois();
    m.campagnes.set(CAMPAGNE, brouillon());
    expect(await proposer(m.deps, T, CSM, [{ type: 'campagne', campagne: CAMPAGNE }, { type: 'publier', scenario: WF }]))
      .toMatchObject({ ok: false, statut: 400 });
    expect(await proposer(m.deps, AUTRE, CSM, [{ type: 'campagne', campagne: CAMPAGNE }])).toMatchObject({ ok: false, statut: 404 });
  });
});

describe('le oui d’une suppression de contacts (CSM, B8)', () => {
  const trois = () => {
    for (const [id, nom] of [[C1, 'Alice Martin'], [C2, 'Bruno Petit'], [C3, 'Chloé Roux']] as const) effacements.fiches.set(id, fiche(id, nom));
  };
  async function proposeeSuppression(m: ReturnType<typeof monterEnvois>, ids = [C3, C1, C2]): Promise<string> {
    const r = await proposer(m.deps, T, CSM, [{ type: 'suppression', contacts: ids }]);
    if (!r.ok) throw new Error(`refusée : ${r.erreur}`);
    return r.valeur.id;
  }

  it('le bouton dit combien ; rien n’est effacé avant le clic ; 🔴 rien du contact n’est gardé, ni nom ni numéro', async () => {
    const m = monterEnvois();
    trois();
    const id = await proposeeSuppression(m);
    expect(effacements.appels).toEqual([]);
    const gardee = JSON.stringify(await m.store.lire(T, id));
    expect(gardee).toContain('Supprimer 3 contacts');
    for (const donnee of ['Alice', 'Bruno', 'Chloé', '612345678']) expect(gardee).not.toContain(donnee);
  });

  it('🔴 le clic efface EXACTEMENT les fiches montrées, et laisse la trace de la purge, signée de l’admin', async () => {
    const m = monterEnvois();
    trois();
    const v = await accepter(m.deps, T, await proposeeSuppression(m), ADMIN);
    expect(effacements.appels).toEqual([[C1, C2, C3]]);
    expect(v.ok && v.valeur.actions[0]!.resultat).toEqual({ ok: true, etat: 'supprimes', contacts: 3, conversations: 6, messages: 15 });
    const purges = m.audit.filter((a) => a.action === 'contact.purged');
    expect(purges).toHaveLength(3);
    for (const p of purges) expect(p).toMatchObject({ userId: ADMIN.userId, detail: { lot: 3, via: 'mise_en_ligne' } });
  });

  it('🔴 une fiche a changé depuis le bouton (effacée ailleurs) : le clic est refusé, rien n’est effacé', async () => {
    const m = monterEnvois();
    trois();
    const id = await proposeeSuppression(m);
    effacements.fiches.delete(C2);
    expect(await accepter(m.deps, T, id, ADMIN)).toMatchObject({ ok: false, statut: 409, details: { code: 'modifiee' } });
    expect(effacements.appels).toEqual([]);
  });

  it('la limite du jour de la Free : le refus est noté, rien n’est effacé ; la Free peut dire oui', async () => {
    const m = monterEnvois({ offre: 'base' });
    trois();
    effacements.refus = { max: 50 };
    const v = await accepter(m.deps, T, await proposeeSuppression(m), ADMIN);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'echouee', actions: [{ resultat: { ok: false, code: 'plan_limit_reached' } }] });
    expect(effacements.fiches.size).toBe(3);
  });

  it('🔴 une exécution coupée se reprend avec les fiches qui RESTENT', async () => {
    const m = monterEnvois();
    trois();
    const id = await proposeeSuppression(m);
    effacements.panne = true;
    const coupee = await accepter(m.deps, T, id, ADMIN);
    expect(coupee.ok && coupee.valeur.etat).toBe('interrompue');
    const v = await reprendre(m.deps, T, id);
    expect(effacements.appels).toEqual([[C1, C2, C3], [C2, C3]]);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'faite', actions: [{ resultat: { ok: true, etat: 'supprimes', contacts: 2 } }] });
  });

  it('aucun de ces contacts n’existe plus : refusée dès la préparation', async () => {
    const m = monterEnvois();
    expect(await proposer(m.deps, T, CSM, [{ type: 'suppression', contacts: [C1] }])).toMatchObject({ ok: false, statut: 409 });
  });
});

describe('🔴 la reprise par l’identifiant du oui n’accepte JAMAIS (CSM, B8)', () => {
  it('pas encore cliqué : refusée, en attente du clic ; expiré : refusée ; rien ne part', async () => {
    const m = monterEnvois();
    m.campagnes.set(CAMPAGNE, brouillon());
    const id = await proposeeCampagne(m);
    expect(await reprendre(m.deps, T, id)).toMatchObject({ ok: false, statut: 409, details: { code: 'en_attente_du_clic' } });
    m.horloge.now += 25 * 3_600_000;
    expect(await reprendre(m.deps, T, id)).toMatchObject({ ok: false, statut: 409, details: { code: 'expiree' } });
    expect(lancements.appels).toEqual([]);
  });

  it('cliqué : rend le résultat sans rien refaire ; un oui d’un autre espace est introuvable', async () => {
    const m = monterEnvois();
    m.campagnes.set(CAMPAGNE, brouillon());
    const id = await proposeeCampagne(m);
    await accepter(m.deps, T, id, ADMIN);
    expect(await reprendre(m.deps, T, id)).toMatchObject({ ok: true, valeur: { etat: 'faite' } });
    expect(lancements.appels).toHaveLength(1);
    expect(await reprendre(m.deps, AUTRE, id)).toMatchObject({ ok: false, statut: 404 });
  });
});
