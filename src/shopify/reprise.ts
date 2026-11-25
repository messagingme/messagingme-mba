import { z } from 'zod';
import type { Pool } from 'pg';
import { nomDeLAcheteur, telephoneDeCommande, telephoneDeLAcheteur, type CommandeShopify } from './donnees';
import { detailsDeCommande } from './attribution';
import { BUDGET_LECTURE_MS } from './clients';
import { demanderJeton, type IssueJeton } from './connexion';
import { lireDroitsDeLApp, lirePageCommandes } from './commandes-lues';
import type { AttestationShopify, DetailsCommande, PgShopifyStore } from './store.pg';
import { BAIL_REPRISE_SECONDES, REPRISE_ABANDONNEE_MINUTES, type ComptesReprise, type PgReprisesStore, type Reprise } from './reprises.pg';
import { PgJoignabiliteStore } from './joignabilite.pg';
import { attestationEnVigueur } from './lignes-gestion';
import { ETIQUETTE_SHOPIFY, type Refus } from './gestion';
import type { PgContactStore } from '../crm/contact-store.pg';
import type { ApercuRepriseVue, RepriseShopifyVue } from '../../web/lib/partage/reprise-shopify';
import { enTransaction } from '../db/transaction';
import { journaliser } from '../lib/journal';
import { messageDe } from '../lib/erreur';

/**
 * LE RATTRAPAGE DES COMMANDES SHOPIFY (segments Shopify enrichis, lot 5 ; spec, chantier 2) : relire les commandes PAYÉES
 * créées dans les 60 derniers jours (la fenêtre que `read_orders` ouvre) et les rattacher aux fiches, lignes de produits
 * comprises, comme le webhook `orders/paid` l'aurait fait.
 *
 * 🔴 CE QU'IL FAIT (décisions de Julien du 2026-11-24, lot 5b, qui remplacent « une commande sans fiche est comptée,
 * jamais gardée » du 2026-11-23). Une commande DÉJÀ connue garde sa fiche ; elle ne reçoit ses lignes que si elle n'en a
 * aucune (celles d'avant le lot 3) et que sa fiche est active. Une commande inconnue rejoint la fiche ACTIVE de son numéro
 * utilisable (`telephoneDeCommande`, le choix du webhook, livraison comprise : un fixe sauté, le candidat suivant essayé),
 * sinon celle de son ACHETEUR (`telephoneDeLAcheteur` : le client, puis la facturation). Sans fiche, celle de l'acheteur
 * est CRÉÉE, jamais celle de la livraison (un destinataire de cadeau n'entre pas), par le chemin de l'import des abonnés
 * (`upsertManyByPhone` : consentante sous l'attestation de la boutique, étiquetée « Shopify », un STOP gardé, la limite
 * de l'offre vérifiée), marquée née d'un envoi Shopify (`nee_de`, supprimée au premier 131026 tant qu'elle n'a jamais
 * écrit), puis la commande et ses lignes s'y rattachent, le tout en UNE transaction. Jamais créée : sans numéro
 * d'acheteur ; quand l'un des numéros de la commande appartenait à un contact SUPPRIMÉ de l'espace après son paiement (la
 * trace des numéros effacés, `numeros_effaces` : « un contact supprimé n'est JAMAIS recréé par le rattrapage ») ; est dans
 * la liste de refus (une fiche effacée en STOP) ; ou a été refusé par WhatsApp en 131026 (`commandesSansWhatsapp`, qui
 * couvre les suppressions d'avant la trace) ; et au-delà des places de l'offre (comptée « hors plafond »). Ce qui n'entre
 * pas est COMPTÉ, jamais gardé, aucun numéro écrit. 🔴 Sans l'attestation EN VIGUEUR de la boutique, l'aperçu, le
 * lancement et le job se refusent.
 * Aucun message, ni attribution de vente, ni joignabilité ; `commandes_depuis` ne bouge pas (il dit « suivi au fil de
 * l'eau depuis », le rattrapage est un autre stock).
 *
 * Le job tient la reprise par un bail (`./reprises.pg.ts`), passe au plus `PASSAGE_REPRISE_MS`, puis se réenfile à son
 * curseur : il ne tient pas un worker, et un plantage ne recommence ni les écritures (idempotentes) ni la lecture.
 */

export const FILE_REPRISE = 'shopify-reprise';
/** La fenêtre lue : les commandes créées depuis 60 jours, la limite de `read_orders`. */
export const FENETRE_REPRISE_JOURS = 60;
/** Un passage du job ; au-delà, la reprise se réenfile à son curseur. */
export const PASSAGE_REPRISE_MS = 120_000;

export const schemaJobReprise = z.object({ tenantId: z.string().uuid(), repriseId: z.string().uuid() });
export type JobReprise = z.infer<typeof schemaJobReprise>;

/** Une commande lue chez Shopify, dans la forme du webhook (`./commandes-lues.ts` la convertit et la valide). */
export interface CommandeLue { corps: CommandeShopify; lignesTronquees: boolean }

/** Ce que Shopify a compté pour une requête (`extensions.cost`), journalisé pour régler la taille des pages. */
export interface CoutRequete { demande: number | null; reel: number | null }

/** Une page de commandes payées, ou la raison de son refus. */
export type PageCommandes =
  | { ok: true; commandes: CommandeLue[]; ecartees: number; suivant: string | null; cout?: CoutRequete }
  | { ok: false; code: 'acces_refuse' | 'passager' | 'trop_lourd'; message: string };

/** Une commande déjà notée dans l'espace : sa fiche, et s'il faut lui ajouter ses lignes (fiche active, aucune ligne). */
export interface CommandeConnue { contactId: string; aCompleter: boolean }

/** Une commande à écrire : vers une fiche déjà là (`contactId`), ou vers celle que la page crée pour son numéro (`numero`). */
export type Liaison = { commandeId: string; clientId: string | null; details: DetailsCommande } & ({ contactId: string } | { numero: string });

/** Ce qu'une page écrit, en UNE transaction : les fiches à créer (une par numéro, avec son nom), puis chaque commande. */
export interface PageAEcrire {
  fiches: Array<{ numero: string; nom: string | null }>;
  /** La trace du consentement des fiches créées (`sourceDuConsentement`) : l'attestation de la boutique. */
  source: string;
  liaisons: Liaison[];
}

/**
 * Un refus du rattrapage. `attestation_absente` : le marchand n'a pas attesté le consentement de ses clients ; l'outil MCP
 * le dit alors dans la voix de Claude Code (`PHRASE_ATTESTATION_RATTRAPAGE_CLAUDE`), la console dans la sienne (`message`).
 */
export type RefusRattrapage = Refus & { cause?: 'attestation_absente' };
export type IssueRattrapage<T> = { ok: true; valeur: T } | RefusRattrapage;

export interface DepsReprise {
  reprises: {
    lancer(tenantId: string, fenetreDebut: Date, domaine: string, par: string | null): Promise<{ ok: true; reprise: Reprise } | { ok: false; vivante: Reprise }>;
    prendre(id: string, tenantId: string): Promise<{ jeton: string; reprise: Reprise } | null>;
    avancer(id: string, tenantId: string, jeton: string, curseur: string, ajout: ComptesReprise): Promise<boolean>;
    relacher(id: string, tenantId: string, jeton: string): Promise<void>;
    finir(id: string, tenantId: string, jeton: string, statut: 'termine' | 'refuse' | 'erreur', erreur: string | null, ajout?: ComptesReprise): Promise<boolean>;
    annuler(id: string, tenantId: string, erreur: string): Promise<void>;
    lire(id: string, tenantId: string): Promise<Reprise | null>;
    derniere(tenantId: string): Promise<Reprise | null>;
  };
  /** La boutique de l'espace, son secret déchiffré et sa devise ; `null` sans boutique. */
  boutique(tenantId: string): Promise<{ domaine: string; clientId: string; secret: string; pays: string | null; devise: string | null; etat: string } | null>;
  jeton(domaine: string, clientId: string, secret: string): Promise<IssueJeton>;
  /** Les droits accordés à l'app de la boutique : sans `read_products`, les lignes ne portent pas leur produit. */
  droits(acces: { domaine: string; jeton: string }): Promise<{ ok: true; droits: string[] } | { ok: false; code: 'acces_refuse' | 'passager'; message: string }>;
  /** L'attestation EN VIGUEUR pour cette boutique (`attestationEnVigueur`) : sans elle, le rattrapage se refuse. */
  attestation(tenantId: string, domaine: string): Promise<AttestationShopify | null>;
  /** Une page ; `delaiMs` borne l'appel ENTIER, attentes du frein de Shopify comprises. */
  lirePage(acces: { domaine: string; jeton: string }, p: { depuis: Date; apres: string | null; parPage: number; delaiMs: number }): Promise<PageCommandes>;
  /** Les commandes déjà notées dans l'espace, leur fiche, et s'il faut leur ajouter leurs lignes. */
  commandesConnues(tenantId: string, ids: readonly string[]): Promise<Map<string, CommandeConnue>>;
  /** Les fiches ACTIVES de ces numéros (E.164) dans l'espace : numéro vers fiche. */
  fichesParNumeros(tenantId: string, numeros: readonly string[]): Promise<Map<string, string>>;
  /** Les numéros d'une fiche effacée en STOP (la liste de refus) : jamais recréés. */
  numerosEnRefus(tenantId: string, numeros: readonly string[]): Promise<Set<string>>;
  /** La date de la dernière suppression d'un contact qui portait ce numéro (la trace des numéros effacés). */
  effacements(tenantId: string, numeros: readonly string[]): Promise<Map<string, Date>>;
  /** Les commandes dont un message Shopify a échoué en 131026 sur une fiche supprimée depuis : leur numéro n'est pas sur WhatsApp. */
  commandesSansWhatsapp(tenantId: string, commandeIds: readonly string[]): Promise<Set<string>>;
  /**
   * Les places de l'offre : sa limite de contacts (`null` sans limite) et les fiches qu'elle compte, comme elle les compte.
   * Pleine, elle refuse un inconnu qui écrit le premier, dans toutes les offres (2026-11-25).
   */
  places(tenantId: string): Promise<{ limite: number | null; comptees: number }>;
  /** UNE transaction : les fiches de la page (le chemin de l'import des abonnés), puis chaque commande et ses lignes. */
  ecrirePage(tenantId: string, p: PageAEcrire): Promise<{ creees: number }>;
  enfiler(job: JobReprise, dansSecondes: number): Promise<void>;
  maintenant?: () => number;
}

/**
 * LE CÂBLAGE COMMUN de l'API (aperçu, lancement, état) et du worker (le job) : écrit une fois, pour qu'ils ne divergent
 * pas. Les magasins passent ENTIERS ou par une flèche : leurs méthodes lisent `this`. Le pool tient la transaction d'une
 * page (`ecrirePage`), dans laquelle les deux magasins écrivent par le client qu'elle leur passe.
 */
export function cablerReprise(o: {
  pool: Pool;
  reprises: PgReprisesStore;
  boutiques: Pick<PgShopifyStore, 'acces' | 'lire' | 'commandesConnues' | 'lierCommandeDans' | 'attestation'>;
  contacts: Pick<PgContactStore, 'fichesParNumeros' | 'numerosEnRefus' | 'effacementsDesNumeros' | 'placesContacts' | 'upsertManyByPhone'>;
  /** `queue.enqueue` de la file `FILE_REPRISE`, différé à `quand` s'il est donné. */
  enfiler: (job: JobReprise, quand: Date | undefined) => Promise<void>;
}): DepsReprise {
  const joignabilite = new PgJoignabiliteStore(o.pool);
  return {
    reprises: o.reprises,
    boutique: async (tenantId) => {
      const a = await o.boutiques.acces(tenantId);
      if (!a) return null;
      const v = await o.boutiques.lire(tenantId);
      return { ...a, devise: v?.devise ?? null };
    },
    jeton: (domaine, clientId, secret) => demanderJeton(domaine, clientId, secret),
    droits: (acces) => lireDroitsDeLApp(acces),
    attestation: (tenantId, domaine) => attestationEnVigueur({ store: o.boutiques }, tenantId, domaine),
    lirePage: (acces, p) => lirePageCommandes(acces, p),
    commandesConnues: (tenantId, ids) => o.boutiques.commandesConnues(tenantId, ids),
    fichesParNumeros: (tenantId, numeros) => o.contacts.fichesParNumeros(tenantId, numeros),
    numerosEnRefus: (tenantId, numeros) => o.contacts.numerosEnRefus(tenantId, numeros),
    effacements: (tenantId, numeros) => o.contacts.effacementsDesNumeros(tenantId, numeros),
    commandesSansWhatsapp: (tenantId, ids) => joignabilite.commandesSansWhatsapp(tenantId, ids),
    places: async (tenantId) => {
      const p = await o.contacts.placesContacts(tenantId, []);
      return { limite: p.limite, comptees: p.comptees };
    },
    ecrirePage: (tenantId, p) => enTransaction(o.pool, async (client) => {
      let creees = 0;
      let crees = new Map<string, string>();
      if (p.fiches.length > 0) {
        // 🔴 LE CHEMIN DE L'IMPORT DES ABONNÉS, pas une copie : consentante, étiquetée « Shopify », autorité `import` (un
        // STOP n'est jamais levé ; un numéro de la liste de refus renaît en STOP), la limite de l'offre revérifiée.
        const issues = await o.contacts.upsertManyByPhone({
          tenantId, optInStatus: 'opted_in', optInSource: p.source, tags: [ETIQUETTE_SHOPIFY], autorite: 'import', neeDe: 'shopify',
          contacts: p.fiches.map((f) => ({ phoneE164: f.numero, profileName: f.nom, fields: {} })),
        }, client);
        creees = issues.filter((i) => i === 'created').length;
        crees = await o.contacts.fichesParNumeros(tenantId, p.fiches.map((f) => f.numero), client);
      }
      for (const l of p.liaisons) {
        const contactId = 'contactId' in l ? l.contactId : crees.get(l.numero);
        // Une fiche que cette transaction vient d'écrire et qu'elle ne relit pas : jamais une commande sans sa fiche.
        if (contactId === undefined) throw new Error('rattrapage : la fiche d’un acheteur est introuvable dans la transaction qui la crée');
        await o.boutiques.lierCommandeDans(client, tenantId, l.commandeId, l.clientId, contactId, l.details);
      }
      return { creees };
    }),
    enfiler: (job, dansSecondes) => o.enfiler(job, dansSecondes > 0 ? new Date(Date.now() + dansSecondes * 1000) : undefined),
  };
}

/**
 * Les commandes d'une page. Estimée à environ 800 points de coût demandé avec leurs 50 lignes (le plafond d'une requête
 * est de 1 000) : une page trop lourde pour Shopify se redemande plus petite, et chaque passage journalise le coût de sa
 * première page (`shopify_reprise_cout`), de quoi régler ce nombre sur la mesure.
 */
export const PAR_PAGE_REPRISE = 5;
/** Le délai d'une page du job, frein de Shopify compris ; l'aperçu, lui, le borne à son budget restant. */
const DELAI_PAGE_MS = 20_000;

const AUCUNE_BOUTIQUE = 'Aucune boutique Shopify n’est branchée dans cet espace : branchez-la avant de rattraper ses commandes.';
const BOUTIQUE_COUPEE = 'La boutique Shopify est coupée : rebranchez-la avant de rattraper ses commandes.';
const BOUTIQUE_CHANGEE = 'La boutique Shopify a changé depuis le lancement du rattrapage : relancez-le.';
/** Le droit qui manque à une app créée avant le 2026-11-24 (décision de Julien : le demander dès le rattrapage). */
export const SANS_READ_PRODUCTS = 'Pour rattraper les commandes avec leurs produits, l’app Messaging Me de la boutique doit avoir le droit '
  + 'read_products : ajoutez-le à ses portées, publiez sa nouvelle version, puis réinstallez-la sur la boutique pour l’accepter '
  + '(depuis Claude Code, la skill shopify le fait). Rien n’a été lu.';
/**
 * Le refus sans l'attestation du consentement des clients (Julien, 2026-11-24 : elle vaut consentement pour les fiches que
 * le rattrapage crée), en DEUX voix, jamais un nom d'outil devant l'utilisateur de la console : celle-ci dit où cocher ;
 * Claude Code reçoit `PHRASE_ATTESTATION_RATTRAPAGE_CLAUDE` (la cause `attestation_absente`), qui lui dit de poser la
 * question au marchand, jamais de répondre pour lui.
 */
export const PHRASE_ATTESTATION_RATTRAPAGE = 'Le rattrapage crée, consentantes, les fiches des acheteurs qui n’en ont pas : avant lui, '
  + 'attestez que les clients de votre boutique ont accepté de recevoir vos messages WhatsApp, offres comprises, par la case '
  + 'en tête de Scénario > Automation > Shopify.';
export const PHRASE_ATTESTATION_RATTRAPAGE_CLAUDE = 'Le rattrapage crée, consentantes, les fiches des acheteurs qui n’en ont pas : '
  + 'avant lui, le marchand atteste que les clients de sa boutique ont accepté de recevoir ses messages WhatsApp, offres '
  + 'comprises. Posez-lui la question, puis relancez import_shopify_order_history avec customers_consent_attested à vrai, '
  + 'une fois qu’il l’a confirmé lui-même.';
/**
 * L'arrêt d'un rattrapage dont l'attestation a été retirée en route : il s'écrit sur la reprise, que la console ET Claude
 * Code lisent, donc ni un chemin d'écran ni un nom d'outil.
 */
export const PHRASE_ATTESTATION_RETIREE = 'L’attestation du consentement des clients de la boutique a été retirée : le rattrapage '
  + 's’est arrêté, et plus aucune fiche n’est créée sur sa foi. Attestez de nouveau, puis relancez-le.';

const refus = (statut: 409 | 503, message: string) => ({ ok: false as const, statut, message });
const zero = (): ComptesReprise => ({ lues: 0, rattachees: 0, deja: 0, sansFiche: 0, sansNumero: 0, fichesCreees: 0, horsPlafond: 0 });

/** Le début de la fenêtre, à la date du jour : Shopify ne rend pas une commande créée plus tôt sans `read_all_orders`. */
export function debutDeFenetre(maintenant: number): Date {
  const d = new Date(maintenant - FENETRE_REPRISE_JOURS * 86_400_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * La trace du consentement d'une fiche créée par le rattrapage (`opt_in_source`, comme « import Shopify, déclaré dans
 * Claude par … » pour l'import des abonnés) : l'attestation de la boutique qui la fonde, par sa date et sa boutique ; qui
 * l'a donnée et sa phrase se lisent dans son historique (`shopify_attestations`).
 */
export function sourceDuConsentement(domaine: string, a: AttestationShopify): string {
  return `rattrapage Shopify, attestation du ${a.le.slice(0, 10)} pour ${domaine}`;
}

function journaliserCout(tenantId: string, quoi: 'apercu' | 'rattrapage', parPage: number, cout: CoutRequete | undefined): void {
  journaliser('info', 'shopify_reprise_cout', { tenantId, quoi, parPage, demande: cout?.demande ?? null, reel: cout?.reel ?? null });
}

/**
 * L'aperçu SIMULE les créations d'une page à l'autre, sans rien écrire et sans rien garder au-delà de l'appel : les places
 * qui restent, les numéros dont la fiche serait déjà créée (une commande suivante s'y rattacherait), et ceux que la limite
 * de l'offre écarterait.
 */
export interface Simulation { libres: number; creees: Set<string>; refusees: Set<string> }

/** Les deux numéros d'une commande inconnue : celui du webhook (livraison comprise), celui de l'acheteur. */
interface Numeros { numero: string | null; acheteur: string | null }
const numerosDe = (x: Numeros): string[] => [...new Set([x.numero, x.acheteur])].filter((n): n is string => n !== null);

/**
 * Le rattachement d'une page. À l'écriture (`source` : la trace du consentement), une transaction crée les fiches
 * manquantes puis écrit chaque commande ; à l'aperçu (`simulation`), il ne fait que compter. Une commande connue garde sa
 * fiche et ne reçoit ses lignes que s'il lui en manque. Une inconnue rejoint la première fiche de ses numéros (celui du
 * webhook, puis celui de l'acheteur) qui existe ou que la page crée ; sinon la page crée celle de son ACHETEUR, une par
 * numéro (deux commandes du même acheteur : une fiche), dans les places de l'offre, dans l'ordre des commandes. Les
 * lectures sont groupées par page, jamais une par commande.
 */
export async function rattacher(
  deps: Pick<DepsReprise, 'commandesConnues' | 'fichesParNumeros' | 'numerosEnRefus' | 'effacements' | 'commandesSansWhatsapp' | 'places' | 'ecrirePage' | 'maintenant'>,
  tenantId: string, commandes: readonly CommandeLue[], boutique: { pays: string | null; devise: string | null },
  mode: { source: string } | { simulation: Simulation },
): Promise<ComptesReprise> {
  const comptes = { ...zero(), lues: commandes.length };
  if (commandes.length === 0) return comptes;
  const sim = 'simulation' in mode ? mode.simulation : null;
  const connues = await deps.commandesConnues(tenantId, commandes.map((c) => String(c.corps.id)));
  const numeros = new Map<string, Numeros>();
  for (const c of commandes) {
    const id = String(c.corps.id);
    if (!connues.has(id)) numeros.set(id, { numero: telephoneDeCommande(c.corps, boutique.pays), acheteur: telephoneDeLAcheteur(c.corps, boutique.pays) });
  }
  const tous = [...new Set([...numeros.values()].flatMap(numerosDe))];
  const fiches = tous.length > 0 ? await deps.fichesParNumeros(tenantId, tous) : new Map<string, string>();
  // À juger, une fois pour la page : les commandes d'un acheteur dont aucun numéro n'a de fiche, ni déjà là ni « créée »
  // par une page précédente de l'aperçu. Leurs numéros passent par la liste de refus, la trace des effacements, WhatsApp.
  const existe = (n: string) => fiches.has(n) || (sim?.creees.has(n) ?? false);
  const aJuger = [...numeros].filter(([, x]) => x.acheteur !== null && !numerosDe(x).some(existe));
  const sansFiche = [...new Set(aJuger.flatMap(([, x]) => numerosDe(x)))];
  const enRefus = sansFiche.length > 0 ? await deps.numerosEnRefus(tenantId, sansFiche) : new Set<string>();
  const effaces = sansFiche.length > 0 ? await deps.effacements(tenantId, sansFiche) : new Map<string, Date>();
  const morts = aJuger.length > 0 ? await deps.commandesSansWhatsapp(tenantId, aJuger.map(([id]) => id)) : new Set<string>();
  // Une commande dont WhatsApp a refusé le numéro (celui de son message, `numero`) le dit pour toute commande qui le porte.
  const numerosMorts = new Set(aJuger.filter(([id]) => morts.has(id)).map(([, x]) => x.numero).filter((n): n is string => n !== null));
  let libres = sim !== null ? sim.libres : 0;
  if (sim === null && aJuger.length > 0) {
    const p = await deps.places(tenantId);
    libres = p.limite === null ? Infinity : Math.max(0, p.limite - p.comptees);
  }
  /**
   * 🔴 Une commande ne fonde AUCUNE fiche quand l'un de ses numéros est dans la liste de refus, a été refusé par WhatsApp,
   * ou appartenait à un contact SUPPRIMÉ de l'espace après son paiement (décision de Julien du 2026-11-24 : « un contact
   * supprimé n'est JAMAIS recréé par le rattrapage ») ; l'autre numéro peut être la même personne. Une date de paiement
   * illisible, devant une trace, vaut un paiement d'avant. Une commande payée APRÈS l'effacement est une nouvelle
   * commande : sa fiche se crée, comme le webhook l'aurait fait.
   */
  const bloquee = (c: CommandeLue, x: Numeros): boolean => {
    const siens = numerosDe(x);
    if (siens.some((n) => enRefus.has(n) || numerosMorts.has(n))) return true;
    const effaceLe = siens.map((n) => effaces.get(n)?.getTime()).filter((t): t is number => t !== undefined);
    if (effaceLe.length === 0) return false;
    const payeLe = Date.parse(c.corps.processed_at ?? '');
    return Number.isNaN(payeLe) || Math.max(...effaceLe) >= payeLe;
  };

  const aCreer = new Map<string, string | null>();
  const refusees = new Set<string>();
  const liaisons: Liaison[] = [];
  const maintenant = deps.maintenant ?? Date.now;
  const lier = (c: CommandeLue, vers: { contactId: string } | { numero: string }): void => {
    if (sim !== null) return;
    const details = detailsDeCommande(c.corps, { devise: boutique.devise }, maintenant);
    const lignes = details.lignes && c.lignesTronquees ? { ...details.lignes, tronquees: true } : details.lignes;
    liaisons.push({ commandeId: String(c.corps.id), clientId: c.corps.customer?.id ? String(c.corps.customer.id) : null, details: { ...details, lignes }, ...vers });
  };
  // La fiche qu'une commande rejoint : la première de ses numéros qui existe, ou que cette page (ou une page précédente de
  // l'aperçu) crée. Le rattachement à une fiche déjà là ne lit pas la trace : seule une CRÉATION la lit.
  const cible = (x: Numeros): { contactId: string } | { numero: string } | null => {
    for (const n of numerosDe(x)) {
      const id = fiches.get(n);
      if (id !== undefined) return { contactId: id };
      if (aCreer.has(n) || sim?.creees.has(n)) return { numero: n };
    }
    return null;
  };
  for (const c of commandes) {
    const id = String(c.corps.id);
    const connue = connues.get(id);
    if (connue !== undefined) {
      comptes.deja += 1;
      // 🔴 Réécrire une commande déjà complète la dirait tronquée à tort : le rattrapage lit moins de lignes que le webhook.
      if (connue.aCompleter) lier(c, { contactId: connue.contactId });
      continue;
    }
    const x = numeros.get(id) ?? { numero: null, acheteur: null };
    const vers = cible(x);
    if (vers !== null) { comptes.rattachees += 1; lier(c, vers); continue; }
    if (x.numero === null) { comptes.sansNumero += 1; continue; }
    // 🔴 Seule la livraison porte un numéro (un destinataire de cadeau, peut-être) : il n'entre jamais par le rattrapage.
    if (x.acheteur === null || bloquee(c, x)) { comptes.sansFiche += 1; continue; }
    // 🔴 La limite de contacts de l'offre n'est jamais dépassée : au-delà, la commande est comptée, rien n'est gardé.
    if (refusees.has(x.acheteur) || sim?.refusees.has(x.acheteur) || libres <= 0) { refusees.add(x.acheteur); comptes.horsPlafond += 1; continue; }
    aCreer.set(x.acheteur, nomDeLAcheteur(c.corps, x.acheteur, boutique.pays));
    libres -= 1;
    comptes.rattachees += 1;
    lier(c, { numero: x.acheteur });
  }

  if ('simulation' in mode) {
    for (const n of aCreer.keys()) mode.simulation.creees.add(n);
    for (const n of refusees) mode.simulation.refusees.add(n);
    mode.simulation.libres = libres;
    comptes.fichesCreees = aCreer.size;
    return comptes;
  }
  if (liaisons.length > 0) {
    const ecrit = await deps.ecrirePage(tenantId, { fiches: [...aCreer].map(([numero, nom]) => ({ numero, nom })), source: mode.source, liaisons });
    comptes.fichesCreees = ecrit.creees;
  }
  return comptes;
}

/**
 * La boutique branchée, l'attestation de son marchand, son jeton et les droits de son app, ou ce qui l'empêche :
 * `boutique` (absente ou coupée), `refus` (pas d'attestation en vigueur, cause `attestation_absente`, ou Shopify refuse
 * l'app : identifiants, app désinstallée, droit `read_products` absent), `passager` (Shopify n'a pas répondu, réessayer).
 * L'attestation se lit AVANT tout appel à Shopify : sans elle, rien n'est lu.
 */
async function ouvrir(deps: Pick<DepsReprise, 'boutique' | 'jeton' | 'droits' | 'attestation'>, tenantId: string): Promise<
  | { ok: true; boutique: { domaine: string; pays: string | null; devise: string | null }; jeton: string }
  | (RefusRattrapage & { statut: 409 | 503; nature: 'boutique' | 'refus' | 'passager' })
> {
  const b = await deps.boutique(tenantId);
  if (!b) return { ...refus(409, AUCUNE_BOUTIQUE), nature: 'boutique' };
  if (b.etat !== 'connectee') return { ...refus(409, BOUTIQUE_COUPEE), nature: 'boutique' };
  if ((await deps.attestation(tenantId, b.domaine)) === null) {
    return { ...refus(409, PHRASE_ATTESTATION_RATTRAPAGE), nature: 'refus', cause: 'attestation_absente' };
  }
  const j = await deps.jeton(b.domaine, b.clientId, b.secret);
  if (!j.ok) return j.code === 'passager' ? { ...refus(503, j.message), nature: 'passager' } : { ...refus(409, j.message), nature: 'refus' };
  const d = await deps.droits({ domaine: b.domaine, jeton: j.jeton });
  if (!d.ok) return d.code === 'passager' ? { ...refus(503, d.message), nature: 'passager' } : { ...refus(409, d.message), nature: 'refus' };
  if (!d.droits.includes('read_products')) return { ...refus(409, SANS_READ_PRODUCTS), nature: 'refus' };
  return { ok: true, boutique: { domaine: b.domaine, pays: b.pays, devise: b.devise }, jeton: j.jeton };
}

/** Le refus d'une ouverture, rendu sans sa nature (qui ne sert qu'au job), sa cause gardée. */
const refusDOuverture = ({ statut, message, cause }: RefusRattrapage): RefusRattrapage => ({ ok: false, statut, message, ...(cause ? { cause } : {}) });

/**
 * L'APERÇU, synchrone, borné comme la lecture des clients (25 s, frein de Shopify compris) : il lit la fenêtre page après
 * page et compte, sans rien écrire, les fiches qu'il créerait dans les places de l'offre lues au départ. 🔴 S'il n'a pas
 * fini, il le dit (`complet: false`) : un compte partiel n'est jamais présenté comme un total. Une panne après des pages
 * lues rend leurs comptes, dits partiels, plutôt qu'un refus.
 */
export async function apercuReprise(deps: DepsReprise, tenantId: string): Promise<IssueRattrapage<ApercuRepriseVue>> {
  const o = await ouvrir(deps, tenantId);
  if (!o.ok) return refusDOuverture(o);
  const maintenant = deps.maintenant ?? Date.now;
  const debut = maintenant();
  const fenetre = debutDeFenetre(debut);
  const p = await deps.places(tenantId);
  const placesLibres = p.limite === null ? null : Math.max(0, p.limite - p.comptees);
  const simulation: Simulation = { libres: placesLibres ?? Infinity, creees: new Set(), refusees: new Set() };
  const total = { ...zero(), ecartees: 0 };
  const vue = (complet: boolean) => vueApercu(fenetre, total, complet, placesLibres);
  let apres: string | null = null;
  let parPage = PAR_PAGE_REPRISE;
  let pages = 0;
  for (;;) {
    const reste = BUDGET_LECTURE_MS - (maintenant() - debut);
    if (reste <= 1_000) return { ok: true, valeur: vue(false) };
    const page = await deps.lirePage({ domaine: o.boutique.domaine, jeton: o.jeton }, { depuis: fenetre, apres, parPage, delaiMs: Math.min(DELAI_PAGE_MS, reste) });
    if (!page.ok) {
      if (page.code === 'trop_lourd' && parPage > 1) { parPage = Math.max(1, Math.floor(parPage / 2)); continue; }
      // Un accès refusé dit quoi régler, même après des pages lues ; une autre panne garde ce qui est déjà compté.
      if (pages > 0 && page.code !== 'acces_refuse') return { ok: true, valeur: vue(false) };
      return { ok: false, statut: page.code === 'acces_refuse' ? 409 : 503, message: page.message };
    }
    if (pages === 0) journaliserCout(tenantId, 'apercu', parPage, page.cout);
    pages += 1;
    const c = await rattacher(deps, tenantId, page.commandes, o.boutique, { simulation });
    for (const k of Object.keys(c) as Array<keyof ComptesReprise>) total[k] += c[k];
    total.ecartees += page.ecartees;
    if (page.suivant === null) return { ok: true, valeur: vue(true) };
    apres = page.suivant;
  }
}

function vueApercu(
  fenetre: Date, t: ComptesReprise & { ecartees: number }, complet: boolean, placesLibres: number | null,
): ApercuRepriseVue {
  return {
    fenetreDebut: fenetre.toISOString(), lues: t.lues, deja: t.deja, rattachables: t.rattachees, fichesACreer: t.fichesCreees,
    horsPlafond: t.horsPlafond, placesLibres,
    // 🔴 Les DERNIÈRES places de l'offre : ensuite, un inconnu qui écrit le premier n'entre plus.
    remplitLesPlaces: placesLibres !== null && t.fichesCreees > 0 && t.fichesCreees >= placesLibres,
    sansFiche: t.sansFiche, sansNumero: t.sansNumero, ecartees: t.ecartees, complet,
  };
}

/**
 * LE LANCEMENT : la boutique branchée, l'attestation et les droits de son app (le même contrôle que l'aperçu, pour ne rien
 * inscrire qui se refuserait aussitôt), une reprise inscrite (refusée si une autre vit), puis son job enfilé. Le job relit
 * tout : rien de l'aperçu n'est gardé. 🔴 Un job qui n'a pas pu être enfilé clôt sa reprise : vivante sans job, elle
 * refuserait tout lancement pendant 15 minutes.
 */
export async function lancerReprise(deps: DepsReprise, tenantId: string, par: string | null): Promise<IssueRattrapage<RepriseShopifyVue>> {
  const o = await ouvrir(deps, tenantId);
  if (!o.ok) return refusDOuverture(o);
  const maintenant = deps.maintenant ?? Date.now;
  const l = await deps.reprises.lancer(tenantId, debutDeFenetre(maintenant()), o.boutique.domaine, par);
  if (!l.ok) {
    return refus(409, `Un rattrapage est déjà en cours dans cet espace (lancé le ${l.vivante.commenceLe.toISOString().slice(0, 10)}) : attendez sa fin.`);
  }
  try {
    await deps.enfiler({ tenantId, repriseId: l.reprise.id }, 0);
  } catch (err) {
    await deps.reprises.annuler(l.reprise.id, tenantId, `le rattrapage n’a pas pu démarrer (${messageDe(err)}) : relancez-le`).catch(() => undefined);
    throw err;
  }
  return { ok: true, valeur: vueReprise(l.reprise, maintenant()) };
}

/** L'état de la dernière reprise de l'espace ; `null` si aucune n'a été lancée. */
export async function etatReprise(deps: Pick<DepsReprise, 'reprises' | 'maintenant'>, tenantId: string): Promise<RepriseShopifyVue | null> {
  const r = await deps.reprises.derniere(tenantId);
  return r ? vueReprise(r, (deps.maintenant ?? Date.now)()) : null;
}

export function vueReprise(r: Reprise, maintenant: number): RepriseShopifyVue {
  const vivante = r.statut === 'en_attente' || r.statut === 'en_cours';
  return {
    id: r.id, statut: r.statut,
    interrompue: vivante && !r.tenue && maintenant - r.majLe.getTime() > REPRISE_ABANDONNEE_MINUTES * 60_000,
    fenetreDebut: r.fenetreDebut.toISOString(), commenceLe: r.commenceLe.toISOString(), finiLe: r.finiLe?.toISOString() ?? null,
    comptes: { ...r.comptes }, erreur: r.erreur,
  };
}

/**
 * UN PASSAGE DU JOB. Le bail pris (sinon : finie, ou tenue par un autre passage, qu'on repasse voir après son bail),
 * page après page jusqu'à la fin de la fenêtre ou du passage. Refus de Shopify, ou attestation retirée : `refuse`.
 * Boutique coupée, effacée ou remplacée : `erreur`. 🔴 TOUTE autre panne (Shopify absent, base, secret illisible, une
 * place prise entre la lecture des places et la création) libère le bail AVANT de remonter : pg-boss rejoue le job, ses
 * essais s'usent, et une panne qui dure finit dans la file d'échec, la reprise dite interrompue quinze minutes plus tard.
 * Tenu, le bail ferait réenfiler chaque rejeu sans rien user, sans fin, et refuserait toute relance.
 */
export async function traiterReprise(deps: DepsReprise, data: unknown): Promise<void> {
  const j = schemaJobReprise.safeParse(data);
  if (!j.success) {
    journaliser('warn', 'shopify_reprise_illisible', { erreur: j.error.issues[0]?.message ?? 'invalide' });
    return;
  }
  const { tenantId, repriseId } = j.data;
  const prise = await deps.reprises.prendre(repriseId, tenantId);
  if (!prise) {
    const r = await deps.reprises.lire(repriseId, tenantId);
    if (r && (r.statut === 'en_attente' || r.statut === 'en_cours')) await deps.enfiler(j.data, Math.ceil(BAIL_REPRISE_SECONDES / 3));
    return;
  }
  try {
    await passage(deps, j.data, prise.jeton, prise.reprise);
  } catch (err) {
    await deps.reprises.relacher(repriseId, tenantId, prise.jeton).catch(() => undefined);
    throw err;
  }
}

async function passage(deps: DepsReprise, job: JobReprise, jeton: string, reprise: Reprise): Promise<void> {
  const { tenantId, repriseId } = job;
  const finir = (statut: 'termine' | 'refuse' | 'erreur', erreur: string | null, ajout?: ComptesReprise) =>
    deps.reprises.finir(repriseId, tenantId, jeton, statut, erreur, ajout);
  const o = await ouvrir(deps, tenantId);
  if (!o.ok) {
    if (o.nature === 'passager') throw new Error(o.message);
    // Le lancement l'a exigée : absente ici, l'attestation a été retirée depuis.
    await finir(o.nature === 'boutique' ? 'erreur' : 'refuse', o.cause === 'attestation_absente' ? PHRASE_ATTESTATION_RETIREE : o.message);
    return;
  }
  if (o.boutique.domaine !== reprise.domaine) { await finir('erreur', BOUTIQUE_CHANGEE); return; }
  const maintenant = deps.maintenant ?? Date.now;
  const debut = maintenant();
  let apres = reprise.curseur;
  let parPage = PAR_PAGE_REPRISE;
  let premiere = true;
  for (;;) {
    if (maintenant() - debut >= PASSAGE_REPRISE_MS) {
      // La suite d'abord, le bail ensuite : un plantage entre les deux laisse un job qui attend la fin du bail, jamais
      // une reprise vivante sans job.
      await deps.enfiler(job, 0);
      await deps.reprises.relacher(repriseId, tenantId, jeton);
      return;
    }
    const page = await deps.lirePage({ domaine: o.boutique.domaine, jeton: o.jeton }, { depuis: reprise.fenetreDebut, apres, parPage, delaiMs: DELAI_PAGE_MS });
    if (!page.ok) {
      if (page.code === 'trop_lourd' && parPage > 1) { parPage = Math.max(1, Math.floor(parPage / 2)); continue; }
      if (page.code === 'acces_refuse') { await finir('refuse', page.message); return; }
      throw new Error(page.message);
    }
    if (premiere) { journaliserCout(tenantId, 'rattrapage', parPage, page.cout); premiere = false; }
    // 🔴 La boutique relue avant d'écrire : coupée, effacée ou remplacée pendant le passage, on s'arrête sans rien écrire.
    const b = await deps.boutique(tenantId);
    if (!b || b.etat !== 'connectee') { await finir('erreur', BOUTIQUE_COUPEE); return; }
    if (b.domaine !== reprise.domaine) { await finir('erreur', BOUTIQUE_CHANGEE); return; }
    // 🔴 L'attestation relue avant d'écrire : retirée pendant le passage, plus aucune fiche ne naît consentante sur sa foi.
    const attestation = await deps.attestation(tenantId, reprise.domaine);
    if (attestation === null) { await finir('refuse', PHRASE_ATTESTATION_RETIREE); return; }
    const comptes = await rattacher(deps, tenantId, page.commandes, o.boutique, { source: sourceDuConsentement(reprise.domaine, attestation) });
    // La dernière page et la fin dans la MÊME écriture : un échec entre les deux ferait relire et recompter la page.
    if (page.suivant === null) { await finir('termine', null, comptes); return; }
    if (!(await deps.reprises.avancer(repriseId, tenantId, jeton, page.suivant, comptes))) return;
    apres = page.suivant;
  }
}
