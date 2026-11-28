import type { z } from 'zod';
import { ajoutSchema, drapeauSchema, patchSchema } from '../../src/http/agent-tools';
import {
  corpsAttestation, corpsBranchement, corpsEtiquettes, corpsImport, corpsLigne, corpsRattrapage, corpsReglage, corpsSegments, corpsSynchroEtiquettes,
} from '../../src/http/shopify';
import { corpsSchema, corpsRendreSchema } from '../../src/http/offre-paiement';
import { corpsQuiRepond, corpsRepondeur } from '../../src/http/agents';
import { CORPS_OPTION } from '../../src/http/credit-whatsapp';
import { saisieDeCreation as creationAgent, saisieDeModification as modificationAgent } from '../../src/agent/gestion';
import { saisieDEssai } from '../../src/agent/essai';
import { saisieDeDocument, saisieDeFiche, saisieDePatchDeFiche, saisieDeSite, saisieDeSuppression } from '../../src/agent/connaissance';
import { saisieCreation as creationAdresse, saisieModification as modificationAdresse } from '../../src/evenements/gestion';
import { saisieDePaiement } from '../../src/stripe/paiement';
import {
  creationSchema as creationSysteme, epreuveSchema as epreuveSysteme, patchSchema as patchSysteme,
} from '../../src/http/agent-sources';
import { corpsRequete as creationAppel, patchSchema as patchAppel, testSchema as essaiAppel } from '../../src/http/agent-requetes';
import { ajoutConnecteurSchema } from '../../src/http/agent-tools';
import { creationSchema as creationServeurMcp, proposeSchema as proposeOutilMcp, reglageSchema as reglageOutilMcp } from '../../src/http/agent-mcp';
import { saisieAchatWhatsapp } from '../../src/stripe/achat-whatsapp';
import { saisieDeCreation as creationWidget, saisieDeModification as modificationWidget } from '../../src/widgets/gestion';
import type { Correspondance } from './schemas';

/**
 * LA PARITÉ DES CHAMPS : POUR CHAQUE ROUTE D'ÉCRITURE SERVIE PAR UN OUTIL, LE SCHÉMA QUI VALIDE SON CORPS (lot 1 du CSM
 * virtuel, brique B1, plan `docs/superpowers/plans/2026-11-24-csm-lot1-b1-parite.md`).
 *
 * `tests/parite-champs.test.ts` exige une déclaration pour chaque route d'écriture dont la décision, dans
 * `tests/parite/adresses.ts`, est un outil. Puis il compare le schéma à l'entrée des outils de cette décision
 * (`tests/parite/schemas.ts`) et exige que les écarts trouvés soient EXACTEMENT ceux de `ECARTS` : un écart neuf (un champ
 * ajouté à la route sans son outil, une borne changée) casse la CI, un écart comblé aussi, tant qu'on ne le retire pas
 * de la liste. `ECARTS` et les routes `aLaMain` sont la suite de la liste de travail du lot 1.
 *
 * Quatre déclarations :
 * - `sansCorps` : la route ne lit aucun corps (l'adresse dit tout) ;
 * - `parLaPage` : la route sert la page ouverte par le lien de l'outil, où la personne agit elle-même ;
 * - `aLaMain` : la route lit son corps sans schéma (`req.body as`) : son schéma d'écriture est à écrire (B0), puis à
 *   comparer à l'outil ;
 * - `schema` : le schéma Zod que la route applique (exporté du code, jamais recopié), avec `noms` quand un champ change
 *   de nom dans l'outil et `absents` quand l'outil ne le porte pas exprès.
 */

export type Corps =
  | { readonly sansCorps: true }
  | { readonly parLaPage: true }
  | { readonly aLaMain: string }
  | ({ readonly schema: z.ZodType } & Correspondance);

const SANS_CORPS: Corps = { sansCorps: true };
const PAR_LA_PAGE: Corps = { parLaPage: true };
const A_LA_MAIN: Corps = { aLaMain: 'corps lu sans schéma : son schéma d’écriture est à écrire (B0), puis à comparer à l’outil' };
/** Le schéma l'accepte, le service le refuse (`DEVENIR_AGENT_A_VENIR`, décision de Julien du 2026-10-02). */
const DEVENIR_AGENT = { valeurs: ['agent'], raison: 'refusé par le service tant que le devenir « agent IA » est à venir (décision du 2026-10-02)' };

/** Les noms d'un système connecté dans ses outils (B10, livraison 4a), en snake_case comme les autres arguments. */
const NOMS_SYSTEME = {
  baseUrl: 'base_url', authKind: 'auth', authHeaderName: 'auth_header_name', 'oauth.tokenUrl': 'oauth.token_url', 'oauth.clientId': 'oauth.client_id',
};
const CLE_ABSENTE = '🔴 la clé ne passe jamais par Claude : la personne la colle sur la page Connecteurs API, puis active le système (0331)';
/** Le mode d'authentification d'un serveur MCP déclaré depuis Claude (B10, livraison 4c). */
const SERVEUR_A_CLE = '🔴 la clé ne passe jamais par Claude, et aucune route n’en ajoute une à un serveur MCP déclaré : un serveur à clé '
  + 'se déclare dans la console, sa clé avec lui ; create_mcp_server pose authKind none';
const ADRESSE_ABSENTE = '🔴 l’adresse d’un système et celle de son jeton se posent à la déclaration, puis se changent dans la console seule, comme celle d’un webhook';

export const CHAMPS: Readonly<Record<string, Corps>> = {
  // Les outils de l'agent IA
  'POST /agents/:agentId/tools': { schema: ajoutSchema, noms: { handler: 'outils[]' } },
  // Les réglages de l'agent IA (B10, livraison 3a) : un même drapeau, deux noms dans l'outil.
  'PUT /agents/:agentId/tools/:outilId/activation': { schema: drapeauSchema, noms: { valeur: 'enabled' } },
  // `autonomous` n'accepte que false : la donner reste un clic dans la console (B10, livraison 3b).
  'PUT /agents/:agentId/tools/:outilId/autonomie': { schema: drapeauSchema, noms: { valeur: 'autonomous' } },
  // `attached` n'accepte que true : détacher détruit une action et son historique, ou un appel de connecteur sans autre
  // agent ; depuis Claude on désactive (enabled false), la console fait confirmer le détachement.
  'PUT /agents/:agentId/tools/:outilId/rattachement': { schema: drapeauSchema, noms: { valeur: 'attached' } },
  'PATCH /agents/:agentId/knowledge/:ficheId': { schema: saisieDePatchDeFiche },
  'PATCH /settings/mention-ia': A_LA_MAIN,
  'PATCH /agents/:agentId/tools/:outilId': { schema: patchSchema },
  'DELETE /agents/:agentId/tools/:outilId': SANS_CORPS,
  // Supprimer un agent (B10, livraison 3b) : au oui d'un admin, préparé par `delete_agent`.
  'DELETE /agents/:agentId': SANS_CORPS,

  // Les systèmes connectés des agents (B10, livraison 4a) : 🔴 la clé ne passe jamais par Claude.
  'POST /agent-sources': { schema: creationSysteme, noms: NOMS_SYSTEME, absents: { authSecret: CLE_ABSENTE } },
  'PATCH /agent-sources/:id': {
    schema: patchSysteme, noms: NOMS_SYSTEME,
    absents: { authSecret: CLE_ABSENTE, baseUrl: ADRESSE_ABSENTE, oauth: ADRESSE_ABSENTE },
  },
  'DELETE /agent-sources/:id': SANS_CORPS,
  'POST /agent-sources/:id/epreuve': { schema: epreuveSysteme, noms: { chemin: 'path' } },

  // Les appels des systèmes et leur branchement sur un agent (B10, livraison 4b).
  'POST /agent-requetes': { schema: creationAppel, noms: { sourceId: 'system_id' } },
  'PATCH /agent-requetes/:id': {
    schema: patchAppel,
    absents: { sourceId: '🔴 un appel enregistré ne change pas de système depuis Claude : son adresse se pose avec le système' },
  },
  'DELETE /agent-requetes/:id': SANS_CORPS,
  'POST /agent-requetes/:id/test': { schema: essaiAppel },
  'POST /agents/:agentId/tools/connecteur': { schema: ajoutConnecteurSchema, noms: { requeteId: 'call_id' } },

  // Les serveurs MCP des agents (B10, livraison 4c) : 🔴 Claude ne déclare qu'un serveur sans clé.
  'POST /mcp': { schema: creationServeurMcp, absents: { authKind: SERVEUR_A_CLE, authHeaderName: SERVEUR_A_CLE, authSecret: SERVEUR_A_CLE } },
  'DELETE /mcp/:sourceId': SANS_CORPS,
  'POST /mcp/:sourceId/apercu': SANS_CORPS,
  'POST /mcp/:sourceId/importer': SANS_CORPS,
  'PATCH /mcp/outils/:outilId': { schema: reglageOutilMcp },
  'PUT /mcp/outils/:outilId/propose': { schema: proposeOutilMcp },

  // Shopify
  'DELETE /integrations/shopify': SANS_CORPS,
  'POST /integrations/shopify': { schema: corpsBranchement, noms: { boutique: 'store', secret: 'client_secret' } },
  'POST /integrations/shopify/clients/import': { schema: corpsImport, noms: { maximum: 'max_contacts' } },
  'POST /integrations/shopify/commandes/rattrapage': { schema: corpsRattrapage },
  'PUT /integrations/shopify/etiquettes': { schema: corpsEtiquettes, noms: { allumee: 'enabled' } },
  'POST /integrations/shopify/etiquettes/synchro': { schema: corpsSynchroEtiquettes },
  'PUT /integrations/shopify/segments': { schema: corpsSegments },
  // Le chantier Shopify à part est fini le 2026-11-26 : l'interrupteur d'une automation, son délai, et l'attestation.
  'PUT /integrations/shopify/lignes/:evenement': { schema: corpsLigne, noms: { actif: 'active', delaiMinutes: 'delay_minutes', agentId: 'agent_id' } },
  'PATCH /integrations/shopify/messages/:evenement': {
    schema: corpsReglage, noms: { delaiMinutes: 'delay_minutes' },
    absents: { consentementAffirme: 'ignoré par la route depuis l’attestation du 2026-11-20 : l’outil atteste par customers_consent_attested' },
  },
  'POST /integrations/shopify/attestation': {
    schema: corpsAttestation, noms: { coche: 'customers_consent_attested' },
    absents: { langue: 'l’outil enregistre la phrase en français, la langue de la console d’origine' },
  },

  // Le numéro : la page du lien de `start_whatsapp_connection`, et le portail de l'abonnement
  'POST /numero-fourni': PAR_LA_PAGE,
  'POST /numero-fourni/destination': PAR_LA_PAGE,
  'POST /numero-fourni/abonnement': PAR_LA_PAGE,
  'POST /numero-fourni/portail': SANS_CORPS,
  // Le lien de test d'un scénario (CSM, B6b) : l'adresse dit le scénario, le jeton se pose au premier appel.
  'POST /workflows/:id/test-link': SANS_CORPS,
  // Les prérequis (CSM, B7) : trois routes qui lisent leur corps sans schéma, comme le reste de la liste de travail.
  'POST /numero/code': A_LA_MAIN,
  'POST /numero/activer': A_LA_MAIN,
  'POST /support': A_LA_MAIN,
  'POST /application/relier': PAR_LA_PAGE,

  // Les champs, les étiquettes, les clés
  'POST /user-fields': A_LA_MAIN,
  'PATCH /user-fields/:key': A_LA_MAIN,
  'DELETE /user-fields/:key': SANS_CORPS,
  'POST /tags': A_LA_MAIN,
  'PATCH /tags': A_LA_MAIN,
  // L'étiquette passe dans l'adresse (`?tag=`), pas dans un corps.
  'DELETE /tags': SANS_CORPS,
  'POST /api-keys': A_LA_MAIN,

  // Le bac à sable et la connaissance de l'agent IA
  'POST /agents/:agentId/test': { schema: saisieDEssai },
  'POST /agents/:agentId/knowledge': { schema: saisieDeFiche, noms: { titre: 'fiches[].titre', corps: 'fiches[].corps' } },
  'DELETE /agents/:agentId/knowledge/:ficheId': SANS_CORPS,
  'POST /agents/:agentId/knowledge/supprimer': { schema: saisieDeSuppression },
  'POST /agents/:agentId/knowledge/document': {
    schema: saisieDeDocument,
    absents: { dataUrl: 'le fichier lui-même : l’outil en reçoit le texte, extrait sur le poste de la personne' },
  },
  'POST /agents/:agentId/knowledge/apercu': { schema: saisieDeSite, absents: { pages: 'lues par l’import seulement, jamais par l’aperçu' } },
  'POST /agents/:agentId/knowledge/import': { schema: saisieDeSite, absents: { portee: 'lue par l’aperçu seulement, l’import prend ses pages' } },

  // L'offre et ses paiements
  'POST /credit/paiement': { schema: saisieDePaiement },
  'POST /offre/paiement': { schema: corpsSchema },
  'PUT /offre/numero': { schema: corpsRendreSchema },
  'POST /credit-whatsapp/option': {
    schema: CORPS_OPTION,
    absents: { origine: 'la page où Stripe ramène la personne dans la console ; l’outil rend sa propre adresse' },
  },
  'POST /credit-whatsapp/achat': { schema: saisieAchatWhatsapp },

  // Les widgets
  'POST /widgets': { schema: creationWidget, valeursAbsentes: { devenir: DEVENIR_AGENT } },
  'PATCH /widgets/:id': { schema: modificationWidget, valeursAbsentes: { devenir: DEVENIR_AGENT } },

  // L'Inbox
  'POST /conversations/:conversationId/prendre': SANS_CORPS,
  'POST /conversations/:conversationId/assignee/moi': SANS_CORPS,
  'PATCH /conversations/:conversationId/assignee': A_LA_MAIN,
  'POST /conversations/:conversationId/reply': A_LA_MAIN,
  'POST /conversations/:conversationId/send-template': A_LA_MAIN,
  'POST /conversations/:conversationId/workflow': A_LA_MAIN,
  'POST /conversations/:conversationId/release': SANS_CORPS,
  // L'Inbox depuis Claude (B10, livraison 2a) : les marques n'ont pas de corps, `update_conversation` les porte.
  'POST /conversations/:conversationId/archive': SANS_CORPS,
  'DELETE /conversations/:conversationId/messages': SANS_CORPS,
  'POST /conversations/:conversationId/unarchive': SANS_CORPS,
  'POST /conversations/:conversationId/signaler': SANS_CORPS,
  'POST /conversations/:conversationId/ne-plus-signaler': SANS_CORPS,
  'POST /conversations/:conversationId/urgent': SANS_CORPS,
  'POST /conversations/:conversationId/ne-plus-urgent': SANS_CORPS,
  'POST /conversations/:conversationId/traiter': SANS_CORPS,
  'POST /conversations/:conversationId/ne-plus-traiter': SANS_CORPS,
  'POST /conversations/:conversationId/read': SANS_CORPS,
  'POST /conversations/:conversationId/messages/:messageId/transcrire': A_LA_MAIN,

  // Les contacts
  'PATCH /contacts/:contactId/blocked': A_LA_MAIN,
  'PATCH /contacts/:contactId': A_LA_MAIN,
  'POST /contacts': A_LA_MAIN,
  'POST /contacts/import/preview': A_LA_MAIN,
  'POST /contacts/import': A_LA_MAIN,
  'POST /contacts/bulk': A_LA_MAIN,
  'POST /contacts/purge': A_LA_MAIN,

  // Les réglages
  'PATCH /settings/transfert-agent': A_LA_MAIN,
  'PATCH /settings/poussee-optout': A_LA_MAIN,
  'PATCH /settings/agents-peuvent-prendre': A_LA_MAIN,
  'PATCH /settings/control-handback': A_LA_MAIN,
  'PATCH /settings/business-hours': A_LA_MAIN,

  // Les modèles WhatsApp
  'POST /templates': A_LA_MAIN,
  'PATCH /templates/:templateName': A_LA_MAIN,
  'DELETE /templates/:templateName': SANS_CORPS,

  // Les webhooks sortants
  'POST /evenements/adresses': { schema: creationAdresse },
  'PATCH /evenements/adresses/:adresseId': { schema: modificationAdresse },
  'POST /evenements/adresses/:adresseId/rotation': SANS_CORPS,
  'DELETE /evenements/adresses/:adresseId': SANS_CORPS,
  'POST /evenements/adresses/:adresseId/essai': SANS_CORPS,
  'POST /evenements/envois/:envoiId/rejeu': SANS_CORPS,

  // Les agents IA et le répondeur
  'PUT /repondeur': { schema: corpsQuiRepond },
  'PUT /agents/repondeur': { schema: corpsRepondeur },
  'POST /agents': { schema: creationAgent },
  'PATCH /agents/:agentId': {
    schema: modificationAgent,
    noms: { contenu: '', maxTours: 'max_turns', maxAppelsOutils: 'max_tool_calls', ficheVersionAttendue: 'fiche_version' },
    absents: {
      budgetMicroEur: 'converti : set_agent_limits le prend en euros (budget_eur)',
      status: 'posé par activate_agent (active : vrai ou faux)',
      transfertMode: 'posé par set_transfer_mode (agent_id, mode)',
    },
  },

  // Les campagnes
  'POST /campaigns': A_LA_MAIN,
  'POST /campaigns/:campaignId/run': A_LA_MAIN,
  'POST /campaigns/:campaignId/pause': SANS_CORPS,
  'POST /campaigns/:campaignId/cancel-schedule': SANS_CORPS,

  // Les scénarios
  'POST /workflows': A_LA_MAIN,
  // Le brouillon de la console (un graphe) et celui de l'outil (une recette, `brouillon: true`) n'ont pas la même forme.
  'PATCH /workflows/:id': A_LA_MAIN,
  'DELETE /workflows/:id': SANS_CORPS,
  // Publier : rien dans le corps ; le brouillon publié est celui que montre la mise en ligne (`propose_go_live`).
  'POST /workflows/:id/publish': SANS_CORPS,
};

/**
 * Les écarts connus, route par route : la suite de la liste de travail du lot 1 (B0 pour les bornes, B10 pour les
 * champs). Une ligne se retire le jour où l'outil la comble ; le test refuse une ligne qui ne se vérifie plus.
 */
export const ECARTS: Readonly<Record<string, readonly string[]>> = {
  // B10, Shopify : l'identifiant de l'agent qui relance un panier, que la route exige au format uuid
  'PUT /integrations/shopify/lignes/:evenement': ['agentId : motif non annoncé'],
  // B10, livraison 4b, voulus. Un identifiant annoncé `format: uuid` (le motif de zod n'apprend rien au modèle) ; la clé
  // d'une variable, fermée pour `fiche` et `systeme`, libre pour `champ` (un champ de l'espace) : un schéma d'outil ne
  // sait pas dire « fermée ou libre », sa description renvoie aux listes de `list_connector_calls`, la route refuse le reste.
  'POST /agent-requetes': ['sourceId : motif non annoncé', 'variables[].origine.cle : valeurs permises non annoncées'],
  'PATCH /agent-requetes/:id': ['variables[].origine.cle : valeurs permises non annoncées'],
  'POST /agents/:agentId/tools/connecteur': ['requeteId : motif non annoncé'],
  // B10, agent IA : la fiche (le cadrage les dit « console seulement »)
  'PATCH /agents/:agentId': [
    'contactInconnu : absent de l’outil',
    'contenu.nom : absent de l’outil',
    'inactiviteMinutes : absent de l’outil',
    'label : absent de l’outil',
    'mentionIa : absent de l’outil',
  ],
  // B10, agent IA : la cible et les réglages communs des outils d'agent
  'POST /agents/:agentId/tools': ['cible : absent de l’outil', 'name : absent de l’outil'],
  'PATCH /agents/:agentId/tools/:outilId': [
    'cible : absent de l’outil',
    'description : absent de l’outil',
    'enums : absent de l’outil',
    'gestes : absent de l’outil',
    'name : absent de l’outil',
    'nature : absent de l’outil',
    'nePasUtiliser : absent de l’outil',
    'outputPaths : absent de l’outil',
    'title : absent de l’outil',
  ],
  // B0, bornes annoncées : l'identifiant d'un scénario est un uuid, que l'outil ne dit pas
  'POST /widgets': ['workflowId : motif non annoncé'],
  'PATCH /widgets/:id': ['workflowId : motif non annoncé'],
};
