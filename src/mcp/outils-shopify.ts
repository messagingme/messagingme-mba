import { ficheOutilMcp } from '../../web/lib/partage/catalogue-mcp';
import type { DepsMcp, OutilMcp } from './outils';
import { RefusOutil, familleDuRefus, refusDuCoeur, refusDuPlafond } from './saisie';
import { signataire } from './outils-agent';
import { journaliser } from '../lib/journal';
import {
  AUTOMATIONS_DISPONIBLES, DELAI_PANIER_DEFAUT, DELAI_PANIER_MAX, DELAI_PANIER_MIN, DONNEES_PAR_EVENEMENT, EVENEMENTS_DISPONIBLES, LIGNE_PANIER_AGENT,
} from '../shopify/donnees';
import {
  apercuImportClients, brancherMessage, connecterShopify, couperShopify, etatShopify, importerClients, IMPORT_MAX, type Issue,
} from '../shopify/gestion';
import { reglerAttestation, type EtatLigne } from '../shopify/lignes-gestion';
import type { MessageBranche } from '../shopify/store.pg';
import { apercuReprise, etatReprise, lancerReprise, PHRASE_ATTESTATION_RATTRAPAGE_CLAUDE, type IssueRattrapage } from '../shopify/reprise';
import { lireCollections } from '../shopify/collections';
import { lireEtiquettes, lireSegments, reglerEtiquettes, suivreSegmentsShopify } from '../shopify/etiquettes';
import type { RepriseShopifyVue } from '../../web/lib/partage/reprise-shopify';
import { BORNES_SEGMENTS, MOTIF_ID_COLLECTION, type SegmentShopifyVue, type SynchroEtiquettesVue } from '../../web/lib/partage/segments';
import { messageDe } from '../lib/erreur';
import { LISTES } from './ecran';

/**
 * Les produits vus des commandes (segments Shopify enrichis, lot 3), pour les critères produit de l'assistant. AU MIEUX :
 * une panne (la table pas encore créée, migration 0311 non bloquante) rend une liste vide, jamais un outil en échec.
 */
async function produitsVusAuMieux(deps: DepsMcp, tenantId: string): Promise<Array<{ product_id: string | null; sku: string | null; title: string; variant: string | null; orders: number }>> {
  try {
    return (await deps.contacts.produitsVus(tenantId, undefined, 20))
      .map((p) => ({ product_id: p.produitId, sku: p.sku, title: p.titre, variant: p.varianteTitre, orders: p.commandes }));
  } catch (err) {
    journaliser('warn', 'mcp_produits_vus_illisibles', { tenantId, erreur: messageDe(err) });
    return [];
  }
}

/**
 * Les collections lues des produits achetés et l'état de leur lecture (segments Shopify enrichis, lot 6a), pour le critère
 * `collections` de l'assistant : la MÊME lecture que le volet Shopify de la console, qui enfile une lecture quand un
 * produit l'attend. AU MIEUX : une panne rend `null`, jamais un outil en échec.
 */
async function collectionsAuMieux(deps: DepsMcp, tenantId: string) {
  try {
    const v = await lireCollections(deps.shopify.collections, tenantId, undefined);
    return {
      read_at: v.lecture.lueLe, reading: v.lecture.enCours,
      refused: v.lecture.refus === null ? null : { reason: v.lecture.refus.code, message: v.lecture.refus.message },
      incomplete: v.lecture.incompletes,
      list: v.collections.map((c) => ({ collection_id: c.collectionId, title: c.titre, products_seen: c.produits })),
    };
  } catch (err) {
    journaliser('warn', 'mcp_collections_illisibles', { tenantId, erreur: messageDe(err) });
    return null;
  }
}

/** L'état de la synchronisation des étiquettes Shopify (segments Shopify enrichis, lot 6b), sous les noms de l'outil. */
const versSynchro = (v: SynchroEtiquettesVue) => ({
  enabled: v.allumee, synced_at: v.synchroLe, syncing: v.enCours,
  refused: v.refus === null ? null : { reason: v.refus.code, message: v.refus.message },
  counts: {
    customers_read: v.comptes.clientsLus, records_found_by_phone: v.comptes.trouvesParTelephone,
    customers_without_record: v.comptes.sansFiche, records_tagged: v.comptes.fichesEtiquetees,
  },
});

/**
 * Les étiquettes Shopify lues et l'état de leur synchronisation (segments Shopify enrichis, lot 6b), pour le critère
 * `shopify_tags` de l'assistant : la MÊME lecture que le volet Shopify de la console, qui n'enfile rien. AU MIEUX : une
 * panne rend `null`, jamais un outil en échec.
 */
async function etiquettesAuMieux(deps: DepsMcp, tenantId: string) {
  try {
    const v = await lireEtiquettes(deps.shopify.etiquettes, tenantId, undefined);
    return { ...versSynchro(v.synchro), list: v.etiquettes.map((e) => ({ tag: e.etiquette, records: e.fiches })) };
  } catch (err) {
    journaliser('warn', 'mcp_etiquettes_illisibles', { tenantId, erreur: messageDe(err) });
    return null;
  }
}

/** Un segment Shopify lu (lot 6c), sous les noms de l'outil. */
const versSegment = (s: SegmentShopifyVue) => ({
  id: s.segmentId, name: s.nom, query: s.requete, followed: s.suivi, gone: s.absent, read_at: s.luLe, partial: s.partiel,
  members: s.membres, records: s.fiches,
});

/** Les segments Shopify lus (lot 6c), pour le critère `shopify_segments` : la MÊME lecture que le volet. AU MIEUX. */
async function segmentsAuMieux(deps: DepsMcp, tenantId: string) {
  try {
    const v = await lireSegments(deps.shopify.etiquettes, tenantId);
    return { followed_max: BORNES_SEGMENTS.segmentsShopifyMax, list: v.segments.map(versSegment) };
  } catch (err) {
    journaliser('warn', 'mcp_segments_illisibles', { tenantId, erreur: messageDe(err) });
    return null;
  }
}

/**
 * LE CONNECTEUR SHOPIFY DEPUIS CLAUDE CODE (plan 2026-10-21, lot 1) : la skill `shopify` du plugin pilote la CLI de
 * Shopify chez le marchand (création et publication de l'app, lien d'installation, `app env show`), puis ces outils
 * gardent la boutique et branchent les messages. La MÊME gestion que la carte de la console (`src/shopify/gestion.ts`).
 *
 * 🔴 TOUS EXIGENT UNE PERSONNE NOMMÉE (OAuth) : l'import déclare l'accord des clients au nom de la personne connectée, et
 * une clé `mcp:write` donnée à un agent qui lit des messages de clients ne doit ni brancher ni débrancher la boutique, ni
 * en importer les clients (lot 3).
 * Ouverts à toutes les offres (décision de Julien), Base comprise, qui n'a pas de console.
 */

function valeur<T>(r: Issue<T>): T {
  if (!r.ok) throw new RefusOutil(r.message, familleDuRefus(r.statut));
  return r.valeur;
}

/**
 * Un refus du rattrapage des commandes (lot 5b) : sans l'attestation du marchand, la phrase de Claude Code (la question à
 * lui poser, l'outil à rappeler) au lieu de celle de la console, qui dit où cocher.
 */
function valeurDuRattrapage<T>(r: IssueRattrapage<T>): T {
  if (!r.ok && r.cause === 'attestation_absente') throw new RefusOutil(PHRASE_ATTESTATION_RATTRAPAGE_CLAUDE, familleDuRefus(r.statut));
  return valeur(r);
}

const evenements = EVENEMENTS_DISPONIBLES.map((e) => `${e} (${DONNEES_PAR_EVENEMENT[e].join(', ')})`).join('; ');

/** Une reprise des commandes (segments Shopify enrichis, lots 5 et 5b), telle que le lancement et l'état la rendent. */
const versRattrapage = (v: RepriseShopifyVue) => ({
  status: v.statut, interrupted: v.interrompue, window_start: v.fenetreDebut, started_at: v.commenceLe, finished_at: v.finiLe,
  counts: {
    paid_orders_read: v.comptes.lues, attached: v.comptes.rattachees, records_created: v.comptes.fichesCreees ?? 0,
    over_plan_limit: v.comptes.horsPlafond ?? 0, already_known: v.comptes.deja,
    without_record: v.comptes.sansFiche, without_usable_phone: v.comptes.sansNumero,
  },
  error: v.erreur,
});

/** L'attestation demandée au marchand, la même que pour les automations : ici, elle fonde l'accord des fiches créées. */
const ATTESTATION_RATTRAPAGE = {
  type: 'boolean' as const,
  description: 'true ONLY once the merchant has confirmed themself, in this conversation, that the customers of their store '
    + 'agreed to receive their WhatsApp messages, offers included (order confirmation and tracking, checkout reminders, '
    + 'campaigns): it records their attestation (who, when, the exact wording) before the catch-up starts. Never answer for '
    + 'the merchant. Required once: the buyer records the catch-up creates are opted in on its strength.',
};

/** Un message d'avant le lot 5 (l'ancienne table), que `get_shopify_state` rend encore aux plugins d'avant. */
const versMessage = (m: MessageBranche) => ({
  event: m.evenement, template: m.modele, text: m.texte, language: m.langue, variables: m.variables, active: m.actif,
});

/**
 * Une automation (menu « Scénario », lot 5), telle que les deux outils la rendent. 🔴 Décision 7 : `set_shopify_message`
 * ne change que le premier template du scénario ; la note dit les étapes qu'il ne change pas (la console), ou, sans les
 * scénarios dans l'offre (Free), que seule la première part.
 */
function versAutomation(l: EtatLigne, scenarios: boolean) {
  const suite = l.blocs - 1;
  // Le message standard (2026-11-20) attend Meta dans une version programmée : le premier template publié est encore vide.
  const enAttente = l.modele === null && l.versionProgrammee && l.apercu !== null;
  const note = enAttente
    ? 'The standard message (message) is under review at Meta: once approved it becomes the template, and set_shopify_message '
      + 'with that template and active true turns the automation on.'
    : l.modele === null
    ? 'No first template yet: set_shopify_message with a template sets it.'
    : suite <= 0 ? null
      : scenarios
        ? `The scenario has ${suite} more step${suite > 1 ? 's' : ''} after its first template: set_shopify_message changes only the first `
          + 'template, the other steps are changed in the console (Scenario > Automation > Shopify, Open the scenario).'
        : 'On this plan only the first step is sent: the other steps of the scenario need the Pro plan.';
  return {
    event: l.evenement, active: l.actif, scenario: l.scenario, template: l.modele, language: l.langue,
    template_status: l.etatChezMeta, steps: l.blocs,
    // Le texte du premier message, variables numérotées ({{1}}...), celui qui attend Meta s'il y en a un.
    // Et ses données dans l'ordre de {{1}}, {{2}}... : ce que `set_shopify_message` doit renvoyer pour allumer sans les perdre
    // (absentes si une position n'est pas une donnée Shopify, ce que l'outil ne sait pas poser).
    ...(l.apercu !== null ? {
      message: l.apercu.corps,
      ...(l.apercu.donnees.every((d) => d !== null) ? { variables: l.apercu.donnees } : {}),
      ...(l.apercu.enValidation ? { message_under_review: true } : {}),
    } : {}),
    ...(note !== null ? { note } : {}),
    // La relance avec agent IA (2026-11-20) : l'agent du bouton « Vous avez une question ? », et ce qui l'empêche de servir.
    ...(l.evenement === LIGNE_PANIER_AGENT ? {
      agent: l.agent === null ? null : { id: l.agent.id, name: l.agent.label, active: l.agent.actif },
      ...(l.avertissements.length > 0 ? { warnings: l.avertissements } : {}),
    } : {}),
  };
}

/**
 * L'attestation du marchand, posée par Claude Code une fois que le marchand l'a confirmée (2026-11-20) : la phrase
 * française mot pour mot (les messages standard sont en français), origine `claude_code`, la personne nommée de l'OAuth.
 */
async function attester(deps: DepsMcp, tenantId: string, par: string | null): Promise<void> {
  valeur(await reglerAttestation(deps.shopify.lignes, tenantId, { coche: true, langue: 'fr', origine: 'claude_code' }, par));
}

/** Les automations rendues ; l'offre n'est lue que si un scénario a plus d'une étape (sinon elle ne change rien). */
async function automations(deps: DepsMcp, tenantId: string, lignes: readonly EtatLigne[]) {
  const scenarios = lignes.some((l) => l.blocs > 1) ? (await deps.offres.offreDe(tenantId)).droits.fonctions.has('scenarios') : true;
  return lignes.map((l) => versAutomation(l, scenarios));
}

export const OUTILS_SHOPIFY: OutilMcp[] = [
  {
    ...ficheOutilMcp('connect_shopify'),
    fonction: null,
    description:
      'Connects the merchant\'s Shopify store to the workspace, with the app the shopify skill created in the merchant\'s '
      + 'own Shopify organization and installed on the store: store (the <name>.myshopify.com domain), client_id and '
      + 'client_secret (SHOPIFY_API_KEY and SHOPIFY_API_SECRET from shopify app env show). The connection is checked with '
      + 'Shopify before the secret is kept, encrypted; a refusal says what to do (for example click Install on the given '
      + 'link). Reconnecting replaces the secret. Connecting writes a standard WhatsApp message for each event that has none '
      + '(order paid, order shipped, abandoned checkout) and sends it to Meta for approval; the automations stay off until '
      + 'turned on (get_shopify_state shows them). Counts toward the workspace\'s heavy operations.',
    annotations: { title: 'Connect a Shopify store', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    entree: {
      type: 'object',
      properties: {
        store: { type: 'string', minLength: 1, maxLength: 100, description: 'The store domain, <name>.myshopify.com.' },
        client_id: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$', description: 'The app client id (SHOPIFY_API_KEY).' },
        client_secret: { type: 'string', minLength: 1, maxLength: 200, description: 'The app client secret (SHOPIFY_API_SECRET).' },
        customers_consent_attested: {
          type: 'boolean',
          description: 'true ONLY once the merchant has confirmed themself, in this conversation, that the customers of their store '
            + 'agreed to receive their WhatsApp messages, offers included (order confirmation and tracking, checkout reminders, '
            + 'campaigns): it records their attestation (who, when, the exact wording). Never answer for the merchant. Required '
            + 'once before turning an automation on.',
        },
      },
      required: ['store', 'client_id', 'client_secret'],
      additionalProperties: false,
    },
    ecran: () => LISTES.integrations,
    async executer(deps: DepsMcp, tenantId, args, personne) {
      const c = await deps.couteux.consommer(tenantId);
      if (!c.accepte) throw refusDuPlafond(c.attenteMs);
      const vue = valeur(await connecterShopify(deps.shopify, tenantId, { boutique: args.store, clientId: args.client_id, secret: args.client_secret }, personne?.userId ?? null, 'claude_code'));
      journaliser('info', 'mcp_shopify_connectee', { tenantId, userId: personne?.userId ?? null, boutique: vue.domaine });
      if (args.customers_consent_attested === true) await attester(deps, tenantId, personne?.userId ?? null);
      return { store: vue.domaine, name: vue.nom, country: vue.pays, currency: vue.devise, state: vue.etat };
    },
  },
  {
    ...ficheOutilMcp('set_shopify_message'),
    fonction: null,
    description:
      'Sets the WhatsApp message sent when a Shopify event happens, or turns it off. Each event has an automation: a scenario '
      + 'whose first step is an approved template (template, language, variables: the Shopify data of {{1}}, {{2}}... in '
      + 'order, as many as the template has). This tool creates the automation and its scenario if missing, sets the template '
      + 'of the first step and keeps the following steps (changing the quick replies a following step starts from is '
      + 'refused); the other steps are changed in the console, and on the Free plan only the first step is sent. A version of '
      + 'the scenario scheduled for Meta\'s approval is cancelled. active false turns the automation off and stops its '
      + 'journeys. On a number linked by QR code (numero.filiere application), Shopify messages cannot go out: WhatsApp does '
      + 'not let a linked device write first to a customer, so turning one on is refused. Link the number through Meta (with '
      + 'a Meta Business account) for order confirmations, shipping updates and reminders. '
      + `Events and their data: ${evenements}. `
      + 'An order message must be a utility template, approved at Meta (create_template, then get_template_status), and a '
      + 'checkout_abandoned reminder a marketing template. A checkout_abandoned reminder is sent once, delay_minutes after '
      + 'the checkout last changed and only if no order came out of it. A missing first name is replaced by a neutral '
      + 'word. Links go in the body (a URL button takes no variable), except the checkout link: a URL button can point to '
      + 'https://<store>/{panier_shopify}, which Messaging Me redirects, on click, to the checkout of the customer who clicks '
      + '(checkout_abandoned); the standard checkout message already has this button. Each message records the customer as opted in (source '
      + 'shopify:<store>), for campaigns too: the merchant is responsible for its customers\' consent, and a customer who said '
      + 'STOP stays opted out and receives nothing. Turning an automation on requires, once, an attestation from the merchant that '
      + 'their customers agreed (customers_consent_attested: ask the merchant, never answer for them). '
      + 'Every message goes through the sends rules (STOP, monthly templates, '
      + 'contact limit) and appears in Campaigns. '
      + `${LIGNE_PANIER_AGENT} is the checkout reminder with an AI agent: the same reminder plus a quick reply button asking `
      + 'whether the customer has a question, which hands the conversation to an AI agent of the workspace (agent_id, an active agent: list_agents), '
      + `required to turn it on. Turning it on turns checkout_abandoned off (and the reverse): a checkout gets one reminder. `
      + 'Without template, its standard message is created and submitted to Meta (no checkout is reminded until Meta approves '
      + 'it). An operator who holds the conversation keeps it; if the agent cannot answer (no AI credit, inactive), the '
      + 'conversation goes to the team.',
    annotations: { title: 'Set a Shopify message', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    entree: {
      type: 'object',
      properties: {
        event: { type: 'string', enum: [...AUTOMATIONS_DISPONIBLES], description: 'The Shopify event, or checkout_abandoned_agent (the checkout reminder with an AI agent).' },
        agent_id: { type: 'string', format: 'uuid', description: 'checkout_abandoned_agent only: the active AI agent that answers when the customer taps the question button (list_agents). Required to turn it on; given on an automation already on, it changes the agent.' },
        template: { type: 'string', minLength: 1, maxLength: 512, description: 'The template of the first step (required to turn the automation on).' },
        language: { type: 'string', minLength: 1, maxLength: 20, description: 'The template language (fr, en_US...).' },
        variables: {
          type: 'array', maxItems: 10, items: { type: 'string', enum: [...new Set(EVENEMENTS_DISPONIBLES.flatMap((e) => DONNEES_PAR_EVENEMENT[e]))] },
          description: 'With template: the Shopify data of {{1}}, {{2}}..., in order.',
        },
        active: { type: 'boolean', description: 'false turns the automation off and stops its journeys (default true).' },
        delay_minutes: {
          type: 'integer', minimum: DELAI_PANIER_MIN, maximum: DELAI_PANIER_MAX,
          description: `checkout_abandoned only: minutes after the checkout last changed (default ${DELAI_PANIER_DEFAUT}).`,
        },
        customers_consent_attested: {
          type: 'boolean',
          description: 'true ONLY once the merchant has confirmed themself, in this conversation, that the customers of their store '
            + 'agreed to receive their WhatsApp messages, offers included (order confirmation and tracking, checkout reminders, '
            + 'campaigns): it records their attestation (who, when, the exact wording). Never answer for the merchant. Required '
            + 'once before turning an automation on.',
        },
      },
      required: ['event', 'language'],
      additionalProperties: false,
    },
    ecran: () => LISTES.messagesShopify,
    async executer(deps: DepsMcp, tenantId, args, personne) {
      // Un plugin d'avant le 2026-10-26 envoie encore `customers_consented` : hors schéma, le serveur la refuse avant
      // l'outil depuis le 2026-11-04 (`refusDesClesInconnues`), avec le refus générique (`todo.md`).
      // L'attestation du marchand d'abord (2026-11-20) : sans elle, aucun allumage ne passe.
      if (args.customers_consent_attested === true) await attester(deps, tenantId, personne?.userId ?? null);
      const r = valeur(await brancherMessage(deps.shopify, tenantId, {
        evenement: args.event, modele: args.template, langue: args.language, variables: args.variables, actif: args.active,
        delaiMinutes: args.delay_minutes, agentId: args.agent_id,
      }, personne?.userId ?? null));
      journaliser('info', 'mcp_shopify_message', { tenantId, userId: personne?.userId ?? null, evenement: args.event });
      return {
        automations: await automations(deps, tenantId, r.lignes),
        ...(r.programmationAnnulee
          ? { scheduled_version_cancelled: 'A version of this scenario was scheduled for Meta\'s approval: it is cancelled, the new first template is live now.' }
          : {}),
      };
    },
  },
  {
    ...ficheOutilMcp('get_shopify_state'),
    fonction: null,
    description:
      'The Shopify store connected to the workspace: its state (connected or cut), whether it is paused, its automations (one '
      + 'per event: on or off, its scenario, the first template and its status at Meta, the number of steps, the text of the '
      + 'first message with its Shopify data in order, and whether it is under review at Meta; for checkout_abandoned_agent, '
      + 'its AI agent and its warnings: bouton_absent, agent_inactif, modele_en_attente, modele_refuse), the last event '
      + 'received, and the last 30 days of events by outcome (sent, '
      + 'opted out, without consent, contact limit, monthly templates limit, without phone...; on a number linked by QR code '
      + 'also premier_contact: such a number never writes first, so its Shopify messages cannot go out; and for a message '
      + 'queued before that rule, en_file, pas_sur_whatsapp, gele, numero_coupe, refuse_whatsapp, filiere_differente), and '
      + 'the abandoned checkouts: '
      + 'their delay and, over the last 7 days, the reminders sent, those closed in time by an order, those waiting (all '
      + 'three counted on the checkouts opened in those days), and, by reminder date, the reminders that went out and those '
      + 'recovered (reminded then paid, test orders excluded) with their amount per currency: compare these two together. '
      + 'The revenue attributed to WhatsApp over any period: get_revenue_stats. messages: the setting from before automations '
      + 'became scenarios, kept for older plugins; it no longer sends. products_seen: the 20 products found most often in '
      + 'paid orders (product_id, sku, title), gift cards left out: the ids and SKUs for bought, not_bought and '
      + 'days_since_product. collections: the Shopify collections of the products ordered, as they are in the store at the '
      + 'last reading (read_at; null: no reading has succeeded yet, and the collections criterion is refused), the 50 '
      + 'holding the most ordered products (collection_id, title, products_seen): the ids for the collections criterion. '
      + 'Reading this tool starts a reading when an ordered product was never read or was read over 24 hours ago (reading: '
      + 'true, a few minutes); refused says why the last one failed (sans_droit: the store app lacks the read_products '
      + 'scope, which the shopify skill adds); incomplete: a product is in more than 50 collections, the list is not exhaustive. '
      + 'shopify_tags: the tags the merchant put on their customers in Shopify, read by the sync of sync_shopify_customer_tags '
      + '(NOT the Messaging Me tags of the contacts): enabled (off until the merchant turns it on), synced_at (the last sync '
      + 'that succeeded; null: none yet, and the shopify_tags criterion is refused), syncing, refused (why the last one '
      + 'failed), counts (customers read, records found by their phone, customers whose record no longer exists, records '
      + 'carrying a tag), and list: the 50 tags carried by the most records (tag, records). '
      + 'shopify_segments: the customer segments built by the merchant in Shopify, listed by the same sync, followed ones '
      + 'first (followed_max at most, chosen with sync_shopify_customer_tags segments): id (for the shopify_segments '
      + 'criterion), name, query (the Shopify segment query, shown as is), followed, gone (no longer in the store), read_at '
      + '(the last full reading of its members; null: not read, and the criterion is refused), partial (the last reading did '
      + 'not finish: the members from before stay), members (customers in it at Shopify) and records (contacts reached by '
      + 'their numbers). Reading this tool starts nothing.',
    annotations: { title: 'Get the Shopify connection', readOnlyHint: true, openWorldHint: false },
    entree: { type: 'object', properties: {} },
    async executer(deps: DepsMcp, tenantId) {
      const e = await etatShopify(deps.shopify, tenantId);
      if (e.boutique === null) return { connected: false, next_step: 'run the shopify skill of the Messaging Me plugin, then connect_shopify' };
      return {
        connected: e.boutique.etat === 'connectee',
        store: e.boutique.domaine, name: e.boutique.nom, state: e.boutique.etat, cut_reason: e.boutique.motifCoupure,
        last_event_at: e.boutique.dernierEvenementLe,
        paused: e.boutique.pauseLe !== null,
        // L'attestation du consentement des clients (2026-11-20) : sans elle, aucune automation ne s'allume.
        customers_consent_attested: e.attestation?.coche === true,
        ...(e.attestation?.coche === true ? { customers_consent_attested_at: e.attestation.le } : {}),
        automations: await automations(deps, tenantId, e.lignes),
        messages: e.messages.map(versMessage),
        last_30_days: e.compteurs,
        checkouts: {
          delay_minutes: e.boutique.delaiPanierMinutes, reminders_last_7_days: e.paniers.relances,
          closed_in_time: e.paniers.fermesATemps, waiting: e.paniers.enAttente,
          sent_reminders_last_7_days: e.paniers.relancesParties,
          recovered_last_7_days: e.paniers.recuperes,
          recovered_amount_last_7_days: e.paniers.montantsRecuperes.map((m) => ({ currency: m.devise, amount: m.montant })),
        },
        store_apps_page: e.pageApps,
        products_seen: await produitsVusAuMieux(deps, tenantId),
        collections: await collectionsAuMieux(deps, tenantId),
        shopify_tags: await etiquettesAuMieux(deps, tenantId),
        shopify_segments: await segmentsAuMieux(deps, tenantId),
      };
    },
  },
  {
    ...ficheOutilMcp('sync_shopify_customer_tags'),
    fonction: null,
    description:
      'Reads the tags the merchant put on their customers in Shopify (customer tags) into a list of their own. They are NOT '
      + 'the Messaging Me tags of the contacts (the tags parameter of find_contacts; tag_contacts adds those), and the sync '
      + 'never turns them into Messaging Me tags. enabled true (default) turns the sync on and starts a reading now: each '
      + 'record is matched to EVERY Shopify customer who has its number among theirs (contact phone, saved addresses), so a '
      + 'record carries the tags of all its customers; never by an order we noted. '
      + 'Each call searches every record again (a number fixed at Shopify gets matched); the daily refresh only searches new '
      + 'records. No record is created; a customer without a record is counted and forgotten. On the Pro, Business and Enterprise plans the sync then refreshes itself at most every 24 hours; on the '
      + 'Free plan it reads on demand only, at most once every 24 hours (refused before, with the delay). enabled false '
      + 'turns the daily refresh off and keeps the tags already read. The reading runs in the background, a few minutes: '
      + 'get_shopify_state follows it (shopify_tags) and lists the tags read with how many records carry each. Then target '
      + 'them with shopify_tags in find_contacts, tag_contacts or prepare_campaign (Pro plan and above), refused until a '
      + 'sync has succeeded. To freeze the target of a campaign, tag its contacts with tag_contacts: copying Shopify tags '
      + 'to Messaging Me tags is always an explicit step, never automatic. The same sync lists the customer segments built '
      + `in Shopify (get_shopify_state shopify_segments.list) and reads the members of those followed: segments chooses them, `
      + `exactly these ids, ${BORNES_SEGMENTS.segmentsShopifyMax} at most ([] stops following them all; omitted, the choice stays), `
      + 'among the segments listed, with the sync on; a reading starts to read them. Target them with shopify_segments. '
      + 'Needs the read_customers scope only. Counts toward the workspace\'s heavy operations.',
    annotations: { title: 'Sync the Shopify customer tags', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    entree: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'true (default): turn the sync on and read now. false: turn the daily refresh off, keeping the tags read.',
        },
        segments: {
          type: 'array', maxItems: BORNES_SEGMENTS.segmentsShopifyMax, items: { type: 'string', pattern: MOTIF_ID_COLLECTION },
          description: `The Shopify segments to follow, by id (id in get_shopify_state shopify_segments.list), ${BORNES_SEGMENTS.segmentsShopifyMax} `
            + 'at most: exactly these afterwards, a segment left out loses its members. [] stops following them all. Omitted: '
            + 'the followed segments stay. Needs enabled true.',
        },
      },
      additionalProperties: false,
    },
    ecran: () => LISTES.integrations,
    async executer(deps: DepsMcp, tenantId, args, personne) {
      const allumee = args.enabled !== false;
      if (allumee) {
        const c = await deps.couteux.consommer(tenantId);
        if (!c.accepte) throw refusDuPlafond(c.attenteMs);
      }
      // Lot 6c : le choix des segments suivis, seulement s'il est donné (un champ omis n'est pas touché).
      const segments = args.segments;
      if (segments !== undefined) {
        const motif = new RegExp(MOTIF_ID_COLLECTION);
        if (!Array.isArray(segments) || segments.length > BORNES_SEGMENTS.segmentsShopifyMax || !segments.every((x) => typeof x === 'string' && motif.test(x))) {
          throw new RefusOutil(`paramètre « segments » : ${BORNES_SEGMENTS.segmentsShopifyMax} identifiants de segment au plus, en chiffres`, 'invalid_args');
        }
        if (!allumee) throw new RefusOutil('paramètre « segments » : suivre des segments demande la synchronisation allumée (enabled true)', 'invalid_args');
      }
      // Avec des segments et la synchronisation DÉJÀ allumée, le choix seul : un segment inconnu refuse tout sans rien lancer,
      // et la Free qui attend sa prochaine lecture garde le choix (comme la carte). Éteinte, `enabled` l'allume d'abord.
      const dejaAllumee = Array.isArray(segments) && (await deps.shopify.etiquettes.magasin.etat(tenantId))?.allumee === true;
      let reglee: (SynchroEtiquettesVue & { lancee: boolean }) | null = null;
      if (!dejaAllumee) {
        const r = await reglerEtiquettes(deps.shopify.etiquettes, tenantId, allumee);
        if (!r.ok) throw refusDuCoeur(r);
        reglee = r.valeur;
      }
      let suivis: (SynchroEtiquettesVue & { lancee: boolean }) | null = null;
      if (Array.isArray(segments)) {
        const s = await suivreSegmentsShopify(deps.shopify.etiquettes, tenantId, segments as string[]);
        if (!s.ok) throw refusDuCoeur(s);
        suivis = s.valeur;
      }
      const vue = (suivis ?? reglee)!;
      const lancee = reglee?.lancee === true || suivis?.lancee === true;
      journaliser('info', 'mcp_shopify_etiquettes', {
        tenantId, userId: personne?.userId ?? null, allumee, lancee, ...(Array.isArray(segments) ? { segments: segments.length } : {}),
      });
      return {
        ...versSynchro(vue),
        reading_started: lancee,
        ...(Array.isArray(segments) ? { segments_followed: [...new Set(segments as string[])] } : {}),
        next_step: !allumee
          ? 'the daily refresh is off; the tags already read stay, and the shopify_tags criterion keeps working with synced_at'
          : lancee || vue.enCours
            ? 'get_shopify_state follows the reading (shopify_tags.syncing, then synced_at): a few minutes for most stores'
            : Array.isArray(segments) && segments.length > 0
              ? 'the followed segments will be read at the next sync (sync_shopify_customer_tags again once the plan allows it)'
              : 'get_shopify_state lists the tags read (shopify_tags.list)',
      };
    },
  },
  {
    ...ficheOutilMcp('preview_shopify_customers'),
    fonction: null,
    description:
      'Counts, before any import, the customers of the connected Shopify store who subscribed to marketing (email or '
      + 'SMS) and have a valid phone: how many are already in the workspace, how many are new, how many free places the '
      + 'plan leaves (null when unlimited), and how many an import would write (importable, newest first). Writes nothing: '
      + 'the numbers the merchant chooses from (up to the free places, or a higher plan) before import_shopify_customers. '
      + 'When the workspace replaces its oldest contacts once full (a Business or Entreprise option), importable goes up to '
      + 'the whole limit and oldest_deleted tells how many of the oldest contacts the import would permanently delete: say it '
      + 'before importing. Counts toward the workspace\'s heavy operations.',
    annotations: { title: 'Count the Shopify customers to import', readOnlyHint: true, openWorldHint: true },
    entree: { type: 'object', properties: {} },
    async executer(deps: DepsMcp, tenantId) {
      const c = await deps.couteux.consommer(tenantId);
      if (!c.accepte) throw refusDuPlafond(c.attenteMs);
      const a = valeur(await apercuImportClients(deps.shopify, tenantId));
      return {
        subscribed_with_phone: a.abonnes, subscribed_without_phone: a.sansTelephone, already_in_workspace: a.dejaDansLEspace,
        new: a.nouveaux, free_places: a.placesLibres, importable: a.importables, oldest_deleted: a.effacements, complete: a.complet,
      };
    },
  },
  {
    ...ficheOutilMcp('import_shopify_customers'),
    fonction: null,
    description:
      'Imports the newest max_contacts customers of the connected Shopify store who subscribed to marketing (email or SMS), '
      + 'have a valid phone and are not in the workspace yet, as the number the user chose after preview_shopify_customers. '
      + 'The records are tagged Shopify and opted in: importing through Claude declares, on the user\'s behalf and under '
      + 'their responsibility, that these customers agreed to receive their WhatsApp messages (recorded with who declared '
      + 'it); consent is not a parameter, the import records it on the user\'s behalf. A record that said STOP stays opted out. A max_contacts above the plan\'s '
      + 'free places is refused, nothing is '
      + `written halfway. At most ${IMPORT_MAX} per call; calling again imports the next ones without duplicates. `
      + 'Records already in the workspace are left untouched. Counts toward the workspace\'s heavy operations.',
    annotations: { title: 'Import the Shopify customers', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    entree: {
      type: 'object',
      properties: {
        max_contacts: { type: 'integer', minimum: 1, maximum: IMPORT_MAX, description: 'How many new subscribed customers to import, newest first: the number the user chose.' },
      },
      required: ['max_contacts'],
      additionalProperties: false,
    },
    ecran: () => LISTES.integrations,
    async executer(deps: DepsMcp, tenantId, args, personne) {
      const c = await deps.couteux.consommer(tenantId);
      if (!c.accepte) throw refusDuPlafond(c.attenteMs);
      // Depuis Claude, l'accord des clients importés est déclaré par le client, signé de la personne connectée (décision
      // de Julien du 2026-10-25) ; la console importe toujours sans consentement.
      const b = valeur(await importerClients(deps.shopify, tenantId, args.max_contacts, signataire(personne)));
      journaliser('info', 'mcp_shopify_clients_importes', { tenantId, userId: personne?.userId ?? null, importes: b.importes, retablis: b.retablis });
      return {
        imported: b.importes, restored: b.retablis, left_out: b.restent, free_places_left: b.placesLibres, tag: b.etiquette,
        complete: b.complet, consent: 'opted_in: declared by the user through Claude (a record that said STOP stays opted out)',
      };
    },
  },
  {
    ...ficheOutilMcp('preview_shopify_order_history'),
    fonction: null,
    description:
      'Counts, before any catch-up, the paid orders (paid, partially or fully refunded) created in the last 60 days in the '
      + 'connected Shopify store, the window Shopify opens to the app: how many are already known (received live: a catch-up '
      + 'adds their products), how many would join a record (attachable: the record of their phone, the same phone choice as '
      + 'a live order, or of their buyer, or the buyer record the catch-up creates), how many buyer records it would create '
      + '(records_to_create, one per buyer phone, within the free places of the plan: free_places, null when unlimited; '
      + 'fills_free_places is true when they would take the last places of a plan that counts every contact, after which a '
      + 'new customer writing first could no longer get in: say it to the user before the catch-up), how many orders the '
      + 'plan\'s contact limit would leave out (over_plan_limit), how many have a usable phone whose record is not created '
      + '(without_record: a contact deleted from the workspace after the order was paid, a phone that said STOP or that '
      + 'WhatsApp already refused, or a phone only on the shipping address, a gift recipient who never gets a record) or no '
      + 'usable mobile phone (without_usable_phone): counted, never kept, and how many were never paid (left out). Writes '
      + 'nothing. complete is false when the 25 seconds of the preview were not enough to read every order: the counts are '
      + 'then partial, never a total. Refused without the merchant\'s consent attestation (customers_consent_attested in '
      + 'get_shopify_state: the created records are opted in on its strength; ask the merchant, then pass it with '
      + 'import_shopify_order_history), and without the read_products scope on the store app (an app created before '
      + '2026-11-24 must add it: the shopify skill does). Counts toward the workspace\'s heavy operations.',
    annotations: { title: 'Count the Shopify orders to catch up', readOnlyHint: true, openWorldHint: true },
    entree: { type: 'object', properties: {} },
    async executer(deps: DepsMcp, tenantId) {
      const c = await deps.couteux.consommer(tenantId);
      if (!c.accepte) throw refusDuPlafond(c.attenteMs);
      const a = valeurDuRattrapage(await apercuReprise(deps.shopify.reprise, tenantId));
      return {
        window_start: a.fenetreDebut, paid_orders_read: a.lues, already_known: a.deja, attachable: a.rattachables,
        records_to_create: a.fichesACreer ?? 0, over_plan_limit: a.horsPlafond ?? 0, free_places: a.placesLibres ?? null,
        fills_free_places: a.remplitLesPlaces ?? false,
        without_record: a.sansFiche, without_usable_phone: a.sansNumero, never_paid: a.ecartees, complete: a.complet,
      };
    },
  },
  {
    ...ficheOutilMcp('import_shopify_order_history'),
    fonction: null,
    description:
      'Starts the catch-up of the paid orders created in the last 60 days in the connected Shopify store, after '
      + 'preview_shopify_order_history and the user\'s yes. An order already known keeps its record and gets its products; '
      + 'an unknown order joins the active record of its usable phone, with its amount and products, as a live order would '
      + 'have (a landline is skipped for the next phone of the order), or else the record of its buyer. When neither has a '
      + 'record, the catch-up creates the BUYER\'s record (the customer\'s phone, then the billing one, never the shipping '
      + 'one: a gift recipient never gets in), one per phone, within the free places of the plan: opted in on the strength '
      + 'of the merchant\'s consent attestation (its source names it), tagged Shopify, and the order joins it. A record '
      + 'created this way that never wrote is deleted at the first WhatsApp failure 131026 (number not on WhatsApp), and its '
      + 'place comes back. No record is created without a buyer\'s usable mobile phone, for a contact deleted from the '
      + 'workspace after the order was paid (a deleted contact is never recreated by the catch-up), for a phone that said '
      + 'STOP, or for one WhatsApp already refused; beyond the plan\'s contact limit the order is counted, never kept. It '
      + 'sends no message and attributes no revenue: find_contacts (orders, products, amount spent) then sees '
      + 'these orders. It runs in the background, a few minutes for most stores and over an hour for the largest: '
      + 'get_shopify_order_history follows it. Refused while another catch-up of the workspace is running, without the '
      + 'merchant\'s consent attestation (customers_consent_attested: ask the merchant, never answer for them), or when the '
      + 'store app lacks the read_products scope. Counts toward the workspace\'s heavy operations.',
    annotations: { title: 'Catch up the Shopify orders', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    entree: {
      type: 'object',
      properties: { customers_consent_attested: ATTESTATION_RATTRAPAGE },
      additionalProperties: false,
    },
    ecran: () => LISTES.integrations,
    async executer(deps: DepsMcp, tenantId, args, personne) {
      const c = await deps.couteux.consommer(tenantId);
      if (!c.accepte) throw refusDuPlafond(c.attenteMs);
      // L'attestation du marchand d'abord (lot 5b) : sans elle, le rattrapage ne crée aucune fiche et se refuse.
      if (args.customers_consent_attested === true) await attester(deps, tenantId, personne?.userId ?? null);
      const r = valeurDuRattrapage(await lancerReprise(deps.shopify.reprise, tenantId, personne?.userId ?? null));
      journaliser('info', 'mcp_shopify_rattrapage', { tenantId, userId: personne?.userId ?? null, reprise: r.id });
      return { ...versRattrapage(r), next_step: 'get_shopify_order_history follows it: a few minutes for most stores, over an hour for the largest' };
    },
  },
  {
    ...ficheOutilMcp('get_shopify_order_history'),
    fonction: null,
    description:
      'The last catch-up of the Shopify orders of the workspace: its status (en_attente, en_cours, termine, refuse, erreur), '
      + 'interrupted when nothing moved for 15 minutes (import_shopify_order_history closes it and starts again), the window '
      + 'read, when it started and finished, its counts (paid orders read, attached to a record, buyer records created, '
      + 'left out over the plan\'s contact limit, already known, without a record, without a usable phone) and the reason it '
      + 'stopped. started is false when none was ever started.',
    annotations: { title: 'Get the Shopify orders catch-up', readOnlyHint: true, openWorldHint: false },
    entree: { type: 'object', properties: {} },
    async executer(deps: DepsMcp, tenantId) {
      const r = await etatReprise(deps.shopify.reprise, tenantId);
      if (!r) return { started: false, next_step: 'preview_shopify_order_history, then import_shopify_order_history once the user agrees' };
      return { started: true, ...versRattrapage(r) };
    },
  },
  {
    ...ficheOutilMcp('disconnect_shopify'),
    fonction: null,
    description:
      'Cuts the Shopify store: no message leaves anymore. The app stays installed on the store (only the merchant can '
      + 'uninstall it, from the store apps page this tool returns); the store\'s privacy requests are still honored. '
      + 'connect_shopify reconnects it.',
    annotations: { title: 'Disconnect the Shopify store', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    entree: { type: 'object', properties: {} },
    ecran: () => LISTES.integrations,
    async executer(deps: DepsMcp, tenantId, _args, personne) {
      const r = valeur(await couperShopify(deps.shopify, tenantId));
      journaliser('info', 'mcp_shopify_coupee', { tenantId, userId: personne?.userId ?? null });
      return { cut: true, already_cut: r.dejaCoupee, store_apps_page: r.pageApps };
    },
  },
];
