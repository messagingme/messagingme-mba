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
 */
export interface DepsFenetrePartenaire {
  /** `META_SOLUTION_ID` : l'identifiant de la solution. Vide, la fenêtre du partenaire est fermée à tous. */
  solutionId: string;
  /** L'offre de l'espace, relue SANS cache. */
  offre(tenantId: string): Promise<Offre>;
  /** L'option vivante de l'espace et ses places payées ; `null` sans option. */
  option(tenantId: string): Promise<{ places: number } | null>;
  /** Les numéros que ses lignes `'option'` couvrent déjà : une place libre se lit contre eux. */
  numerosCouverts(tenantId: string): Promise<number>;
  /** Les numéros vivants de l'espace (non déliés) : un numéro déjà connecté relève du lot D, pas de cette fenêtre. */
  numerosVivants(tenantId: string): Promise<number>;
  alerter(texte: string): Promise<void>;
}

/**
 * L'espace a-t-il droit à la ligne du partenaire ? Une Entreprise, toujours ; une formule Pro ou un Business, avec une
 * option vivante dont une place est libre (un essai n'a pas d'option) ; jamais une Free.
 */
export async function droitALaLigne(d: Pick<DepsFenetrePartenaire, 'offre' | 'option' | 'numerosCouverts'>, tenantId: string): Promise<boolean> {
  const offre = await d.offre(tenantId);
  if (offre === 'entreprise') return true;
  if (offre !== 'pro' && offre !== 'business') return false;
  const option = await d.option(tenantId);
  return option !== null && option.places > (await d.numerosCouverts(tenantId));
}

/**
 * L'identifiant de la solution, pour la fenêtre de Meta : seulement à un espace qui a droit à la ligne ET n'a encore aucun
 * numéro vivant (un numéro de l'essai passe sur la ligne par le lot D). `null` sinon, et pour tous si rien n'est configuré.
 */
export async function solutionDuPartenaire(d: DepsFenetrePartenaire, tenantId: string): Promise<string | null> {
  if (d.solutionId === '') return null;
  if ((await d.numerosVivants(tenantId)) > 0) return null;
  return (await droitALaLigne(d, tenantId)) ? d.solutionId : null;
}

/**
 * Un numéro vient d'être connecté par la fenêtre du partenaire. Tant que la façon dont le partenaire branche sa ligne
 * n'est pas connue (question 2 de la note privée), la pose reste à Julien : il est alerté du geste à faire. Le droit se
 * relit SANS la condition « aucun numéro » (le numéro vient d'arriver) ; sans lui (l'identifiant réutilisé hors de sa
 * garde), Julien est prévenu de ne pas brancher la ligne. Ne lève jamais : la connexion est faite.
 */
export async function connexionParLaLigne(
  d: DepsFenetrePartenaire, tenantId: string, n: { wabaId: string; phoneNumberId: string | null; numero: string | null },
): Promise<void> {
  try {
    const qui = `espace ${tenantId}, ${n.numero ?? n.phoneNumberId ?? 'sans numéro'} (compte ${n.wabaId})`;
    await d.alerter((await droitALaLigne(d, tenantId))
      ? `Numéro connecté par la ligne du partenaire : ${qui}. Vérifier que le partenaire a branché sa ligne sur ce compte, puis poser la ligne dans /ops.`
      : `Numéro connecté par la solution du partenaire SANS droit à la ligne : ${qui}. Ne pas brancher la ligne du partenaire ; voir avec le client.`);
  } catch (err) {
    journaliser('error', 'connexion_par_la_ligne_alerte_impossible', { tenantId, wabaId: n.wabaId, err });
  }
}
