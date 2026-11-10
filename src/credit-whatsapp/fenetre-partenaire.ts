import type { Offre } from '../offres/offres';
import type { Prise, VerrousCourts } from '../db/verrous-courts';
import type { IssueTelegram } from '../ops/telegram';
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
   * Les numéros RATTACHÉS à l'espace, déliés compris : comme `hasNumber` (la console le dit connecté) et `linkTenant` (qui
   * refuse un second numéro). Un numéro déjà là relève du lot D, pas de cette fenêtre ; une connexion interrompue y
   * retrouve celui qu'elle a pu rattacher, dans le compte du corps, et l'alerte dit ce qu'en sait la liste (relecture du
   * lot E7, jaune 4 ; du lot V5, jaunes 1, 4 et 7).
   */
  numerosRattaches(tenantId: string): Promise<NumeroRattache[]>;
  /**
   * La ligne en cours qui couvre le numéro (la sienne ou celle de son compte WhatsApp), quels que soient son origine
   * (`ops` comprise) et son espace : `ligneDuNumero`, la lecture même de la pose de `/ops`. « Déjà couvert » se lit ici
   * (relecture du lot E5, jaune 5) : les seules lignes de l'option faisaient dire « poser » à une Entreprise que `/ops`
   * refusait ensuite.
   */
  ligneDuNumero(phoneNumberId: string): Promise<LigneCouvrante | null>;
  /**
   * Le nom d'un espace (`getTenantName` du magasin de `/ops`), pour que l'alerte nomme celui dont la ligne couvre encore
   * le compte (relecture du lot E6, jaune 4) ; `null` s'il n'est pas connu.
   */
  nomDeLEspace(tenantId: string): Promise<string | null>;
  /**
   * Les verrous courts partagés par les copies de l'API : une alerte de refus, et une d'interruption, par espace et par
   * demi-heure, quelle que soit la copie qui sert chaque fin (relecture du lot E5, jaune 2 ; du lot E6, jaune 1). Une
   * alerte que Telegram n'a pas reçue rend la sienne.
   */
  verrous: Pick<VerrousCourts, 'prendre' | 'relacher'>;
  /**
   * Marque le numéro arrivé par la fenêtre (`marquerParLaLigne`) : la trace en base de la connexion, et ce qui fait
   * attendre sa ligne à une Entreprise (relecture du lot E, jaunes 3 et 4). `false` : le numéro n'est pas, ou plus, de
   * l'espace, rien n'est marqué (relecture du lot V6, jaune 4).
   */
  marquer(tenantId: string, phoneNumberId: string): Promise<boolean>;
  /**
   * L'alerte à Julien, et son issue chez Telegram (`envoyerTelegram`) : une alerte perdue se journalise (jaune 3) ; une
   * alerte incertaine (délai dépassé, coupure en cours) a pu partir, et garde sa retenue (relecture du lot E7, jaune 7).
   */
  alerter(texte: string): Promise<IssueTelegram>;
}

/**
 * Un numéro rattaché à l'espace, tel que la fenêtre le lit (`NumeroDeLEspace` en a tous les champs) : son compte, sa
 * coexistence (la pose la refuse), et s'il attend sa ligne (`ATTEND_LIGNE_SQL`, la liste de `/ops`).
 */
export interface NumeroRattache {
  phoneNumberId: string;
  wabaId: string | null;
  coexistence: boolean;
  attendLigne: boolean;
}

/** La ligne en cours qui couvre un numéro, telle que l'alerte la lit (`LigneCredit` en a tous les champs). */
export interface LigneCouvrante {
  tenantId: string;
  /** Le numéro de la ligne : celui qui arrive, ou un autre de son compte WhatsApp. */
  phoneNumberId: string;
  /** Arrêtée (l'option a pris fin) : la garde refuse les envois de tout le compte. */
  arreteeLe: string | null;
}

/**
 * Une alerte de refus, et une d'interruption, par espace et par demi-heure : la fin d'une connexion vient du navigateur,
 * et un corps forgé (`parLaLigne: true`, un code bidon) la déclencherait à volonté (relecture du lot E5, jaune 2). Deux
 * retenues distinctes : un refus, forgé ou non, ne tait pas l'interruption, seul signal d'un compte relié à moitié
 * (relecture du lot E6, jaune 1). Le refus retenu se journalise.
 */
export const RETENUE_ALERTE_REFUS_MS = 30 * 60_000;

/** Ce que dit un refus, par statut : un libellé FIXE, jamais le message de Meta, qui peut reprendre le compte du corps. */
const CAUSE_DU_REFUS: Readonly<Record<number, string>> = {
  409: 'conflit, compte ou numéro rattaché à un autre espace, second numéro, plusieurs comptes ou numéros, ou numéro 360dialog',
  422: 'refus de Meta, échange du code, preuve d’appartenance ou lecture du compte',
};

/** Un identifiant de Meta (compte ou numéro) tel que le corps le dit : cité ou marqué seulement s'il en a la forme. */
const ID_META = /^\d{1,32}$/;

/**
 * Ce que dit chaque alerte. Une alerte perdue se journalise par son cas, JAMAIS par son texte : il porte le numéro
 * affiché, que l'audit refuse lui aussi de garder (relecture du lot E5, jaune 8).
 */
type CasAlerte =
  | 'fermee' | 'sans_droit' | 'sans_numero' | 'coexistence' | 'deja_couvert' | 'couvert_arrete' | 'autre_espace' | 'a_poser'
  | 'illisible' | 'refusee' | 'interrompue';

/**
 * Les cas où le numéro attend sa ligne, marqué : une ligne est à poser, ou celle de l'espace attend la vérification de
 * l'attache du partenaire (`deja_couvert`, relecture du lot E7, jaune 6 : sans marque, rien ne rappelait de reposer la
 * nôtre une fois retirée). L'Entreprise le lit, `/ops` le liste.
 */
const CAS_QUI_ATTENDENT: ReadonlySet<CasAlerte> = new Set(['a_poser', 'deja_couvert', 'couvert_arrete', 'autre_espace']);

/**
 * L'espace a-t-il droit à la ligne du partenaire ? Une Entreprise, toujours ; une formule Pro (essai compris, depuis V1
 * du 2026-11-10) ou un Business, avec une option vivante dont une place est libre ; jamais une Free. `sauf` : un numéro à
 * ne pas compter parmi les couverts (celui qui vient d'arriver ne prend pas sa propre place).
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
    if ((await d.numerosRattaches(tenantId)).length > 0) return null;
    return (await droitALaLigne(d, tenantId)) ? d.solutionId : null;
  } catch (err) {
    journaliser('error', 'fenetre_partenaire_illisible', { tenantId, err });
    return null;
  }
}

/**
 * L'alerte à Julien, journalisée par son cas quand elle ne part pas (Telegram absent, qui la refuse, ou une connexion
 * jamais établie : perdue) ou qu'elle a pu partir sans que Telegram le confirme (délai dépassé, coupure en cours :
 * incertaine, relecture du lot E7, jaune 7). Une alerte qui lève compte pour perdue. Rend son issue.
 */
async function alerterSansPerte(
  d: Pick<DepsFenetrePartenaire, 'alerter'>, tenantId: string, wabaId: string | null, cas: CasAlerte, texte: string,
): Promise<IssueTelegram> {
  try {
    const issue = await d.alerter(texte);
    if (issue === 'non_recue') journaliser('error', 'alerte_fenetre_partenaire_perdue', { tenantId, wabaId, cas });
    if (issue === 'incertaine') journaliser('warn', 'alerte_fenetre_partenaire_incertaine', { tenantId, wabaId, cas });
    return issue;
  } catch (err) {
    journaliser('error', 'alerte_fenetre_partenaire_perdue', { tenantId, wabaId, cas, err });
    return 'non_recue';
  }
}

/**
 * Marque le numéro qui attend sa ligne ; une marque ratée se journalise et n'empêche pas l'alerte. `ecrite`, `absente`
 * (le numéro n'est pas, ou plus, de l'espace : relecture du lot V6, jaune 4) ou `panne`.
 */
async function marquerSansLever(
  d: Pick<DepsFenetrePartenaire, 'marquer'>, tenantId: string, phoneNumberId: string,
): Promise<'ecrite' | 'absente' | 'panne'> {
  try {
    return (await d.marquer(tenantId, phoneNumberId)) ? 'ecrite' : 'absente';
  } catch (err) {
    journaliser('error', 'marque_par_la_ligne_impossible', { tenantId, phoneNumberId, err });
    return 'panne';
  }
}

/**
 * Le cas d'une connexion par la fenêtre : le droit (SANS la condition « aucun numéro », et sans compter le numéro qui vient
 * d'arriver ; sans lui, l'identifiant a été réutilisé hors de sa garde), puis la ligne qui couvre déjà son compte, toute
 * origine et tout espace, arrêtée comprise. Une lecture qui échoue rend `illisible`, journalisée.
 */
async function casDeConnexion(
  d: DepsFenetrePartenaire, tenantId: string, wabaId: string | null, phoneNumberId: string | null,
): Promise<{ cas: CasAlerte; couvrante: LigneCouvrante | null }> {
  if (d.solutionId === '') return { cas: 'fermee', couvrante: null };
  try {
    if (!(await droitALaLigne(d, tenantId, phoneNumberId))) return { cas: 'sans_droit', couvrante: null };
    // Un compte sans numéro : rien à poser dans `/ops`, qui pose un numéro (relecture du lot E5, jaune 6).
    if (phoneNumberId === null) return { cas: 'sans_numero', couvrante: null };
    const couvrante = await d.ligneDuNumero(phoneNumberId);
    if (couvrante === null) return { cas: 'a_poser', couvrante };
    if (couvrante.tenantId !== tenantId) return { cas: 'autre_espace', couvrante };
    // Arrêtée, la ligne de l'espace ne paie plus rien : la garde refuse les envois (relecture du lot E6, jaune 3).
    return { cas: couvrante.arreteeLe === null ? 'deja_couvert' : 'couvert_arrete', couvrante };
  } catch (err) {
    journaliser('error', 'droit_a_la_ligne_illisible', { tenantId, wabaId, err });
    return { cas: 'illisible', couvrante: null };
  }
}

/** L'autre espace, nommé quand son nom se lit, par son identifiant sinon : une lecture en panne ne fait pas taire l'alerte. */
async function autreEspace(d: Pick<DepsFenetrePartenaire, 'nomDeLEspace'>, tenantId: string): Promise<string> {
  try {
    const nom = await d.nomDeLEspace(tenantId);
    if (nom !== null && nom.trim() !== '') return `« ${nom} »`;
  } catch (err) {
    journaliser('error', 'nom_de_l_espace_illisible', { tenantId, err });
  }
  return `espace ${tenantId}`;
}

/**
 * Ce que l'alerte d'une connexion par la fenêtre dit, par cas. 🔴 La ligne se pose APRÈS l'attache du partenaire
 * (décision de Julien du 2026-11-09, relecture du lot E5, jaune 1) : posée avant, la carte dirait « payés par votre Crédit
 * WhatsApp » pendant que Meta refuse les envois, et un compte qui a déjà sa carte chez Meta paierait deux fois.
 * `enListe` : le numéro est marqué ; sinon (en coexistence), l'alerte ne promet ni la liste de /ops ni son « Ne pas
 * poser » (relecture du lot V6, jaune 1).
 */
function texteDeConnexion(cas: CasAlerte, qui: string, couvrante: LigneCouvrante | null, autre: string, enListe: boolean): string {
  const attend = enListe ? ' D’ici là, le numéro attend dans la liste de /ops.' : '';
  switch (cas) {
    case 'fermee':
      return `Numéro connecté par la fenêtre du partenaire alors qu’elle est FERMÉE chez nous (variable vide ou inscription éteinte) : ${qui}. Vérifier chez Meta s’il est partagé avec le partenaire ; ne rien poser sans décision.`;
    case 'sans_droit':
      return `Numéro connecté par la fenêtre du partenaire SANS droit à la ligne : ${qui}. Ne pas poser la ligne ; demander au partenaire de ne rien attacher à ce compte, ou de détacher sa ligne ; voir avec le client.`;
    case 'sans_numero':
      return `Compte WhatsApp relié SANS numéro par la ligne du partenaire : ${qui}. Demander au partenaire d’attacher sa ligne de crédit à ce compte ; rien à poser dans /ops tant qu’aucun numéro n’y est connecté. Connecté par la fenêtre, le numéro enverra sa propre alerte ; connecté autrement, le poser à son arrivée, une fois l’attache confirmée.`;
    case 'a_poser':
      return `Numéro connecté par la ligne du partenaire : ${qui}. Demander au partenaire d’attacher sa ligne de crédit à ce compte WhatsApp (elle ne s’attache pas d’elle-même), puis poser la ligne dans /ops quand il confirme l’attache, pas avant : Meta refuserait les envois, et un compte qui a déjà sa carte chez Meta paierait deux fois.${attend}`;
    case 'coexistence':
      // La pose de `/ops` refuse un numéro en coexistence : l'application envoie sans nous, donc sans provision (relecture
      // du lot V2, jaune 6). Rien à marquer.
      return `Numéro connecté par la fenêtre du partenaire EN COEXISTENCE (il garde l’application WhatsApp Business) : ${qui}. Il ne passe pas sur la ligne, l’application envoie sans nous : rien à poser. Demander au partenaire de ne rien attacher à ce compte, et voir avec le client.`;
    case 'deja_couvert':
      // Une ligne active ne prouve pas l'attache du partenaire (relecture du lot E6, jaune 3) : le numéro attend sa
      // vérification dans la liste de /ops (relecture du lot E7, jaune 6).
      return `Numéro connecté par la ligne du partenaire : ${qui}. Son compte WhatsApp est déjà sur la ligne de l’espace (numéro ${couvrante?.phoneNumberId ?? 'inconnu'}). Vérifier auprès du partenaire que sa ligne est attachée à ce compte : si oui, rien à poser${enListe ? ', lever l’attente par « Ne pas poser » dans la liste de /ops' : ''} ; sinon, retirer la nôtre dans /ops jusqu’à son attache, puis la reposer.${attend}`;
    case 'couvert_arrete':
      // Le numéro de la ligne arrêtée, et l'attache vérifiée d'abord, comme pour l'autre espace (relecture du lot E7,
      // jaune 6) : une ligne du partenaire encore attachée paie chez Meta, retirer et poser se font ensemble.
      return `Numéro connecté par la ligne du partenaire : ${qui}. Son compte WhatsApp est sur une ligne ARRÊTÉE de l’espace (numéro ${couvrante?.phoneNumberId ?? 'inconnu'}), et la garde refuse ses envois. Vérifier d’abord auprès du partenaire si sa ligne est encore attachée à ce compte : si oui, retirer la ligne arrêtée et poser la nouvelle dans le même geste ; sinon, la lui demander, puis faire les deux quand il confirme.${attend}`;
    case 'autre_espace':
      // L'autre espace nommé, avec le numéro de sa ligne ; l'attache d'abord, qui peut être encore là (relecture du lot E6,
      // jaune 4) : retirer avant de la vérifier ouvrirait une fenêtre d'envois payés par le partenaire, sans provision.
      return `Numéro connecté par la ligne du partenaire : ${qui}. Son compte WhatsApp est encore sur la ligne d’un AUTRE espace (${autre}, numéro ${couvrante?.phoneNumberId ?? 'inconnu'}), et la garde refuse ses envois. Vérifier d’abord auprès du partenaire si sa ligne est encore attachée à ce compte : si oui, retirer cette ligne et poser celle de l’espace dans le même geste ; sinon, la lui demander, puis faire les deux quand il confirme.`;
    default:
      return `Numéro connecté par la fenêtre du partenaire, droit ou couverture illisible : ${qui}. Vérifier l’espace dans /ops ; ne poser la ligne qu’après l’attache du partenaire.`;
  }
}

/**
 * Un numéro vient d'être connecté par la fenêtre du partenaire : Julien est alerté des gestes à faire, dans l'ordre. La
 * ligne du partenaire ne s'attache pas d'elle-même (essai 236) : la lui demander, puis poser la nôtre quand il confirme
 * l'attache. Variable vide (fenêtre fermée chez nous, une page restée ouverte), l'alerte le dit au lieu de se taire.
 *
 * 🔴 Le numéro n'est marqué (« il attend sa ligne ») QUE dans les cas qui attendent (`CAS_QUI_ATTENDENT`) : une ligne à
 * poser, ou celle de l'espace dont l'attache reste à vérifier. Une marque posée sans droit, fenêtre fermée, en coexistence
 * ou droit illisible attendrait une ligne que personne ne posera, et l'Entreprise ne lirait plus le conseil de sa carte
 * chez Meta (le rouge de la relecture du lot E5). L'audit `numero.connecte` garde, lui, toute connexion par la fenêtre.
 * La marque d'abord, l'alerte ensuite : une alerte perdue laisse la trace. Ne lève jamais : la connexion est faite.
 */
export async function connexionParLaLigne(
  d: DepsFenetrePartenaire, tenantId: string,
  n: { wabaId: string; phoneNumberId: string | null; numero: string | null; coexistence: boolean },
): Promise<void> {
  const qui = `espace ${tenantId}, ${n.numero ?? n.phoneNumberId ?? 'sans numéro'} (compte ${n.wabaId})`;
  const lu = await casDeConnexion(d, tenantId, n.wabaId, n.phoneNumberId);
  // Un numéro en coexistence garde l'application : la pose le refuse, il n'est jamais marqué (relecture du lot V2, jaune 6).
  // La coexistence ne remplace que « à poser » : ailleurs, l'alerte dit la ligne qui couvre, ou l'absence de droit, ET la
  // coexistence (relecture du lot V5, jaune 3).
  const cas: CasAlerte = n.coexistence && lu.cas === 'a_poser' ? 'coexistence' : lu.cas;
  const autre = cas === 'autre_espace' && lu.couvrante !== null ? await autreEspace(d, lu.couvrante.tenantId) : '';
  const marque = !n.coexistence && CAS_QUI_ATTENDENT.has(cas) && n.phoneNumberId !== null;
  if (marque && n.phoneNumberId !== null) await marquerSansLever(d, tenantId, n.phoneNumberId);
  const texte = texteDeConnexion(cas, qui, lu.couvrante, autre, marque);
  await alerterSansPerte(d, tenantId, n.wabaId, cas, n.coexistence && cas !== 'coexistence' ? `${texte} ${MAIS_EN_COEXISTENCE}` : texte);
}

/**
 * Ce qu'une alerte ajoute quand le numéro garde l'application, hors du cas « à poser » (relecture du lot V5, jaune 3) :
 * jamais marqué, il n'est pas dans la liste de /ops (relecture du lot V6, jaune 1).
 */
const MAIS_EN_COEXISTENCE = 'Mais ce numéro est EN COEXISTENCE (il garde l’application WhatsApp Business) : la pose de /ops le refusera, ne rien poser sans voir avec le client ; il n’est pas dans la liste de /ops.';

/**
 * Le numéro qu'une connexion interrompue a pu rattacher (relecture du lot E7, jaune 4) : celui que le corps annonce, s'il
 * est rattaché, et nul autre (`connecterNumero` prend le numéro annoncé tel quel, et `linkTenant` refuse un second
 * numéro : un autre rattaché est étranger à cette connexion, relecture du lot V5, jaune 1). Sans annonce, le seul
 * rattaché du compte du corps, celui que le serveur a pu retrouver seul ; sans compte non plus, le seul de l'espace.
 * Plusieurs : on ne devine pas.
 */
function numeroDeLaConnexion(rattaches: NumeroRattache[], annonce: string | null, wabaId: string | null): NumeroRattache | null {
  if (annonce !== null) return rattaches.find((r) => r.phoneNumberId === annonce) ?? null;
  const duCompte = wabaId === null ? rattaches : rattaches.filter((r) => r.wabaId === wabaId);
  return duCompte.length === 1 ? (duCompte[0] ?? null) : null;
}

/** Ce que l'alerte d'une interruption sait du numéro de la connexion et de la liste de `/ops` (relecture du lot V5, jaune 7). */
type NumeroInterrompu =
  | { etat: 'aucun' | 'illisible' }
  | { etat: 'dans_la_liste' | 'hors_liste' | 'rien_a_poser' | 'coexistence'; phoneNumberId: string };

/**
 * Le numéro qu'une connexion interrompue a rattaché, marqué selon les règles de la connexion (jamais en coexistence, que
 * la pose refuse : relecture du lot V5, jaune 4), puis relu : rejouée, la marque garde son premier moment, qu'une ligne
 * posée depuis a pu éteindre. Une lecture ou une marque en panne se journalise et rend `illisible` : l'alerte ne prétend
 * rien.
 */
async function numeroInterrompu(
  d: DepsFenetrePartenaire, tenantId: string, annonce: string | null, wabaId: string | null,
): Promise<NumeroInterrompu> {
  let numero: NumeroRattache | null;
  try {
    numero = numeroDeLaConnexion(await d.numerosRattaches(tenantId), annonce, wabaId);
  } catch (err) {
    journaliser('error', 'numero_interrompu_illisible', { tenantId, err });
    return { etat: 'illisible' };
  }
  if (numero === null) return { etat: 'aucun' };
  const { phoneNumberId } = numero;
  if (numero.coexistence) return { etat: 'coexistence', phoneNumberId };
  const { cas } = await casDeConnexion(d, tenantId, wabaId, phoneNumberId);
  if (cas === 'illisible') return { etat: 'illisible' };
  if (!CAS_QUI_ATTENDENT.has(cas)) return { etat: 'rien_a_poser', phoneNumberId };
  const ecrite = await marquerSansLever(d, tenantId, phoneNumberId);
  if (ecrite === 'panne') return { etat: 'illisible' };
  // Le numéro a quitté l'espace entre la lecture et la marque, ou entre la marque et la relecture (déconnecté) : il n'est
  // plus celui de cette connexion (relecture du lot V6, jaune 4).
  if (ecrite === 'absente') return { etat: 'aucun' };
  try {
    const relu = (await d.numerosRattaches(tenantId)).find((r) => r.phoneNumberId === phoneNumberId);
    if (relu === undefined) return { etat: 'aucun' };
    return { etat: relu.attendLigne ? 'dans_la_liste' : 'hors_liste', phoneNumberId };
  } catch (err) {
    journaliser('error', 'numero_interrompu_illisible', { tenantId, err });
    return { etat: 'illisible' };
  }
}

/** Ce que l'alerte d'une interruption dit de la liste « En attente de leur ligne ». */
function texteDeLaListe(n: NumeroInterrompu): string {
  switch (n.etat) {
    case 'dans_la_liste':
      return `Son numéro ${n.phoneNumberId} est rattaché et attend sa ligne : il figure dans la liste « En attente de leur ligne ».`;
    case 'hors_liste':
      return `Son numéro ${n.phoneNumberId} est rattaché et marqué, mais il n’attend pas sa ligne (une ligne posée depuis sa première marque, ou son attente levée) : il n’est pas dans la liste « En attente de leur ligne », voir l’espace dans /ops.`;
    case 'rien_a_poser':
      return `Son numéro ${n.phoneNumberId} est rattaché, sans ligne à poser : il n’est pas dans la liste « En attente de leur ligne ».`;
    case 'coexistence':
      return `Son numéro ${n.phoneNumberId} est rattaché EN COEXISTENCE (il garde l’application) : il ne passe pas sur la ligne, et n’est pas dans la liste « En attente de leur ligne ».`;
    case 'aucun':
      return 'Aucun numéro de cette connexion n’est rattaché : rien dans la liste « En attente de leur ligne ».';
    default:
      return 'Le numéro de cette connexion n’a pas pu se lire ou se marquer (voir les journaux de l’API) : vérifier la liste « En attente de leur ligne » dans /ops.';
  }
}

/**
 * La fenêtre du partenaire a fini chez Meta, mais notre serveur a refusé la connexion (compte d'un autre espace, second
 * numéro, échange ou preuve refusés), ou l'a interrompue par une erreur (`statut` 500, relecture du lot E5, jaune 7) : le
 * compte est peut-être déjà partagé avec le partenaire, et rien ne le dirait (relecture du lot E, jaune 1).
 *
 * La fin vient du navigateur (relecture du lot E5, jaune 2) : une alerte de refus, et une d'interruption, par espace et
 * par demi-heure, celle que Telegram n'a pas reçue rendant sa retenue (relecture du lot E6, jaune 1), jamais celle qui a
 * pu partir (relecture du lot E7, jaune 7) ; le compte et le numéro ne sont repris que s'ils ont la forme d'un
 * identifiant de Meta ; un refus se dit par un libellé fixe, jamais par le message de Meta, qui peut reprendre le compte
 * du corps (jaune 6). Interrompue, la connexion a pu rattacher son numéro : l'annoncé, ou sans annonce le seul du compte
 * du corps (`numeroDeLaConnexion`), retrouvé en base et marqué selon les règles de la connexion, retenue ou non, la marque
 * disant l'état et non l'alerte ; l'alerte dit ce qu'en sait la liste de `/ops` (relecture du lot E7, jaune 4 ; du lot
 * V5, jaunes 1, 4 et 7). Ne lève jamais : la réponse d'erreur part de toute façon.
 */
export async function fenetreRefuseeParLaLigne(
  d: DepsFenetrePartenaire, tenantId: string, i: { statut: number; wabaId: string | null; phoneNumberId: string | null },
): Promise<void> {
  const wabaId = i.wabaId !== null && ID_META.test(i.wabaId) ? i.wabaId : null;
  const phoneNumberId = i.phoneNumberId !== null && ID_META.test(i.phoneNumberId) ? i.phoneNumberId : null;
  const interrompue = i.statut >= 500;
  // Une annonce REJETÉE n'est pas une annonce absente : un numéro mal formé n'a rien pu rattacher, et un compte mal formé,
  // sans numéro annoncé, ne retombe pas sur tout l'espace (relecture du lot V6, jaune 2).
  const rejetee = (i.phoneNumberId !== null && phoneNumberId === null) || (phoneNumberId === null && i.wabaId !== null && wabaId === null);
  const numero: NumeroInterrompu | null = !interrompue
    ? null
    : rejetee ? { etat: 'aucun' } : await numeroInterrompu(d, tenantId, phoneNumberId, wabaId);
  let prise: Prise | null = null;
  try {
    prise = await d.verrous.prendre([[`fenetre-partenaire.${interrompue ? 'interruption' : 'refus'}:${tenantId}`, RETENUE_ALERTE_REFUS_MS]]);
    if (prise === null) {
      journaliser('warn', 'alerte_fenetre_refusee_retenue', { tenantId, statut: i.statut, wabaId });
      return;
    }
  } catch (err) {
    // La retenue illisible (la base) n'éteint pas l'alerte : mieux vaut deux alertes qu'aucune.
    journaliser('error', 'alerte_fenetre_refusee_retenue_illisible', { tenantId, err });
  }
  const compte = `espace ${tenantId}, compte ${wabaId ?? 'inconnu'}`;
  const issue = numero !== null
    ? await alerterSansPerte(d, tenantId, wabaId, 'interrompue',
      `Fenêtre du partenaire passée chez Meta, connexion INTERROMPUE chez nous par une erreur interne (voir les journaux de l’API) : ${compte}. Le compte est peut-être partagé avec le partenaire et relié à moitié : voir l’espace dans /ops avant toute pose, et lui demander de ne rien y attacher sans décision. ${texteDeLaListe(numero)}`)
    : await alerterSansPerte(d, tenantId, wabaId, 'refusee',
      `Fenêtre du partenaire passée chez Meta, connexion REFUSÉE chez nous (${i.statut} : ${CAUSE_DU_REFUS[i.statut] ?? 'refus'}) : ${compte}. Le compte est peut-être déjà partagé avec le partenaire : lui demander de ne rien y attacher, et voir avec le client. Le détail est dans les journaux de l’API.`);
  // Seule une alerte que Telegram n'a pas reçue rend sa retenue : une alerte incertaine a pu partir (relecture du lot E7,
  // jaune 7), la suivante serait un doublon.
  if (issue === 'non_recue' && prise !== null) {
    try {
      await d.verrous.relacher(prise);
    } catch (err) {
      journaliser('error', 'alerte_fenetre_retenue_non_rendue', { tenantId, err });
    }
  }
}
