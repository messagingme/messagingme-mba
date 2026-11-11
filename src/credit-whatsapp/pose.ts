import { journaliser } from '../lib/journal';
import type { GrilleMeta } from './grille';
import type { LigneCredit, NumeroDeLEspace, NumeroPourLaLigne } from './lignes.pg';

/**
 * POSER UN NUMÉRO SUR LA LIGNE DU CRÉDIT WHATSAPP : le geste de `/ops` (`POST /ops/credit-whatsapp/ligne/:tenantId`) et,
 * depuis V3 (plan `2026-11-10-credit-whatsapp-vente-libre-service.md`), celui de la connexion par la fenêtre du partenaire.
 * UNE fonction pour les deux : les contrôles ne se recopient pas, sinon la connexion poserait ce que `/ops` refuse.
 *
 * Ne passent pas sur la ligne : un numéro 360dialog (facturé chez 360dialog, la garde ne le voit pas), un numéro en
 * coexistence (l'application WhatsApp Business envoie sans nous, donc sans provision), un numéro délié (il n'envoie plus
 * rien), un numéro dont le compte WhatsApp est déjà couvert (une ligne par compte, de cet espace ou d'un autre), et aucun
 * numéro tant qu'aucune grille de Meta n'est en vigueur (la garde refuserait tous ses envois). Hors Entreprise, la pose
 * consomme des places payées, le compte entier devant y tenir (décision de Julien du 2026-11-03) ; un essai se FORCE, et
 * sa ligne `'ops'` reste hors des places. La ligne posée fait repartir les campagnes en pause faute de ligne, sans que
 * l'échec de cette reprise fasse passer la pose pour un échec.
 */
export interface DepsPose {
  lignes: {
    numeroDeLEspace(tenantId: string, phoneNumberId: string): Promise<NumeroPourLaLigne | null>;
    ligneDuNumero(phoneNumberId: string): Promise<LigneCredit | null>;
    numerosCouvertsParOption(tenantId: string): Promise<string[]>;
    numerosDeLEspace(tenantId: string): Promise<NumeroDeLEspace[]>;
    poser(tenantId: string, phoneNumberId: string, wabaId: string | null, origine: 'ops' | 'option', note: string): Promise<boolean>;
  };
  /** La grille que la garde lit : sans elle, tout envoi d'un numéro de la ligne est refusé. */
  grilleEnVigueur(): Promise<GrilleMeta | null>;
  option: {
    entreprise(tenantId: string): Promise<boolean>;
    placesPayees(tenantId: string): Promise<number>;
    reprendreCampagnes(tenantId: string): Promise<number>;
  };
}

/** Ce que rend une pose : la ligne posée et son origine, ou le refus tel que `/ops` le rend (statut, message, code). */
export type IssuePose =
  | { ok: true; origine: 'ops' | 'option' }
  | { ok: false; statut: 404 | 409; error: string; code?: 'places_manquantes' };

/**
 * Les places qu'une pose sur ce numéro demanderait : les numéros déjà couverts par l'option, plus ceux que la nouvelle ligne
 * couvrirait (le numéro et les autres de son compte WhatsApp, déliés exclus). Une ligne couvre tout son compte.
 */
export function placesApresPose(
  couverts: readonly string[], numeros: readonly NumeroDeLEspace[], numero: { phoneNumberId: string; wabaId: string | null },
): number {
  const apres = new Set(couverts);
  for (const n of numeros) {
    if (n.delie) continue;
    if (n.phoneNumberId === numero.phoneNumberId || (numero.wabaId !== null && n.wabaId === numero.wabaId)) apres.add(n.phoneNumberId);
  }
  apres.add(numero.phoneNumberId);
  return apres.size;
}

/**
 * Pose le numéro de l'espace sur la ligne, ou dit pourquoi pas. 🔴 Le numéro est lu DANS l'espace (`numeroDeLEspace`) :
 * celui d'un autre espace rend 404, comme un inconnu. `note` est la note finale, déjà signée par l'appelant.
 */
export async function poserLaLigne(
  d: DepsPose, tenantId: string, phoneNumberId: string, o: { forcer: boolean; note: string },
): Promise<IssuePose> {
  const numero = await d.lignes.numeroDeLEspace(tenantId, phoneNumberId);
  if (numero === null) return { ok: false, statut: 404, error: 'numéro inconnu dans cet espace' };
  if (numero.fournisseur !== 'meta') return { ok: false, statut: 409, error: 'un numéro 360dialog ne passe pas sur la ligne : ses messages sont facturés chez 360dialog' };
  if (numero.coexistence) return { ok: false, statut: 409, error: 'un numéro en coexistence ne passe pas sur la ligne : l’application WhatsApp Business envoie sans passer par nous' };
  if (numero.delie) return { ok: false, statut: 409, error: 'numéro délié : il n’envoie plus rien, rien à mettre sur la ligne' };
  if ((await d.grilleEnVigueur()) === null) {
    return { ok: false, statut: 409, error: 'aucune grille de Meta en vigueur : chargez-la avant de poser un numéro sur la ligne' };
  }
  // 🔴 Une ligne par compte WhatsApp (Meta attache la ligne au compte) : un numéro que la ligne d'un autre espace couvre,
  // ou qu'un autre numéro de son compte couvre déjà, ne pose pas une seconde ligne (relecture du lot D).
  const couvrante = await d.lignes.ligneDuNumero(phoneNumberId);
  if (couvrante !== null && couvrante.tenantId !== tenantId) {
    return { ok: false, statut: 409, error: 'le compte WhatsApp de ce numéro est sur la ligne d’un autre espace : retirez-la d’abord' };
  }
  if (couvrante !== null && couvrante.phoneNumberId !== phoneNumberId) {
    return { ok: false, statut: 409, error: 'déjà couvert : un autre numéro de son compte WhatsApp est sur la ligne, qui couvre tout le compte' };
  }
  let origine: 'ops' | 'option' = 'ops';
  if (!o.forcer && !(await d.option.entreprise(tenantId))) {
    const [places, couverts, numeros] = await Promise.all([
      d.option.placesPayees(tenantId), d.lignes.numerosCouvertsParOption(tenantId), d.lignes.numerosDeLEspace(tenantId),
    ]);
    const requises = placesApresPose(couverts, numeros, { phoneNumberId, wabaId: numero.wabaId });
    if (requises > places) {
      return {
        ok: false, statut: 409, code: 'places_manquantes',
        error: `il faut ${requises} place${requises > 1 ? 's' : ''} payée${requises > 1 ? 's' : ''} pour couvrir ce compte, l’espace en a ${places} : prendre l’option, ou forcer la pose pour un essai`,
      };
    }
    origine = 'option';
  }
  if (!(await d.lignes.poser(tenantId, phoneNumberId, numero.wabaId, origine, o.note))) {
    return { ok: false, statut: 409, error: 'numéro déjà sur la ligne' };
  }
  // La ligne posée : les campagnes de l'espace en pause faute de ligne active repartent (relecture du lot 4a, jaune 6).
  // Non bloquant : la pose est faite, une panne ici ne doit pas la faire passer pour un échec (une seconde pose rendrait
  // « déjà sur la ligne ») ; les pauses se lèveront au prochain geste qui les lève.
  try {
    await d.option.reprendreCampagnes(tenantId);
  } catch (err) {
    journaliser('error', 'ops_ligne_credit_reprise_impossible', { tenantId, phoneNumberId, err: err instanceof Error ? err.message : String(err) });
  }
  return { ok: true, origine };
}
