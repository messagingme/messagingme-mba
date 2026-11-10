import { describe, it, expect } from 'vitest';
import {
  connexionParLaLigne, droitALaLigne, fenetreRefuseeParLaLigne, solutionDuPartenaire, type DepsFenetrePartenaire,
} from '../src/credit-whatsapp/fenetre-partenaire';
import type { Offre } from '../src/offres/offres';
import type { IssueTelegram } from '../src/ops/telegram';
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
/** Le compte WhatsApp que la fin d'une fenêtre annonce, et celui des numéros rattachés par défaut. */
const COMPTE_DU_CORPS = '1815162959535129';

/** Un numéro rattaché : son identifiant seul (du compte du corps, hors coexistence), ou le détail. */
type Rattache = string | { phoneNumberId: string; wabaId?: string | null; coexistence?: boolean };

function deps(o: {
  offre?: Offre; places?: number | null; couverts?: string[];
  /** Les numéros rattachés à l'espace ; aucun par défaut. Un numéro marqué attend sa ligne, sauf marque éteinte. */
  rattaches?: Rattache[];
  /** Les numéros dont la marque, rejouée, garde un premier moment déjà éteint par une ligne posée depuis. */
  marqueEteinte?: string[];
  /** Les numéros que la marque ne trouve plus dans l'espace (`marquerParLaLigne` rend `false`). */
  marqueAbsente?: string[];
  /** Les numéros qui quittent l'espace une fois marqués (déconnectés entre la marque et la relecture). */
  partentApresMarque?: string[];
  solutionId?: string;
  /** L'issue de l'alerte chez Telegram : toujours, ou appel par appel (une liste consommée dans l'ordre). */
  alerte?: IssueTelegram | IssueTelegram[];
  /** La ligne qui couvre le numéro arrivé (`ligneDuNumero`), quelle que soit son origine ; aucune par défaut. */
  couvrante?: { tenantId: string; phoneNumberId?: string; arreteeLe?: string | null } | null;
  /** Les noms des espaces (`getTenantName`) ; inconnu par défaut. */
  noms?: Record<string, string>;
  maintenant?: () => number;
} = {}) {
  const alertes: string[] = [];
  const marques: string[] = [];
  const couvertures: string[] = [];
  const reponses = Array.isArray(o.alerte) ? [...o.alerte] : null;
  const d: DepsFenetrePartenaire = {
    solutionId: o.solutionId ?? SOLUTION,
    offre: async () => o.offre ?? 'pro',
    option: async () => (o.places === null ? null : { places: o.places ?? 1 }),
    numerosCouverts: async () => o.couverts ?? [],
    numerosRattaches: async () => (o.rattaches ?? []).map((r) => {
      const n = typeof r === 'string' ? { phoneNumberId: r } : r;
      return {
        phoneNumberId: n.phoneNumberId, wabaId: n.wabaId === undefined ? COMPTE_DU_CORPS : n.wabaId,
        coexistence: n.coexistence ?? false,
        attendLigne: marques.includes(n.phoneNumberId) && !(o.marqueEteinte ?? []).includes(n.phoneNumberId),
      };
    }).filter((n) => !(marques.includes(n.phoneNumberId) && (o.partentApresMarque ?? []).includes(n.phoneNumberId))),
    ligneDuNumero: async (phoneNumberId) => {
      couvertures.push(phoneNumberId);
      const c = o.couvrante ?? null;
      return c === null ? null : { tenantId: c.tenantId, phoneNumberId: c.phoneNumberId ?? 'pn-couvrant', arreteeLe: c.arreteeLe ?? null };
    },
    nomDeLEspace: async (tenantId) => o.noms?.[tenantId] ?? null,
    verrous: verrousEnMemoire(o.maintenant),
    marquer: async (_tenant, phoneNumberId) => {
      if ((o.marqueAbsente ?? []).includes(phoneNumberId)) return false;
      marques.push(phoneNumberId);
      return true;
    },
    alerter: async (texte) => {
      alertes.push(texte);
      return reponses !== null ? (reponses.shift() ?? 'recue') : ((o.alerte as IssueTelegram | undefined) ?? 'recue');
    },
  };
  return { d, alertes, marques, couvertures };
}

describe('le droit à la ligne', () => {
  it('🔴 une Entreprise toujours (illimitée, sans option) ; une formule Pro ou un Business avec une option et une place libre', async () => {
    expect(await droitALaLigne(deps({ offre: 'entreprise', places: null }).d, T)).toBe(true);
    expect(await droitALaLigne(deps({ offre: 'pro', places: 2, couverts: ['pn-a'] }).d, T)).toBe(true);
    expect(await droitALaLigne(deps({ offre: 'business', places: 1, couverts: [] }).d, T)).toBe(true);
  });

  it('🔴 jamais une Free, ni un Pro sans option, ni une option dont toutes les places sont prises', async () => {
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
    expect(await solutionDuPartenaire(deps({ offre: 'pro', places: 1, rattaches: ['pn-essai'] }).d, T)).toBeNull();
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
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: NUMERO, coexistence: false });
    expect(marques).toEqual(['pn-1']);
    expect(alertes).toEqual([
      `Numéro connecté par la ligne du partenaire : espace ${T}, ${NUMERO} (compte waba-1). Demander au partenaire d’attacher sa ligne de crédit à ce compte WhatsApp (elle ne s’attache pas d’elle-même), puis poser la ligne dans /ops quand il confirme l’attache, pas avant : Meta refuserait les envois, et un compte qui a déjà sa carte chez Meta paierait deux fois. D’ici là, le numéro attend dans la liste de /ops.`,
    ]);
  });

  it('🔴 un compte déjà sur une ligne active de l’espace, quelle qu’en soit l’origine (une ligne `ops` d’Entreprise comprise) : vérifier l’attache, et le numéro attend dans la liste jusque-là (relecture du lot E, jaune 9 ; du lot E5, jaune 5 ; du lot E7, jaune 6)', async () => {
    // « Déconnecter le numéro » ne retire pas la ligne : le numéro qui revient est couvert par son compte. Lue comme la pose
    // de `/ops` la lit (`ligneDuNumero`) : les seules lignes de l'option faisaient dire « poser » à une Entreprise, que
    // `/ops` refusait ensuite (« déjà couvert »).
    const { d, alertes, marques, couvertures } = deps({ offre: 'entreprise', places: null, couvrante: { tenantId: T, phoneNumberId: '106540352242999' } });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null, coexistence: false });
    expect(couvertures).toEqual(['pn-1']);
    // La ligne active ne prouve pas l'attache (relecture du lot E6, jaune 3) : le numéro est marqué, sans quoi rien ne
    // rappellerait de reposer la nôtre une fois retirée jusqu'à l'attache (relecture du lot E7, jaune 6).
    expect(alertes).toEqual([
      `Numéro connecté par la ligne du partenaire : espace ${T}, pn-1 (compte waba-1). Son compte WhatsApp est déjà sur la ligne de l’espace (numéro 106540352242999). Vérifier auprès du partenaire que sa ligne est attachée à ce compte : si oui, rien à poser, lever l’attente par « Ne pas poser » dans la liste de /ops ; sinon, retirer la nôtre dans /ops jusqu’à son attache, puis la reposer. D’ici là, le numéro attend dans la liste de /ops.`,
    ]);
    expect(marques).toEqual(['pn-1']);
  });

  it('🔴 un compte sur une ligne ARRÊTÉE de l’espace, citée par son numéro : vérifier l’attache d’abord, puis retirer et poser dans le même geste ; le numéro attend sa nouvelle ligne (relecture du lot E6, jaune 3 ; du lot E7, jaune 6)', async () => {
    // Avant, « déjà couvert » rassurait Julien alors que la garde refusait chaque envoi du numéro.
    const { d, alertes, marques } = deps({ offre: 'entreprise', places: null, couvrante: { tenantId: T, phoneNumberId: '106540352242999', arreteeLe: '2026-11-01T10:00:00.000Z' } });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null, coexistence: false });
    expect(alertes).toEqual([
      `Numéro connecté par la ligne du partenaire : espace ${T}, pn-1 (compte waba-1). Son compte WhatsApp est sur une ligne ARRÊTÉE de l’espace (numéro 106540352242999), et la garde refuse ses envois. Vérifier d’abord auprès du partenaire si sa ligne est encore attachée à ce compte : si oui, retirer la ligne arrêtée et poser la nouvelle dans le même geste ; sinon, la lui demander, puis faire les deux quand il confirme. D’ici là, le numéro attend dans la liste de /ops.`,
    ]);
    expect(marques).toEqual(['pn-1']);
  });

  it('🔴 un numéro connecté EN COEXISTENCE par la fenêtre : il garde l’application et ne passe pas sur la ligne, rien à poser ni à marquer (relecture du lot V2, jaune 6)', async () => {
    // La pose de `/ops` refuse un numéro en coexistence : marqué, il attendrait une ligne que personne ne posera.
    const { d, alertes, marques } = deps({ offre: 'entreprise', places: null });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: NUMERO, coexistence: true });
    expect(alertes).toEqual([
      `Numéro connecté par la fenêtre du partenaire EN COEXISTENCE (il garde l’application WhatsApp Business) : espace ${T}, ${NUMERO} (compte waba-1). Il ne passe pas sur la ligne, l’application envoie sans nous : rien à poser. Demander au partenaire de ne rien attacher à ce compte, et voir avec le client.`,
    ]);
    expect(marques).toEqual([]);
  });

  it('🔴 la coexistence ne remplace que « à poser » : sur la ligne d’un autre espace, une ligne arrêtée ou active, ou sans droit, l’alerte dit les deux, le numéro n’est jamais marqué, et l’alerte ne promet pas la liste (relecture du lot V5, jaune 3 ; du lot V6, jaune 1)', async () => {
    const PRECISION = 'Mais ce numéro est EN COEXISTENCE (il garde l’application WhatsApp Business) : la pose de /ops le refusera, ne rien poser sans voir avec le client ; il n’est pas dans la liste de /ops.';
    const AUTRE = '0b8b2a3e-1c4d-4e5f-8a9b-0c1d2e3f4a5b';
    const cas: Array<[string, Parameters<typeof deps>[0], string]> = [
      ['autre espace', { offre: 'entreprise', places: null, couvrante: { tenantId: AUTRE, phoneNumberId: '106540352242999' } }, 'Son compte WhatsApp est encore sur la ligne d’un AUTRE espace'],
      ['ligne arrêtée', { offre: 'entreprise', places: null, couvrante: { tenantId: T, phoneNumberId: '106540352242999', arreteeLe: '2026-11-01T10:00:00.000Z' } }, 'Son compte WhatsApp est sur une ligne ARRÊTÉE de l’espace'],
      ['ligne active', { offre: 'entreprise', places: null, couvrante: { tenantId: T, phoneNumberId: '106540352242999' } }, 'Son compte WhatsApp est déjà sur la ligne de l’espace'],
      ['sans droit', { offre: 'base' }, 'SANS droit à la ligne'],
    ];
    for (const [nom, o, motif] of cas) {
      const { d, alertes, marques } = deps(o);
      await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null, coexistence: true });
      expect(alertes[0], nom).toContain(motif);
      expect(alertes[0]?.endsWith(` ${PRECISION}`), nom).toBe(true);
      // Jamais marqué, donc jamais dans la liste : l'alerte ne le promet pas, ni « Ne pas poser » (relecture du lot V6, jaune 1).
      expect(alertes[0], nom).not.toContain('attend dans la liste');
      expect(alertes[0], nom).not.toContain('« Ne pas poser »');
      expect(marques, nom).toEqual([]);
    }
  });

  it('🔴 un compte encore sur la ligne d’un AUTRE espace, NOMMÉ avec le numéro de sa ligne : vérifier l’attache d’abord, puis retirer et poser dans le même geste ; le numéro attend sa ligne (relecture du lot E6, jaune 4)', async () => {
    const AUTRE = '0b8b2a3e-1c4d-4e5f-8a9b-0c1d2e3f4a5b';
    const { d, alertes, marques } = deps({
      offre: 'entreprise', places: null, couvrante: { tenantId: AUTRE, phoneNumberId: '106540352242999' }, noms: { [AUTRE]: 'Espace Dupont' },
    });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null, coexistence: false });
    expect(alertes).toEqual([
      `Numéro connecté par la ligne du partenaire : espace ${T}, pn-1 (compte waba-1). Son compte WhatsApp est encore sur la ligne d’un AUTRE espace (« Espace Dupont », numéro 106540352242999), et la garde refuse ses envois. Vérifier d’abord auprès du partenaire si sa ligne est encore attachée à ce compte : si oui, retirer cette ligne et poser celle de l’espace dans le même geste ; sinon, la lui demander, puis faire les deux quand il confirme.`,
    ]);
    expect(marques).toEqual(['pn-1']);
  });

  it('un autre espace sans nom lisible est cité par son identifiant : un nom inconnu ou une lecture en panne n’éteignent pas l’alerte', async () => {
    const AUTRE = '0b8b2a3e-1c4d-4e5f-8a9b-0c1d2e3f4a5b';
    const inconnu = deps({ offre: 'entreprise', places: null, couvrante: { tenantId: AUTRE, phoneNumberId: '106540352242999' } });
    await connexionParLaLigne(inconnu.d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null, coexistence: false });
    expect(inconnu.alertes[0]).toContain(`(espace ${AUTRE}, numéro 106540352242999)`);
    const enPanne = deps({ offre: 'entreprise', places: null, couvrante: { tenantId: AUTRE, phoneNumberId: '106540352242999' } });
    enPanne.d.nomDeLEspace = async () => { throw new Error('base indisponible'); };
    await capturerJournal(() => connexionParLaLigne(enPanne.d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null, coexistence: false }));
    expect(enPanne.alertes[0]).toContain(`(espace ${AUTRE}, numéro 106540352242999)`);
    expect(enPanne.marques).toEqual(['pn-1']);
  });

  it('🔴 un compte relié SANS numéro : demander l’attache, rien à poser, aucune marque ni lecture de couverture (relecture du lot E5, jaune 6)', async () => {
    const { d, alertes, marques, couvertures } = deps({ offre: 'entreprise', places: null });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: null, numero: null, coexistence: false });
    expect(alertes).toEqual([
      `Compte WhatsApp relié SANS numéro par la ligne du partenaire : espace ${T}, sans numéro (compte waba-1). Demander au partenaire d’attacher sa ligne de crédit à ce compte ; rien à poser dans /ops tant qu’aucun numéro n’y est connecté. Connecté par la fenêtre, le numéro enverra sa propre alerte ; connecté autrement, le poser à son arrivée, une fois l’attache confirmée.`,
    ]);
    expect(marques).toEqual([]);
    expect(couvertures).toEqual([]);
  });

  it('🔴 sans le droit (l’identifiant réutilisé hors de sa garde) : ne pas poser, et demander au partenaire de ne rien attacher ; aucune marque', async () => {
    // Le numéro vient d'arriver : le droit se relit SANS la condition « aucun numéro ».
    const { d, alertes, marques } = deps({ offre: 'base', rattaches: ['pn-1'] });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null, coexistence: false });
    expect(alertes[0]).toMatch(/^Numéro connecté par la fenêtre du partenaire SANS droit à la ligne : espace .* \(compte waba-1\)\. Ne pas poser la ligne ; demander au partenaire de ne rien attacher à ce compte, ou de détacher sa ligne ; voir avec le client\.$/);
    // 🔴 Une marque sans droit attendrait une ligne que personne ne posera, et se réveillerait si l'espace passe en Entreprise.
    expect(marques).toEqual([]);
  });

  it('🔴 la fenêtre fermée chez nous (variable vidée, page restée ouverte) : la fin alerte quand même, au lieu de se taire (relecture du lot E4, jaune 1) ; aucune marque, la décision est à Julien', async () => {
    const { d, alertes, marques } = deps({ offre: 'entreprise', places: null, solutionId: '' });
    await connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null, coexistence: false });
    expect(marques).toEqual([]);
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toMatch(/^Numéro connecté par la fenêtre du partenaire alors qu’elle est FERMÉE chez nous \(variable vide ou inscription éteinte\) : .*\(compte waba-1\)\. Vérifier chez Meta s’il est partagé avec le partenaire ; ne rien poser sans décision\.$/);
  });

  it('🔴 un droit ou une couverture illisible (la base) n’empêche pas l’alerte : Julien vérifie l’espace, et ne pose qu’après l’attache (relecture du lot E, jaune 3)', async () => {
    const { d, alertes, marques } = deps({ offre: 'entreprise', places: null });
    d.offre = async () => { throw new Error('base indisponible'); };
    const { lignes } = await capturerJournal(() => connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null, coexistence: false }));
    expect(alertes).toEqual([
      `Numéro connecté par la fenêtre du partenaire, droit ou couverture illisible : espace ${T}, pn-1 (compte waba-1). Vérifier l’espace dans /ops ; ne poser la ligne qu’après l’attache du partenaire.`,
    ]);
    expect(lignes).toEqual(expect.arrayContaining([expect.objectContaining({ msg: 'droit_a_la_ligne_illisible', tenantId: T })]));
    // Le droit n'est pas su : aucune marque, la décision est à Julien.
    expect(marques).toEqual([]);
    const couvertureIllisible = deps({ offre: 'entreprise', places: null });
    couvertureIllisible.d.ligneDuNumero = async () => { throw new Error('base indisponible'); };
    await capturerJournal(() => connexionParLaLigne(couvertureIllisible.d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null, coexistence: false }));
    expect(couvertureIllisible.alertes).toEqual([expect.stringMatching(/, droit ou couverture illisible : /)]);
    expect(couvertureIllisible.marques).toEqual([]);
  });

  it('🔴 une alerte qui ne part pas laisse une trace dans le journal, par son CAS et jamais par son texte : le numéro affiché n’y entre pas, comme dans l’audit (relecture du lot E, jaune 3 ; du lot E5, jaune 8)', async () => {
    const { d } = deps({ offre: 'pro', places: 1, alerte: 'non_recue' });
    const { lignes } = await capturerJournal(() => connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: NUMERO, coexistence: false }));
    expect(lignes).toEqual([expect.objectContaining({ lvl: 'error', msg: 'alerte_fenetre_partenaire_perdue', tenantId: T, wabaId: 'waba-1', cas: 'a_poser' })]);
    expect(lignes[0]).not.toHaveProperty('texte');
    expect(JSON.stringify(lignes)).not.toContain('12 34 56 78');
    // Un délai dépassé ne dit pas que l'alerte est perdue : elle a pu partir (relecture du lot E7, jaune 7).
    const incertaine = deps({ offre: 'pro', places: 1, alerte: 'incertaine' });
    const r = await capturerJournal(() => connexionParLaLigne(incertaine.d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: NUMERO, coexistence: false }));
    expect(r.lignes).toEqual([expect.objectContaining({ lvl: 'warn', msg: 'alerte_fenetre_partenaire_incertaine', tenantId: T, wabaId: 'waba-1', cas: 'a_poser' })]);
  });

  it('une marque qui échoue ne fait pas taire l’alerte', async () => {
    const { d, alertes } = deps({ offre: 'pro', places: 1 });
    d.marquer = async () => { throw new Error('base indisponible'); };
    const { lignes } = await capturerJournal(() => connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null, coexistence: false }));
    expect(alertes).toHaveLength(1);
    expect(lignes).toEqual([expect.objectContaining({ msg: 'marque_par_la_ligne_impossible', tenantId: T })]);
  });

  it('ne lève jamais : la connexion est faite, une alerte en panne ne la défait pas', async () => {
    const { d } = deps();
    d.alerter = async () => { throw new Error('Telegram indisponible'); };
    await expect(capturerJournal(() => connexionParLaLigne(d, T, { wabaId: 'waba-1', phoneNumberId: 'pn-1', numero: null, coexistence: false })).then((r) => r.resultat)).resolves.toBeUndefined();
  });
});


describe('la fenêtre du partenaire passée chez Meta, la connexion refusée ou interrompue chez nous (relecture du lot E, jaune 1)', () => {
  const COMPTE = '1815162959535129';
  const NUMERO_META = '106540352242922';
  const fin = (statut: number, wabaId: string | null = COMPTE, phoneNumberId: string | null = null) => ({ statut, wabaId, phoneNumberId });

  it('🔴 Julien est alerté par un libellé FIXE par statut, jamais par le message de Meta, qui peut reprendre le compte forgé du corps (relecture du lot E6, jaune 6)', async () => {
    const { d, alertes } = deps({ offre: 'pro', places: 1 });
    await fenetreRefuseeParLaLigne(d, T, fin(409));
    expect(alertes).toEqual([`Fenêtre du partenaire passée chez Meta, connexion REFUSÉE chez nous (409 : conflit, compte ou numéro rattaché à un autre espace, second numéro, plusieurs comptes ou numéros, ou numéro 360dialog) : espace ${T}, compte ${COMPTE}. Le compte est peut-être déjà partagé avec le partenaire : lui demander de ne rien y attacher, et voir avec le client. Le détail est dans les journaux de l’API.`]);
    const meta = deps();
    await fenetreRefuseeParLaLigne(meta.d, T, fin(422));
    expect(meta.alertes).toEqual([expect.stringContaining('(422 : refus de Meta, échange du code, preuve d’appartenance ou lecture du compte)')]);
    const autre = deps();
    await fenetreRefuseeParLaLigne(autre.d, T, fin(400));
    expect(autre.alertes).toEqual([expect.stringContaining('(400 : refus)')]);
  });

  it('🔴 le compte n’est cité que s’il est fait de chiffres : le corps le dit, rien ne le borne (relecture du lot E5, jaune 2)', async () => {
    for (const wabaId of [null, 'waba-x', '1'.repeat(33), `${COMPTE}\nAlerte forgée`]) {
      const { d, alertes } = deps();
      await fenetreRefuseeParLaLigne(d, T, fin(422, wabaId));
      expect(alertes, String(wabaId)).toEqual([expect.stringMatching(/: espace [^,]+, compte inconnu\. Le compte est peut-être/)]);
    }
  });

  it('🔴 une alerte de refus par espace et par demi-heure : un corps forgé ne la déclenche pas à volonté, et le refus retenu se journalise (relecture du lot E5, jaune 2)', async () => {
    let maintenant = 1_000_000;
    const { d, alertes } = deps({ maintenant: () => maintenant });
    await fenetreRefuseeParLaLigne(d, T, fin(422));
    const { lignes } = await capturerJournal(() => fenetreRefuseeParLaLigne(d, T, fin(422)));
    expect(alertes).toHaveLength(1);
    expect(lignes).toEqual([expect.objectContaining({ lvl: 'warn', msg: 'alerte_fenetre_refusee_retenue', tenantId: T, statut: 422, wabaId: COMPTE })]);
    // Un autre espace a la sienne ; la demi-heure passée, l'espace aussi.
    await fenetreRefuseeParLaLigne(d, 'un-autre-espace', fin(422));
    expect(alertes).toHaveLength(2);
    maintenant += 30 * 60_000;
    await fenetreRefuseeParLaLigne(d, T, fin(422));
    expect(alertes).toHaveLength(3);
  });

  it('🔴 un refus ne tait plus l’alerte d’une INTERRUPTION, seul signal d’un compte relié à moitié : chacune a sa retenue (relecture du lot E6, jaune 1)', async () => {
    const { d, alertes } = deps();
    await fenetreRefuseeParLaLigne(d, T, fin(422));
    await fenetreRefuseeParLaLigne(d, T, fin(500));
    expect(alertes).toHaveLength(2);
    expect(alertes[1]).toMatch(/connexion INTERROMPUE/);
    // Une seconde interruption dans la demi-heure est retenue, comme un second refus.
    await capturerJournal(() => fenetreRefuseeParLaLigne(d, T, fin(500)));
    expect(alertes).toHaveLength(2);
  });

  it('🔴 une alerte que Telegram n’a pas reçue rend sa retenue : la suivante part ; reçue, elle la garde (relecture du lot E6, jaune 1)', async () => {
    const { d, alertes } = deps({ alerte: ['non_recue', 'recue'] });
    await capturerJournal(() => fenetreRefuseeParLaLigne(d, T, fin(422)));
    await fenetreRefuseeParLaLigne(d, T, fin(422));
    expect(alertes).toHaveLength(2);
    await capturerJournal(() => fenetreRefuseeParLaLigne(d, T, fin(422)));
    expect(alertes).toHaveLength(2);
  });

  it('🔴 une alerte INCERTAINE (délai dépassé, panne réseau) garde sa retenue : elle a pu partir, la suivante serait un doublon (relecture du lot E7, jaune 7)', async () => {
    const { d, alertes } = deps({ alerte: ['incertaine', 'recue'] });
    const { lignes } = await capturerJournal(() => fenetreRefuseeParLaLigne(d, T, fin(422)));
    expect(lignes).toEqual(expect.arrayContaining([expect.objectContaining({ msg: 'alerte_fenetre_partenaire_incertaine', cas: 'refusee' })]));
    await capturerJournal(() => fenetreRefuseeParLaLigne(d, T, fin(422)));
    expect(alertes).toHaveLength(1);
  });

  it('un verrou illisible n’éteint pas l’alerte : elle part, et le journal le dit', async () => {
    const { d, alertes } = deps();
    d.verrous = { prendre: async () => { throw new Error('base indisponible'); }, relacher: async () => undefined };
    const { lignes } = await capturerJournal(() => fenetreRefuseeParLaLigne(d, T, fin(422, null)));
    expect(alertes).toHaveLength(1);
    expect(lignes).toEqual([expect.objectContaining({ lvl: 'error', msg: 'alerte_fenetre_refusee_retenue_illisible', tenantId: T })]);
  });

  it('🔴 une connexion INTERROMPUE a son texte, et le numéro du corps, rattaché à l’espace, est marqué selon les règles de la connexion ; l’alerte dit qu’il attend dans la liste (relecture du lot E5, jaune 7 ; du lot E6, jaune 1 ; du lot E7, jaune 4)', async () => {
    const { d, alertes, marques } = deps({ offre: 'entreprise', places: null, rattaches: [NUMERO_META] });
    await fenetreRefuseeParLaLigne(d, T, fin(500, COMPTE, NUMERO_META));
    expect(alertes).toEqual([`Fenêtre du partenaire passée chez Meta, connexion INTERROMPUE chez nous par une erreur interne (voir les journaux de l’API) : espace ${T}, compte ${COMPTE}. Le compte est peut-être partagé avec le partenaire et relié à moitié : voir l’espace dans /ops avant toute pose, et lui demander de ne rien y attacher sans décision. Son numéro ${NUMERO_META} est rattaché et attend sa ligne : il figure dans la liste « En attente de leur ligne ».`]);
    expect(marques).toEqual([NUMERO_META]);
    // Retenue, l'alerte ne part pas, mais la marque se pose quand même : elle dit l'état, pas l'alerte.
    const retenue = deps({ offre: 'entreprise', places: null, rattaches: [NUMERO_META] });
    await fenetreRefuseeParLaLigne(retenue.d, T, fin(500, COMPTE, null));
    await capturerJournal(() => fenetreRefuseeParLaLigne(retenue.d, T, fin(500, COMPTE, NUMERO_META)));
    expect(retenue.alertes).toHaveLength(1);
    expect(retenue.marques).toEqual([NUMERO_META, NUMERO_META]);
  });

  it('🔴 une interruption retrouve en base le numéro que la fenêtre n’a pas annoncé, seulement dans le compte du corps ; un numéro annoncé et pas rattaché, jamais un autre (relecture du lot E7, jaune 4 ; du lot V5, jaune 1)', async () => {
    const RATTACHE = '106540352242933';
    // Le corps ne dit rien du numéro : le seul numéro rattaché du compte du corps est celui de la connexion.
    const sansAnnonce = deps({ offre: 'entreprise', places: null, rattaches: [RATTACHE] });
    await fenetreRefuseeParLaLigne(sansAnnonce.d, T, fin(500, COMPTE, null));
    expect(sansAnnonce.marques).toEqual([RATTACHE]);
    expect(sansAnnonce.alertes[0]).toContain(`Son numéro ${RATTACHE} est rattaché et attend sa ligne : il figure dans la liste « En attente de leur ligne ».`);
    // Le corps en annonce un autre, pas rattaché : la connexion n'a rien rattaché (`linkTenant` refuse un second numéro),
    // le seul rattaché lui est étranger, jamais marqué.
    const autreAnnonce = deps({ offre: 'entreprise', places: null, rattaches: [RATTACHE] });
    await fenetreRefuseeParLaLigne(autreAnnonce.d, T, fin(500, COMPTE, NUMERO_META));
    expect(autreAnnonce.marques).toEqual([]);
    expect(autreAnnonce.alertes[0]).toMatch(/ Aucun numéro de cette connexion n’est rattaché : rien dans la liste « En attente de leur ligne »\.$/);
    // Sans annonce, un numéro d'un AUTRE compte n'est pas celui de la connexion ; deux du compte, on ne devine pas.
    const autreCompte = deps({ offre: 'entreprise', places: null, rattaches: [{ phoneNumberId: RATTACHE, wabaId: '999' }] });
    await fenetreRefuseeParLaLigne(autreCompte.d, T, fin(500, COMPTE, null));
    expect(autreCompte.marques).toEqual([]);
    const plusieurs = deps({ offre: 'entreprise', places: null, rattaches: [RATTACHE, '106540352242944'] });
    await fenetreRefuseeParLaLigne(plusieurs.d, T, fin(500, COMPTE, null));
    expect(plusieurs.marques).toEqual([]);
    // Ni numéro ni compte annoncés : le seul rattaché de l'espace.
    const rien = deps({ offre: 'entreprise', places: null, rattaches: [{ phoneNumberId: RATTACHE, wabaId: '999' }] });
    await fenetreRefuseeParLaLigne(rien.d, T, fin(500, null, null));
    expect(rien.marques).toEqual([RATTACHE]);
  });

  it('🔴 l’alerte d’une interruption dit ce qu’elle sait de la liste : rattaché sans ligne à poser, en coexistence, marque éteinte, lecture ou marque en panne (relecture du lot V5, jaunes 4 et 7)', async () => {
    const liste = (alerte: string | undefined) => (alerte ?? '').slice((alerte ?? '').indexOf('sans décision. ') + 'sans décision. '.length);
    const sansDroit = deps({ offre: 'base', rattaches: [NUMERO_META] });
    await fenetreRefuseeParLaLigne(sansDroit.d, T, fin(500, COMPTE, NUMERO_META));
    expect(sansDroit.marques).toEqual([]);
    expect(liste(sansDroit.alertes[0])).toBe(`Son numéro ${NUMERO_META} est rattaché, sans ligne à poser : il n’est pas dans la liste « En attente de leur ligne ».`);
    // Une connexion en coexistence interrompue après le rattachement : la pose la refuserait, aucune marque.
    const coexistence = deps({ offre: 'entreprise', places: null, rattaches: [{ phoneNumberId: NUMERO_META, coexistence: true }] });
    await fenetreRefuseeParLaLigne(coexistence.d, T, fin(500, COMPTE, NUMERO_META));
    expect(coexistence.marques).toEqual([]);
    expect(liste(coexistence.alertes[0])).toBe(`Son numéro ${NUMERO_META} est rattaché EN COEXISTENCE (il garde l’application) : il ne passe pas sur la ligne, et n’est pas dans la liste « En attente de leur ligne ».`);
    // Rejouée, la marque garde son premier moment, déjà éteint par une ligne posée depuis : le numéro n'attend pas.
    // Le texte ne choisit pas la cause : une ligne posée depuis la première marque, ou l'attente levée (relecture du lot V6, jaune 4).
    const eteinte = deps({ offre: 'entreprise', places: null, rattaches: [NUMERO_META], marqueEteinte: [NUMERO_META] });
    await fenetreRefuseeParLaLigne(eteinte.d, T, fin(500, COMPTE, NUMERO_META));
    expect(liste(eteinte.alertes[0])).toBe(`Son numéro ${NUMERO_META} est rattaché et marqué, mais il n’attend pas sa ligne (une ligne posée depuis sa première marque, ou son attente levée) : il n’est pas dans la liste « En attente de leur ligne », voir l’espace dans /ops.`);
    // Un numéro que la marque ne trouve plus, ou qui a quitté l'espace avant la relecture : aucun numéro de cette connexion.
    const aucun = 'Aucun numéro de cette connexion n’est rattaché : rien dans la liste « En attente de leur ligne ».';
    const absent = deps({ offre: 'entreprise', places: null, rattaches: [NUMERO_META], marqueAbsente: [NUMERO_META] });
    await fenetreRefuseeParLaLigne(absent.d, T, fin(500, COMPTE, NUMERO_META));
    expect(liste(absent.alertes[0])).toBe(aucun);
    const parti = deps({ offre: 'entreprise', places: null, rattaches: [NUMERO_META], partentApresMarque: [NUMERO_META] });
    await fenetreRefuseeParLaLigne(parti.d, T, fin(500, COMPTE, NUMERO_META));
    expect(liste(parti.alertes[0])).toBe(aucun);
    // Une lecture ou une marque en panne : l'alerte ne prétend rien.
    const illisible = 'Le numéro de cette connexion n’a pas pu se lire ou se marquer (voir les journaux de l’API) : vérifier la liste « En attente de leur ligne » dans /ops.';
    const lecture = deps({ offre: 'entreprise', places: null, rattaches: [NUMERO_META] });
    lecture.d.numerosRattaches = async () => { throw new Error('base indisponible'); };
    await capturerJournal(() => fenetreRefuseeParLaLigne(lecture.d, T, fin(500, COMPTE, NUMERO_META)));
    expect(liste(lecture.alertes[0])).toBe(illisible);
    const marque = deps({ offre: 'entreprise', places: null, rattaches: [NUMERO_META] });
    marque.d.marquer = async () => { throw new Error('base indisponible'); };
    await capturerJournal(() => fenetreRefuseeParLaLigne(marque.d, T, fin(500, COMPTE, NUMERO_META)));
    expect(liste(marque.alertes[0])).toBe(illisible);
  });

  it('🔴 la marque après une interruption suit les règles : jamais un numéro mal formé, ni sans droit, ni après un simple refus ; un compte déjà sur une ligne active de l’espace attend la vérification de l’attache (relecture du lot E7, jaune 6)', async () => {
    for (const phoneNumberId of [null, 'pn-x', `${NUMERO_META}\n`]) {
      const { d, marques } = deps({ offre: 'entreprise', places: null });
      await fenetreRefuseeParLaLigne(d, T, fin(500, COMPTE, phoneNumberId));
      expect(marques, String(phoneNumberId)).toEqual([]);
    }
    // Une annonce REJETÉE (mal formée) n'est pas une annonce absente : elle n'a rien pu rattacher, et ne retombe pas sur le
    // seul rattaché du compte ; un compte rejeté ne retombe pas sur tout l'espace (relecture du lot V6, jaune 2).
    const RATTACHE = '106540352242933';
    for (const [numero, compte] of [['pn-x', COMPTE], [`${NUMERO_META}\n`, COMPTE], [null, 'waba-x']] as const) {
      const { d, alertes, marques } = deps({ offre: 'entreprise', places: null, rattaches: [{ phoneNumberId: RATTACHE, wabaId: compte }] });
      await fenetreRefuseeParLaLigne(d, T, fin(500, compte, numero));
      expect(marques, `${String(numero)} ${compte}`).toEqual([]);
      expect(alertes[0], `${String(numero)} ${compte}`).toMatch(/ Aucun numéro de cette connexion n’est rattaché : rien dans la liste « En attente de leur ligne »\.$/);
    }
    const sansDroit = deps({ offre: 'base', rattaches: [NUMERO_META] });
    await fenetreRefuseeParLaLigne(sansDroit.d, T, fin(500, COMPTE, NUMERO_META));
    expect(sansDroit.marques).toEqual([]);
    const couvert = deps({ offre: 'entreprise', places: null, rattaches: [NUMERO_META], couvrante: { tenantId: T } });
    await fenetreRefuseeParLaLigne(couvert.d, T, fin(500, COMPTE, NUMERO_META));
    expect(couvert.marques).toEqual([NUMERO_META]);
    const refuse = deps({ offre: 'entreprise', places: null, rattaches: [NUMERO_META] });
    await fenetreRefuseeParLaLigne(refuse.d, T, fin(409, COMPTE, NUMERO_META));
    expect(refuse.marques).toEqual([]);
  });

  it('ne lève jamais, et une alerte perdue laisse sa trace, par son cas', async () => {
    const { d } = deps({ alerte: 'non_recue' });
    const { lignes } = await capturerJournal(() => fenetreRefuseeParLaLigne(d, T, fin(422)));
    expect(lignes).toEqual([expect.objectContaining({ msg: 'alerte_fenetre_partenaire_perdue', tenantId: T, wabaId: COMPTE, cas: 'refusee' })]);
    const interrompue = deps({ alerte: 'non_recue' });
    const r = await capturerJournal(() => fenetreRefuseeParLaLigne(interrompue.d, T, fin(500, null)));
    expect(r.lignes).toEqual([expect.objectContaining({ msg: 'alerte_fenetre_partenaire_perdue', cas: 'interrompue', wabaId: null })]);
    const enPanne = deps();
    enPanne.d.alerter = async () => { throw new Error('Telegram indisponible'); };
    enPanne.d.marquer = async () => { throw new Error('base indisponible'); };
    await expect(capturerJournal(() => fenetreRefuseeParLaLigne(enPanne.d, T, fin(500, null, NUMERO_META))).then((r2) => r2.resultat)).resolves.toBeUndefined();
  });
});
