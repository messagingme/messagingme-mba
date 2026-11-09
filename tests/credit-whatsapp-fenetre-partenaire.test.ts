import { describe, it, expect } from 'vitest';
import {
  connexionParLaLigne, droitALaLigne, fenetreRefuseeParLaLigne, solutionDuPartenaire, type DepsFenetrePartenaire,
} from '../src/credit-whatsapp/fenetre-partenaire';
import type { Offre } from '../src/offres/offres';
import { capturerJournal } from './journal';

/**
 * LA FENÊTRE DU PARTENAIRE (lot E du Crédit WhatsApp, plan `2026-11-09-credit-whatsapp-fenetre-du-partenaire.md`) : la
 * fenêtre de Meta ouverte avec la solution du partenaire. 🔴 L'identifiant de la solution ne part qu'à un espace qui a
 * droit à la ligne : sinon la ligne du partenaire paierait les messages d'un espace qui ne l'a pas payée.
 */
const T = '5f0c1e2a-8b7d-4c3e-9a1f-2d6b7e8c9f01';
const SOLUTION = 'solution-de-test';

function deps(o: {
  offre?: Offre; places?: number | null; couverts?: string[]; rattaches?: number; solutionId?: string; alertePart?: boolean;
} = {}) {
  const alertes: string[] = [];
  const marques: string[] = [];
  const d: DepsFenetrePartenaire = {
    solutionId: o.solutionId ?? SOLUTION,
    offre: async () => o.offre ?? 'pro',
    option: async () => (o.places === null ? null : { places: o.places ?? 1 }),
    numerosCouverts: async () => o.couverts ?? [],
    numerosRattaches: async () => o.rattaches ?? 0,
    marquer: async (_tenant, phoneNumberId) => { marques.push(phoneNumberId); },
    alerter: async (texte) => { alertes.push(texte); return o.alertePart ?? true; },
  };
  return { d, alertes, marques };
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

  it('🔴 une règle qui ne se lit pas (la base) ferme la fenêtre sans lever, et le journal le dit : la configuration de la connexion et l’état des cartes restent servis (relecture du lot E, jaune 6 ; du lot E4, jaune 3)', async () => {
    const offreIllisible = deps({ offre: 'entreprise', places: null });
    offreIllisible.d.offre = async () => { throw new Error('base indisponible'); };
    const { resultat, lignes } = await capturerJournal(() => solutionDuPartenaire(offreIllisible.d, T));
    expect(resultat).toBeNull();
    expect(lignes).toEqual([expect.objectContaining({ lvl: 'error', msg: 'fenetre_partenaire_illisible', tenantId: T })]);
    const numerosIllisibles = deps({ offre: 'entreprise', places: null });
    numerosIllisibles.d.numerosRattaches = async () => { throw new Error('base indisponible'); };
    await expect(capturerJournal(() => solutionDuPartenaire(numerosIllisibles.d, T)).then((r) => r.resultat)).resolves.toBeNull();
  });
});

describe('la connexion faite par la ligne', () => {
  it('🔴 avec le droit : le numéro est marqué, et Julien sait les gestes : poser la ligne tout de suite, puis demander au partenaire d’attacher la sienne (essai 236 : elle ne s’attache pas d’elle-même)', async () => {
    const { d, alertes, marques } = deps({ offre: 'pro', places: 1 });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: '+33 6 12 34 56 78' });
    expect(marques).toEqual(['pn-1']);
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toMatch(/^Numéro connecté par la ligne du partenaire : espace 5f0c1e2a-.*, \+33 6 12 34 56 78 \(compte waba-1\)\. Poser la ligne dans \/ops tout de suite, puis demander au partenaire d’attacher sa ligne de crédit à ce compte WhatsApp : elle ne s’attache pas d’elle-même\.$/);
  });

  it('🔴 un numéro reconnecté sur un compte déjà couvert par la ligne de l’option : le droit est dit, et rien n’est à poser (relecture du lot E, jaune 9 ; du lot E4, jaune 5)', async () => {
    // « Déconnecter le numéro » ne retire pas la ligne de l'option : le numéro qui revient est couvert par son compte.
    const { d, alertes } = deps({ offre: 'pro', places: 1, couverts: ['pn-1'], rattaches: 1 });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null });
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toMatch(/^Numéro connecté par la ligne du partenaire : .*\(compte waba-1\)\. Son compte WhatsApp est déjà couvert par la ligne de l’option : rien à poser dans \/ops ; vérifier que le partenaire a attaché sa ligne à ce compte\.$/);
  });

  it('🔴 sans le droit (l’identifiant réutilisé hors de sa garde) : ne pas poser, et demander au partenaire de ne rien attacher', async () => {
    // Le numéro vient d'arriver : le droit se relit SANS la condition « aucun numéro ».
    const { d, alertes } = deps({ offre: 'base', rattaches: 1 });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: null, numero: null });
    expect(alertes[0]).toMatch(/^Numéro connecté par la fenêtre du partenaire SANS droit à la ligne : espace .* \(compte waba-1\)\. Ne pas poser la ligne ; demander au partenaire de ne rien attacher à ce compte, ou de détacher sa ligne ; voir avec le client\.$/);
  });

  it('🔴 la fenêtre fermée chez nous (variable vidée, page restée ouverte) : la fin alerte quand même, au lieu de se taire (relecture du lot E4, jaune 1)', async () => {
    const { d, alertes, marques } = deps({ offre: 'entreprise', places: null, solutionId: '' });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null });
    expect(marques).toEqual(['pn-1']);
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toMatch(/^Numéro connecté par la fenêtre du partenaire alors qu’elle est FERMÉE chez nous \(variable vide ou inscription éteinte\) : .*\(compte waba-1\)\. Vérifier chez Meta s’il est partagé avec le partenaire ; ne rien poser sans décision\.$/);
  });

  it('🔴 un droit illisible (la base) n’empêche pas l’alerte : Julien vérifie l’espace avant de poser (relecture du lot E, jaune 3)', async () => {
    const { d, alertes } = deps({ offre: 'entreprise', places: null });
    d.offre = async () => { throw new Error('base indisponible'); };
    const { lignes } = await capturerJournal(() => connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null }));
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toMatch(/^Numéro connecté par la fenêtre du partenaire, droit illisible : .*\(compte waba-1\)\. Vérifier l’espace dans \/ops avant de poser la ligne\.$/);
    expect(lignes).toEqual(expect.arrayContaining([expect.objectContaining({ msg: 'droit_a_la_ligne_illisible', tenantId: T })]));
  });

  it('🔴 une alerte qui ne part pas laisse une trace dans le journal, avec son texte (relecture du lot E, jaune 3 ; l’alerte de l’essai 236 jamais reçue)', async () => {
    const { d } = deps({ offre: 'pro', places: 1, alertePart: false });
    const { lignes } = await capturerJournal(() => connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null }));
    expect(lignes).toEqual([expect.objectContaining({
      lvl: 'error', msg: 'alerte_fenetre_partenaire_perdue', tenantId: T, wabaId: 'waba-1',
      texte: expect.stringMatching(/^Numéro connecté par la ligne du partenaire/),
    })]);
  });

  it('une marque qui échoue ne fait pas taire l’alerte ; sans numéro, rien à marquer', async () => {
    const { d, alertes } = deps({ offre: 'pro', places: 1 });
    d.marquer = async () => { throw new Error('base indisponible'); };
    const { lignes } = await capturerJournal(() => connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null }));
    expect(alertes).toHaveLength(1);
    expect(lignes).toEqual([expect.objectContaining({ msg: 'marque_par_la_ligne_impossible', tenantId: T })]);
    const sansNumero = deps({ offre: 'pro', places: 1 });
    await connexionParLaLigne(sansNumero.d, T, { wabaId: 'waba-1', phoneNumberId: null, numero: null });
    expect(sansNumero.marques).toEqual([]);
    expect(sansNumero.alertes[0]).toMatch(/sans numéro \(compte waba-1\)/);
  });

  it('ne lève jamais : la connexion est faite, une alerte en panne ne la défait pas', async () => {
    const { d } = deps();
    d.alerter = async () => { throw new Error('Telegram indisponible'); };
    await expect(capturerJournal(() => connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null })).then((r) => r.resultat)).resolves.toBeUndefined();
  });
});

describe('la fenêtre du partenaire passée chez Meta, la connexion refusée chez nous (relecture du lot E, jaune 1)', () => {
  it('🔴 Julien est alerté : le compte est peut-être déjà partagé avec le partenaire', async () => {
    const { d, alertes } = deps({ offre: 'pro', places: 1 });
    await fenetreRefuseeParLaLigne(d, T, { statut: 409, erreur: 'Ce compte WhatsApp appartient à un autre espace', wabaId: 'waba-x' });
    expect(alertes).toEqual([`Fenêtre du partenaire passée chez Meta, connexion REFUSÉE chez nous (409 : Ce compte WhatsApp appartient à un autre espace) : espace ${T}, compte waba-x. Le compte est peut-être déjà partagé avec le partenaire : lui demander de ne rien y attacher, et voir avec le client.`]);
    const sansCompte = deps();
    await fenetreRefuseeParLaLigne(sansCompte.d, T, { statut: 422, erreur: 'échange refusé', wabaId: null });
    expect(sansCompte.alertes[0]).toMatch(/: espace .*, compte inconnu\. /);
  });

  it('ne lève jamais, et une alerte perdue laisse sa trace', async () => {
    const { d } = deps({ alertePart: false });
    const { lignes } = await capturerJournal(() => fenetreRefuseeParLaLigne(d, T, { statut: 422, erreur: 'échange refusé', wabaId: 'waba-x' }));
    expect(lignes).toEqual([expect.objectContaining({ msg: 'alerte_fenetre_partenaire_perdue', tenantId: T, wabaId: 'waba-x' })]);
    const enPanne = deps();
    enPanne.d.alerter = async () => { throw new Error('Telegram indisponible'); };
    await expect(capturerJournal(() => fenetreRefuseeParLaLigne(enPanne.d, T, { statut: 422, erreur: 'x', wabaId: null })).then((r) => r.resultat)).resolves.toBeUndefined();
  });
});
