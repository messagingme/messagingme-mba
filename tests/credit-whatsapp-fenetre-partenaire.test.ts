import { describe, it, expect } from 'vitest';
import {
  connexionParLaLigne, droitALaLigne, solutionDuPartenaire, type DepsFenetrePartenaire,
} from '../src/credit-whatsapp/fenetre-partenaire';
import type { Offre } from '../src/offres/offres';

/**
 * LA FENÊTRE DU PARTENAIRE (lot E du Crédit WhatsApp, plan `2026-11-09-credit-whatsapp-fenetre-du-partenaire.md`) : la
 * fenêtre de Meta ouverte avec la solution du partenaire. 🔴 L'identifiant de la solution ne part qu'à un espace qui a
 * droit à la ligne : sinon la ligne du partenaire paierait les messages d'un espace qui ne l'a pas payée.
 */
const T = '5f0c1e2a-8b7d-4c3e-9a1f-2d6b7e8c9f01';
const SOLUTION = 'solution-de-test';

function deps(o: { offre?: Offre; places?: number | null; couverts?: string[]; rattaches?: number; solutionId?: string } = {}) {
  const alertes: string[] = [];
  const d: DepsFenetrePartenaire = {
    solutionId: o.solutionId ?? SOLUTION,
    offre: async () => o.offre ?? 'pro',
    option: async () => (o.places === null ? null : { places: o.places ?? 1 }),
    numerosCouverts: async () => o.couverts ?? [],
    numerosRattaches: async () => o.rattaches ?? 0,
    alerter: async (texte) => { alertes.push(texte); },
  };
  return { d, alertes };
}

describe('le droit à la ligne', () => {
  it('🔴 une Entreprise toujours (illimitée, sans option) ; une formule Pro ou un Business avec une option et une place libre', async () => {
    expect(await droitALaLigne(deps({ offre: 'entreprise', places: null }).d, T)).toBe(true);
    expect(await droitALaLigne(deps({ offre: 'pro', places: 2, couverts: ['pn-a'] }).d, T)).toBe(true);
    expect(await droitALaLigne(deps({ offre: 'business', places: 1, couverts: [] }).d, T)).toBe(true);
  });

  it('🔴 jamais une Free, ni un Pro sans option (un essai n’en a pas), ni une option dont toutes les places sont prises', async () => {
    expect(await droitALaLigne(deps({ offre: 'base', places: 1 }).d, T)).toBe(false);
    expect(await droitALaLigne(deps({ offre: 'pro', places: null }).d, T)).toBe(false);
    expect(await droitALaLigne(deps({ offre: 'business', places: null }).d, T)).toBe(false);
    expect(await droitALaLigne(deps({ offre: 'pro', places: 1, couverts: ['pn-a'] }).d, T)).toBe(false);
    // Une option sans place (relecture du lot E, jaune 10) : aucune place libre.
    expect(await droitALaLigne(deps({ offre: 'pro', places: 0 }).d, T)).toBe(false);
  });

  it('🔴 le numéro écarté ne compte pas parmi les couverts : celui qui vient d’arriver ne prend pas sa propre place (relecture du lot E, jaune 9)', async () => {
    // Une place, et la ligne de l'option couvre déjà le compte du numéro reconnecté : sans l'écarter, la place paraît prise.
    const { d } = deps({ offre: 'pro', places: 1, couverts: ['pn-nouveau'] });
    expect(await droitALaLigne(d, T)).toBe(false);
    expect(await droitALaLigne(d, T, 'pn-nouveau')).toBe(true);
    // Un AUTRE numéro couvert garde sa place : écarter le nouveau ne libère rien.
    expect(await droitALaLigne(deps({ offre: 'pro', places: 1, couverts: ['pn-autre', 'pn-nouveau'] }).d, T, 'pn-nouveau')).toBe(false);
  });
});

describe('l’identifiant de la solution', () => {
  it('🔴 rendu seulement à un espace qui a droit à la ligne ET n’a encore aucun numéro rattaché', async () => {
    expect(await solutionDuPartenaire(deps({ offre: 'entreprise', places: null }).d, T)).toBe(SOLUTION);
    expect(await solutionDuPartenaire(deps({ offre: 'pro', places: 1 }).d, T)).toBe(SOLUTION);
    // Un numéro déjà rattaché, délié compris (celui de l'essai) relève du lot D : pas de fenêtre du partenaire.
    expect(await solutionDuPartenaire(deps({ offre: 'pro', places: 1, rattaches: 1 }).d, T)).toBeNull();
    expect(await solutionDuPartenaire(deps({ offre: 'base' }).d, T)).toBeNull();
    expect(await solutionDuPartenaire(deps({ offre: 'pro', places: null }).d, T)).toBeNull();
  });

  it('la solution non configurée (`META_SOLUTION_ID` vide, ou l’inscription éteinte) : rien, pour personne', async () => {
    expect(await solutionDuPartenaire(deps({ offre: 'entreprise', places: null, solutionId: '' }).d, T)).toBeNull();
  });

  it('🔴 une règle qui ne se lit pas (la base) ferme la fenêtre sans lever : la configuration de la connexion et l’état des cartes restent servis (relecture du lot E, jaune 6)', async () => {
    const offreIllisible = deps({ offre: 'entreprise', places: null });
    offreIllisible.d.offre = async () => { throw new Error('base indisponible'); };
    await expect(solutionDuPartenaire(offreIllisible.d, T)).resolves.toBeNull();
    const numerosIllisibles = deps({ offre: 'entreprise', places: null });
    numerosIllisibles.d.numerosRattaches = async () => { throw new Error('base indisponible'); };
    await expect(solutionDuPartenaire(numerosIllisibles.d, T)).resolves.toBeNull();
  });
});

describe('la connexion faite par la ligne', () => {
  it('🔴 avec le droit : Julien sait le geste à faire, poser la ligne une fois celle du partenaire branchée', async () => {
    const { d, alertes } = deps({ offre: 'pro', places: 1 });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: '+33 6 12 34 56 78' });
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toMatch(/Numéro connecté par la ligne du partenaire : espace 5f0c1e2a-.*, \+33 6 12 34 56 78 \(compte waba-1\)\. Vérifier que le partenaire a branché sa ligne sur ce compte, puis poser la ligne dans \/ops\./);
  });

  it('🔴 un numéro reconnecté sur un compte déjà couvert par la ligne de l’option : le droit est dit, pas « sans droit » (relecture du lot E, jaune 9)', async () => {
    // « Déconnecter le numéro » ne retire pas la ligne de l'option : le numéro qui revient est couvert par son compte.
    const { d, alertes } = deps({ offre: 'pro', places: 1, couverts: ['pn-1'], rattaches: 1 });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null });
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toMatch(/^Numéro connecté par la ligne du partenaire/);
  });

  it('🔴 sans le droit (l’identifiant réutilisé hors de sa garde) : Julien est prévenu de ne pas brancher la ligne', async () => {
    // Le numéro vient d'arriver : le droit se relit SANS la condition « aucun numéro ».
    const { d, alertes } = deps({ offre: 'base', rattaches: 1 });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: null, numero: null });
    expect(alertes[0]).toMatch(/SANS droit à la ligne : espace .* \(compte waba-1\)\. Ne pas brancher la ligne du partenaire/);
  });

  it('variable vide, la fenêtre n’a pu être ouverte par nous : une fin marquée par la ligne n’alerte pas (relecture du lot E, jaune 10)', async () => {
    const { d, alertes } = deps({ offre: 'entreprise', places: null, solutionId: '' });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null });
    expect(alertes).toEqual([]);
  });

  it('ne lève jamais : la connexion est faite, une alerte en panne ne la défait pas', async () => {
    const { d } = deps();
    d.alerter = async () => { throw new Error('Telegram indisponible'); };
    await expect(connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null })).resolves.toBeUndefined();
  });
});
