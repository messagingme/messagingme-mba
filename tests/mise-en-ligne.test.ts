import { describe, it, expect } from 'vitest';
import type { WorkflowNode } from '../src/workflow/graph';
import {
  accepter, libelleDe, lireVue, proposer, DUREE_MISE_EN_LIGNE_MS, type ActionGardee, type DemandeAction,
} from '../src/mise-en-ligne/mise-en-ligne';
import { modelesDeBlocInertes } from './routes-inertes';
import { ACTIVER, ADMIN, AUTRE, BROUILLON, CSM, T, V1, WF, WF2, bloc, graphe, ligne, monter, proposee } from './mise-en-ligne-fixtures';

/**
 * LE OUI DE MISE EN LIGNE (lot 1 du CSM virtuel, B2), sa logique : ce que la proposition refuse sans rien écrire, ce que
 * le clic exige (pas échu, l'état inchangé), qu'il sert une fois, qu'une panne se reprend après le dernier résultat, et
 * qu'un accès retiré bloque. Le magasin est un faux qui reproduit ses requêtes conditionnelles ; la vraie base est
 * éprouvée par `tests/integration/mises-en-ligne.integration.test.ts`.
 */

describe('la proposition : vérifie sans rien écrire', () => {
  it('🔴 le bouton nomme l’effet, le récapitulatif dit ce qui change, et RIEN n’est publié ni branché', async () => {
    const m = monter();
    const r = await proposer(m.deps, T, CSM, ACTIVER);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valeur.libelle).toBe('Activer sur WhatsApp');
    expect(r.valeur.etat).toBe('proposee');
    // Les publications d'abord, puis le répondeur, quel que soit l'ordre demandé.
    expect(r.valeur.actions.map((a) => a.type)).toEqual(['publier', 'repondeur']);
    expect(r.valeur.recapitulatif[0]).toContain('« Qualification » est publié tel qu’il a été préparé (2 blocs)');
    expect(r.valeur.recapitulatif[1]).toContain('toutes les 24 heures');
    expect(r.valeur.recapitulatif[1]).toContain('c’est l’équipe qui répond');
    expect(r.valeur.expireLe).toBe(new Date(m.horloge.now + DUREE_MISE_EN_LIGNE_MS).toISOString());
    expect(m.publies).toEqual([]);
    expect(m.reglagesEcrits).toEqual([]);
    expect(m.audit).toEqual([]);
  });

  it('le libellé : « Restaurer la version N » pour une restauration seule, « Publier les modifications » sinon', () => {
    const r: ActionGardee = { type: 'restaurer', scenario: WF, nom: 'Q', version: 3, publieeLe: '2026-11-20T09:00:00.000Z', graphe: V1 };
    const p: ActionGardee = { type: 'publier', scenario: WF2, nom: 'A', graphe: V1 };
    expect(libelleDe([r])).toBe('Restaurer la version 3');
    expect(libelleDe([p])).toBe('Publier les modifications');
    expect(libelleDe([r, p])).toBe('Publier les modifications');
  });

  it('🔴 chaque refus, avant toute écriture', async () => {
    const m = monter();
    m.ajouterVersion(WF, 1, V1);
    const cas: Array<[DemandeAction[], number, RegExp]> = [
      [[], 400, /de 1 à 10 actions/],
      [[{ type: 'publier', scenario: 'pas-un-uuid' }], 404, /introuvable/],
      [[{ type: 'publier', scenario: '77777777-7777-4777-8777-777777777777' }], 404, /introuvable/],
      [[{ type: 'publier', scenario: WF2 }], 409, /pas de brouillon/],
      [[{ type: 'restaurer', scenario: WF, version: 1 }], 409, /déjà celle en ligne/],
      [[{ type: 'restaurer', scenario: WF, version: 9 }], 404, /pas de version 9/],
      [[{ type: 'publier', scenario: WF }, { type: 'restaurer', scenario: WF, version: 1 }], 400, /publié deux fois/],
      [[{ type: 'repondeur', scenario: WF2 }, { type: 'repondeur', scenario: WF }, { type: 'publier', scenario: WF }], 400, /une fois au plus/],
      [[{ type: 'repondeur', scenario: WF, delaiHeures: 0 }], 400, /délai/],
    ];
    for (const [demandes, statut, phrase] of cas) {
      const r = await proposer(m.deps, T, CSM, demandes);
      expect(r.ok, JSON.stringify(demandes)).toBe(false);
      if (r.ok) continue;
      expect(r.statut, JSON.stringify(demandes)).toBe(statut);
      expect(r.erreur).toMatch(phrase);
    }
    expect(m.store.lignes.size).toBe(0);
  });

  it('🔴 le répondeur sur un scénario jamais publié exige sa publication dans la même mise en ligne', async () => {
    const m = monter();
    m.rows.set(WF, ligne(WF, 'Qualification', graphe(), BROUILLON));
    const seul = await proposer(m.deps, T, CSM, [{ type: 'repondeur', scenario: WF }]);
    expect(seul.ok).toBe(false);
    if (!seul.ok) expect(seul.erreur).toMatch(/n’est pas publié/);
    expect((await proposer(m.deps, T, CSM, ACTIVER)).ok).toBe(true);
  });

  it('🔴 sans les scénarios dans l’offre, toute action est refusée avec le lien de l’offre, une publication seule comprise', async () => {
    const m = monter({ offre: 'base' });
    for (const demandes of [ACTIVER, [{ type: 'publier', scenario: WF }] as DemandeAction[]]) {
      const r = await proposer(m.deps, T, CSM, demandes);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.statut).toBe(402);
    }
  });

  it('un brouillon que « Publier » refuserait est refusé ici, avec le code de la console', async () => {
    const m = monter();
    const sautSansCible: WorkflowNode = { id: 'g', type: 'aller_a', position: { x: 0, y: 0 }, data: {} };
    m.rows.set(WF, ligne(WF, 'Qualification', V1, graphe(bloc('a', 'Bonjour'), sautSansCible)));
    const r = await proposer(m.deps, T, CSM, [{ type: 'publier', scenario: WF }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.statut).toBe(422);
      expect(r.details?.code).toBe('aller_a_invalide');
    }
  });

  it('une mise en ligne d’un autre espace n’existe pas', async () => {
    const m = monter();
    const id = await proposee(m);
    expect((await lireVue(m.deps, AUTRE, id)).ok).toBe(false);
    const clic = await accepter(m.deps, AUTRE, id, ADMIN);
    expect(clic.ok).toBe(false);
    if (!clic.ok) expect(clic.statut).toBe(404);
    expect(m.publies).toEqual([]);
  });
});

describe('le clic : une fois, sur ce qui a été montré', () => {
  it('🔴 publie le brouillon montré, branche le répondeur, et le journal dit qui a cliqué', async () => {
    const m = monter();
    const id = await proposee(m);
    const r = await accepter(m.deps, T, id, ADMIN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valeur.etat).toBe('faite');
    expect(r.valeur.actions.map((a) => a.resultat)).toEqual([{ ok: true, etat: 'publie' }, { ok: true, etat: 'branche' }]);
    expect(m.publies).toEqual([{ id: WF, blocs: 2 }]);
    expect(m.reglagesEcrits).toEqual([`scenario:${WF}:86400`]);
    expect(m.audit.map((a) => [a.action, a.userId])).toEqual([
      ['mise_en_ligne.acceptee', ADMIN.userId],
      ['workflow.published', ADMIN.userId],
      ['mise_en_ligne.faite', ADMIN.userId],
    ]);
  });

  it('🔴 un second clic rend le résultat, sans rien refaire', async () => {
    const m = monter();
    const id = await proposee(m);
    await accepter(m.deps, T, id, ADMIN);
    const encore = await accepter(m.deps, T, id, { userId: 'u-admin2' });
    expect(encore.ok).toBe(true);
    if (encore.ok) expect(encore.valeur.etat).toBe('faite');
    expect(m.publies).toHaveLength(1);
    expect(m.reglagesEcrits).toHaveLength(1);
    expect(m.audit.filter((a) => a.action === 'mise_en_ligne.acceptee')).toHaveLength(1);
  });

  it('🔴 un bouton échu au bout de 24 heures est refusé, et rien ne part', async () => {
    const m = monter();
    const id = await proposee(m);
    m.horloge.now += DUREE_MISE_EN_LIGNE_MS;
    const r = await accepter(m.deps, T, id, ADMIN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.details?.code).toBe('expiree');
    expect((await lireVue(m.deps, T, id)).ok && (await lireVue(m.deps, T, id))).toMatchObject({ valeur: { etat: 'expiree' } });
    expect(m.publies).toEqual([]);
  });

  it('🔴 un brouillon modifié depuis est refusé (« remontrez ») ; un bloc seulement déplacé ne l’est pas, et part avec sa disposition', async () => {
    const m = monter();
    const id = await proposee(m);
    m.rows.get(WF)!.draftGraph = graphe(bloc('a', 'Bonjour'), bloc('b', 'Autre chose ?'));
    const refuse = await accepter(m.deps, T, id, ADMIN);
    expect(refuse.ok).toBe(false);
    if (!refuse.ok) expect(refuse.details?.code).toBe('modifiee');
    expect(m.publies).toEqual([]);

    const m2 = monter();
    const id2 = await proposee(m2);
    const deplace = graphe(bloc('a', 'Bonjour', 300), bloc('b', 'Votre besoin ?', 600));
    m2.rows.get(WF)!.draftGraph = deplace;
    const ok = await accepter(m2.deps, T, id2, ADMIN);
    expect(ok.ok).toBe(true);
    expect(m2.rows.get(WF)!.graph).toEqual(deplace);
  });

  it('🔴 le graphe MONTRÉ part, pas un brouillon modifié après le clic', async () => {
    const m = monter();
    const id = await proposee(m);
    // Un enregistrement automatique tombe entre l'acceptation et l'exécution (juste après la prise du bail, avant que
    // l'exécution relise le scénario) : c'est le graphe gardé qui part, et le nouveau brouillon reste un brouillon.
    const reclamer = m.store.reclamer.bind(m.store);
    m.store.reclamer = async (t, i, jeton, bailS) => {
      m.rows.get(WF)!.draftGraph = graphe(bloc('z', 'Tout autre chose'));
      return reclamer(t, i, jeton, bailS);
    };
    await accepter(m.deps, T, id, ADMIN);
    expect(m.rows.get(WF)!.graph).toEqual(BROUILLON);
    expect(m.rows.get(WF)!.draftGraph).toEqual(graphe(bloc('z', 'Tout autre chose')));
  });

  it('🔴 une panne au milieu : interrompue, puis un nouveau clic reprend là où elle s’est arrêtée', async () => {
    const m = monter();
    m.ajouterVersion(WF2, 1, graphe(bloc('x', 'Ancien accueil')));
    const id = await proposee(m, [{ type: 'publier', scenario: WF }, { type: 'restaurer', scenario: WF2, version: 1 }]);
    const publier = m.deps.scenarios.publish;
    let appels = 0;
    m.deps.scenarios.publish = async (wfId, t, g) => {
      appels += 1;
      if (appels === 2) throw new Error('base injoignable');
      return publier(wfId, t, g);
    };
    const coupe = await accepter(m.deps, T, id, ADMIN);
    expect(coupe.ok).toBe(true);
    if (coupe.ok) {
      expect(coupe.valeur.etat).toBe('interrompue');
      expect(coupe.valeur.actions.map((a) => a.resultat)).toEqual([{ ok: true, etat: 'publie' }, null]);
    }
    const repris = await accepter(m.deps, T, id, { userId: 'u-admin2' });
    expect(repris.ok).toBe(true);
    if (repris.ok) expect(repris.valeur.etat).toBe('faite');
    // La première action n'a pas été refaite : une publication de WF, une (réussie) de WF2.
    expect(m.publies.map((p) => p.id)).toEqual([WF, WF2]);
    expect(m.audit.filter((a) => a.action === 'mise_en_ligne.acceptee')).toHaveLength(1);
  });

  it('🔴 une exécution en cours (bail tenu) n’est pas doublée par un second clic', async () => {
    const m = monter();
    const id = await proposee(m);
    await m.store.accepter(T, id, ADMIN.userId, m.store.lignes.get(id)!.empreinte);
    await m.store.reclamer(T, id, 'jeton-d-un-autre', 120);
    const r = await accepter(m.deps, T, id, ADMIN);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valeur.etat).toBe('en_cours');
    expect(m.publies).toEqual([]);
  });

  it('🔴 un refus pendant l’exécution l’arrête : la suite ne part pas, et le journal le dit', async () => {
    const avecModele = graphe({ id: 't', type: 'template', position: { x: 0, y: 0 }, data: { templateName: 'promo', language: 'fr' } });
    const m = monter({
      publication: {
        lignes: {
          ...modelesDeBlocInertes.publication.lignes,
          desModeles: async () => [{ workflowId: WF, modele: 'promo', langue: 'fr', etat: 'refuse', raison: 'refusé par Meta', creeLe: '2026-11-24T00:00:00.000Z', trancheLe: null }],
        },
      },
    });
    m.rows.set(WF, ligne(WF, 'Qualification', V1, avecModele));
    const id = await proposee(m);
    const r = await accepter(m.deps, T, id, ADMIN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valeur.etat).toBe('echouee');
    expect(r.valeur.actions[0]!.resultat).toMatchObject({ ok: false, code: 'modele_refuse' });
    expect(r.valeur.actions[1]!.resultat).toBeNull();
    expect(m.reglagesEcrits).toEqual([]);
    expect(m.audit.at(-1)).toMatchObject({ action: 'mise_en_ligne.echouee', detail: { action: 1, code: 'modele_refuse' } });
  });

  it('🔴 un admin retiré, ou l’accès qui a préparé révoqué, avant l’exécution la bloque', async () => {
    for (const retirer of ['clic', 'acces'] as const) {
      const m = monter();
      const id = await proposee(m);
      const ligneFausse = m.store.lignes.get(id)!;
      await m.store.accepter(T, id, ADMIN.userId, ligneFausse.empreinte);
      if (retirer === 'clic') m.store.admins.delete(ADMIN.userId);
      else m.store.revoquees.add(CSM.autorisationId);
      const r = await accepter(m.deps, T, id, { userId: 'u-admin2' });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.valeur.etat, retirer).toBe('echouee');
      expect(r.valeur.actions[0]!.resultat).toMatchObject({ ok: false, code: 'acces_revoque' });
      expect(m.publies, retirer).toEqual([]);
      expect(m.reglagesEcrits, retirer).toEqual([]);
    }
  });

  it('🔴 un espace redescendu en Base entre la préparation et le clic : refusé, rien n’est publié', async () => {
    const m = monter();
    const id = await proposee(m, [{ type: 'publier', scenario: WF }]);
    m.offre.valeur = 'base';
    const r = await accepter(m.deps, T, id, ADMIN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.details?.code).toBe('impossible');
    expect(m.publies).toEqual([]);
  });

  it('🔴 une reprise après un refus déjà noté conclut sur lui, sans jamais repartir après', async () => {
    const m = monter();
    const id = await proposee(m);
    await m.store.accepter(T, id, ADMIN.userId, m.store.lignes.get(id)!.empreinte);
    // L'exécution d'avant a noté le refus de la publication, puis s'est arrêtée avant de conclure (une panne).
    await m.store.reclamer(T, id, 'jeton-perdu', 120);
    await m.store.noterResultat(T, id, 'jeton-perdu', { ok: false, code: 'modele_refuse', message: 'refusé par Meta' }, 120);
    m.horloge.now += 121_000;
    const r = await accepter(m.deps, T, id, ADMIN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valeur.etat).toBe('echouee');
    expect(r.valeur.actions[1]!.resultat).toBeNull();
    expect(m.reglagesEcrits).toEqual([]);
    expect(m.audit.at(-1)).toMatchObject({ action: 'mise_en_ligne.echouee', detail: { action: 1, code: 'modele_refuse' } });
  });

  it('🔴 restaurer une version republie son graphe d’alors', async () => {
    const m = monter();
    const ancien = graphe(bloc('x', 'Ancien accueil'));
    m.ajouterVersion(WF2, 1, ancien);
    const id = await proposee(m, [{ type: 'restaurer', scenario: WF2, version: 1 }]);
    const vue = await lireVue(m.deps, T, id);
    expect(vue.ok && vue.valeur.libelle).toBe('Restaurer la version 1');
    const r = await accepter(m.deps, T, id, ADMIN);
    expect(r.ok && r.valeur.etat).toBe('faite');
    expect(m.rows.get(WF2)!.graph).toEqual(ancien);
  });
});
