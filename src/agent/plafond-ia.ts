import { journaliser } from '../lib/journal';

/**
 * LE BALAYAGE HORAIRE DES ENTREPRISES (Entreprise illimitée, lot B ; décision de Julien du 2026-11-02). Leur Crédit IA
 * est illimité et facturé au contrat, sous un plafond de sécurité par mois (`acces_credit_ia`, migration 0268). Pour
 * chacune, deux gestes :
 *  1. sa clé Vercel garde un mois d'avance : son plafond se remonte à ce qu'elle a consommé, plus son plafond du mois
 *     (`remonterPlafondApresRecharge`, qui n'appelle Vercel que si la cible dépasse le dernier plafond posé). Sans lui,
 *     sa clé couperait ses agents au plafond posé à son ouverture ;
 *  2. Julien est prévenu sur Telegram à 80 %, puis à 100 % de son plafond du mois, une fois chacun par espace et par mois
 *     (`alertes_plafond_ia`) : à 100 %, ses agents, sa traduction et ses transcriptions sont arrêtés. Le client, lui,
 *     n'est pas prévenu : il n'a rien à faire, c'est nous qui relevons son plafond. La marque se pose AVANT l'envoi (deux
 *     copies du balayage n'envoient qu'une fois), et se retire si Telegram n'a pas pris le message : l'heure suivante
 *     la retente, au lieu de la perdre pour le mois.
 * Un espace qui échoue n'arrête pas les autres ; le balayage lève ensuite, en les nommant, pour que l'alerte parte.
 */
export interface DepsPlafondIa {
  acces: {
    entreprises(): Promise<Array<{ tenantId: string; nom: string; consommationDuMoisMicroEur: number; plafondMicroEur: number }>>;
    marquerAlerte(tenantId: string, seuil: 80 | 100): Promise<boolean>;
    oublierAlerte(tenantId: string, seuil: 80 | 100): Promise<void>;
  };
  /** La remontée du plafond de la clé d'un espace ; `null` quand le provisionnement des clés est éteint. */
  remonterPlafond: ((tenantId: string) => Promise<boolean>) | null;
  /** Le message à Julien (Telegram) : `true` s'il est parti. Ne lève jamais. */
  alerter(texte: string): Promise<boolean>;
}

/** Des micro-euros en euros, au centime, à la française. */
function euros(microEur: number): string {
  return (Math.round(microEur / 10_000) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function balayerPlafondsIa(deps: DepsPlafondIa): Promise<{ remontees: number; alertes: number }> {
  let remontees = 0;
  let alertes = 0;
  const echecs: string[] = [];
  for (const e of await deps.acces.entreprises()) {
    /** Une alerte par seuil et par mois : marquée d'abord, démarquée si Telegram ne l'a pas prise. */
    const prevenir = async (seuil: 80 | 100, texte: string): Promise<boolean> => {
      if (!(await deps.acces.marquerAlerte(e.tenantId, seuil))) return false;
      if (await deps.alerter(texte)) return true;
      await deps.acces.oublierAlerte(e.tenantId, seuil);
      return false;
    };
    try {
      if (deps.remonterPlafond !== null && await deps.remonterPlafond(e.tenantId)) remontees += 1;
      const part = e.plafondMicroEur > 0 ? e.consommationDuMoisMicroEur / e.plafondMicroEur : 0;
      const ce = `« ${e.nom} » a consommé ${euros(e.consommationDuMoisMicroEur)} € d'IA sur son plafond du mois (${euros(e.plafondMicroEur)} €)`;
      if (part >= 1) {
        if (await prevenir(100, `Plafond IA ATTEINT : ${ce}. Ses agents, sa traduction et ses transcriptions sont arrêtés jusqu'au mois prochain, ou jusqu'à ce que son plafond soit relevé dans /ops > Offre.`)) {
          alertes += 1;
        }
        // Le seuil de 80 % est passé lui aussi : marqué sans un second message, que celui de 100 % rend inutile.
        await deps.acces.marquerAlerte(e.tenantId, 80);
      } else if (part >= 0.8) {
        if (await prevenir(80, `Plafond IA à ${Math.floor(part * 100)} % : ${ce}. À 100 %, ses agents s'arrêtent : relever son plafond dans /ops > Offre si c'est normal.`)) {
          alertes += 1;
        }
      }
    } catch (err) {
      journaliser('error', 'plafond_ia_espace_echec', { err, tenantId: e.tenantId });
      echecs.push(e.tenantId);
    }
  }
  if (echecs.length > 0) throw new Error(`plafond IA : ${echecs.length} espace(s) en échec : ${echecs.join(', ')}`);
  return { remontees, alertes };
}
