import { z, type ZodError } from 'zod';
import { journaliser } from '../lib/journal';
import { messageDe } from '../lib/erreur';
import { moisDeParis } from '../offres/compteurs';
import { MAX_OPT_IN_SOURCE } from '../api/contacts-upsert';
import type { Emission } from '../emails-produit/emission';
import {
  donneesDeCommande, donneesDExpedition, schemaCommande, schemaDemandeDonnees,
  schemaEffacementClient, schemaExpedition, telephoneDeCommande, telephoneDExpedition, telephoneE164,
  avecPrenomDeSecours, estObjetSimple, numeroDeCommandeDExpedition, prenomDeCheckout, schemaCheckout, telephoneDeCheckout, valeurDeVariable,
  classementDeCommande, type CommandeShopify, type DonneeShopify, type EvenementShopify, type ExpeditionShopify,
} from './donnees';
import type { PgJoignabiliteStore } from './joignabilite.pg';
import { envoyerPremierBloc, pontSelonLOffre, type DepsEnvoiShopify, type IssueShopify } from './envoi';
import { PREFIXE_LIGNE_SHOPIFY, attribuerCommande, detailsDeCommande } from './attribution';
import { origineShopify, prefixeShopify } from './lignes';
import { LIGNES_DU_PANIER } from '../../web/lib/partage/shopify-messages';
import { donneeManquante, premierBloc, type LecturesPremierBloc } from './premier-bloc';
import type { DetailsCommande, EtatBoutique, OrigineBoutique, PgShopifyStore } from './store.pg';
import type { SourceOffres } from '../offres/offre.pg';
import type { WorkflowExecutor } from '../workflow/executor';
import type { PgVentesStore } from './ventes.pg';
import type { ProgrammerPreuve } from './preuve-utm';
import { etiquettesUtiles } from './etiquettes-lues';
import type { PgEtiquettesStore, SensEtiquettes } from './etiquettes.pg';

/**
 * LE TRAITEMENT D'UN WEBHOOK SHOPIFY DÉJÀ VÉRIFIÉ (plan 2026-10-21, lot 1), sujet par sujet.
 *
 * 🔴 DANS LA REQUÊTE, ET SHOPIFY EST LA FILE. L'envoi public n'existe que dans le processus de l'API (ses dépendances
 * se construisent dans `src/index.ts`), et les recopier dans le worker serait une liste tenue à la main. Shopify attend
 * sa réponse en 5 s et réessaie ce qui n'a pas reçu de 2xx : un 503 rendu ici est donc un « réessayez », jamais une
 * perte, et le traitement est rejouable de bout en bout (réservation de l'événement, clé d'idempotence de l'envoi).
 *
 * 🔴 AUCUN ORDRE ENTRE SUJETS (mesuré : `orders/paid` arrive avant `orders/create`). Chaque sujet se suffit à lui-même.
 *
 * Une boutique `coupee` n'envoie plus rien, mais ses trois sujets RGPD se traitent encore : Shopify envoie `shop/redact`
 * environ 48 h après la désinstallation.
 *
 * 🔴 CHAQUE ENVOI NÉ D'UN ÉVÉNEMENT SHOPIFY ÉCRIT LA FICHE CONSENTANTE (décision de Julien du 2026-10-26, suite de celle du
 * 2026-10-25 : « par principe, les contacts sont opt in, c'est la responsabilité du client ; on respecte le STOP ») :
 * source `shopify:<boutique>`, et `appliquerConsentement` refuse toujours de lever un STOP (chemin partagé).
 */

export interface BoutiqueRecue {
  tenantId: string;
  domaine: string;
  etat: EtatBoutique;
  pays: string | null;
  /** La devise de la boutique : le montant d'une vente attribuée quand la commande ne porte pas `shop_money`. */
  devise: string | null;
  /** `console` : une boutique désinstallée perd son branchement, `shop/redact` ne viendra jamais (conception 2026-10-22). */
  origine: OrigineBoutique;
  /** La pause (lot 5, décision 15) : rien ne part et rien ne se réserve ; l'attribution, les paniers fermés et le RGPD continuent. */
  pause: boolean;
}

export interface DepsTraitementShopify {
  store: Pick<PgShopifyStore,
    'ligne' | 'reserverEvenement' | 'noterIssue' | 'libererEvenement' | 'noterDernierEvenement' | 'lierCommande'
    | 'couperParDomaine' | 'effacerBoutique' | 'contactsLies' | 'noterPanier' | 'fermerPanier' | 'fermerPanierExistant'
    | 'fermerPaniersDuTelephone' | 'effacerPaniersDuTelephone' | 'oublierClientShopify'>;
  /** L'envoi public (le premier bloc, un template, filière API) et la filière lue à l'envoi. */
  envoyer: DepsEnvoiShopify['envoyer'];
  filiere: DepsEnvoiShopify['filiere'];
  /** Ce que lit le premier bloc d'une ligne (`./premier-bloc.ts`) : les magasins des scénarios et des indices, ENTIERS. */
  lectures: LecturesPremierBloc;
  /** L'offre de l'espace (en cache court) : le pont ne se pose qu'avec la fonction `scenarios` (appel A6 du lot 5). */
  offres: SourceOffres;
  /** L'exécuteur des parcours, ENTIER (sa méthode lit `this`) : la fermeture d'un panier arrête son parcours. */
  parcours: Pick<WorkflowExecutor, 'arreterParcours'>;
  /** La fiche vivante d'un numéro E.164 dans l'espace, ou `null`. */
  ficheParTelephone(tenantId: string, e164: string): Promise<string | null>;
  /**
   * L'effacement de fiches demandé par Shopify, HORS limite d'effacements du jour : une obligation légale ne bute pas
   * sur une limite commerciale, et la demande est signée par la boutique elle-même.
   */
  effacerFiches(tenantId: string, ids: readonly string[]): Promise<void>;
  emails: { emettre(e: Emission): Promise<unknown> };
  /** La page Offre de la console, pour l'e-mail de la limite de contacts. */
  pageOffre: string;
  maintenant?: () => number;
  /** Les ventes attribuées (plan 2026-10-28) : les touches d'un contact, le panier relancé, la vente figée, l'anonymisation. */
  ventes: Pick<PgVentesStore, 'touches' | 'derniereToucheDuModele' | 'panierRelance' | 'enregistrer' | 'anonymiserCommandes'>;
  /** Le budget de l'attribution, `BUDGET_ATTRIBUTION_MS` par défaut (les tests le raccourcissent). */
  budgetAttributionMs?: number;
  /** Enfiler la relecture de la preuve par UTM d'une commande (file `shopify-preuve-utm`, traitée par le worker). */
  programmerPreuve: ProgrammerPreuve;
  /**
   * La joignabilité WhatsApp des commandes (segments Shopify enrichis, lot 2b), passée ENTIÈRE : chaque écriture se fait
   * au mieux (`joignabiliteAuMieux`), jamais un frein pour la confirmation.
   */
  joignabilite: Pick<PgJoignabiliteStore, 'noterCommande' | 'noterExpedition' | 'noterEnvoi' | 'effacerCommandes'>;
  /**
   * Écrit le lien de suivi du dernier colis dans le champ `CHAMP_LIEN_SUIVI` de la fiche, déclaré au besoin (agent IA,
   * 2026-11-23) : l'agent le lit avec la fiche pour répondre à « où en est ma commande ? ». N'émet AUCUN événement
   * d'automation : un champ écrit par un webhook n'est pas un geste du contact.
   */
  ecrireLienDeSuivi(tenantId: string, contactId: string, lien: string): Promise<void>;
  /** Les étiquettes en direct (segments Shopify enrichis, lot 6d) : le magasin de la synchronisation, ENTIER. */
  etiquettes: Pick<PgEtiquettesStore, 'appliquerDuWebhook' | 'fusionnerClients'>;
}

/** La clé du champ de fiche qui porte le lien de suivi du dernier colis expédié. */
export const CHAMP_LIEN_SUIVI = 'shopify_lien_suivi';
/** La borne d'une valeur de champ de fiche : au-delà, le lien n'est pas écrit (coupé, il mènerait ailleurs). */
const LIEN_SUIVI_MAX = 1000;

/**
 * Le lien de suivi d'une expédition, s'il est utilisable : une adresse http(s) entière. Lu BRUT, pas par
 * `valeurDeVariable` qui coupe à la borne d'une variable de message : un lien coupé mènerait ailleurs.
 */
export function lienDeSuivi(f: ExpeditionShopify): string | null {
  const brut = typeof f.tracking_url === 'string' ? f.tracking_url.trim() : '';
  if (brut === '' || brut.length > LIEN_SUIVI_MAX || /\s/.test(brut)) return null;
  try {
    const u = new URL(brut);
    return u.protocol === 'https:' || u.protocol === 'http:' ? brut : null;
  } catch {
    return null;
  }
}

/**
 * 🔴 LE LIEN DE SUIVI SUR LA FICHE, AU MIEUX (2026-11-23). À chaque expédition, ligne allumée ou non et pause comprise
 * (c'est une donnée, pas un envoi), et seulement sur une fiche qui existe déjà : jamais une fiche créée pour l'écrire.
 * Le dernier colis remplace le précédent. Une panne se journalise et ne lève pas : le message d'expédition attendu par
 * le client compte plus que ce champ.
 */
async function lienDeSuiviAuMieux(deps: DepsTraitementShopify, b: BoutiqueRecue, f: ExpeditionShopify): Promise<void> {
  const lien = lienDeSuivi(f);
  if (lien === null) return;
  const telephone = telephoneDExpedition(f, b.pays);
  if (telephone === null) return;
  try {
    const fiche = await deps.ficheParTelephone(b.tenantId, telephone);
    if (fiche !== null) await deps.ecrireLienDeSuivi(b.tenantId, fiche, lien);
  } catch (err) {
    journaliser('warn', 'shopify_lien_suivi_en_echec', { tenantId: b.tenantId, erreur: messageDe(err) });
  }
}

/** 200 : traité ou délibérément ignoré. 503 : Shopify doit réessayer plus tard. */
export interface ReponseTraitement { statut: 200 | 503 }

const OK: ReponseTraitement = { statut: 200 };
const REESSAYER: ReponseTraitement = { statut: 503 };

/** Le nom de la ligne dans Campagnes, par événement. */
const LIBELLE: Readonly<Record<EvenementShopify, string>> = {
  order_paid: 'commande payée',
  order_fulfilled: 'commande expédiée',
  checkout_abandoned: 'panier abandonné',
};

/**
 * Les issues qui ne sont pas un envoi : le traitement s'arrête avant l'envoi public. `premier_message_absent` : la ligne
 * est allumée mais son scénario n'a pas de premier bloc prêt (template pas encore écrit, scénario retiré).
 */
type IssueAvantEnvoi = 'sans_telephone' | 'donnee_manquante' | 'premier_message_absent';
export type IssueEvenement = Exclude<IssueShopify, 'en_cours'> | IssueAvantEnvoi;

const SUJETS_RGPD = new Set(['customers/redact', 'customers/data_request', 'shop/redact']);

/**
 * LES DEUX SUJETS D'ÉTIQUETTES (lot 6d). La doc de Shopify écrit le sujet `customer.tags_added` sans dire la valeur de
 * l'en-tête `X-Shopify-Topic` : les deux écritures sont acceptées, et un sujet inconnu se journalise par son nom.
 */
const SENS_DU_SUJET: Readonly<Record<string, SensEtiquettes>> = {
  'customer.tags_added': 'ajout', 'customers/tags_added': 'ajout',
  'customer.tags_removed': 'retrait', 'customers/tags_removed': 'retrait',
};
/** L'identifiant d'un client Shopify dans son GID (`gid://shopify/Customer/<n>`), ou rien. */
const idClient = (gid: string): string | undefined => /^gid:\/\/shopify\/Customer\/(\d{1,19})$/.exec(gid)?.[1];
/** Le corps d'un webhook d'étiquettes, d'après l'exemple de la doc : `{ customerId, tags, occurredAt }`. */
const schemaEtiquettesClient = z.object({ customerId: z.string(), tags: z.array(z.unknown()) });

/**
 * 🔴 UN WEBHOOK D'ÉTIQUETTES RÉPOND TOUJOURS 200 (recommandation de la spec) : une panne d'écriture se journalise au lieu
 * de faire réessayer Shopify pendant des heures sur un client bavard ; la relecture quotidienne répare. Une étiquette
 * n'est pas une confirmation de commande.
 */
async function etiquettesDuClient(deps: DepsTraitementShopify, b: BoutiqueRecue, sujet: string, sens: SensEtiquettes, corps: unknown): Promise<ReponseTraitement> {
  const e = schemaEtiquettesClient.safeParse(corps);
  const clientId = e.success ? idClient(e.data.customerId) : undefined;
  if (!e.success || clientId === undefined) {
    journaliser('warn', 'shopify_etiquettes_webhook_illisible', { tenantId: b.tenantId, sujet });
    return OK;
  }
  try {
    const n = await deps.etiquettes.appliquerDuWebhook(b.tenantId, clientId, etiquettesUtiles(e.data.tags).etiquettes, sens);
    if (n > 0) journaliser('info', 'shopify_etiquettes_webhook', { tenantId: b.tenantId, sujet, etiquettes: e.data.tags.length, lignes: n });
  } catch (err) {
    journaliser('warn', 'shopify_etiquettes_webhook_en_echec', { tenantId: b.tenantId, sujet, erreur: messageDe(err) });
  }
  return OK;
}

/**
 * LA FUSION DE DEUX CLIENTS (lot 7d), d'après le corps d'exemple de la doc : les GID du client gardé et du client absorbé,
 * et le statut de la demande. 🔴 La doc ne dit pas quand l'événement part : seul un statut `completed`, en toutes lettres,
 * agit ; tout autre statut se journalise. Un corps illisible journalise le NOM de ses clés, jamais leurs valeurs (de quoi
 * mesurer le vrai contrat sans rien garder d'un client). Toujours 200 : la relecture des étiquettes répare.
 */
const schemaFusion = z.object({
  admin_graphql_api_customer_kept_id: z.string(),
  admin_graphql_api_customer_deleted_id: z.string(),
  status: z.string(),
});

async function fusionDeClients(deps: DepsTraitementShopify, b: BoutiqueRecue, corps: unknown): Promise<ReponseTraitement> {
  const f = schemaFusion.safeParse(corps);
  const garde = f.success ? idClient(f.data.admin_graphql_api_customer_kept_id) : undefined;
  const absorbe = f.success ? idClient(f.data.admin_graphql_api_customer_deleted_id) : undefined;
  if (!f.success || garde === undefined || absorbe === undefined) {
    const cles = corps !== null && typeof corps === 'object' && !Array.isArray(corps) ? Object.keys(corps).slice(0, 20) : [];
    journaliser('warn', 'shopify_fusion_illisible', { tenantId: b.tenantId, cles });
    return OK;
  }
  const statut = f.data.status.slice(0, 40);
  if (statut.toLowerCase() !== 'completed') {
    journaliser('info', 'shopify_fusion_non_terminee', { tenantId: b.tenantId, statut });
    return OK;
  }
  try {
    const r = await deps.etiquettes.fusionnerClients(b.tenantId, garde, absorbe);
    journaliser('info', 'shopify_fusion', { tenantId: b.tenantId, ...r });
  } catch (err) {
    journaliser('warn', 'shopify_fusion_en_echec', { tenantId: b.tenantId, erreur: messageDe(err) });
  }
  return OK;
}

export async function traiterWebhookShopify(
  deps: DepsTraitementShopify, b: BoutiqueRecue, sujet: string, corps: unknown,
): Promise<ReponseTraitement> {
  // Une boutique coupée n'écoute plus que le RGPD, et la désinstallation d'une boutique de la console : c'est le seul
  // signal qui efface son branchement, le parcours nominal étant « Couper » puis désinstaller (relecture des lots 0 et 1).
  if (b.etat === 'coupee' && !SUJETS_RGPD.has(sujet) && !(sujet === 'app/uninstalled' && b.origine === 'console')) return OK;
  const sens = SENS_DU_SUJET[sujet];
  if (sens !== undefined) return etiquettesDuClient(deps, b, sujet, sens, corps);
  switch (sujet) {
    case 'orders/paid': {
      const c = schemaCommande.safeParse(corps);
      if (!c.success) return illisible(b, sujet, c.error);
      // 🔴 L'attribution AVANT tout le reste, et jamais un frein : la confirmation attendue par le client compte plus que
      // notre chiffre, et une panne ici ne doit ni la bloquer ni faire réessayer Shopify en boucle (plan 2026-10-28).
      await attribuerSansFreiner(deps, b, c.data);
      // Une commande payée ferme aussi son panier : `orders/create` peut arriver après (aucun ordre entre sujets).
      await fermerSiPanier(deps, b, c.data.checkout_token, telephoneDeCommande(c.data, b.pays));
      // Son classement (sans numéro, invalide ou fixe, utilisable), ligne allumée ou non, pause comprise : la carte lit
      // toutes les commandes d'une boutique branchée. Aucun téléphone n'y est écrit.
      await joignabiliteAuMieux(b, 'commande', () => deps.joignabilite.noterCommande(
        b.tenantId, String(c.data.id), classementDeCommande(c.data, b.pays), c.data.test === true,
      ));
      return servir(deps, b, {
        evenement: 'order_paid', reference: String(c.data.id), sujet,
        commandeId: String(c.data.id), clientId: c.data.customer?.id ? String(c.data.customer.id) : null,
        telephone: telephoneDeCommande(c.data, b.pays), valeurs: donneesDeCommande(c.data), numero: c.data.name,
        details: detailsDeCommande(c.data, b, deps.maintenant ?? Date.now),
      });
    }
    case 'fulfillments/create': {
      const f = schemaExpedition.safeParse(corps);
      if (!f.success) return illisible(b, sujet, f.error);
      // La PREMIÈRE expédition de la commande (un second colis ne la déplace pas), ligne allumée ou non. Une commande dont
      // le paiement n'a pas été vu (payée avant la mise en service) naît ici sans classement : la carte l'ignore.
      await joignabiliteAuMieux(b, 'expedition', () => deps.joignabilite.noterExpedition(b.tenantId, String(f.data.order_id)));
      await lienDeSuiviAuMieux(deps, b, f.data);
      return servir(deps, b, {
        evenement: 'order_fulfilled', reference: String(f.data.id), sujet,
        commandeId: String(f.data.order_id), clientId: null,
        telephone: telephoneDExpedition(f.data, b.pays), valeurs: donneesDExpedition(f.data),
        numero: numeroDeCommandeDExpedition(f.data.name),
      });
    }
    case 'orders/create': {
      // Le panier se ferme dès qu'une commande en naît, même non payée : un client qui a commandé par virement ne
      // reçoit pas « vous avez oublié votre panier ».
      const c = schemaCommande.safeParse(corps);
      if (!c.success) return illisible(b, sujet, c.error);
      await fermerSiPanier(deps, b, c.data.checkout_token, telephoneDeCommande(c.data, b.pays));
      return OK;
    }
    case 'checkouts/create':
    case 'checkouts/update':
      return noterCheckout(deps, b, sujet, corps);
    case 'app/uninstalled':
      // Une boutique de la console ne recevra jamais shop/redact (ses sujets RGPD ne s'abonnent pas sans la CLI) : son
      // branchement part tout de suite, le secret ne servait plus qu'à vérifier ce sujet. Les fiches restent.
      if (b.origine === 'console') await deps.store.effacerBoutique(b.tenantId);
      else await deps.store.couperParDomaine(b.domaine, 'app désinstallée de la boutique');
      return OK;
    case 'customers/redact':
      return effacerClient(deps, b, corps);
    case 'customers/merge':
      return fusionDeClients(deps, b, corps);
    case 'customers/data_request': {
      const d = schemaDemandeDonnees.safeParse(corps);
      if (!d.success) return illisible(b, sujet, d.error);
      const jour = new Date((deps.maintenant ?? Date.now)()).toISOString().slice(0, 10);
      await deps.emails.emettre({
        cle: 'shopify_demande_donnees', tenantId: b.tenantId, a: 'admins',
        occasion: `${b.domaine}:${d.data.customer?.id ?? (d.data.orders_requested ?? []).join(',')}:${jour}`.slice(0, 200),
        valeurs: { boutique: b.domaine },
      });
      return OK;
    }
    case 'shop/redact':
      // Shopify l'envoie ~48 h après la désinstallation. Une boutique reconnectée entre-temps est `connectee` : ne pas
      // effacer un branchement vivant (relecture du lot 1).
      if (b.etat === 'connectee') {
        journaliser('warn', 'shopify_shop_redact_ignore', { tenantId: b.tenantId });
        return OK;
      }
      await deps.store.effacerBoutique(b.tenantId);
      return OK;
    default:
      // Un sujet inconnu ne se réessaie pas ; son nom se journalise (un en-tête qu'on n'attendait pas se voit ainsi).
      journaliser('info', 'shopify_sujet_inconnu', { tenantId: b.tenantId, sujet: sujet.slice(0, 80) });
      return OK;
  }
}

/**
 * Le temps que l'attribution peut prendre avant la confirmation. Shopify coupe à 5 s ; base saturée, l'attribution
 * (cinq allers-retours) pourrait les manger. Au-delà, on n'attend plus : elle finit ou se perd seule, la confirmation part.
 */
export const BUDGET_ATTRIBUTION_MS = 1500;

/** L'attribution d'une commande, bornée dans le temps et sans jamais lever : une panne ou une lenteur se journalise. */
async function attribuerSansFreiner(deps: DepsTraitementShopify, b: BoutiqueRecue, c: CommandeShopify): Promise<void> {
  const budget = deps.budgetAttributionMs ?? BUDGET_ATTRIBUTION_MS;
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const attribution = attribuerCommande(deps, b, c).then(
    () => 'finie' as const,
    (err: unknown) => {
      journaliser('error', 'shopify_attribution_en_echec', { tenantId: b.tenantId, erreur: messageDe(err) });
      return 'finie' as const;
    },
  );
  const issue = await Promise.race([attribution, new Promise<'hors_budget'>((r) => { minuterie = setTimeout(() => r('hors_budget'), budget); })]);
  clearTimeout(minuterie);
  if (issue === 'hors_budget') journaliser('warn', 'shopify_attribution_hors_budget', { tenantId: b.tenantId, budgetMs: budget });
}

/**
 * 🔴 LA JOIGNABILITÉ S'ÉCRIT AU MIEUX (segments Shopify enrichis, lot 2b) : une panne se journalise et le traitement
 * continue. Ni la confirmation ni son issue n'en dépendent, et la migration 0310 n'est pas bloquante : sa table absente,
 * chaque écriture échoue ici, seule.
 */
async function joignabiliteAuMieux(b: BoutiqueRecue, quoi: 'commande' | 'expedition' | 'effacement', ecrire: () => Promise<void>): Promise<void> {
  try {
    await ecrire();
  } catch (err) {
    journaliser('warn', 'shopify_joignabilite_en_echec', { tenantId: b.tenantId, quoi, erreur: messageDe(err) });
  }
}

/**
 * La relance est-elle allumée ? Sa ligne allumée, et la boutique hors pause (lot 5). Sans elle, aucun panier ne se garde :
 * un téléphone sans raison.
 */
async function relanceActive(deps: DepsTraitementShopify, b: BoutiqueRecue): Promise<boolean> {
  if (b.pause) return false;
  // L'une des deux relances du panier (la normale, ou celle avec agent IA : exclusives, 2026-11-20).
  for (const l of LIGNES_DU_PANIER) if ((await deps.store.ligne(b.tenantId, l))?.actif === true) return true;
  return false;
}

/**
 * Une commande ferme son panier. 🔴 TOUJOURS celui qui existe, relance éteinte comprise : éteinte puis rallumée, elle
 * relançait sinon le client qui avait commandé pendant la pause (rouge de la relecture du lot 2). La ligne d'un panier
 * pas encore reçu (fermeture avant le panier) ne s'écrit, elle, que relance active. Et les autres paniers ouverts du
 * même numéro se ferment aussi : un achat express passe par un autre checkout. Puis leurs parcours s'arrêtent.
 */
async function fermerSiPanier(deps: DepsTraitementShopify, b: BoutiqueRecue, jeton: string | null | undefined, telephone: string | null): Promise<void> {
  if (jeton) {
    if (await relanceActive(deps, b)) await deps.store.fermerPanier(b.tenantId, jeton);
    else await deps.store.fermerPanierExistant(b.tenantId, jeton);
  }
  if (telephone !== null) await deps.store.fermerPaniersDuTelephone(b.tenantId, telephone);
  await arreterParcoursDuPanier(deps, b, jeton, telephone);
}

/**
 * 🔴 LE PARCOURS D'UN PANIER S'ARRÊTE QUAND UNE COMMANDE EN NAÎT (menu « Scénario », lot 5, décision 4) : celui de ce
 * jeton, et ceux des autres paniers du même numéro. AVANT la confirmation, pour que le parcours de la commande trouve la
 * place unique libre. Jamais bloquant : une panne se journalise et la confirmation part (anti-objectif 1) ; la règle
 * « encore voulu » (`panierOuvert`) arrêterait de toute façon ce parcours à son prochain pas.
 */
async function arreterParcoursDuPanier(
  deps: DepsTraitementShopify, b: BoutiqueRecue, jeton: string | null | undefined, telephone: string | null,
): Promise<void> {
  try {
    if (jeton) {
      await deps.parcours.arreterParcours(b.tenantId, { origine: origineShopify(b.domaine, 'checkout_abandoned', jeton) }, 'panier devenu commande');
    }
    if (telephone !== null) {
      await deps.parcours.arreterParcours(
        b.tenantId, { prefixe: prefixeShopify(b.domaine, 'checkout_abandoned'), waId: telephone.replace(/^\+/, '') }, 'panier devenu commande',
      );
    }
  } catch (err) {
    journaliser('error', 'shopify_arret_parcours_panier_en_echec', { tenantId: b.tenantId, erreur: messageDe(err) });
  }
}

/**
 * Un checkout : payé, il ferme le panier ; sinon il le note, avec le téléphone saisi, le prénom et le lien de reprise.
 * Sans téléphone, rien ne se garde (le suivant en portera peut-être un).
 */
/**
 * La FORME d'une valeur, jamais son contenu : son type, la longueur d'une liste et le type de son premier élément, les
 * noms des champs d'un objet. Un corps de Shopify porte le nom, le téléphone et l'adresse d'un client.
 */
export function formeDe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    const premier = v[0];
    const detail = v.length === 0 ? '' : ` de ${estObjetSimple(premier) ? `objet {${Object.keys(premier).slice(0, 12).join(', ')}}` : typeof premier}`;
    return `liste(${v.length})${detail}`;
  }
  if (estObjetSimple(v)) return `objet {${Object.keys(v).slice(0, 12).join(', ')}}`;
  return typeof v;
}

/** Une adresse ou un client reçu sous une autre forme qu'un objet : lu comme absent (`objetOuAbsent`), et tracé ici. */
function signalerFormesInattendues(b: BoutiqueRecue, sujet: string, corps: unknown): void {
  if (!estObjetSimple(corps)) return;
  for (const champ of ['shipping_address', 'billing_address', 'customer'] as const) {
    const v = corps[champ];
    if (v !== undefined && v !== null && !estObjetSimple(v)) {
      journaliser('info', 'shopify_forme_inattendue', { tenantId: b.tenantId, sujet, champ, forme: formeDe(v) });
    }
  }
}

async function noterCheckout(deps: DepsTraitementShopify, b: BoutiqueRecue, sujet: string, corps: unknown): Promise<ReponseTraitement> {
  signalerFormesInattendues(b, sujet, corps);
  const c = schemaCheckout.safeParse(corps);
  if (!c.success) return illisible(b, sujet, c.error);
  if (c.data.completed_at) {
    await fermerSiPanier(deps, b, c.data.token, null);
    return OK;
  }
  // Un panier ne se garde qu'avec la relance active : sinon c'est un téléphone sans usage, qu'une relance branchée plus
  // tard ferait relancer d'un coup.
  if (!(await relanceActive(deps, b))) return OK;
  const telephone = telephoneDeCheckout(c.data, b.pays);
  if (telephone === null) return OK;
  await deps.store.noterPanier(b.tenantId, {
    jeton: c.data.token, telephone, nom: prenomDeCheckout(c.data), lien: valeurDeVariable(c.data.abandoned_checkout_url),
  });
  return OK;
}

/**
 * Un corps bien signé qui ne se lit pas : 200 et une trace, jamais un 4xx (Shopify réessaierait, puis désabonnerait).
 * La trace nomme les CHAMPS refusés et le type attendu (`champsIllisibles`), jamais une valeur : un corps de Shopify porte
 * le nom, le téléphone et l'adresse d'un client. Sans eux, un refus ne se diagnostiquait pas (essai réel du 2026-10-23).
 */
function illisible(b: BoutiqueRecue, sujet: string, erreur?: ZodError): ReponseTraitement {
  journaliser('warn', 'shopify_corps_illisible', { tenantId: b.tenantId, sujet, ...(erreur ? { champs: champsIllisibles(erreur) } : {}) });
  return OK;
}

/** Les champs refusés d'un corps : chemin, code, et type attendu ; dix au plus. Aucune valeur reçue n'y entre. */
export function champsIllisibles(erreur: ZodError): string[] {
  return erreur.issues.slice(0, 10).map((i) => {
    const chemin = i.path.map(String).join('.') || '(racine)';
    return i.code === 'invalid_type' ? `${chemin} : ${i.code} (attendu ${String(i.expected)})` : `${chemin} : ${i.code}`;
  });
}

interface Service {
  evenement: EvenementShopify;
  /** L'identifiant de la commande ou de l'expédition : la fin de la clé d'idempotence et de l'origine du parcours. */
  reference: string;
  sujet: string;
  commandeId: string;
  clientId: string | null;
  telephone: string | null;
  valeurs: Partial<Record<DonneeShopify, string>>;
  numero: string;
  /** Le paiement d'une commande : la fiche née de la confirmation reçoit aussi sa date et son montant (segments). */
  details?: DetailsCommande;
}

/**
 * LA RÉCEPTION D'UNE COMMANDE PAYÉE OU EXPÉDIÉE (lot 5 du menu « Scénario ») : la ligne de l'événement, puis le premier
 * bloc PUBLIÉ de son scénario, qui part par l'envoi public avec TOUTES les données de l'événement, et le pont quand le bloc
 * a une suite. La réservation, la clé, le consentement, la fiche et l'issue sont ceux d'avant.
 */
async function servir(deps: DepsTraitementShopify, b: BoutiqueRecue, s: Service): Promise<ReponseTraitement> {
  // 🔴 En pause, rien ne part et rien ne se réserve : l'événement est perdu, jamais rejoué après coup (décision 15).
  if (b.pause) return OK;
  const ligne = await deps.store.ligne(b.tenantId, s.evenement);
  // Aucune ligne allumée : rien ne s'écrit, pas même une fiche (elle compterait dans la limite de l'offre).
  if (!ligne || !ligne.actif) return OK;
  // La clé d'idempotence d'avant le lot 5, mot pour mot, et l'origine du parcours qui naîtra.
  const cle = origineShopify(b.domaine, s.evenement, s.reference);
  const resa = await deps.store.reserverEvenement(b.tenantId, cle, s.sujet);
  if (resa === 'servi') return OK;
  if (resa === 'en_cours') return REESSAYER;
  try {
    let issue: IssueEvenement | 'en_cours';
    const bloc = await premierBloc(deps.lectures, b.tenantId, ligne.workflowId, 'shopify');
    if (bloc.etat !== 'pret') issue = 'premier_message_absent';
    else if (s.telephone === null) issue = 'sans_telephone';
    else {
      // Un prénom absent prend son mot de secours (facultatif chez Shopify) ; les autres données manquent vraiment.
      const valeurs = avecPrenomDeSecours(s.valeurs, bloc.langue);
      issue = donneeManquante(bloc.params, s.evenement, valeurs)
        ? 'donnee_manquante'
        : await envoyerPremierBloc(deps, {
          tenantId: b.tenantId, cle, nomLigne: `${PREFIXE_LIGNE_SHOPIFY}${LIBELLE[s.evenement]} · ${s.numero}`,
          modele: bloc.modele, langue: bloc.langue, params: bloc.params, valeurs, telephone: s.telephone,
          // Bornée comme toute source de consentement (`MAX_OPT_IN_SOURCE`) : trop longue, le destinataire serait écarté.
          sourceConsentement: `shopify:${b.domaine}`.slice(0, MAX_OPT_IN_SOURCE),
          parcoursEvenement: await pontSelonLOffre(deps.offres, b.tenantId, bloc, cle, 'evenement_shopify'),
          // La campagne de ce message vers sa commande : ses accusés se liront dans la carte de la joignabilité. Au
          // premier passage, car un webhook rejoué après `servi` ne revient pas jusqu'ici.
          surCampagne: (campagne) => deps.joignabilite.noterEnvoi(b.tenantId, campagne, s.commandeId),
        });
    }
    // Un autre traitement tient la même clé d'envoi : le laisser finir, Shopify réessaiera.
    if (issue === 'en_cours') return REESSAYER;
    await deps.store.noterIssue(b.tenantId, cle, issue);
    if (s.telephone !== null) {
      const fiche = await deps.ficheParTelephone(b.tenantId, s.telephone);
      if (fiche !== null) await deps.store.lierCommande(b.tenantId, s.commandeId, s.clientId, fiche, s.details);
    }
    if (issue === 'limite_contacts') {
      await deps.emails.emettre({
        cle: 'shopify_limite_contacts', tenantId: b.tenantId, a: 'admins',
        occasion: moisDeParis((deps.maintenant ?? Date.now)()), valeurs: { boutique: b.domaine, lien_offre: deps.pageOffre },
      });
    }
    await deps.store.noterDernierEvenement(b.tenantId);
    return OK;
  } catch (err) {
    // Rien n'est perdu : la réservation repart, et l'envoi qui aurait pu partir est protégé par sa clé.
    journaliser('error', 'shopify_traitement_en_echec', { tenantId: b.tenantId, sujet: s.sujet, erreur: messageDe(err) });
    await deps.store.libererEvenement(b.tenantId, cle).catch(() => undefined);
    return REESSAYER;
  }
}

/**
 * `customers/redact` : les fiches liées aux commandes nommées ou au client Shopify, et celle de son numéro, DANS l'espace
 * de la boutique ; puis les liens de ce client posés par la synchronisation des étiquettes, partout dans l'espace, et
 * ses étiquettes avec eux, sans purger la fiche d'un proche reliée par son carnet d'adresses (lot 6b bis). Un échec rend
 * 503 : Shopify réessaie.
 */
async function effacerClient(deps: DepsTraitementShopify, b: BoutiqueRecue, corps: unknown): Promise<ReponseTraitement> {
  const d = schemaEffacementClient.safeParse(corps);
  if (!d.success) return illisible(b, 'customers/redact', d.error);
  const commandes = (d.data.orders_to_redact ?? []).map(String);
  try {
    // Les ventes attribuées de ces commandes perdent leur numéro et leur contact ; le montant et la source restent.
    await deps.ventes.anonymiserCommandes(b.tenantId, commandes);
    // Leurs lignes de joignabilité : sans personne dedans (ni téléphone ni nom), mais la demande cite leur identifiant.
    await joignabiliteAuMieux(b, 'effacement', () => deps.joignabilite.effacerCommandes(b.tenantId, commandes));
    const ids = new Set(await deps.store.contactsLies(
      b.tenantId, commandes, d.data.customer?.id ? String(d.data.customer.id) : null,
    ));
    const tel = telephoneE164([{ brut: d.data.customer?.phone }], b.pays);
    const parNumero = tel === null ? null : await deps.ficheParTelephone(b.tenantId, tel);
    // Ses paniers en attente partent aussi, fiche ou pas (relecture du lot 2).
    if (tel !== null) await deps.store.effacerPaniersDuTelephone(b.tenantId, tel);
    if (parNumero !== null) ids.add(parNumero);
    if (d.data.customer?.id) await deps.store.oublierClientShopify(b.tenantId, String(d.data.customer.id));
    if (ids.size > 0) await deps.effacerFiches(b.tenantId, [...ids]);
    journaliser('info', 'shopify_client_efface', { tenantId: b.tenantId, fiches: ids.size });
    return OK;
  } catch (err) {
    journaliser('error', 'shopify_effacement_en_echec', { tenantId: b.tenantId, erreur: messageDe(err) });
    return REESSAYER;
  }
}
