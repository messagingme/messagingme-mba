import type { Offre } from '../offres/offres';
import type { VerrousCourts } from '../db/verrous-courts';
import { journaliser } from '../lib/journal';

/**
 * LA FENÊTRE DU PARTENAIRE (lot E du Crédit WhatsApp, plan `2026-11-09-credit-whatsapp-fenetre-du-partenaire.md`) : la
 * fenêtre de Meta ouverte avec la solution multi-partenaires du partenaire (`extras.setup.solutionID`). Le compte WhatsApp
 * qu'elle connecte est partagé avec le partenaire, qui y branche sa ligne de crédit ; seule notre application envoie.
 *
 * 🔴 L'identifiant de la solution ne part qu'à un espace qui a droit à la ligne : sinon la ligne du partenaire paierait
 * les messages d'un espace qui ne l'a pas payée. Le droit se lit sur l'offre et l'option, jamais sur Stripe ni sur le
 * solde (décision de Julien) : une Entreprise est illimitée, sans option ; une formule Pro ou un Business prend l'option ;
 * une Free jamais. Le partenaire n'est jamais nommé dans le dépôt.
 *
 * Mesuré à l'essai réel 236 (2026-11-09) : le compte est bien partagé avec le partenaire, mais sa ligne ne s'attache PAS
 * d'elle-même ; Julien la lui demande, et l'alerte le lui dit.
 */
export interface DepsFenetrePartenaire {
  /**
   * `META_SOLUTION_ID` : l'identifiant de la solution. Vide, la fenêtre du partenaire est fermée à tous ; le câblage la
   * vide aussi quand l'inscription n'est pas configurée (sinon la carte se dirait ouverte sur un bouton grisé).
   */
  solutionId: string;
  /** L'offre de l'espace, relue SANS cache. */
  offre(tenantId: string): Promise<Offre>;
  /** L'option vivante de l'espace et ses places payées ; `null` sans option. */
  option(tenantId: string): Promise<{ places: number } | null>;
  /**
   * Les numéros (leurs identifiants) que ses lignes `'option'` couvrent déjà : une place libre se lit contre eux. La
   * liste, et non un compte : la fin d'une connexion écarte le numéro qui vient d'arriver.
   */
  numerosCouverts(tenantId: string): Promise<string[]>;
  /**
   * Les numéros RATTACHÉS à l'espace, déliés compris : comme `hasNumber` (la console le dit connecté) et `linkTenant`
   * (qui refuse un second numéro). Un numéro déjà là relève du lot D, pas de cette fenêtre.
   */
  numerosRattaches(tenantId: string): Promise<number>;
  /**
   * La ligne en cours qui couvre le numéro (la sienne ou celle de son compte WhatsApp), quels que soient son origine
   * (`ops` comprise) et son espace : `ligneDuNumero`, la lecture même de la pose de `/ops`. « Déjà couvert » se lit ici
   * (relecture du lot E5, jaune 5) : les seules lignes de l'option faisaient dire « poser » à une Entreprise que `/ops`
   * refusait ensuite.
   */
  ligneDuNumero(phoneNumberId: string): Promise<{ tenantId: string } | null>;
  /**
   * Les verrous courts partagés par les copies de l'API : une alerte de refus par espace et par demi-heure, quelle que
   * soit la copie qui sert chaque fin (relecture du lot E5, jaune 2).
   */
  verrous: Pick<VerrousCourts, 'prendre'>;
  /**
   * Marque le numéro arrivé par la fenêtre (`marquerParLaLigne`) : la trace en base de la connexion, et ce qui fait
   * attendre sa ligne à une Entreprise (relecture du lot E, jaunes 3 et 4).
   */
  marquer(tenantId: string, phoneNumberId: string): Promise<void>;
  /** L'alerte à Julien ; `true` seulement si Telegram l'a reçue. Une alerte perdue se journalise (jaune 3). */
  alerter(texte: string): Promise<boolean>;
}

/**
 * Une alerte de refus par espace et par demi-heure : la fin d'une connexion vient du navigateur, et un corps forgé
 * (`parLaLigne: true`, un code bidon) la déclencherait à volonté (relecture du lot E5, jaune 2). Le refus retenu se
 * journalise.
 */
export const RETENUE_ALERTE_REFUS_MS = 30 * 60_000;

/**
 * Ce que dit chaque alerte. Une alerte perdue se journalise par son cas, JAMAIS par son texte : il porte le numéro
 * affiché, que l'audit refuse lui aussi de garder (relecture du lot E5, jaune 8).
 */
type CasAlerte =
  | 'fermee' | 'sans_droit' | 'sans_numero' | 'deja_couvert' | 'autre_espace' | 'a_poser' | 'illisible'
  | 'refusee' | 'interrompue';

/** Les cas où une ligne est à poser : le numéro est marqué, il attend sa ligne (l'Entreprise le lit, `/ops` le liste). */
const CAS_QUI_ATTENDENT: ReadonlySet<CasAlerte> = new Set(['a_poser', 'autre_espace']);

/**
 * L'espace a-t-il droit à la ligne du partenaire ? Une Entreprise, toujours ; une formule Pro ou un Business, avec une
 * option vivante dont une place est libre (un essai n'a pas d'option) ; jamais une Free. `sauf` : un numéro à ne pas
 * compter parmi les couverts (celui qui vient d'arriver ne prend pas sa propre place).
 */
export async function droitALaLigne(
  d: Pick<DepsFenetrePartenaire, 'offre' | 'option' | 'numerosCouverts'>, tenantId: string, sauf: string | null = null,
): Promise<boolean> {
  const offre = await d.offre(tenantId);
  if (offre === 'entreprise') return true;
  if (offre !== 'pro' && offre !== 'business') return false;
  const option = await d.option(tenantId);
  if (option === null) return false;
  const couverts = (await d.numerosCouverts(tenantId)).filter((id) => id !== sauf);
  return option.places > couverts.length;
}

/**
 * L'identifiant de la solution, pour la fenêtre de Meta : seulement à un espace qui a droit à la ligne ET n'a encore aucun
 * numéro rattaché (un numéro de l'essai passe sur la ligne par le lot D). `null` sinon, et pour tous si rien n'est
 * configuré. Une règle qui ne se lit pas (la base) ferme la fenêtre, journalisée : la configuration de la connexion et
 * l'état des cartes restent servis, et la connexion directe avec eux.
 */
export async function solutionDuPartenaire(d: DepsFenetrePartenaire, tenantId: string): Promise<string | null> {
  if (d.solutionId === '') return null;
  try {
    if ((await d.numerosRattaches(tenantId)) > 0) return null;
    return (await droitALaLigne(d, tenantId)) ? d.solutionId : null;
  } catch (err) {
    journaliser('error', 'fenetre_partenaire_illisible', { tenantId, err });
    return null;
  }
}

/** L'alerte à Julien, journalisée par son cas si elle ne part pas (Telegram absent, en panne, ou en délai). */
async function alerterSansPerte(
  d: Pick<DepsFenetrePartenaire, 'alerter'>, tenantId: string, wabaId: string | null, cas: CasAlerte, texte: string,
): Promise<void> {
  try {
    if (!(await d.alerter(texte))) journaliser('error', 'alerte_fenetre_partenaire_perdue', { tenantId, wabaId, cas });
  } catch (err) {
    journaliser('error', 'alerte_fenetre_partenaire_perdue', { tenantId, wabaId, cas, err });
  }
}

/**
 * Ce que l'alerte d'une connexion par la fenêtre dit, et son cas. 🔴 La ligne se pose APRÈS l'attache du partenaire
 * (décision de Julien du 2026-11-09, relecture du lot E5, jaune 1) : posée avant, la carte dirait « payés par votre Crédit
 * WhatsApp » pendant que Meta refuse les envois, et un compte qui a déjà sa carte chez Meta paierait deux fois.
 */
async function alerteDeConnexion(
  d: DepsFenetrePartenaire, tenantId: string, n: { wabaId: string; phoneNumberId: string | null }, qui: string,
): Promise<{ cas: CasAlerte; texte: string }> {
  if (d.solutionId === '') {
    return { cas: 'fermee', texte: `Numéro connecté par la fenêtre du partenaire alors qu’elle est FERMÉE chez nous (variable vide ou inscription éteinte) : ${qui}. Vérifier chez Meta s’il est partagé avec le partenaire ; ne rien poser sans décision.` };
  }
  try {
    if (!(await droitALaLigne(d, tenantId, n.phoneNumberId))) {
      return { cas: 'sans_droit', texte: `Numéro connecté par la fenêtre du partenaire SANS droit à la ligne : ${qui}. Ne pas poser la ligne ; demander au partenaire de ne rien attacher à ce compte, ou de détacher sa ligne ; voir avec le client.` };
    }
    // Un compte sans numéro : rien à poser dans `/ops`, qui pose un numéro (relecture du lot E5, jaune 6). Le numéro
    // connecté ensuite par la fenêtre a sa propre alerte, et sa marque.
    if (n.phoneNumberId === null) {
      return { cas: 'sans_numero', texte: `Compte WhatsApp relié SANS numéro par la ligne du partenaire : ${qui}. Demander au partenaire d’attacher sa ligne de crédit à ce compte ; rien à poser dans /ops tant qu’aucun numéro n’y est connecté. Connecté par la fenêtre, le numéro enverra sa propre alerte ; connecté autrement, le poser à son arrivée, une fois l’attache confirmée.` };
    }
    const couvrante = await d.ligneDuNumero(n.phoneNumberId);
    if (couvrante === null) {
      return { cas: 'a_poser', texte: `Numéro connecté par la ligne du partenaire : ${qui}. Demander au partenaire d’attacher sa ligne de crédit à ce compte WhatsApp (elle ne s’attache pas d’elle-même), puis poser la ligne dans /ops quand il confirme l’attache, pas avant : Meta refuserait les envois, et un compte qui a déjà sa carte chez Meta paierait deux fois. D’ici là, le numéro attend dans la liste de /ops.` };
    }
    if (couvrante.tenantId === tenantId) {
      return { cas: 'deja_couvert', texte: `Numéro connecté par la ligne du partenaire : ${qui}. Son compte WhatsApp est déjà sur la ligne de l’espace : rien à poser dans /ops ; vérifier que le partenaire a attaché sa ligne à ce compte.` };
    }
    return { cas: 'autre_espace', texte: `Numéro connecté par la ligne du partenaire : ${qui}. Son compte WhatsApp est encore sur la ligne d’un AUTRE espace, et la garde refuse ses envois : retirer cette ligne dans /ops, demander au partenaire d’attacher sa ligne à ce compte, puis poser celle de l’espace quand il confirme l’attache.` };
  } catch (err) {
    journaliser('error', 'droit_a_la_ligne_illisible', { tenantId, wabaId: n.wabaId, err });
    return { cas: 'illisible', texte: `Numéro connecté par la fenêtre du partenaire, droit ou couverture illisible : ${qui}. Vérifier l’espace dans /ops ; ne poser la ligne qu’après l’attache du partenaire.` };
  }
}

/**
 * Un numéro vient d'être connecté par la fenêtre du partenaire : Julien est alerté des gestes à faire, dans l'ordre. La
 * ligne du partenaire ne s'attache pas d'elle-même (essai 236) : la lui demander, puis poser la nôtre quand il confirme
 * l'attache. Le droit se relit SANS la condition « aucun numéro », et sans compter le numéro qui vient d'arriver ; sans
 * lui (l'identifiant réutilisé hors de sa garde), ne rien poser. Variable vide (fenêtre fermée chez nous, une page restée
 * ouverte), l'alerte le dit au lieu de se taire.
 *
 * 🔴 Le numéro n'est marqué (« il attend sa ligne ») QUE quand une ligne est à poser : une marque posée sans droit,
 * fenêtre fermée, compte déjà couvert ou droit illisible attendrait une ligne que personne ne posera, et l'Entreprise ne
 * lirait plus le conseil de sa carte chez Meta (le rouge de la relecture du lot E5). L'audit `numero.connecte` garde,
 * lui, toute connexion par la fenêtre. Ne lève jamais : la connexion est faite.
 */
export async function connexionParLaLigne(
  d: DepsFenetrePartenaire, tenantId: string, n: { wabaId: string; phoneNumberId: string | null; numero: string | null },
): Promise<void> {
  const qui = `espace ${tenantId}, ${n.numero ?? n.phoneNumberId ?? 'sans numéro'} (compte ${n.wabaId})`;
  const { cas, texte } = await alerteDeConnexion(d, tenantId, n, qui);
  // La marque d'abord, l'alerte ensuite : une alerte perdue laisse la trace ; une marque ratée n'empêche pas l'alerte.
  if (CAS_QUI_ATTENDENT.has(cas) && n.phoneNumberId !== null) {
    try {
      await d.marquer(tenantId, n.phoneNumberId);
    } catch (err) {
      journaliser('error', 'marque_par_la_ligne_impossible', { tenantId, phoneNumberId: n.phoneNumberId, err });
    }
  }
  await alerterSansPerte(d, tenantId, n.wabaId, cas, texte);
}

/**
 * La fenêtre du partenaire a fini chez Meta, mais notre serveur a refusé la connexion (compte d'un autre espace, second
 * numéro, échange ou preuve refusés), ou l'a interrompue par une erreur (`statut` 500, relecture du lot E5, jaune 7) : le
 * compte est peut-être déjà partagé avec le partenaire, et rien ne le dirait (relecture du lot E, jaune 1). Une alerte par
 * espace et par demi-heure, le compte cité seulement s'il a la forme d'un identifiant de Meta : la fin vient du
 * navigateur (relecture du lot E5, jaune 2). Ne lève jamais : la réponse d'erreur part de toute façon.
 */
export async function fenetreRefuseeParLaLigne(
  d: Pick<DepsFenetrePartenaire, 'alerter' | 'verrous'>, tenantId: string, i: { statut: number; erreur: string; wabaId: string | null },
): Promise<void> {
  const wabaId = i.wabaId !== null && /^\d{1,32}$/.test(i.wabaId) ? i.wabaId : null;
  try {
    if ((await d.verrous.prendre([[`fenetre-partenaire.refus:${tenantId}`, RETENUE_ALERTE_REFUS_MS]])) === null) {
      journaliser('warn', 'alerte_fenetre_refusee_retenue', { tenantId, statut: i.statut, wabaId });
      return;
    }
  } catch (err) {
    // La retenue illisible (la base) n'éteint pas l'alerte : mieux vaut deux alertes qu'aucune.
    journaliser('error', 'alerte_fenetre_refusee_retenue_illisible', { tenantId, err });
  }
  const compte = `espace ${tenantId}, compte ${wabaId ?? 'inconnu'}`;
  if (i.statut >= 500) {
    await alerterSansPerte(d, tenantId, wabaId, 'interrompue',
      `Fenêtre du partenaire passée chez Meta, connexion INTERROMPUE chez nous par une erreur interne (voir les journaux de l’API) : ${compte}. Le compte est peut-être partagé avec le partenaire et relié à moitié : voir l’espace dans /ops avant toute pose, et lui demander de ne rien y attacher sans décision.`);
    return;
  }
  await alerterSansPerte(d, tenantId, wabaId, 'refusee',
    `Fenêtre du partenaire passée chez Meta, connexion REFUSÉE chez nous (${i.statut} : ${i.erreur}) : ${compte}. Le compte est peut-être déjà partagé avec le partenaire : lui demander de ne rien y attacher, et voir avec le client.`);
}
