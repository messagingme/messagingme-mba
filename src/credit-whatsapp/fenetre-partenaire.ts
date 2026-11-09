import type { Offre } from '../offres/offres';
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
   * Marque le numéro arrivé par la fenêtre (`marquerParLaLigne`) : la trace en base de la connexion, et ce qui fait
   * attendre sa ligne à une Entreprise (relecture du lot E, jaunes 3 et 4).
   */
  marquer(tenantId: string, phoneNumberId: string): Promise<void>;
  /** L'alerte à Julien ; `true` seulement si Telegram l'a reçue. Une alerte perdue se journalise (jaune 3). */
  alerter(texte: string): Promise<boolean>;
}

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

/** L'alerte à Julien, journalisée si elle ne part pas (Telegram absent, en panne, ou en délai) : jamais perdue en silence. */
async function alerterSansPerte(d: Pick<DepsFenetrePartenaire, 'alerter'>, tenantId: string, wabaId: string | null, texte: string): Promise<void> {
  try {
    if (!(await d.alerter(texte))) journaliser('error', 'alerte_fenetre_partenaire_perdue', { tenantId, wabaId, texte });
  } catch (err) {
    journaliser('error', 'alerte_fenetre_partenaire_perdue', { tenantId, wabaId, texte, err });
  }
}

/**
 * Un numéro vient d'être connecté par la fenêtre du partenaire : Julien est alerté du geste à faire. La ligne du
 * partenaire ne s'attache pas d'elle-même (essai 236) : poser la nôtre tout de suite (un envoi que Meta refuse faute de
 * paiement rend sa provision), puis la lui demander. Le droit se relit SANS la condition « aucun numéro », et sans compter
 * le numéro qui vient d'arriver ; sans lui (l'identifiant réutilisé hors de sa garde), ne rien poser. Variable vide
 * (fenêtre fermée chez nous, une page restée ouverte), l'alerte le dit au lieu de se taire.
 *
 * 🔴 Le numéro n'est marqué (« il attend sa ligne ») QUE quand l'alerte dit de poser : une marque posée sans droit, fenêtre
 * fermée ou droit illisible attendrait une ligne que personne ne posera, et l'Entreprise ne lirait plus le conseil de sa
 * carte chez Meta (le rouge de la relecture du lot E5). L'audit `numero.connecte` garde, lui, toute connexion par la
 * fenêtre. Ne lève jamais : la connexion est faite.
 */
export async function connexionParLaLigne(
  d: DepsFenetrePartenaire, tenantId: string, n: { wabaId: string; phoneNumberId: string | null; numero: string | null },
): Promise<void> {
  const qui = `espace ${tenantId}, ${n.numero ?? n.phoneNumberId ?? 'sans numéro'} (compte ${n.wabaId})`;
  let aPoser = false;
  let texte: string;
  if (d.solutionId === '') {
    texte = `Numéro connecté par la fenêtre du partenaire alors qu’elle est FERMÉE chez nous (variable vide ou inscription éteinte) : ${qui}. Vérifier chez Meta s’il est partagé avec le partenaire ; ne rien poser sans décision.`;
  } else {
    try {
      if (!(await droitALaLigne(d, tenantId, n.phoneNumberId))) {
        texte = `Numéro connecté par la fenêtre du partenaire SANS droit à la ligne : ${qui}. Ne pas poser la ligne ; demander au partenaire de ne rien attacher à ce compte, ou de détacher sa ligne ; voir avec le client.`;
      } else if (n.phoneNumberId !== null && (await d.numerosCouverts(tenantId)).includes(n.phoneNumberId)) {
        texte = `Numéro connecté par la ligne du partenaire : ${qui}. Son compte WhatsApp est déjà couvert par la ligne de l’option : rien à poser dans /ops ; vérifier que le partenaire a attaché sa ligne à ce compte.`;
      } else {
        texte = `Numéro connecté par la ligne du partenaire : ${qui}. Poser la ligne dans /ops tout de suite, puis demander au partenaire d’attacher sa ligne de crédit à ce compte WhatsApp : elle ne s’attache pas d’elle-même.`;
        aPoser = true;
      }
    } catch (err) {
      journaliser('error', 'droit_a_la_ligne_illisible', { tenantId, wabaId: n.wabaId, err });
      texte = `Numéro connecté par la fenêtre du partenaire, droit illisible : ${qui}. Vérifier l’espace dans /ops avant de poser la ligne.`;
    }
  }
  // La marque d'abord, l'alerte ensuite : une alerte perdue laisse la trace ; une marque ratée n'empêche pas l'alerte.
  if (aPoser && n.phoneNumberId !== null) {
    try {
      await d.marquer(tenantId, n.phoneNumberId);
    } catch (err) {
      journaliser('error', 'marque_par_la_ligne_impossible', { tenantId, phoneNumberId: n.phoneNumberId, err });
    }
  }
  await alerterSansPerte(d, tenantId, n.wabaId, texte);
}

/**
 * La fenêtre du partenaire a fini chez Meta, mais notre serveur a refusé la connexion (compte d'un autre espace, second
 * numéro, échange ou preuve refusés) : le compte est peut-être déjà partagé avec le partenaire, et rien ne le dirait
 * (relecture du lot E, jaune 1). Ne lève jamais : la réponse d'erreur part de toute façon.
 */
export async function fenetreRefuseeParLaLigne(
  d: Pick<DepsFenetrePartenaire, 'alerter'>, tenantId: string, i: { statut: number; erreur: string; wabaId: string | null },
): Promise<void> {
  await alerterSansPerte(d, tenantId, i.wabaId,
    `Fenêtre du partenaire passée chez Meta, connexion REFUSÉE chez nous (${i.statut} : ${i.erreur}) : espace ${tenantId}, compte ${i.wabaId ?? 'inconnu'}. Le compte est peut-être déjà partagé avec le partenaire : lui demander de ne rien y attacher, et voir avec le client.`);
}
