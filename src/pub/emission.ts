import { journaliser } from '../lib/journal';
import type { Fait, JobConversion } from './conversions-meta';

/**
 * L'ÉMETTEUR DES CONVERSIONS (lot 2 du plan pixel) : réserve le fait dans le journal (le dédoublonnage, en base) puis
 * enfile un job `conversions-meta`. Appelé depuis l'inscription, la connexion d'un numéro et le paiement du Pro.
 *
 * 🔴 IL RÉSERVE TOUJOURS, fonction allumée ou non : le journal note chaque fait à son heure. Sinon un fait accompli
 * pendant que la fonction est éteinte resterait libre, et son geste rejoué après l'accord (une reconnexion, la facture
 * suivante) partirait chez Meta comme un fait neuf. C'est le travail du worker, seul à envoyer, qui décide.
 *
 * 🔴 IL NE LÈVE JAMAIS : une conversion est un à-côté publicitaire, la panne de sa table ou de sa file ne fait échouer
 * ni une inscription, ni une connexion de numéro, ni un webhook Stripe.
 */

export interface DepsEmetteurConversions {
  reserver(f: Fait): Promise<string | null>;
  enfiler(job: JobConversion): Promise<void>;
}

export interface EmetteurConversions {
  signaler(f: Fait): Promise<void>;
}

export function creerEmetteurConversions(d: DepsEmetteurConversions): EmetteurConversions {
  return {
    async signaler(f) {
      let id: string | null;
      try {
        id = await d.reserver(f);
      } catch (err) {
        journaliser('warn', 'conversion_meta_reservation_echouee', { err, evenement: f.evenement });
        return;
      }
      if (id === null) return;
      try {
        await d.enfiler({ conversionId: id, tentative: 0 });
      } catch (err) {
        // La ligne reste `a_envoyer` : le balayage la reprendra. Rien n'est perdu, rien ne remonte.
        journaliser('warn', 'conversion_meta_mise_en_file_echouee', { err, evenement: f.evenement });
      }
    },
  };
}
