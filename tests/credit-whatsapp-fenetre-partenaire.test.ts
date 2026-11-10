import { describe, it, expect } from 'vitest';
import {
  connexionParLaLigne, droitALaLigne, fenetreRefuseeParLaLigne, solutionDuPartenaire, type DepsFenetrePartenaire,
} from '../src/credit-whatsapp/fenetre-partenaire';
import type { Offre } from '../src/offres/offres';
import { capturerJournal } from './journal';
import { verrousEnMemoire } from './verrous';

/**
 * LA FENÊTRE DU PARTENAIRE (lot E du Crédit WhatsApp, plan `2026-11-09-credit-whatsapp-fenetre-du-partenaire.md`) : la
 * fenêtre de Meta ouverte avec la solution du partenaire. 🔴 L'identifiant de la solution ne part qu'à un espace qui a
 * droit à la ligne : sinon la ligne du partenaire paierait les messages d'un espace qui ne l'a pas payée.
 */
const T = '5f0c1e2a-8b7d-4c3e-9a1f-2d6b7e8c9f01';
const SOLUTION = 'solution-de-test';
const NUMERO = '+33 6 12 34 56 78';

function deps(o: {
  offre?: Offre; places?: number | null; couverts?: string[]; rattaches?: number; solutionId?: string; alertePart?: boolean;
  /** La ligne qui couvre le numéro arrivé (`ligneDuNumero`), quelle que soit son origine ; aucune par défaut. */
  couvrante?: { tenantId: string } | null;
  maintenant?: () => number;
} = {}) {
  const alertes: string[] = [];
  const marques: string[] = [];
  const couvertures: string[] = [];
  const d: DepsFenetrePartenaire = {
    solutionId: o.solutionId ?? SOLUTION,
    offre: async () => o.offre ?? 'pro',
    option: async () => (o.places === null ? null : { places: o.places ?? 1 }),
    numerosCouverts: async () => o.couverts ?? [],
    numerosRattaches: async () => o.rattaches ?? 0,
    ligneDuNumero: async (phoneNumberId) => { couvertures.push(phoneNumberId); return o.couvrante ?? null; },
    verrous: verrousEnMemoire(o.maintenant),
    marquer: async (_tenant, phoneNumberId) => { marques.push(phoneNumberId); },
    alerter: async (texte) => { alertes.push(texte); return o.alertePart ?? true; },
  };
  return { d, alertes, marques, couvertures };
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
  it('🔴 avec le droit : le numéro est marqué, et Julien sait les gestes DANS L’ORDRE : demander l’attache au partenaire, puis poser la ligne quand il la confirme, pas avant (relecture du lot E5, jaune 1 ; décision de Julien du 2026-11-09)', async () => {
    // Posée avant l'attache, la ligne ferait dire « payés par votre Crédit WhatsApp » pendant que Meta refuse les envois,
    // et un compte qui a déjà sa carte chez Meta paierait deux fois (Meta, puis notre facture d'Entreprise).
    const { d, alertes, marques } = deps({ offre: 'pro', places: 1 });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: NUMERO });
    expect(marques).toEqual(['pn-1']);
    expect(alertes).toEqual([
      `Numéro connecté par la ligne du partenaire : espace ${T}, ${NUMERO} (compte waba-1). Demander au partenaire d’attacher sa ligne de crédit à ce compte WhatsApp (elle ne s’attache pas d’elle-même), puis poser la ligne dans /ops quand il confirme l’attache, pas avant : Meta refuserait les envois, et un compte qui a déjà sa carte chez Meta paierait deux fois. D’ici là, le numéro attend dans la liste de /ops.`,
    ]);
  });

  it('🔴 un compte déjà sur une ligne de l’espace, quelle qu’en soit l’origine (une ligne `ops` d’Entreprise comprise) : rien à poser, aucune marque (relecture du lot E, jaune 9 ; du lot E5, jaune 5)', async () => {
    // « Déconnecter le numéro » ne retire pas la ligne : le numéro qui revient est couvert par son compte. Lue comme la pose
    // de `/ops` la lit (`ligneDuNumero`) : les seules lignes de l'option faisaient dire « poser » à une Entreprise, que
    // `/ops` refusait ensuite (« déjà couvert »).
    const { d, alertes, marques, couvertures } = deps({ offre: 'entreprise', places: null, couvrante: { tenantId: T } });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null });
    expect(couvertures).toEqual(['pn-1']);
    expect(alertes).toEqual([
      `Numéro connecté par la ligne du partenaire : espace ${T}, pn-1 (compte waba-1). Son compte WhatsApp est déjà sur la ligne de l’espace : rien à poser dans /ops ; vérifier que le partenaire a attaché sa ligne à ce compte.`,
    ]);
    // Rien à poser, rien n'attend : pas de marque (le rouge de la relecture du lot E5).
    expect(marques).toEqual([]);
  });

  it('🔴 un compte encore sur la ligne d’un AUTRE espace : la retirer avant de poser, et le numéro attend sa ligne (relecture du lot E5, jaune 5)', async () => {
    const { d, alertes, marques } = deps({ offre: 'entreprise', places: null, couvrante: { tenantId: 'un-autre-espace' } });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null });
    expect(alertes).toEqual([
      `Numéro connecté par la ligne du partenaire : espace ${T}, pn-1 (compte waba-1). Son compte WhatsApp est encore sur la ligne d’un AUTRE espace, et la garde refuse ses envois : retirer cette ligne dans /ops, demander au partenaire d’attacher sa ligne à ce compte, puis poser celle de l’espace quand il confirme l’attache.`,
    ]);
    expect(marques).toEqual(['pn-1']);
  });

  it('🔴 un compte relié SANS numéro : demander l’attache, rien à poser, aucune marque ni lecture de couverture (relecture du lot E5, jaune 6)', async () => {
    const { d, alertes, marques, couvertures } = deps({ offre: 'entreprise', places: null });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: null, numero: null });
    expect(alertes).toEqual([
      `Compte WhatsApp relié SANS numéro par la ligne du partenaire : espace ${T}, sans numéro (compte waba-1). Demander au partenaire d’attacher sa ligne de crédit à ce compte ; rien à poser dans /ops tant qu’aucun numéro n’y est connecté. Connecté par la fenêtre, le numéro enverra sa propre alerte ; connecté autrement, le poser à son arrivée, une fois l’attache confirmée.`,
    ]);
    expect(marques).toEqual([]);
    expect(couvertures).toEqual([]);
  });

  it('🔴 sans le droit (l’identifiant réutilisé hors de sa garde) : ne pas poser, et demander au partenaire de ne rien attacher ; aucune marque', async () => {
    // Le numéro vient d'arriver : le droit se relit SANS la condition « aucun numéro ».
    const { d, alertes, marques } = deps({ offre: 'base', rattaches: 1 });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null });
    expect(alertes[0]).toMatch(/^Numéro connecté par la fenêtre du partenaire SANS droit à la ligne : espace .* \(compte waba-1\)\. Ne pas poser la ligne ; demander au partenaire de ne rien attacher à ce compte, ou de détacher sa ligne ; voir avec le client\.$/);
    // 🔴 Une marque sans droit attendrait une ligne que personne ne posera, et se réveillerait si l'espace passe en Entreprise.
    expect(marques).toEqual([]);
  });

  it('🔴 la fenêtre fermée chez nous (variable vidée, page restée ouverte) : la fin alerte quand même, au lieu de se taire (relecture du lot E4, jaune 1) ; aucune marque, la décision est à Julien', async () => {
    const { d, alertes, marques } = deps({ offre: 'entreprise', places: null, solutionId: '' });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null });
    expect(marques).toEqual([]);
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toMatch(/^Numéro connecté par la fenêtre du partenaire alors qu’elle est FERMÉE chez nous \(variable vide ou inscription éteinte\) : .*\(compte waba-1\)\. Vérifier chez Meta s’il est partagé avec le partenaire ; ne rien poser sans décision\.$/);
  });

  it('🔴 un droit ou une couverture illisible (la base) n’empêche pas l’alerte : Julien vérifie l’espace, et ne pose qu’après l’attache (relecture du lot E, jaune 3)', async () => {
    const { d, alertes, marques } = deps({ offre: 'entreprise', places: null });
    d.offre = async () => { throw new Error('base indisponible'); };
    const { lignes } = await capturerJournal(() => connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null }));
    expect(alertes).toEqual([
      `Numéro connecté par la fenêtre du partenaire, droit ou couverture illisible : espace ${T}, pn-1 (compte waba-1). Vérifier l’espace dans /ops ; ne poser la ligne qu’après l’attache du partenaire.`,
    ]);
    expect(lignes).toEqual(expect.arrayContaining([expect.objectContaining({ msg: 'droit_a_la_ligne_illisible', tenantId: T })]));
    // Le droit n'est pas su : aucune marque, la décision est à Julien.
    expect(marques).toEqual([]);
    const couvertureIllisible = deps({ offre: 'entreprise', places: null });
    couvertureIllisible.d.ligneDuNumero = async () => { throw new Error('base indisponible'); };
    await capturerJournal(() => connexionParLaLigne(couvertureIllisible.d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null }));
    expect(couvertureIllisible.alertes).toEqual([expect.stringMatching(/, droit ou couverture illisible : /)]);
    expect(couvertureIllisible.marques).toEqual([]);
  });

  it('🔴 une alerte qui ne part pas laisse une trace dans le journal, par son CAS et jamais par son texte : le numéro affiché n’y entre pas, comme dans l’audit (relecture du lot E, jaune 3 ; du lot E5, jaune 8)', async () => {
    const { d } = deps({ offre: 'pro', places: 1, alertePart: false });
    const { lignes } = await capturerJournal(() => connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: NUMERO }));
    expect(lignes).toEqual([expect.objectContaining({ lvl: 'error', msg: 'alerte_fenetre_partenaire_perdue', tenantId: T, wabaId: 'waba-1', cas: 'a_poser' })]);
    expect(lignes[0]).not.toHaveProperty('texte');
    expect(JSON.stringify(lignes)).not.toContain('12 34 56 78');
  });

  it('une marque qui échoue ne fait pas taire l’alerte', async () => {
    const { d, alertes } = deps({ offre: 'pro', places: 1 });
    d.marquer = async () => { throw new Error('base indisponible'); };
    const { lignes } = await capturerJournal(() => connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null }));
    expect(alertes).toHaveLength(1);
    expect(lignes).toEqual([expect.objectContaining({ msg: 'marque_par_la_ligne_impossible', tenantId: T })]);
  });

  it('ne lève jamais : la connexion est faite, une alerte en panne ne la défait pas', async () => {
    const { d } = deps();
    d.alerter = async () => { throw new Error('Telegram indisponible'); };
    await expect(capturerJournal(() => connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null })).then((r) => r.resultat)).resolves.toBeUndefined();
  });
});

describe('la fenêtre du partenaire passée chez Meta, la connexion refusée chez nous (relecture du lot E, jaune 1)', () => {
  const COMPTE = '1815162959535129';

  it('🔴 Julien est alerté : le compte est peut-être déjà partagé avec le partenaire', async () => {
    const { d, alertes } = deps({ offre: 'pro', places: 1 });
    await fenetreRefuseeParLaLigne(d, T, { statut: 409, erreur: 'Ce compte WhatsApp appartient à un autre espace', wabaId: COMPTE });
    expect(alertes).toEqual([`Fenêtre du partenaire passée chez Meta, connexion REFUSÉE chez nous (409 : Ce compte WhatsApp appartient à un autre espace) : espace ${T}, compte ${COMPTE}. Le compte est peut-être déjà partagé avec le partenaire : lui demander de ne rien y attacher, et voir avec le client.`]);
  });

  it('🔴 le compte n’est cité que s’il est fait de chiffres : le corps le dit, rien ne le borne (relecture du lot E5, jaune 2)', async () => {
    for (const wabaId of [null, 'waba-x', '1'.repeat(33), `${COMPTE}\nAlerte forgée`]) {
      const { d, alertes } = deps();
      await fenetreRefuseeParLaLigne(d, T, { statut: 422, erreur: 'échange refusé', wabaId });
      expect(alertes, String(wabaId)).toEqual([expect.stringMatching(/: espace [^,]+, compte inconnu\. Le compte est peut-être/)]);
    }
  });

  it('🔴 une alerte de refus par espace et par demi-heure : un corps forgé ne la déclenche pas à volonté, et le refus retenu se journalise (relecture du lot E5, jaune 2)', async () => {
    let maintenant = 1_000_000;
    const { d, alertes } = deps({ maintenant: () => maintenant });
    const refus = { statut: 422, erreur: 'échange refusé', wabaId: COMPTE };
    await fenetreRefuseeParLaLigne(d, T, refus);
    const { lignes } = await capturerJournal(() => fenetreRefuseeParLaLigne(d, T, refus));
    expect(alertes).toHaveLength(1);
    expect(lignes).toEqual([expect.objectContaining({ lvl: 'warn', msg: 'alerte_fenetre_refusee_retenue', tenantId: T, statut: 422, wabaId: COMPTE })]);
    // Un autre espace a la sienne ; la demi-heure passée, l'espace aussi.
    await fenetreRefuseeParLaLigne(d, 'un-autre-espace', refus);
    expect(alertes).toHaveLength(2);
    maintenant += 30 * 60_000;
    await fenetreRefuseeParLaLigne(d, T, refus);
    expect(alertes).toHaveLength(3);
  });

  it('un verrou illisible n’éteint pas l’alerte : elle part, et le journal le dit', async () => {
    const { d, alertes } = deps();
    d.verrous = { prendre: async () => { throw new Error('base indisponible'); } };
    const { lignes } = await capturerJournal(() => fenetreRefuseeParLaLigne(d, T, { statut: 422, erreur: 'x', wabaId: null }));
    expect(alertes).toHaveLength(1);
    expect(lignes).toEqual([expect.objectContaining({ lvl: 'error', msg: 'alerte_fenetre_refusee_retenue_illisible', tenantId: T })]);
  });

  it('🔴 une connexion INTERROMPUE par une erreur chez nous a son texte : le compte est peut-être partagé et relié à moitié (relecture du lot E5, jaune 7)', async () => {
    const { d, alertes } = deps();
    await fenetreRefuseeParLaLigne(d, T, { statut: 500, erreur: 'erreur interne', wabaId: COMPTE });
    expect(alertes).toEqual([`Fenêtre du partenaire passée chez Meta, connexion INTERROMPUE chez nous par une erreur interne (voir les journaux de l’API) : espace ${T}, compte ${COMPTE}. Le compte est peut-être partagé avec le partenaire et relié à moitié : voir l’espace dans /ops avant toute pose, et lui demander de ne rien y attacher sans décision.`]);
  });

  it('ne lève jamais, et une alerte perdue laisse sa trace, par son cas', async () => {
    const { d } = deps({ alertePart: false });
    const { lignes } = await capturerJournal(() => fenetreRefuseeParLaLigne(d, T, { statut: 422, erreur: 'échange refusé', wabaId: COMPTE }));
    expect(lignes).toEqual([expect.objectContaining({ msg: 'alerte_fenetre_partenaire_perdue', tenantId: T, wabaId: COMPTE, cas: 'refusee' })]);
    const interrompue = deps({ alertePart: false });
    const r = await capturerJournal(() => fenetreRefuseeParLaLigne(interrompue.d, T, { statut: 500, erreur: 'erreur interne', wabaId: null }));
    expect(r.lignes).toEqual([expect.objectContaining({ msg: 'alerte_fenetre_partenaire_perdue', cas: 'interrompue', wabaId: null })]);
    const enPanne = deps();
    enPanne.d.alerter = async () => { throw new Error('Telegram indisponible'); };
    await expect(capturerJournal(() => fenetreRefuseeParLaLigne(enPanne.d, T, { statut: 422, erreur: 'x', wabaId: null })).then((r2) => r2.resultat)).resolves.toBeUndefined();
  });
});
