import type { CompteurDebit } from '../db/debit';
import { journaliser } from '../lib/journal';

/**
 * LES REBONDS ET LES PLAINTES DES LIENS D'INSCRIPTION (lot identité B, décision de Julien du 2026-11-05). Ces e-mails
 * partent vers une adresse saisie par n'importe qui, du même expéditeur que la réinitialisation, les invitations et la
 * bienvenue : des plaintes nuiraient à tous. Le webhook de Resend les reconnaît à leur étiquette
 * (`ETIQUETTE_INSCRIPTION`), les compte par jour UTC dans le compteur partagé, et prévient une fois par jour au seuil.
 * 🔴 Ne lève jamais : une panne du compteur ne doit pas faire rejouer le webhook.
 */
export const SEUIL_RETOURS_INSCRIPTION_PAR_JOUR = 5;

const JOUR_MS = 24 * 60 * 60 * 1000;

export type RetourInscription = 'email.bounced' | 'email.complained';

export function creerSuiviRetoursInscription(
  compteur: CompteurDebit,
  alerter: (texte: string) => Promise<void>,
): (type: RetourInscription) => Promise<void> {
  return async (type) => {
    journaliser('warn', 'inscription_email_retour', { type });
    try {
      const v = await compteur.compter([{ cle: 'inscription.retours', dureeMs: JOUR_MS, max: null }]);
      if (v.fenetres[0]?.compte === SEUIL_RETOURS_INSCRIPTION_PAR_JOUR) {
        await alerter(`Liens d'inscription : ${SEUIL_RETOURS_INSCRIPTION_PAR_JOUR} rebonds ou plaintes aujourd'hui. Regarder Resend (étiquette categorie=inscription) : un robot remplit peut-être le formulaire avec des adresses d'autrui.`);
      }
    } catch (err) {
      journaliser('error', 'inscription_retours_compteur', { err });
    }
  };
}
