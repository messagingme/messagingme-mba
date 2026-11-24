import { changerLigneAbonnement, lireAbonnementStripe, lirePrixStripe, StripeError, type LigneAbonnement } from './client';
import { refusDeStripe } from './abonnement';
import type { StripeConfigure } from './paiement';
import { CONTACTS_PAR_PACK, DROITS, PRIX_PACK_CONTACTS_HT_CENTIMES } from '../offres/offres';
import { journaliser } from '../lib/journal';
import { refus, type Issue } from '../lib/issue';

/**
 * LES PACKS DE CONTACTS DU PRO (décision de Julien du 2026-11-24, plan
 * `docs/superpowers/plans/2026-11-24-contacts-packs-et-remplacement.md`, lot 1). Le Pro compte 1 000 contacts ; un pack en
 * ajoute 1 000, 20 € HT par mois ou 240 € HT par an, selon la formule du Pro, en quantité sur son abonnement Stripe. Calqué
 * sur les sièges (`./sieges`), avec les mêmes invariants.
 *
 * 🔴 STRIPE D'ABORD, LA LIMITE ENSUITE. Un ajout facture le prorata sur le coup et ne s'applique que si cette facture est
 * payée (`pending_if_incomplete`) : un paiement refusé ne change rien, ni chez Stripe ni ici. La limite suit ce que Stripe
 * REND, jamais ce qu'on lui a demandé. Le webhook relit les packs à chaque modification de l'abonnement.
 *
 * Un retrait se fait sans remboursement ni prorata, et seulement si les contacts comptés tiennent dans ce qui reste : rien
 * n'est jamais effacé pour faire de la place, le client fait d'abord le ménage.
 */
export interface DepsPacksContacts {
  stripe: StripeConfigure | null;
  /** Les identifiants Stripe des deux prix du pack (`STRIPE_PRIX_PACK_CONTACTS_MOIS`, `_AN`). Vides = pas en vente. */
  prixPackMois: string;
  prixPackAn: string;
  payeurAutorise(userId: string): Promise<boolean>;
  /** Le Pro vivant d'un espace EN PRO (`PgAbonnementsOffreStore.deLEspace`, non fini) ; `null` sinon. */
  proVivant(tenantId: string): Promise<{ abonnementId: string; periodicite: 'mois' | 'an' } | null>;
  /** Les contacts que la limite compte (`PgOffresStore.usage`, sur `ficheComptee`) : ceux qu'un retrait doit laisser tenir. */
  contacts(tenantId: string): Promise<number>;
  /** `PgAbonnementsOffreStore.noterPacksContacts` : `null` si le Pro a fini entre-temps. */
  noterPacks(abonnementId: string, packs: number): Promise<{ tenantId: string } | null>;
  /** L'offre en cache de l'espace : la limite neuve vaut tout de suite, pour la création qui suit. */
  invalider(tenantId: string): void;
  alerter(texte: string): Promise<void>;
}

export const PACKS_CONTACTS_INDISPONIBLES = refus(503, 'Les contacts en plus ne sont pas encore en vente : contactez-nous.', { code: 'packs_contacts_indisponibles' });

/** La récurrence que doit porter chaque prix du pack chez Stripe. */
const RECURRENCE = { mois: 'month', an: 'year' } as const;

/**
 * Le changement demandé : d'où l'écran part (`depuis`, les packs qu'il a lus) et où il va (`cible`), un pack à la fois
 * (contrôlé par la route). L'état de départ fait refuser une vue périmée, comme pour les sièges.
 */
export interface DemandePacks {
  depuis: number;
  cible: number;
}

/** 1 000 contacts écrits à la française, dans les phrases de ce module. */
const nb = (n: number): string => n.toLocaleString('fr-FR');

/**
 * Porte les packs du Pro de l'espace de `depuis` à `cible`. `payeur` est l'utilisateur de la session, jamais une valeur du
 * corps. Rend le nombre de packs que Stripe a appliqué, relu après la modification.
 */
export async function changerPacksContacts(
  d: DepsPacksContacts, tenantId: string, demande: DemandePacks, payeur: string,
): Promise<Issue<{ packs: number }>> {
  const { depuis, cible } = demande;
  const s = d.stripe;
  if (s === null || d.prixPackMois === '' || d.prixPackAn === '') return PACKS_CONTACTS_INDISPONIBLES;
  if (!(await d.payeurAutorise(payeur))) return PACKS_CONTACTS_INDISPONIBLES;
  const pro = await d.proVivant(tenantId);
  if (pro === null) {
    return refus(409, 'Votre espace n’a pas de Pro en cours : les contacts en plus s’ajoutent à un Pro.', { code: 'aucun_pro' });
  }
  const prixPack = pro.periodicite === 'an' ? d.prixPackAn : d.prixPackMois;
  const estPack = (l: LigneAbonnement) => l.prix === d.prixPackMois || l.prix === d.prixPackAn;
  try {
    const a = await lireAbonnementStripe(s.transport, { cle: s.cle, abonnementId: pro.abonnementId });
    if (a.statut !== 'active' && a.statut !== 'trialing') {
      return refus(409, 'Le paiement de votre formule Pro est en attente : réglez-le depuis la page Offre, puis ajoutez les contacts.', { code: 'pro_en_retard' });
    }
    const lignes = a.lignes.filter(estPack);
    // Une ligne posée à la main chez Stripe, dans l'autre formule ou en double : on ne devine pas laquelle changer.
    if (lignes.length > 1 || (lignes[0] !== undefined && lignes[0].prix !== prixPack)) {
      journaliser('error', 'stripe_packs_contacts_a_regler', { tenantId, abonnement: pro.abonnementId, lignes: lignes.map((l) => l.prix) });
      return refus(409, 'Les contacts de votre formule Pro demandent un réglage de notre part : contactez-nous.', { code: 'packs_contacts_a_regler' });
    }
    const ligne = lignes[0];
    const actuel = ligne?.quantite ?? 0;
    // Déjà fait (un second clic, l'autre onglet) : rien à écrire, la base se recale.
    if (cible === actuel) return noter(d, tenantId, pro.abonnementId, actuel, null);
    if (actuel !== depuis) {
      return refus(409, 'Le nombre de contacts de votre formule Pro a changé entre-temps : rechargez la page, puis recommencez.', { code: 'packs_contacts_changes' });
    }

    if (cible < actuel) {
      const restante = (DROITS.pro.limites.contacts ?? 0) + CONTACTS_PAR_PACK * cible;
      const comptes = await d.contacts(tenantId);
      if (comptes > restante) {
        return refus(409, `Votre espace compte ${nb(comptes)} contacts : supprimez-en d’abord ${nb(comptes - restante)}, pour tenir dans ${nb(restante)} contacts.`,
          { code: 'contacts_en_trop' });
      }
      await changerLigneAbonnement(s.transport, {
        cle: s.cle, abonnementId: pro.abonnementId, ligne: { id: ligne!.id }, quantite: cible, facturerMaintenant: false,
        idempotence: `pack-contacts-${pro.abonnementId}-${actuel}-${cible}-${a.derniereFacture ?? 'aucune'}`,
      });
      return noter(d, tenantId, pro.abonnementId, await relire(s, pro.abonnementId, estPack), `retiré (${actuel} vers ${cible})`);
    }

    // 🔴 Le prix configuré est relu chez Stripe AVANT d'écrire : 20 € par mois ou 240 € par an, en euros, sinon rien.
    const prix = await lirePrixStripe(s.transport, { cle: s.cle, prix: prixPack });
    const attendu = PRIX_PACK_CONTACTS_HT_CENTIMES[pro.periodicite];
    const recurrenceJuste = prix.recurrence?.intervalle === RECURRENCE[pro.periodicite] && prix.recurrence.nombre === 1;
    if (prix.montantCentimes !== attendu || prix.devise !== 'eur' || !recurrenceJuste) {
      journaliser('error', 'stripe_prix_pack_contacts_incoherent', {
        tenantId, periodicite: pro.periodicite, prix: prixPack, attenduCentimes: attendu, luCentimes: prix.montantCentimes,
        devise: prix.devise, recurrence: prix.recurrence,
      });
      return refus(422, 'Les contacts en plus sont momentanément indisponibles : leur tarif est en cours de correction. Réessayez plus tard, ou contactez-nous.',
        { code: 'prix_incoherent' });
    }
    // La clé dit l'état de départ (la quantité ET la dernière facture) : un double clic rejoue la même réponse, alors
    // qu'un nouvel achat après un retrait, même vers la même quantité, en a une autre.
    const r = await changerLigneAbonnement(s.transport, {
      cle: s.cle, abonnementId: pro.abonnementId, ligne: ligne ? { id: ligne.id } : { prix: prixPack }, quantite: cible,
      facturerMaintenant: true, idempotence: `pack-contacts-${pro.abonnementId}-${actuel}-${cible}-${a.derniereFacture ?? 'aucune'}`,
    });
    if (r.enAttente) {
      return refus(402, 'Le paiement des contacts en plus n’a pas abouti : réglez la facture sur sa page, la limite suivra.',
        { code: 'paiement_pack_contacts_incomplet', url: r.urlFacture });
    }
    // Relu, pas lu dans la réponse : un rejeu idempotent rend la réponse d'un appel plus ancien.
    return noter(d, tenantId, pro.abonnementId, await relire(s, pro.abonnementId, estPack), `ajouté (${actuel} vers ${cible})`);
  } catch (err) {
    if (!(err instanceof StripeError)) throw err;
    // La même modification encore en vol chez Stripe (un double clic très rapproché) : à réessayer, pas un refus.
    if (err.code === 'idempotency_key_in_use') {
      return refus(409, 'Un changement des contacts de votre formule Pro est déjà en cours : réessayez dans quelques secondes.', { code: 'packs_contacts_en_cours' });
    }
    return refusDeStripe(err, tenantId, 'packs_contacts');
  }
}

/** Les packs de l'abonnement, relus chez Stripe. */
async function relire(s: StripeConfigure, abonnementId: string, estPack: (l: LigneAbonnement) => boolean): Promise<number> {
  return (await lireAbonnementStripe(s.transport, { cle: s.cle, abonnementId })).lignes.filter(estPack).reduce((n, l) => n + l.quantite, 0);
}

/**
 * Les packs d'un abonnement, RELUS chez Stripe, pour le webhook (`customer.subscription.updated`) : toutes les lignes à un
 * prix de pack, quelle que soit leur formule. `null` quand les packs ne sont pas en vente (rien à relire). Une panne de
 * Stripe lève : le webhook échoue et Stripe rejoue ; un refus durable n'arrête pas le reste de la mise à jour du Pro.
 */
export async function packsContactsChezStripe(
  d: Pick<DepsPacksContacts, 'stripe' | 'prixPackMois' | 'prixPackAn' | 'alerter'>, abonnementId: string,
): Promise<number | null> {
  const s = d.stripe;
  if (s === null || d.prixPackMois === '' || d.prixPackAn === '') return null;
  try {
    return await relire(s, abonnementId, (l) => l.prix === d.prixPackMois || l.prix === d.prixPackAn);
  } catch (err) {
    // Comme les sièges : un refus DURABLE (4xx hors 429, réponse illisible) laisse les packs déjà notés et prévient
    // Julien ; une panne passagère (réseau, 5xx, 429) lève, Stripe rejouera.
    if (!(err instanceof StripeError) || err.status === null || err.status === 429 || err.status >= 500) throw err;
    journaliser('error', 'stripe_packs_contacts_illisibles', { abonnement: abonnementId, status: err.status, code: err.code, err: err.message });
    await d.alerter(`Packs de contacts du Pro ${abonnementId} illisibles chez Stripe (${err.status}) : ceux déjà notés restent, à vérifier.`);
    return null;
  }
}

/** La base suit ce que Stripe a rendu ; l'offre en cache est invalidée, et Julien est prévenu d'un changement. */
async function noter(d: DepsPacksContacts, tenantId: string, abonnementId: string, packs: number, geste: string | null): Promise<Issue<{ packs: number }>> {
  await d.noterPacks(abonnementId, packs);
  d.invalider(tenantId);
  if (geste !== null) {
    await d.alerter(`Pack de contacts du Pro ${geste} : espace ${tenantId} (${abonnementId}), ${packs} pack${packs > 1 ? 's' : ''} payé${packs > 1 ? 's' : ''} en plus des ${nb(DROITS.pro.limites.contacts ?? 0)} contacts.`);
  }
  return { ok: true, valeur: { packs } };
}
