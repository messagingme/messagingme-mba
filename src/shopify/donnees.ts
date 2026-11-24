import { z } from 'zod';
import { isSupportedCountry, type CountryCode } from 'libphonenumber-js';
import { estUnFixe, normalizePhone } from '../crm/phone';
import { VALEUR_VARIABLE_MAX } from '../api/variables';

/**
 * LES DONNÉES SHOPIFY QU'UN MESSAGE PEUT CITER, et les corps de webhook d'où elles se lisent (plan du connecteur,
 * lot 1). Une liste FERMÉE : `set_shopify_message` n'accepte que ces clés, et chacune dit de quel événement elle se lit.
 *
 * Mesuré le 2026-10-21 sur de vrais webhooks (lot 0) : le téléphone d'une commande est dans `shipping_address.phone`
 * (`customer` absent sur une commande sans client), celui d'une expédition dans `destination.phone` ; une expédition
 * ne porte ni `order_status_url` ni client, et son `name` est celui de la commande suivi d'un suffixe (« #1002.1 »).
 *
 * 🔴 Les corps se lisent par `safeParse`, jamais par `as` : ils viennent d'un tiers. Les schémas ne retiennent que ce
 * que le connecteur lit (Shopify ajoute des champs à chaque version d'API, un schéma strict refuserait des corps
 * valides) et tolèrent `null` partout où Shopify le rend.
 */

// La liste des événements, des données et de ce que chacun sait remplir vit dans le module que la console partage
// (l'assistant propose ses textes et ses repères depuis la même source) : un seul endroit à changer.
import {
  DONNEES_PAR_EVENEMENT, DONNEES_SHOPIFY, EVENEMENTS_SHOPIFY, LIGNE_PANIER_AGENT, estAutomationShopify, evenementDe, prenomDeSecours,
  type AutomationShopify, type DonneeShopify, type EvenementShopify,
} from '../../web/lib/partage/shopify-messages';
export { DONNEES_PAR_EVENEMENT, DONNEES_SHOPIFY, EVENEMENTS_SHOPIFY, LIGNE_PANIER_AGENT, estAutomationShopify, evenementDe, type AutomationShopify, type DonneeShopify, type EvenementShopify };

/**
 * La catégorie de modèle admise par événement : une confirmation et une expédition sont des messages de service
 * (UTILITY) ; une relance de panier admet un modèle marketing ou de service.
 */
export const CATEGORIES_ADMISES: Readonly<Record<EvenementShopify, ReadonlyArray<'marketing' | 'utility'>>> = {
  order_paid: ['utility'],
  order_fulfilled: ['utility'],
  checkout_abandoned: ['marketing', 'utility'],
};

/** Les événements qu'un marchand peut brancher (la relance de panier depuis le lot 2). */
export const EVENEMENTS_DISPONIBLES: readonly EvenementShopify[] = ['order_paid', 'order_fulfilled', 'checkout_abandoned'];

/** Les automations qu'un marchand peut régler : les événements, plus la relance de panier avec agent IA (2026-11-20). */
export const AUTOMATIONS_DISPONIBLES: readonly AutomationShopify[] = [...EVENEMENTS_DISPONIBLES, LIGNE_PANIER_AGENT];

export { DELAI_PANIER_DEFAUT, DELAI_PANIER_MAX, DELAI_PANIER_MIN } from '../../web/lib/partage/shopify-messages';

/**
 * Les valeurs d'un envoi, le prénom absent remplacé par son mot de secours dans la langue du modèle : le prénom est
 * facultatif chez Shopify, et sans lui le message ne partait pas. Les autres données manquantes restent manquantes.
 */
export function avecPrenomDeSecours(valeurs: Partial<Record<DonneeShopify, string>>, langue: string): Partial<Record<DonneeShopify, string>> {
  return valeurs.first_name ? valeurs : { ...valeurs, first_name: prenomDeSecours(langue) };
}

export function estEvenementShopify(v: unknown): v is EvenementShopify {
  return typeof v === 'string' && (EVENEMENTS_SHOPIFY as readonly string[]).includes(v);
}
export function estDonneeShopify(v: unknown): v is DonneeShopify {
  return typeof v === 'string' && (DONNEES_SHOPIFY as readonly string[]).includes(v);
}

const texte = z.string().nullish();
/** Un objet JSON au sens strict : ni `null`, ni une liste. */
export const estObjetSimple = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
/**
 * 🔴 Une adresse ou un client que Shopify n'envoie PAS comme un objet se lit comme ABSENT (essai réel du 2026-10-23 : quatre
 * corps de checkout refusés sur `shipping_address : invalid_type (attendu object)`). Refusé, ce champ faisait rejeter
 * TOUT le corps, téléphone compris : le panier n'était jamais noté et sa relance ne partait jamais. Ce que le connecteur
 * lit dedans (prénom, téléphone, pays) est facultatif ; la forme reçue se journalise (`shopify_forme_inattendue`).
 */
const objetOuAbsent = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === undefined || v === null || estObjetSimple(v) ? v : null), schema);
// `last_name` (segments Shopify enrichis, lot 5b) : le nom de la fiche qu'un rattrapage crée (`nomDeLAcheteur`) ; facultatif,
// `.catch(null)` comme ce que seule l'attribution lit, jamais un refus du corps.
const adresse = objetOuAbsent(z.object({ first_name: texte, last_name: texte.catch(null), phone: texte, country_code: texte }).nullish());
const idShopify = z.number().int().positive();

export const schemaCommande = z.object({
  id: idShopify,
  name: z.string().min(1).max(100),
  checkout_token: texte,
  order_status_url: texte,
  customer_locale: texte,
  phone: texte,
  customer: objetOuAbsent(z.object({ id: idShopify.nullish(), phone: texte, first_name: texte, last_name: texte.catch(null) }).nullish()),
  shipping_address: adresse,
  billing_address: adresse,
  total_price: texte,
  presentment_currency: texte,
  total_price_set: z.object({
    presentment_money: z.object({ amount: z.string(), currency_code: z.string() }).nullish(),
    // 🔴 Les champs que seule l'attribution lit se lisent ABSENTS sous une forme inattendue (`.catch(null)`), jamais
    // refusés : un refus rejetterait le corps entier, et la confirmation de commande avec (plan 2026-10-28, relecture).
    shop_money: z.object({ amount: z.string(), currency_code: z.string() }).nullish().catch(null),
  }).nullish(),
  /** Le moment où Shopify a traité la commande : la fenêtre d'attribution se compte depuis lui, pas depuis un webhook réessayé. */
  processed_at: texte.catch(null),
  /** Une commande de la passerelle de test : enregistrée, jamais comptée (spec du 2026-10-28). */
  test: z.boolean().nullish().catch(null),
  /** La page d'arrivée de la visite qui a mené à la commande, avec sa requête : la preuve par UTM (tâche 6). */
  landing_site: texte.catch(null),
  /**
   * Les lignes (segments Shopify enrichis, lot 3), lues BRUTES ici puis une à une par `lignesDeCommande` : une ligne
   * illisible s'écarte seule, jamais la commande, ni sa confirmation avec elle.
   */
  line_items: z.array(z.unknown()).nullish().catch(null),
});
export type CommandeShopify = z.infer<typeof schemaCommande>;

/** Les lignes gardées par commande, dans l'ordre du corps (spec, chantier 1) ; au-delà, la commande le dit. */
export const LIGNES_MAX = 250;
const BORNE_TITRE = 200;
const BORNE_SKU = 255;

/** Une ligne de commande, sans prix ni montant : la dépense reste celle de la commande. */
export interface LigneDeCommande {
  ligneId: string;
  produitId: string | null;
  varianteId: string | null;
  sku: string | null;
  titre: string;
  varianteTitre: string | null;
  /** La quantité au paiement (les remboursements ne sont pas déduits, décision du 2026-10-31). */
  quantite: number;
  /** Gardée, mais écartée des critères produit (décision de Julien du 2026-11-23). */
  carteCadeau: boolean;
}
export interface LignesDeCommande { lignes: LigneDeCommande[]; tronquees: boolean }

/** Un identifiant REST de Shopify (un entier, parfois en texte), rendu en texte ; un autre format ne se lit pas. */
const idTexte = z.union([z.number().int().positive(), z.string().regex(/^\d{1,30}$/)]).transform(String);
const schemaLigne = z.object({
  id: idTexte,
  // `product_id` peut être nul (produit supprimé depuis, ligne sur mesure) : la ligne reste, cherchable par son SKU.
  product_id: idTexte.nullish().catch(null),
  variant_id: idTexte.nullish().catch(null),
  sku: texte.catch(null),
  title: texte.catch(null),
  name: texte.catch(null),
  variant_title: texte.catch(null),
  quantity: z.number().int().min(1).max(100_000),
  gift_card: z.boolean().nullish().catch(null),
});

/** Un texte utile : coupé à sa borne, vide ramené à nul. */
function texteUtile(v: string | null | undefined, borne: number): string | null {
  const t = v?.trim() ?? '';
  return t === '' ? null : t.slice(0, borne);
}

/**
 * LES LIGNES D'UNE COMMANDE PAYÉE (segments Shopify enrichis, lot 3) : celles qui se lisent, dans l'ordre du corps,
 * `LIGNES_MAX` au plus, une fois chacune. Une quantité illisible, un identifiant de ligne absent ou un titre vide
 * écartent LA ligne, jamais la commande. `tronquees` : le corps en portait plus que le plafond.
 */
export function lignesDeCommande(c: CommandeShopify): LignesDeCommande {
  const brutes = c.line_items ?? [];
  const vues = new Set<string>();
  const lignes: LigneDeCommande[] = [];
  for (const brute of brutes.slice(0, LIGNES_MAX)) {
    const l = schemaLigne.safeParse(brute);
    if (!l.success || vues.has(l.data.id)) continue;
    const titre = texteUtile(l.data.title, BORNE_TITRE) ?? texteUtile(l.data.name, BORNE_TITRE);
    if (titre === null) continue;
    vues.add(l.data.id);
    lignes.push({
      ligneId: l.data.id, produitId: l.data.product_id ?? null, varianteId: l.data.variant_id ?? null,
      sku: texteUtile(l.data.sku, BORNE_SKU), titre, varianteTitre: texteUtile(l.data.variant_title, BORNE_TITRE),
      quantite: l.data.quantity, carteCadeau: l.data.gift_card === true,
    });
  }
  return { lignes, tronquees: brutes.length > LIGNES_MAX };
}

export const schemaExpedition = z.object({
  id: idShopify,
  order_id: idShopify,
  name: z.string().min(1).max(100),
  tracking_company: texte,
  tracking_number: texte,
  tracking_url: texte,
  destination: adresse,
});
export type ExpeditionShopify = z.infer<typeof schemaExpedition>;

/**
 * Un checkout (`checkouts/create`, puis un `checkouts/update` par modification), mesuré le 2026-10-21 : le téléphone saisi
 * est dans `shipping_address.phone` (PAS sur `customer`), le lien de reprise dans `abandoned_checkout_url`, et
 * `completed_at` reste vide tant que rien n'est payé.
 */
export const schemaCheckout = z.object({
  token: z.string().min(1).max(200),
  completed_at: texte,
  abandoned_checkout_url: texte,
  phone: texte,
  customer: objetOuAbsent(z.object({ phone: texte, first_name: texte }).nullish()),
  shipping_address: adresse,
  billing_address: adresse,
});
export type CheckoutShopify = z.infer<typeof schemaCheckout>;

/**
 * Le numéro de l'ACHETEUR d'abord : la relance est un message marketing qui rouvre SON paiement, et un cadeau ferait
 * sinon relancer le destinataire du colis. La livraison reste en dernier : c'est souvent le seul numéro saisi (mesuré).
 */
export function telephoneDeCheckout(c: CheckoutShopify, paysBoutique: string | null): string | null {
  return telephoneE164([
    { brut: c.phone },
    { brut: c.customer?.phone },
    { brut: c.billing_address?.phone, pays: c.billing_address?.country_code },
    { brut: c.shipping_address?.phone, pays: c.shipping_address?.country_code },
  ], paysBoutique, { sauterFixes: true });
}

/** Le prénom d'un checkout, rangé avec le panier : la relance part longtemps après le webhook. */
export function prenomDeCheckout(c: CheckoutShopify): string | null {
  return premierPrenom(c.shipping_address?.first_name, c.billing_address?.first_name, c.customer?.first_name);
}

/**
 * Le premier prénom NON VIDE : `??` s'arrêtait sur `""`, et un prénom vide dans l'adresse de livraison masquait celui de
 * la facturation ou du client (relecture du 2026-10-23 : avec le prénom de secours, on aurait écrit « Bonjour à vous »
 * alors qu'on avait le prénom).
 */
function premierPrenom(...candidats: Array<string | null | undefined>): string | null {
  for (const c of candidats) {
    const v = valeurDeVariable(c);
    if (v !== null) return v;
  }
  return null;
}

const clientRgpd = z.object({ id: idShopify.nullish(), email: texte, phone: texte }).nullish();
export const schemaEffacementClient = z.object({ customer: clientRgpd, orders_to_redact: z.array(idShopify).nullish() });
export const schemaDemandeDonnees = z.object({ customer: clientRgpd, orders_requested: z.array(idShopify).nullish() });

/**
 * Une valeur que Meta accepte dans une variable : ni retour à la ligne, ni tabulation, ni plus de quatre espaces de
 * suite (erreur 132018), et pas plus que la borne de l'envoi public. Vide après nettoyage = absente.
 */
export function valeurDeVariable(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const propre = v.replace(/\s+/g, ' ').trim().slice(0, VALEUR_VARIABLE_MAX);
  return propre === '' ? null : propre;
}

/** Le montant que le client a payé, dans SA devise (`presentment_money`) : une boutique multi-devises sinon ment. */
export function montantAffiche(c: CommandeShopify): string | null {
  const m = c.total_price_set?.presentment_money;
  const montant = m?.amount ?? c.total_price ?? null;
  const devise = m?.currency_code ?? c.presentment_currency ?? null;
  if (montant === null || !/^\d+(\.\d+)?$/.test(montant)) return null;
  if (devise === null || !/^[A-Z]{3}$/.test(devise)) return montant;
  const langue = typeof c.customer_locale === 'string' && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(c.customer_locale) ? c.customer_locale : 'fr-FR';
  try {
    return new Intl.NumberFormat(langue, { style: 'currency', currency: devise }).format(Number(montant));
  } catch {
    return `${montant} ${devise}`;
  }
}

/**
 * Le montant d'une VENTE ATTRIBUÉE, dans la devise de la BOUTIQUE (`shop_money`) et non celle du client : les ventes d'un
 * espace s'additionnent sans mélanger les devises. Sans `shop_money`, `total_price` est déjà dans la devise de la boutique.
 * Décimal en texte, jamais un flottant ; illisible : `null`, et rien ne s'enregistre.
 */
export function montantBoutique(c: CommandeShopify, deviseBoutique: string | null): { montant: string; devise: string } | null {
  const m = c.total_price_set?.shop_money;
  const montant = m?.amount ?? c.total_price ?? null;
  const devise = m?.currency_code ?? deviseBoutique;
  if (montant === null || !/^\d+(\.\d+)?$/.test(montant)) return null;
  if (devise === null || !/^[A-Z]{3}$/.test(devise)) return null;
  return { montant, devise };
}

/** Le numéro de commande d'une expédition : son `name` sans le suffixe de l'expédition (« #1002.1 » -> « #1002 »). */
export function numeroDeCommandeDExpedition(nom: string): string {
  return nom.replace(/\.\d+$/, '');
}

export function donneesDeCommande(c: CommandeShopify): Partial<Record<DonneeShopify, string>> {
  return sansVides({
    first_name: premierPrenom(c.shipping_address?.first_name, c.billing_address?.first_name, c.customer?.first_name),
    order_number: c.name,
    order_total: montantAffiche(c),
    order_status_url: c.order_status_url,
  });
}

export function donneesDExpedition(f: ExpeditionShopify): Partial<Record<DonneeShopify, string>> {
  return sansVides({
    first_name: f.destination?.first_name,
    order_number: numeroDeCommandeDExpedition(f.name),
    carrier: f.tracking_company,
    tracking_number: f.tracking_number,
    tracking_url: f.tracking_url,
  });
}

function sansVides(brut: Partial<Record<DonneeShopify, string | null | undefined>>): Partial<Record<DonneeShopify, string>> {
  const out: Partial<Record<DonneeShopify, string>> = {};
  for (const cle of DONNEES_SHOPIFY) {
    const v = valeurDeVariable(brut[cle]);
    if (v !== null) out[cle] = v;
  }
  return out;
}

/**
 * Le téléphone d'un événement en E.164, ou `null`. Chaque candidat se normalise au pays de SON adresse, à défaut à celui
 * de la boutique : un numéro national saisi au checkout n'a de sens qu'avec son pays. Le premier candidat valide gagne.
 *
 * `sauterFixes` (segments Shopify enrichis, lot 2a ; décision de Julien du 2026-11-23) : un candidat que WhatsApp ne porte
 * pas (`estUnFixe` : ligne fixe, numéro de service, VOIP française) est sauté et le suivant essayé. Un fixe de livraison
 * ne masque plus un mobile sur le client, et ne fonde plus une fiche qui échouerait en 131026. Posé par les trois
 * chemins d'un MESSAGE ; l'effacement de `customers/redact` et l'import des abonnés s'en passent : un effacement doit
 * retrouver la fiche d'un fixe, et l'import garde sa règle.
 */
export function telephoneE164(
  candidats: ReadonlyArray<{ brut: string | null | undefined; pays?: string | null | undefined }>,
  paysBoutique: string | null,
  { sauterFixes = false }: { sauterFixes?: boolean } = {},
): string | null {
  for (const c of candidats) {
    if (typeof c.brut !== 'string' || c.brut.trim() === '') continue;
    const pays = [c.pays, paysBoutique].find((p): p is CountryCode => typeof p === 'string' && isSupportedCountry(p)) ?? 'FR';
    const r = normalizePhone(c.brut, pays);
    if (r.e164 && !(sauterFixes && estUnFixe(r.e164))) return r.e164;
  }
  return null;
}

type CandidatTelephone = { brut: string | null | undefined; pays?: string | null | undefined };

/** Le nom d'une fiche : prénom et nom joints, espaces resserrés, 200 caractères au plus ; vide, `null`. */
export const NOM_FICHE_MAX = 200;
export function nomComplet(prenom: string | null | undefined, nom: string | null | undefined): string | null {
  const joint = [prenom, nom].filter((x): x is string => typeof x === 'string' && x.trim() !== '').join(' ').replace(/\s+/g, ' ').trim();
  return joint === '' ? null : joint.slice(0, NOM_FICHE_MAX);
}

/** L'ordre mesuré pour une commande : livraison, facturation, client, puis le champ de la commande. */
const candidatsDeCommande = (c: CommandeShopify): CandidatTelephone[] => [
  { brut: c.shipping_address?.phone, pays: c.shipping_address?.country_code },
  { brut: c.billing_address?.phone, pays: c.billing_address?.country_code },
  { brut: c.customer?.phone },
  { brut: c.phone },
];
const candidatsDExpedition = (f: ExpeditionShopify): CandidatTelephone[] => [{ brut: f.destination?.phone, pays: f.destination?.country_code }];

/** Le téléphone d'une commande, un fixe sauté. */
export function telephoneDeCommande(c: CommandeShopify, paysBoutique: string | null): string | null {
  return telephoneE164(candidatsDeCommande(c), paysBoutique, { sauterFixes: true });
}

/**
 * Les candidats de L'ACHETEUR : le client, le numéro que la commande porte pour lui (`phone`, « le numéro associé au
 * client » chez Shopify), puis la facturation. Jamais la livraison, qui peut être le destinataire d'un cadeau. Chacun porte
 * le nom qui va avec son numéro : celui du client pour les deux premiers, celui de la facturation pour le dernier.
 */
const candidatsDeLAcheteur = (c: CommandeShopify): Array<CandidatTelephone & { nom: string | null }> => {
  const client = nomComplet(c.customer?.first_name, c.customer?.last_name);
  return [
    { brut: c.customer?.phone, nom: client },
    { brut: c.phone, nom: client },
    { brut: c.billing_address?.phone, pays: c.billing_address?.country_code, nom: nomComplet(c.billing_address?.first_name, c.billing_address?.last_name) },
  ];
};

/**
 * LE NUMÉRO DE L'ACHETEUR (segments Shopify enrichis, lot 5b ; décision de Julien du 2026-11-24), un fixe sauté : le
 * rattrapage ne CRÉE une fiche que sur lui, jamais sur celui de la livraison (un destinataire de cadeau n'entre pas). Le
 * rattachement à une fiche déjà là garde les candidats de `telephoneDeCommande`.
 */
export function telephoneDeLAcheteur(c: CommandeShopify, paysBoutique: string | null): string | null {
  return telephoneE164(candidatsDeLAcheteur(c), paysBoutique, { sauterFixes: true });
}

/**
 * LE NOM DE LA FICHE D'UN ACHETEUR (segments Shopify enrichis, lot 5b) : le premier nom porté par un candidat de
 * l'acheteur qui donne CE numéro. Le nom suit le numéro retenu, jamais celui de la livraison. `null` : aucun nom.
 */
export function nomDeLAcheteur(c: CommandeShopify, numero: string, paysBoutique: string | null): string | null {
  for (const x of candidatsDeLAcheteur(c)) {
    if (x.nom !== null && telephoneE164([x], paysBoutique, { sauterFixes: true }) === numero) return x.nom;
  }
  return null;
}

export function telephoneDExpedition(f: ExpeditionShopify, paysBoutique: string | null): string | null {
  return telephoneE164(candidatsDExpedition(f), paysBoutique, { sauterFixes: true });
}

/**
 * Le CLASSEMENT d'une commande pour la carte « Joignabilité WhatsApp » (segments Shopify enrichis, lot 2b), sans garder le
 * numéro : `sans_numero` (aucun candidat n'a de texte), `invalide` (du texte, mais aucun E.164 que WhatsApp porte : la
 * normalisation refuse, ou `estUnFixe`), `utilisable` sinon. Les MÊMES candidats et la même règle que le message : une
 * commande classée utilisable est une commande dont la confirmation a un numéro.
 */
export type ClassementTelephone = 'sans_numero' | 'invalide' | 'utilisable';

export function classementDeCommande(c: CommandeShopify, paysBoutique: string | null): ClassementTelephone {
  const candidats = candidatsDeCommande(c);
  if (!candidats.some((x) => typeof x.brut === 'string' && x.brut.trim() !== '')) return 'sans_numero';
  return telephoneE164(candidats, paysBoutique, { sauterFixes: true }) === null ? 'invalide' : 'utilisable';
}
