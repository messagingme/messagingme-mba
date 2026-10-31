import { paysDuNumero } from '../crm/phone';
import { messagingTarget } from '../meta/types';
import { journaliser } from '../lib/journal';
import { normaliserCategorie, prixMessage, type CategorieMeta, type GrilleMeta } from './grille';
import type { IssueProvision, ProvisionDemandee } from './credit';
import type { LigneCredit } from './lignes.pg';
import { CreditWhatsappRefus } from './refus';

/**
 * LA GARDE DU CRÉDIT WHATSAPP (plan du Crédit WhatsApp, tâche 4), posée par la fabrique d'envoi
 * (`MetaClientFactory.clientForTenant`) autour de CHAQUE méthode `send*` du client Meta : le seul point de passage de
 * tous les envois, dans l'API comme dans le worker. Un numéro qui n'est pas sur la ligne ne coûte qu'une lecture en
 * cache ; aucun autre calcul, aucun appel à Meta.
 *
 * Sur un numéro de la ligne, AVANT l'appel à Meta : le prix du message (`prixMessage`, la grille de Meta en vigueur et
 * la commission), zéro pour un message de service encore dans la franchise du numéro, puis la provision atomique. Un
 * solde qui ne couvre pas le message lève `CreditWhatsappRefus('solde')`, une ligne arrêtée ou un message impossible à
 * chiffrer `CreditWhatsappRefus('ligne_inactive')`, et rien ne part. Après l'appel : le wamid rattaché, ou la provision
 * rendue sur un refus net de Meta (un doute la garde : la régularisation tranche).
 */

/** La franchise de Meta : 1 000 messages de service livrés par numéro et par mois, sans report. */
export const FRANCHISE_SERVICE_PAR_NUMERO = 1000;

/** Ce que la fabrique sait d'un envoi au moment de le garder. */
export type NatureEnvoi =
  | { type: 'libre' }
  | { type: 'marketing' }
  | { type: 'modele'; name: string; language: string };

export interface EnvoiAGarder {
  tenantId: string;
  phoneNumberId: string;
  /** Le destinataire tel que l'envoi le reçoit : numéro (avec ou sans « + ») ou identifiant Meta. */
  destinataire: string;
  nature: NatureEnvoi;
}

export interface GardeCreditWhatsapp {
  /** `provisionId: null` : le numéro n'est pas sur la ligne, rien à faire après l'envoi. Lève `CreditWhatsappRefus`. */
  avant(e: EnvoiAGarder): Promise<{ provisionId: string | null }>;
  apres(provisionId: string, wamid: string): Promise<void>;
  /** `net` : Meta (ou une garde avant lui) a refusé, rien n'est parti ; sinon un doute, la provision reste. */
  surEchec(provisionId: string, net: boolean): Promise<void>;
  /**
   * Le refus certain AVANT tout effet (ligne arrêtée, aucune grille, solde nul hors open bar), `null` sinon. Un parcours
   * qui enverra par WhatsApp le lit avant ses effets (`MetaClientFactory.verifierAvantEffets`), pour qu'un e-mail ou un
   * appel d'API placés avant un modèle ne partent pas à sec. Un solde positif mais sous le prix du message passe ici et
   * sera refusé à l'envoi.
   */
  refusAvantEffets(tenantId: string, phoneNumberId: string): Promise<CreditWhatsappRefus | null>;
  /**
   * Le Crédit WhatsApp bloque-t-il ce numéro AVANT tout effet ? La même lecture que `refusAvantEffets`. Le démarreur du
   * répondeur et le tour d'un agent le demandent avant d'appeler un modèle : une réponse qui ne partirait pas ne se paie
   * pas.
   */
  bloque(tenantId: string, phoneNumberId: string): Promise<boolean>;
}

export interface ConditionsCredit {
  /** Entreprise en open bar : jamais de refus pour le solde, tout est compté. */
  openBar: boolean;
  commissionPct: number;
}

export interface DepsGardeCredit {
  lignes: { ligneDuNumero(phoneNumberId: string): Promise<LigneCredit | null> };
  grille(): Promise<GrilleMeta | null>;
  conditions(tenantId: string): Promise<ConditionsCredit>;
  /** La catégorie d'un modèle, lue chez Meta (`creerLecteurCategorie`) ; `null` si illisible. */
  categorieDuModele(tenantId: string, name: string, language: string): Promise<CategorieMeta | null>;
  credit: {
    provisionner(p: ProvisionDemandee): Promise<IssueProvision>;
    rattacher(provisionId: string, wamid: string): Promise<void>;
    rendre(provisionId: string): Promise<void>;
    serviceDuMois(phoneNumberId: string, mois: string, plafond: number): Promise<number>;
    solde(tenantId: string): Promise<number>;
  };
  /**
   * Les e-mails aux admins (`creerAlertesCreditWhatsapp`, plan du Crédit WhatsApp, tâche 11) : le débit qui fait passer le
   * solde sous 10 €, et un refus faute de solde. Jamais attendus par l'envoi, jamais en open bar (rien n'y est acheté).
   * 🔴 Requises : oubliées par un câblage, un client découvrirait que ses messages ne partent plus sans en avoir été averti.
   */
  alertes: {
    surDebit(tenantId: string, avantMicroEur: number, apresMicroEur: number): Promise<void>;
    surEpuise(tenantId: string): Promise<void>;
  };
  maintenant?: () => Date;
}

/** Le pays du destinataire : `null` pour un identifiant Meta sans numéro, provisionné au plus cher. */
function paysDuDestinataire(destinataire: string): string | null {
  return 'to' in messagingTarget(destinataire) ? paysDuNumero(destinataire) : null;
}

export function creerGardeCreditWhatsapp(d: DepsGardeCredit): GardeCreditWhatsapp {
  const maintenant = d.maintenant ?? (() => new Date());
  // Une alerte ne retarde ni ne fait échouer un envoi : lancée, jamais attendue, son échec avalé (elle journalise déjà).
  const signalerEpuise = (tenantId: string): void => { d.alertes.surEpuise(tenantId).catch(() => undefined); };
  // Une fonction locale, pas `this` : `bloque` reste juste même appelée détachée de la garde.
  const refusAvantEffets = async (tenantId: string, phoneNumberId: string): Promise<CreditWhatsappRefus | null> => {
    const ligne = await d.lignes.ligneDuNumero(phoneNumberId);
    if (ligne === null) return null;
    if (ligne.tenantId !== tenantId || ligne.arreteeLe !== null) return new CreditWhatsappRefus('ligne_inactive');
    if ((await d.grille()) === null) return new CreditWhatsappRefus('ligne_inactive');
    if ((await d.conditions(tenantId)).openBar) return null;
    const solde = await d.credit.solde(tenantId);
    if (solde > 0) return null;
    signalerEpuise(tenantId);
    // Le prix du prochain message n'est pas connu ici : il manque au moins de quoi rendre le solde positif. Le prix d'un
    // micro-euro fait écrire la pause d'une campagne seulement si le solde est ENCORE nul (`pauserCampagneCredit`) : un
    // achat arrivé entre ce refus et la pause a déjà levé les pauses de l'espace, et la sienne ne serait levée par personne.
    return new CreditWhatsappRefus('solde', 1 - solde, 1);
  };
  return {
    refusAvantEffets,
    async avant(e) {
      const ligne = await d.lignes.ligneDuNumero(e.phoneNumberId);
      if (ligne === null) return { provisionId: null };
      if (ligne.tenantId !== e.tenantId) {
        // Un numéro n'appartient qu'à un espace : une ligne d'un autre espace est une incohérence, on refuse fermé.
        journaliser('error', 'credit_whatsapp_ligne_autre_espace', { tenantId: e.tenantId, ligneTenantId: ligne.tenantId });
        throw new CreditWhatsappRefus('ligne_inactive');
      }
      if (ligne.arreteeLe !== null) throw new CreditWhatsappRefus('ligne_inactive');
      const grille = await d.grille();
      if (grille === null) {
        journaliser('error', 'credit_whatsapp_sans_grille', { tenantId: e.tenantId });
        throw new CreditWhatsappRefus('ligne_inactive');
      }
      const { openBar, commissionPct } = await d.conditions(e.tenantId);
      const categorie: CategorieMeta | null = e.nature.type === 'libre'
        ? 'service'
        : e.nature.type === 'marketing' ? 'marketing' : await d.categorieDuModele(e.tenantId, e.nature.name, e.nature.language);
      const pays = paysDuDestinataire(e.destinataire);
      const dansLaFranchise = categorie === 'service'
        && await d.credit.serviceDuMois(e.phoneNumberId, maintenant().toISOString().slice(0, 7), FRANCHISE_SERVICE_PAR_NUMERO) < FRANCHISE_SERVICE_PAR_NUMERO;
      const montant = dansLaFranchise ? 0 : prixMessage(grille, pays, categorie, commissionPct);
      if (montant === null) {
        journaliser('error', 'credit_whatsapp_sans_tarif', { tenantId: e.tenantId, pays, categorie });
        throw new CreditWhatsappRefus('ligne_inactive');
      }
      const issue = await d.credit.provisionner({
        tenantId: e.tenantId,
        phoneNumberId: e.phoneNumberId,
        pays,
        // Une catégorie illisible est provisionnée au plus cher des modèles ; l'accusé de Meta la corrige.
        categorie: categorie ?? 'marketing',
        montantMicroEur: montant,
        openBar,
      });
      // Ce qui manque pour que CE message parte : couvrir son prix, et laisser un solde positif avant lui (un solde nul ne
      // laisse rien partir, même un message à zéro). Au moins un micro-euro, même si un crédit est arrivé entre-temps.
      if (!issue.ok) {
        signalerEpuise(e.tenantId);
        throw new CreditWhatsappRefus('solde', Math.max(1, Math.max(montant, 1) - issue.soldeMicroEur), montant);
      }
      if (!openBar) {
        d.alertes.surDebit(e.tenantId, issue.soldeApresMicroEur + montant, issue.soldeApresMicroEur).catch(() => undefined);
      }
      return { provisionId: issue.provisionId };
    },

    async bloque(tenantId, phoneNumberId) {
      return (await refusAvantEffets(tenantId, phoneNumberId)) !== null;
    },

    async apres(provisionId, wamid) {
      // Le message est parti : un rattachement manqué ne doit pas le faire passer pour un échec. La régularisation
      // rattrape une provision sans wamid.
      try {
        await d.credit.rattacher(provisionId, wamid);
      } catch (err) {
        journaliser('error', 'credit_whatsapp_rattachement', { err, provisionId });
      }
    },

    async surEchec(provisionId, net) {
      if (!net) return;
      try {
        await d.credit.rendre(provisionId);
      } catch (err) {
        journaliser('error', 'credit_whatsapp_rendu', { err, provisionId });
      }
    },
  };
}

/** Ce qu'un client de modèles rend d'un modèle, pour en lire la catégorie. */
interface ModeleLu {
  name: string;
  language: string;
  category?: string | null;
}

export interface DepsLecteurCategorie {
  wabaDeLEspace(tenantId: string): Promise<string | null>;
  modeles(tenantId: string): Promise<{ list(wabaId: string): Promise<readonly ModeleLu[]> }>;
  maintenant?: () => number;
}

/** Cinq minutes : un modèle ne change pas de catégorie d'un envoi à l'autre, et Meta corrige à l'accusé s'il l'a fait. */
const CACHE_CATEGORIE_MS = 5 * 60_000;
/**
 * Trente secondes pour une lecture RATÉE : sans elle, chaque envoi d'une campagne relirait la liste des modèles pendant
 * toute une panne de Meta. Le temps de ce cache, le message se provisionne au plus cher, et l'accusé corrige.
 */
const CACHE_ECHEC_CATEGORIE_MS = 30_000;

/**
 * La catégorie d'un modèle, lue chez Meta (jamais dans la requête ni dans la campagne, qui sont des choix de
 * consentement), gardée cinq minutes par processus, une lecture en vol partagée par les envois simultanés. Seule la garde
 * l'appelle, et seulement sur un numéro de la ligne. Toute lecture ratée rend `null` : le message se provisionne alors au
 * plus cher des modèles.
 */
export function creerLecteurCategorie(d: DepsLecteurCategorie): DepsGardeCredit['categorieDuModele'] {
  const maintenant = d.maintenant ?? (() => Date.now());
  const cache = new Map<string, { lue: number; categorie: CategorieMeta | null; echec: boolean }>();
  const enVol = new Map<string, Promise<CategorieMeta | null>>();
  const lire = async (tenantId: string, name: string, language: string, cle: string): Promise<CategorieMeta | null> => {
    let categorie: CategorieMeta | null = null;
    try {
      const waba = await d.wabaDeLEspace(tenantId);
      if (waba !== null) {
        const liste = await (await d.modeles(tenantId)).list(waba);
        const modele = liste.find((m) => m.name === name && m.language === language) ?? liste.find((m) => m.name === name);
        categorie = normaliserCategorie(modele?.category ?? null);
      }
    } catch (err) {
      journaliser('warn', 'credit_whatsapp_categorie_illisible', { err, tenantId });
      cache.set(cle, { lue: maintenant(), categorie: null, echec: true });
      return null;
    }
    cache.set(cle, { lue: maintenant(), categorie, echec: false });
    return categorie;
  };
  return async (tenantId, name, language) => {
    const cle = `${tenantId}|${name}|${language}`;
    const c = cache.get(cle);
    if (c !== undefined && maintenant() - c.lue < (c.echec ? CACHE_ECHEC_CATEGORIE_MS : CACHE_CATEGORIE_MS)) return c.categorie;
    const deja = enVol.get(cle);
    if (deja !== undefined) return deja;
    const lecture = lire(tenantId, name, language, cle).finally(() => enVol.delete(cle));
    enVol.set(cle, lecture);
    return lecture;
  };
}
