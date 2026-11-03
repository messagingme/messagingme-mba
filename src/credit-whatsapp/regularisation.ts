import { journaliser } from '../lib/journal';
import type { PointVolumeBrut } from '../meta/pricing';
import { normaliserCategorie, palierDeTier, prixMessage, type GrilleMeta } from './grille';
import type { ConditionsCredit } from './garde';

/**
 * LA RÉGULARISATION SUR LES VOLUMES DE META (plan `docs/superpowers/plans/2026-11-03-credit-whatsapp-fiabilite.md`, lot E ;
 * spec du 2026-10-30, étage 3) : le seul filet de ce que la garde et l'ajustement à l'accusé ne voient pas (une provision
 * en doute après un 5xx ou un délai, un wamid jamais rattaché, un accusé perdu, un message jamais livré, un rejeu qui
 * envoie deux fois sous une provision, un envoi parti hors Messaging Me).
 *
 * Mesuré le 2026-11-03 : Meta rend le COÛT de notre seul compte, pas celui d'un client ; il rend en revanche ses VOLUMES
 * (`pricing_analytics`, par demi-heure exacte en UTC, numéro, pays, catégorie, type et palier). La régularisation chiffre
 * donc ces volumes elle-même, par la formule de la garde (`prixMessage`), et les compare à nos provisions des mêmes
 * demi-heures. Sur la demi-heure de l'essai 211, les deux côtés se sont rejoints au centime.
 *
 * - Un jour de PARIS clos (la veille, l'avant-veille pour les livraisons tardives), jamais le jour en cours : ses volumes
 *   arrivent avec retard, une régularisation du jour ferait monter puis descendre le solde.
 * - Seules les demi-heures ENTIÈRES couvertes par une ligne comptent, des deux côtés : celle qu'entame la pose ou le
 *   retrait contient des messages payés par la carte du client.
 * - Nos provisions se rangent par l'instant de leur livraison (Meta facture à la livraison), à défaut de leur création :
 *   une provision en doute ou jamais livrée reste comptée, et l'écart la rend si Meta ne l'a pas facturée.
 * - L'écart (Meta moins nous) REMPLACE celui du même jour : une passe rejouée ne cumule jamais.
 */

export const DEMI_HEURE_S = 1800;

/** Un écart positif au-delà de ces deux bornes dit des envois que nous n'avons pas vus : Julien est prévenu. */
export const TOLERANCE_ALERTE_MICRO_EUR = 500_000;
export const TOLERANCE_ALERTE_PART = 0.02;

/** Sous ce solde, un prépayé a dépensé ce que nous n'avons pas vu partir : Julien fait retirer la ligne (spec). */
export const SOLDE_RETRAIT_LIGNE_MICRO_EUR = -50_000_000;

/**
 * Un jour ne se régularise que deux heures après sa fin : une demi-heure se lit chez Meta moins d'une heure après la
 * sienne (mesuré le 2026-11-03), et la première passe après minuit lirait sinon une veille incomplète, rendrait au solde
 * ce que Meta n'a pas encore compté, puis le reprendrait l'heure suivante (relecture du lot E).
 */
export const MARGE_FRAICHEUR_S = 2 * 3600;

/**
 * Une demi-heure de volumes de Meta pour un compte WhatsApp, telle que `pricing_analytics` la rend (`lirePointsVolume`) :
 * le début en secondes Unix (UTC), `phone_number` en chiffres, `pricing_category` et `pricing_type` tels quels, `tier`.
 */
export type PointVolumeMeta = PointVolumeBrut;

/** Une période pendant laquelle une ligne couvrait le compte ; `jusqua: null` : elle le couvre encore. */
export interface Couverture {
  depuis: Date;
  jusqua: Date | null;
}

/** Ce que nos provisions non rendues ont compté sur une demi-heure (rangées par livraison, à défaut par création). */
export interface NosDemiHeures {
  debut: number;
  montantMicroEur: number;
  messages: number;
  /** Les messages dont Meta a accusé la livraison : Meta ne peut pas les ignorer dans ses volumes. */
  livres: number;
}

export interface LigneDetailMeta {
  numero: string | null;
  pays: string | null;
  categorie: string | null;
  type: string;
  palier: string | null;
  volume: number;
  montantMicroEur: number;
}

export interface CalculRegularisation {
  metaMicroEur: number;
  nousMicroEur: number;
  ecartMicroEur: number;
  messagesMeta: number;
  messagesNous: number;
  /** Tous les messages que Meta rend sur les demi-heures comparées, gratuits compris. */
  volumeMeta: number;
  /** Nos messages livrés sur ces demi-heures. */
  livresNous: number;
  /**
   * Des messages facturés que la grille ne sait pas chiffrer (catégorie inconnue, pays absent, aucun tarif) : jamais
   * chiffrés au plus cher, le jour ne s'écrit pas et Julien est prévenu.
   */
  nonChiffres: number;
  demiHeures: number;
  detail: LigneDetailMeta[];
}

/** Les demi-heures ENTIÈRES d'un jour `[debutS, finS)` qu'au moins une période couvrait d'un bout à l'autre. */
export function demiHeuresCouvertes(debutS: number, finS: number, couvertures: readonly Couverture[]): Set<number> {
  const couvertes = new Set<number>();
  for (let t = debutS; t + DEMI_HEURE_S <= finS; t += DEMI_HEURE_S) {
    const entiere = couvertures.some((c) => c.depuis.getTime() / 1000 <= t
      && (c.jusqua === null || c.jusqua.getTime() / 1000 >= t + DEMI_HEURE_S));
    if (entiere) couvertes.add(t);
  }
  return couvertes;
}

/**
 * L'écart d'un jour. Côté Meta : les volumes facturés (`REGULAR`) de CHAQUE compte sur SES seules demi-heures couvertes
 * (deux comptes d'un espace n'ont pas la même ligne : les envois d'un compte avant la pose de sa ligne, payés par la carte
 * du client, ne se comptent jamais sous la couverture de l'autre, relecture du lot E), chacun au prix de la garde (la
 * grille du jour, la commission de l'espace, le palier lu, la catégorie EXACTE que Meta a facturée). Côté nous : nos
 * provisions sur la réunion de ces demi-heures (la garde ne provisionne que des numéros couverts). Pur : la passe lui donne
 * tout ce qu'il lit.
 */
export function calculerRegularisation(e: {
  comptes: ReadonlyArray<{ points: readonly PointVolumeMeta[]; demiHeures: ReadonlySet<number> }>;
  nous: readonly NosDemiHeures[];
  grille: GrilleMeta;
  commissionPct: number;
}): CalculRegularisation {
  const detail = new Map<string, LigneDetailMeta>();
  const reunion = new Set<number>();
  let meta = 0;
  let messagesMeta = 0;
  let volumeMeta = 0;
  let nonChiffres = 0;
  for (const compte of e.comptes) {
    for (const t of compte.demiHeures) reunion.add(t);
    for (const p of compte.points) {
      if (!compte.demiHeures.has(p.debut) || !(p.volume > 0)) continue;
      volumeMeta += p.volume;
      const facture = p.type.toUpperCase() === 'REGULAR';
      let unitaire = 0;
      if (facture) {
        messagesMeta += p.volume;
        // Une catégorie que nous ne connaissons pas ou un pays absent ne se chiffrent pas « au plus cher » : le jour attend.
        const categorie = normaliserCategorie(p.categorie);
        const prix = categorie === null || p.pays === null
          ? null
          : prixMessage(e.grille, p.pays, categorie, e.commissionPct, palierDeTier(p.palier), true);
        if (prix === null) nonChiffres += p.volume; else unitaire = prix;
      }
      const montant = unitaire * p.volume;
      meta += montant;
      const cle = [p.numero, p.pays, p.categorie, p.type, p.palier].join('|');
      const l = detail.get(cle) ?? { numero: p.numero, pays: p.pays, categorie: p.categorie, type: p.type, palier: p.palier, volume: 0, montantMicroEur: 0 };
      l.volume += p.volume;
      l.montantMicroEur += montant;
      detail.set(cle, l);
    }
  }
  let nous = 0;
  let messagesNous = 0;
  let livresNous = 0;
  for (const n of e.nous) {
    if (!reunion.has(n.debut)) continue;
    nous += n.montantMicroEur;
    messagesNous += n.messages;
    livresNous += n.livres;
  }
  return {
    metaMicroEur: meta, nousMicroEur: nous, ecartMicroEur: meta - nous, messagesMeta, messagesNous, volumeMeta, livresNous,
    nonChiffres, demiHeures: reunion.size, detail: [...detail.values()],
  };
}

/** Un écart positif au-delà de la tolérance : Meta a facturé des envois que nous n'avons pas comptés. */
export function horsMessagingMe(c: Pick<CalculRegularisation, 'ecartMicroEur' | 'metaMicroEur'>): boolean {
  return c.ecartMicroEur > Math.max(TOLERANCE_ALERTE_MICRO_EUR, TOLERANCE_ALERTE_PART * c.metaMicroEur);
}

/** Un espace qu'une ligne couvre sur la période, et les comptes WhatsApp de ses lignes. */
export interface EspaceARegulariser {
  tenantId: string;
  nom: string;
  /** Les comptes WhatsApp couverts, chacun avec ses périodes de couverture. */
  comptes: Array<{ wabaId: string; couvertures: Couverture[] }>;
}

/** Un jour de Paris clos, avec ses bornes en secondes Unix (UTC). */
export interface JourDeParis {
  jour: string;
  debutS: number;
  finS: number;
}

export interface RegularisationAEcrire {
  tenantId: string;
  jour: string;
  calcul: CalculRegularisation;
  illimite: boolean;
}

export interface DepsRegularisation {
  store: {
    /**
     * La veille et l'avant-veille de Paris (la veille d'abord), bornes calculées par la base, chacune seulement si elle a
     * fini depuis au moins `margeS` secondes.
     */
    joursClos(margeS: number): Promise<JourDeParis[]>;
    /** Les espaces qu'une ligne couvrait au moins un instant depuis `depuisS`. */
    espacesARegulariser(depuisS: number): Promise<EspaceARegulariser[]>;
    nosDemiHeures(tenantId: string, debutS: number, finS: number): Promise<NosDemiHeures[]>;
    /**
     * Écrit (remplace) la régularisation du jour, et pour un prépayé son mouvement et le solde, dans une transaction sous
     * un verrou par espace et par jour. Rend si l'alerte de ce jour est déjà partie et le solde après l'écriture.
     */
    enregistrer(r: RegularisationAEcrire): Promise<{ alerteDejaPartie: boolean; soldeMicroEur: number }>;
    marquerAlerte(tenantId: string, jour: string): Promise<void>;
  };
  /** La grille en vigueur ce jour-là : celle qui a chiffré les provisions du jour. */
  grilleAu(jour: string): Promise<GrilleMeta | null>;
  conditions(tenantId: string): Promise<ConditionsCredit>;
  /** Les volumes d'un compte sur `[debutS, finS)`, par demi-heure ; `null` : illisibles chez Meta. */
  volumes(tenantId: string, wabaId: string, debutS: number, finS: number): Promise<PointVolumeMeta[] | null>;
  /** Telegram vers Julien ; jamais attendu, ne lève jamais. */
  alerter(cle: string, texte: string): void;
}

const euros = (microEur: number): string => `${(microEur / 1_000_000).toFixed(2).replace('.', ',')} €`;

/**
 * La passe horaire : chaque jour clos de chaque espace couvert est recalculé et remplacé. Un compte illisible chez Meta,
 * une lecture vide alors que nos messages ont été livrés, une grille absente ou un message impossible à chiffrer laissent
 * le jour tel quel (rien n'est écrit sur une lecture douteuse) et préviennent Julien UNE fois par jour et par espace (la
 * passe est horaire) ; une panne sur un espace n'arrête pas les suivants. Rend le nombre de jours écrits.
 */
export function creerRegularisationCreditWhatsapp(d: DepsRegularisation): { passe(): Promise<number> } {
  // La dernière journée de référence à laquelle chaque alerte est partie (la passe tourne dans une seule copie).
  const dejaDites = new Map<string, string>();
  return {
    async passe() {
      const jours = await d.store.joursClos(MARGE_FRAICHEUR_S);
      if (jours.length === 0) return 0;
      const reference = jours[0]!.jour;
      const uneFoisParJour = (cle: string, texte: string): void => {
        if (dejaDites.get(cle) === reference) return;
        dejaDites.set(cle, reference);
        d.alerter(cle, texte);
      };
      const depuisS = Math.min(...jours.map((j) => j.debutS));
      const finS = Math.max(...jours.map((j) => j.finS));
      let ecrits = 0;
      for (const espace of await d.store.espacesARegulariser(depuisS)) {
        try {
          // Les demi-heures couvertes de chaque compte, jour par jour : un compte qui n'en a aucune n'est pas lu chez Meta.
          const couverts = espace.comptes.map((compte) => ({
            compte,
            parJour: jours.map((j) => demiHeuresCouvertes(j.debutS, j.finS, compte.couvertures)),
          })).filter((c) => c.parJour.some((s) => s.size > 0));
          if (couverts.length === 0) continue;
          // Une seule lecture de Meta par compte pour les deux jours.
          const points = new Map<string, PointVolumeMeta[]>();
          let lisible = true;
          for (const { compte } of couverts) {
            const lus = await d.volumes(espace.tenantId, compte.wabaId, depuisS, finS);
            if (lus === null) { lisible = false; break; }
            points.set(compte.wabaId, lus);
          }
          if (!lisible) {
            journaliser('error', 'credit_whatsapp_regularisation_illisible', { tenantId: espace.tenantId });
            uneFoisParJour(`regularisation-illisible:${espace.tenantId}`, `Crédit WhatsApp : les volumes de Meta de « ${espace.nom} » sont illisibles, sa régularisation attend.`);
            continue;
          }
          const nous = await d.store.nosDemiHeures(espace.tenantId, depuisS, finS);
          const { openBar, commissionPct } = await d.conditions(espace.tenantId);
          for (const [i, j] of jours.entries()) {
            const comptes = couverts
              .map((c) => ({ points: points.get(c.compte.wabaId) ?? [], demiHeures: c.parJour[i]! }))
              .filter((c) => c.demiHeures.size > 0);
            if (comptes.length === 0) continue;
            const grille = await d.grilleAu(j.jour);
            if (grille === null) {
              uneFoisParJour('regularisation-sans-grille', `Crédit WhatsApp : aucune grille de Meta en vigueur le ${j.jour}, la régularisation attend.`);
              continue;
            }
            const calcul = calculerRegularisation({ comptes, nous, grille, commissionPct });
            if (calcul.nonChiffres > 0) {
              journaliser('error', 'credit_whatsapp_regularisation_non_chiffree', { tenantId: espace.tenantId, jour: j.jour, messages: calcul.nonChiffres });
              uneFoisParJour(`regularisation-non-chiffree:${espace.tenantId}`, `Crédit WhatsApp : ${calcul.nonChiffres} message(s) de « ${espace.nom} » le ${j.jour} que la grille ne sait pas chiffrer, sa régularisation attend.`);
              continue;
            }
            // Meta ne rend rien alors que nos messages ont été livrés : une omission chez lui rendrait tout le jour au client.
            if (calcul.volumeMeta === 0 && calcul.livresNous > 0) {
              journaliser('error', 'credit_whatsapp_regularisation_meta_vide', { tenantId: espace.tenantId, jour: j.jour, livres: calcul.livresNous });
              uneFoisParJour(`regularisation-meta-vide:${espace.tenantId}`, `Crédit WhatsApp : Meta ne rend aucun volume pour « ${espace.nom} » le ${j.jour}, alors que ${calcul.livresNous} message(s) ont été livrés : sa régularisation attend.`);
              continue;
            }
            const { alerteDejaPartie, soldeMicroEur } = await d.store.enregistrer({ tenantId: espace.tenantId, jour: j.jour, calcul, illimite: openBar });
            ecrits += 1;
            if (horsMessagingMe(calcul) && !alerteDejaPartie) {
              d.alerter(
                `regularisation-hors:${espace.tenantId}:${j.jour}`,
                `Crédit WhatsApp : le ${j.jour}, Meta a facturé à « ${espace.nom} » ${euros(calcul.metaMicroEur)} pour ${calcul.messagesMeta} message(s), nos provisions ${euros(calcul.nousMicroEur)} : ${euros(calcul.ecartMicroEur)} d'envois que nous n'avons pas vus (hors Messaging Me ?). ${openBar ? 'Ajouté au montant à facturer.' : 'Débité de son Crédit WhatsApp.'}`,
              );
              await d.store.marquerAlerte(espace.tenantId, j.jour);
            }
            if (!openBar && soldeMicroEur < SOLDE_RETRAIT_LIGNE_MICRO_EUR) {
              uneFoisParJour(`regularisation-retrait:${espace.tenantId}`, `Crédit WhatsApp : le solde de « ${espace.nom} » est à ${euros(soldeMicroEur)} après régularisation : faire retirer la ligne par le partenaire.`);
            }
          }
        } catch (err) {
          // Une panne sur un espace (base, Meta) n'arrête pas la régularisation des suivants.
          journaliser('error', 'credit_whatsapp_regularisation_echec', { tenantId: espace.tenantId, erreur: err instanceof Error ? err.message : String(err) });
          uneFoisParJour(`regularisation-echec:${espace.tenantId}`, `Crédit WhatsApp : la régularisation de « ${espace.nom} » a échoué (${err instanceof Error ? err.message : String(err)}), elle sera rejouée.`);
        }
      }
      return ecrits;
    },
  };
}
