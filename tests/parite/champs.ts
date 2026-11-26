import type { z } from 'zod';
import { ajoutSchema, patchSchema } from '../../src/http/agent-tools';
import { corpsBranchement, corpsEtiquettes, corpsImport, corpsRattrapage, corpsSegments, corpsSynchroEtiquettes } from '../../src/http/shopify';
import { corpsSchema, corpsRendreSchema } from '../../src/http/offre-paiement';
import { corpsQuiRepond, corpsRepondeur } from '../../src/http/agents';
import { CORPS_OPTION } from '../../src/http/credit-whatsapp';
import { saisieDeCreation as creationAgent, saisieDeModification as modificationAgent } from '../../src/agent/gestion';
import { saisieDEssai } from '../../src/agent/essai';
import { saisieDeDocument, saisieDeFiche, saisieDeSite, saisieDeSuppression } from '../../src/agent/connaissance';
import { saisieCreation as creationAdresse, saisieModification as modificationAdresse } from '../../src/evenements/gestion';
import { saisieDePaiement } from '../../src/stripe/paiement';
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

export const CHAMPS: Readonly<Record<string, Corps>> = {
  // Les outils de l'agent IA
  'POST /agents/:agentId/tools': { schema: ajoutSchema, noms: { handler: 'outils[]' } },
  'PATCH /agents/:agentId/tools/:outilId': { schema: patchSchema },
  'DELETE /agents/:agentId/tools/:outilId': SANS_CORPS,

  // Shopify
  'DELETE /integrations/shopify': SANS_CORPS,
  'POST /integrations/shopify': { schema: corpsBranchement, noms: { boutique: 'store', secret: 'client_secret' } },
  'POST /integrations/shopify/clients/import': { schema: corpsImport, noms: { maximum: 'max_contacts' } },
  'POST /integrations/shopify/commandes/rattrapage': { schema: corpsRattrapage },
  'PUT /integrations/shopify/etiquettes': { schema: corpsEtiquettes, noms: { allumee: 'enabled' } },
  'POST /integrations/shopify/etiquettes/synchro': { schema: corpsSynchroEtiquettes },
  'PUT /integrations/shopify/segments': { schema: corpsSegments },

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
  'POST /tags': A_LA_MAIN,
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

  // Les contacts
  'PATCH /contacts/:contactId/blocked': A_LA_MAIN,
  'PATCH /contacts/:contactId': A_LA_MAIN,
  'POST /contacts/bulk': A_LA_MAIN,
  'POST /contacts/purge': A_LA_MAIN,

  // Les réglages
  'PATCH /settings/transfert-agent': A_LA_MAIN,
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
