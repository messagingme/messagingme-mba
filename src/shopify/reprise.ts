import { z } from 'zod';
import { telephoneDeCommande, type CommandeShopify } from './donnees';
import { detailsDeCommande } from './attribution';
import { BUDGET_LECTURE_MS } from './clients';
import { demanderJeton, type IssueJeton } from './connexion';
import { lireDroitsDeLApp, lirePageCommandes } from './commandes-lues';
import type { DetailsCommande, PgShopifyStore } from './store.pg';
import { BAIL_REPRISE_SECONDES, REPRISE_ABANDONNEE_MINUTES, type ComptesReprise, type PgReprisesStore, type Reprise } from './reprises.pg';
import type { PgContactStore } from '../crm/contact-store.pg';
import type { Issue } from './gestion';
import type { ApercuRepriseVue, RepriseShopifyVue } from '../../web/lib/partage/reprise-shopify';
import { journaliser } from '../lib/journal';
import { messageDe } from '../lib/erreur';

/**
 * LE RATTRAPAGE DES COMMANDES SHOPIFY (segments Shopify enrichis, lot 5 ; spec, chantier 2) : relire les commandes PAYÉES
 * créées dans les 60 derniers jours (la fenêtre que `read_orders` ouvre) et les rattacher aux fiches déjà là, lignes de
 * produits comprises, comme le webhook `orders/paid` l'aurait fait.
 *
 * 🔴 CE QU'IL FAIT, ET RIEN DE PLUS. Une commande DÉJÀ connue garde sa fiche ; elle ne reçoit ses lignes que si elle n'en
 * a aucune (celles d'avant le lot 3) et que sa fiche est active. Une commande inconnue se rattache à la fiche ACTIVE de
 * son numéro utilisable (`telephoneDeCommande`, le même choix que le webhook) ; sans fiche ou sans numéro, elle est
 * COMPTÉE, jamais gardée (décision de Julien du 2026-11-23). Aucune fiche créée, aucun message, ni attribution de vente,
 * ni joignabilité ; `commandes_depuis` ne bouge pas (il dit « suivi au fil de l'eau depuis », le rattrapage est un autre
 * stock).
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
  /** Une page ; `delaiMs` borne l'appel ENTIER, attentes du frein de Shopify comprises. */
  lirePage(acces: { domaine: string; jeton: string }, p: { depuis: Date; apres: string | null; parPage: number; delaiMs: number }): Promise<PageCommandes>;
  /** Les commandes déjà notées dans l'espace, leur fiche, et s'il faut leur ajouter leurs lignes. */
  commandesConnues(tenantId: string, ids: readonly string[]): Promise<Map<string, CommandeConnue>>;
  /** Les fiches ACTIVES de ces numéros (E.164) : numéro vers `contact_id`. */
  fichesParNumeros(tenantId: string, numeros: readonly string[]): Promise<Map<string, string>>;
  lierCommande(tenantId: string, commandeId: string, clientId: string | null, contactId: string, details: DetailsCommande): Promise<void>;
  enfiler(job: JobReprise, dansSecondes: number): Promise<void>;
  maintenant?: () => number;
}

/**
 * LE CÂBLAGE COMMUN de l'API (aperçu, lancement, état) et du worker (le job) : écrit une fois, pour qu'ils ne divergent
 * pas. Les magasins passent ENTIERS ou par une flèche : leurs méthodes lisent `this`.
 */
export function cablerReprise(o: {
  reprises: PgReprisesStore;
  boutiques: Pick<PgShopifyStore, 'acces' | 'lire' | 'commandesConnues' | 'lierCommande'>;
  contacts: Pick<PgContactStore, 'fichesParNumeros'>;
  /** `queue.enqueue` de la file `FILE_REPRISE`, différé à `quand` s'il est donné. */
  enfiler: (job: JobReprise, quand: Date | undefined) => Promise<void>;
}): DepsReprise {
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
    lirePage: (acces, p) => lirePageCommandes(acces, p),
    commandesConnues: (tenantId, ids) => o.boutiques.commandesConnues(tenantId, ids),
    fichesParNumeros: (tenantId, numeros) => o.contacts.fichesParNumeros(tenantId, numeros),
    lierCommande: (tenantId, commandeId, clientId, contactId, details) => o.boutiques.lierCommande(tenantId, commandeId, clientId, contactId, details),
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

const refus = (statut: 409 | 503, message: string) => ({ ok: false as const, statut, message });
const zero = (): ComptesReprise => ({ lues: 0, rattachees: 0, deja: 0, sansFiche: 0, sansNumero: 0 });

/** Le début de la fenêtre, à la date du jour : Shopify ne rend pas une commande créée plus tôt sans `read_all_orders`. */
export function debutDeFenetre(maintenant: number): Date {
  const d = new Date(maintenant - FENETRE_REPRISE_JOURS * 86_400_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function journaliserCout(tenantId: string, quoi: 'apercu' | 'rattrapage', parPage: number, cout: CoutRequete | undefined): void {
  journaliser('info', 'shopify_reprise_cout', { tenantId, quoi, parPage, demande: cout?.demande ?? null, reel: cout?.reel ?? null });
}

/**
 * Le rattachement d'une page : `ecrire` à faux, il ne fait que compter (l'aperçu). Une commande connue garde sa fiche et
 * ne reçoit ses lignes que s'il lui en manque ; une inconnue cherche la fiche active de son numéro utilisable. Deux
 * lectures groupées par page, jamais une par commande.
 */
export async function rattacher(
  deps: Pick<DepsReprise, 'commandesConnues' | 'fichesParNumeros' | 'lierCommande' | 'maintenant'>,
  tenantId: string, commandes: readonly CommandeLue[], boutique: { pays: string | null; devise: string | null }, ecrire: boolean,
): Promise<ComptesReprise> {
  const comptes = { ...zero(), lues: commandes.length };
  if (commandes.length === 0) return comptes;
  const connues = await deps.commandesConnues(tenantId, commandes.map((c) => String(c.corps.id)));
  const numeros = new Map<string, string | null>();
  for (const c of commandes) {
    const id = String(c.corps.id);
    if (!connues.has(id)) numeros.set(id, telephoneDeCommande(c.corps, boutique.pays));
  }
  const distincts = [...new Set([...numeros.values()].filter((n): n is string => n !== null))];
  const fiches = distincts.length > 0 ? await deps.fichesParNumeros(tenantId, distincts) : new Map<string, string>();
  const maintenant = deps.maintenant ?? Date.now;
  for (const c of commandes) {
    const id = String(c.corps.id);
    const connue = connues.get(id);
    let fiche: string | undefined;
    if (connue !== undefined) {
      comptes.deja += 1;
      // 🔴 Réécrire une commande déjà complète la dirait tronquée à tort : le rattrapage lit moins de lignes que le webhook.
      if (!connue.aCompleter) continue;
      fiche = connue.contactId;
    } else {
      const numero = numeros.get(id) ?? null;
      if (numero === null) { comptes.sansNumero += 1; continue; }
      fiche = fiches.get(numero);
      if (fiche === undefined) { comptes.sansFiche += 1; continue; }
      comptes.rattachees += 1;
    }
    if (!ecrire) continue;
    const details = detailsDeCommande(c.corps, { devise: boutique.devise }, maintenant);
    const lignes = details.lignes && c.lignesTronquees ? { ...details.lignes, tronquees: true } : details.lignes;
    await deps.lierCommande(tenantId, id, c.corps.customer?.id ? String(c.corps.customer.id) : null, fiche, { ...details, lignes });
  }
  return comptes;
}

/**
 * La boutique branchée, son jeton et les droits de son app, ou ce qui l'empêche : `boutique` (absente ou coupée),
 * `refus` (Shopify refuse l'app : identifiants, app désinstallée, droit `read_products` absent), `passager` (Shopify
 * n'a pas répondu, réessayer).
 */
async function ouvrir(deps: Pick<DepsReprise, 'boutique' | 'jeton' | 'droits'>, tenantId: string): Promise<
  | { ok: true; boutique: { domaine: string; pays: string | null; devise: string | null }; jeton: string }
  | { ok: false; nature: 'boutique' | 'refus' | 'passager'; statut: 409 | 503; message: string }
> {
  const b = await deps.boutique(tenantId);
  if (!b) return { ...refus(409, AUCUNE_BOUTIQUE), nature: 'boutique' };
  if (b.etat !== 'connectee') return { ...refus(409, BOUTIQUE_COUPEE), nature: 'boutique' };
  const j = await deps.jeton(b.domaine, b.clientId, b.secret);
  if (!j.ok) return j.code === 'passager' ? { ...refus(503, j.message), nature: 'passager' } : { ...refus(409, j.message), nature: 'refus' };
  const d = await deps.droits({ domaine: b.domaine, jeton: j.jeton });
  if (!d.ok) return d.code === 'passager' ? { ...refus(503, d.message), nature: 'passager' } : { ...refus(409, d.message), nature: 'refus' };
  if (!d.droits.includes('read_products')) return { ...refus(409, SANS_READ_PRODUCTS), nature: 'refus' };
  return { ok: true, boutique: { domaine: b.domaine, pays: b.pays, devise: b.devise }, jeton: j.jeton };
}

/**
 * L'APERÇU, synchrone, borné comme la lecture des clients (25 s, frein de Shopify compris) : il lit la fenêtre page après
 * page et compte, sans rien écrire. 🔴 S'il n'a pas fini, il le dit (`complet: false`) : un compte partiel n'est jamais
 * présenté comme un total. Une panne après des pages lues rend leurs comptes, dits partiels, plutôt qu'un refus.
 */
export async function apercuReprise(deps: DepsReprise, tenantId: string): Promise<Issue<ApercuRepriseVue>> {
  const o = await ouvrir(deps, tenantId);
  if (!o.ok) return { ok: false, statut: o.statut, message: o.message };
  const maintenant = deps.maintenant ?? Date.now;
  const debut = maintenant();
  const fenetre = debutDeFenetre(debut);
  const total = { ...zero(), ecartees: 0 };
  let apres: string | null = null;
  let parPage = PAR_PAGE_REPRISE;
  let pages = 0;
  for (;;) {
    const reste = BUDGET_LECTURE_MS - (maintenant() - debut);
    if (reste <= 1_000) return { ok: true, valeur: vueApercu(fenetre, total, false) };
    const page = await deps.lirePage({ domaine: o.boutique.domaine, jeton: o.jeton }, { depuis: fenetre, apres, parPage, delaiMs: Math.min(DELAI_PAGE_MS, reste) });
    if (!page.ok) {
      if (page.code === 'trop_lourd' && parPage > 1) { parPage = Math.max(1, Math.floor(parPage / 2)); continue; }
      // Un accès refusé dit quoi régler, même après des pages lues ; une autre panne garde ce qui est déjà compté.
      if (pages > 0 && page.code !== 'acces_refuse') return { ok: true, valeur: vueApercu(fenetre, total, false) };
      return { ok: false, statut: page.code === 'acces_refuse' ? 409 : 503, message: page.message };
    }
    if (pages === 0) journaliserCout(tenantId, 'apercu', parPage, page.cout);
    pages += 1;
    const c = await rattacher(deps, tenantId, page.commandes, o.boutique, false);
    for (const k of Object.keys(c) as Array<keyof ComptesReprise>) total[k] += c[k];
    total.ecartees += page.ecartees;
    if (page.suivant === null) return { ok: true, valeur: vueApercu(fenetre, total, true) };
    apres = page.suivant;
  }
}

function vueApercu(fenetre: Date, t: ComptesReprise & { ecartees: number }, complet: boolean): ApercuRepriseVue {
  return {
    fenetreDebut: fenetre.toISOString(), lues: t.lues, deja: t.deja, rattachables: t.rattachees, sansFiche: t.sansFiche,
    sansNumero: t.sansNumero, ecartees: t.ecartees, complet,
  };
}

/**
 * LE LANCEMENT : la boutique branchée et les droits de son app (le même contrôle que l'aperçu, pour ne rien inscrire
 * qui se refuserait aussitôt), une reprise inscrite (refusée si une autre vit), puis son job enfilé. Le job relit tout :
 * rien de l'aperçu n'est gardé. 🔴 Un job qui n'a pas pu être enfilé clôt sa reprise : vivante sans job, elle refuserait
 * tout lancement pendant 15 minutes.
 */
export async function lancerReprise(deps: DepsReprise, tenantId: string, par: string | null): Promise<Issue<RepriseShopifyVue>> {
  const o = await ouvrir(deps, tenantId);
  if (!o.ok) return { ok: false, statut: o.statut, message: o.message };
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
 * page après page jusqu'à la fin de la fenêtre ou du passage. Refus de Shopify : `refuse`. Boutique coupée, effacée ou
 * remplacée : `erreur`. 🔴 TOUTE autre panne (Shopify absent, base, secret illisible) libère le bail AVANT de remonter :
 * pg-boss rejoue le job, ses essais s'usent, et une panne qui dure finit dans la file d'échec, la reprise dite interrompue
 * quinze minutes plus tard. Tenu, le bail ferait réenfiler chaque rejeu sans rien user, sans fin, et refuserait toute
 * relance.
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
    await finir(o.nature === 'boutique' ? 'erreur' : 'refuse', o.message);
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
    const comptes = await rattacher(deps, tenantId, page.commandes, o.boutique, true);
    // La dernière page et la fin dans la MÊME écriture : un échec entre les deux ferait relire et recompter la page.
    if (page.suivant === null) { await finir('termine', null, comptes); return; }
    if (!(await deps.reprises.avancer(repriseId, tenantId, jeton, page.suivant, comptes))) return;
    apres = page.suivant;
  }
}
