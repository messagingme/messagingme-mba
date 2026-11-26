/**
 * LES ROUTES RÉSERVÉES AU BUSINESS ET À L'ENTREPRISE, ET CE QU'ELLES FONT (lot 1 du CSM virtuel, plan
 * `docs/superpowers/plans/2026-11-26-csm-lot1-parite-criteres-et-offres.md`).
 *
 * 🔴 LA TABLE DES ADRESSES N'Y VOIT RIEN, ET C'EST VOULU, MAIS RIEN D'AUTRE NE LES LISTAIT. L'inventaire écarte ces
 * routes en MESURANT l'offre (un espace Pro reçoit 402 avant le handler), et le plan du lot 1 les renvoie au lot 7 ; or
 * aucune liste ne disait lesquelles, donc le lot 7 aurait dû les retrouver de mémoire. Cette table les nomme, une par une
 * (le grain est la méthode, comme pour les adresses), avec ce qu'un outil devra en exposer.
 *
 * `tests/parite-offres-superieures.test.ts` exige EXACTEMENT les routes que l'inventaire trouve fermées au Pro : une route
 * Business ou Entreprise ajoutée sans entrée casse la CI, une route rouverte au Pro doit sortir d'ici pour entrer dans
 * `ADRESSES`. Ce n'est pas une liste de travail du lot 1 : c'est celle du lot 7.
 */

export interface RouteOffreSuperieure {
  /** Ce qu'un outil devra exposer, au lot 7. */
  readonly quoi: string;
}

const lot7 = (quoi: string): RouteOffreSuperieure => ({ quoi });
const MBA = lot7('l’agent de Meta (Meta Business Agent) : budget, statut, réglages, déploiement, fiche, FAQ, compétences, messages interactifs, sites, fichiers, essai et activation');
const MBA_ASSISTANT = lot7('l’assistant de configuration de l’agent de Meta');
const MBA_OUTILS = lot7('les outils de l’agent de Meta (blocs, serveurs MCP, activation)');
const MBA_PUBLICATION = lot7('la publication de l’agent de Meta');
const PUBS = lot7('les publicités Click-to-WhatsApp : connexion du compte publicitaire, brouillons, vidéos, audiences, publication et cycle de vie');
const CHANNELS_ME = lot7('Channels Me : connexion, liens, publications et demande d’activation');
const SALESFORCE = lot7('le connecteur Salesforce');
const BATCH = lot7('l’intégration Batch');
const HUBSPOT = lot7('HubSpot : les automations, les listes à importer, le lien d’installation, la correspondance des champs et les étapes de vente');
const RCS = lot7('le RCS : le canal et ses messages enregistrés');
const STATS = lot7('les statistiques des conversations et des parcours des offres supérieures');
const RAPPORTS = lot7('les rapports programmés des parcours');
const AIDE = lot7('le bot d’aide de la console et ses fiches');

export const OFFRES_SUPERIEURES: Readonly<Record<string, RouteOffreSuperieure>> = {

  // le RCS
  'GET /rcs-messages': RCS,
  'POST /rcs-messages': RCS,
  'PATCH /rcs-messages/:id': RCS,
  'DELETE /rcs-messages/:id': RCS,
  'GET /rcs/channel': RCS,
  'POST /rcs/channel': RCS,
  'DELETE /rcs/channel': RCS,

  // l’intégration Batch
  'GET /integrations/batch': BATCH,
  'PUT /integrations/batch': BATCH,
  'DELETE /integrations/batch': BATCH,

  // le connecteur Salesforce
  'GET /integrations/salesforce': SALESFORCE,
  'PATCH /integrations/salesforce/actif': SALESFORCE,
  'POST /integrations/salesforce/connexion': SALESFORCE,
  'PUT /integrations/salesforce/reglages': SALESFORCE,
  'DELETE /integrations/salesforce': SALESFORCE,

  // les statistiques des conversations et des parcours des offres supérieures
  'GET /stats/workflow/:workflowId': STATS,
  'GET /stats/conversations/jours': STATS,
  'GET /stats/conversations': STATS,
  'GET /stats/conversations/nuage': STATS,
  'GET /stats/conversations/list': STATS,

  // la publication de l’agent de Meta
  'GET /mba-publication': MBA_PUBLICATION,
  'POST /mba-publication': MBA_PUBLICATION,

  // les outils de l’agent de Meta (blocs, serveurs MCP, activation)
  'GET /mba-outils': MBA_OUTILS,
  'GET /mba-outils/blocs': MBA_OUTILS,
  'GET /mba-outils/mcp': MBA_OUTILS,
  'POST /mba-outils/mcp/:outilId': MBA_OUTILS,
  'POST /mba-outils': MBA_OUTILS,
  'PATCH /mba-outils/:outilId': MBA_OUTILS,
  'DELETE /mba-outils/:outilId': MBA_OUTILS,
  'PUT /mba-outils/:outilId/actif': MBA_OUTILS,

  // les publicités Click-to-WhatsApp
  'GET /pubs/connexion': PUBS,
  'POST /pubs/connexion/echange': PUBS,
  'POST /pubs/connexion/choix': PUBS,
  'GET /pubs': PUBS,
  'GET /pubs/brouillons': PUBS,
  'GET /pubs/brouillons/:id': PUBS,
  'POST /pubs/brouillons': PUBS,
  'PUT /pubs/brouillons/:id': PUBS,
  'DELETE /pubs/brouillons/:id': PUBS,
  'POST /pubs/videos': PUBS,
  'POST /pubs/videos/:sessionId/morceaux': PUBS,
  'POST /pubs/videos/:sessionId/fin': PUBS,
  'GET /pubs/videos/:videoId': PUBS,
  'GET /pubs/audiences': PUBS,
  'POST /pubs': PUBS,
  'POST /pubs/:id/publier': PUBS,
  'GET /pubs/:id': PUBS,
  'POST /pubs/:id/pause': PUBS,
  'POST /pubs/:id/reprendre': PUBS,
  'POST /pubs/:id/archiver': PUBS,
  'POST /pubs/:id/desarchiver': PUBS,
  'DELETE /pubs/connexion': PUBS,

  // l’assistant de configuration de l’agent de Meta
  'GET /mba/assistant': MBA_ASSISTANT,
  'DELETE /mba/assistant': MBA_ASSISTANT,
  'POST /mba/assistant': MBA_ASSISTANT,
  'POST /mba/assistant/appliquer': MBA_ASSISTANT,

  // le bot d’aide de la console et ses fiches
  'POST /aide': AIDE,
  'POST /aide/recap': AIDE,
  'GET /aide/fiches/:cle': AIDE,

  // les rapports programmés des parcours
  'GET /workflow-reports': RAPPORTS,
  'POST /workflow-reports': RAPPORTS,
  'DELETE /workflow-reports/:id': RAPPORTS,

  // HubSpot
  'GET /hubspot/lignes': HUBSPOT,
  'POST /hubspot/lignes': HUBSPOT,
  'PUT /hubspot/lignes/:id': HUBSPOT,
  'DELETE /hubspot/lignes/:id': HUBSPOT,

  // Channels Me
  'GET /channels-me/connection': CHANNELS_ME,
  'PUT /channels-me/connection': CHANNELS_ME,
  'DELETE /channels-me/connection': CHANNELS_ME,
  'POST /channels-me/connection/test': CHANNELS_ME,
  'GET /channels-me/links': CHANNELS_ME,
  'POST /channels-me/links': CHANNELS_ME,
  'GET /channels-me/links/conversations': CHANNELS_ME,
  'POST /channels-me/links/:id/disable': CHANNELS_ME,
  'POST /channels-me/links/:id/enable': CHANNELS_ME,
  'GET /channels-me/posts': CHANNELS_ME,
  'POST /channels-me/posts': CHANNELS_ME,
  'POST /channels-me/activation-request': CHANNELS_ME,

  // HubSpot
  'GET /hubspot/lists': HUBSPOT,
  'POST /hubspot/import': HUBSPOT,
  'POST /hubspot/install-link': HUBSPOT,
  'GET /hubspot/champs': HUBSPOT,
  'PUT /hubspot/champs': HUBSPOT,
  'GET /hubspot/deal-stages': HUBSPOT,

  // l’agent de Meta (Meta Business Agent)
  'GET /mba-budget': MBA,
  'PUT /mba-budget': MBA,
  'GET /mba-insights': MBA,
  'GET /mba/:phoneNumberId/completion': MBA,
  'GET /mba/:phoneNumberId/messages': MBA,
  'GET /mba/:phoneNumberId/status': MBA,
  'PATCH /mba/:phoneNumberId/settings': MBA,
  'PUT /mba/:phoneNumberId/rollout': MBA,
  'GET /mba/:phoneNumberId/business-info': MBA,
  'PATCH /mba/:phoneNumberId/business-info': MBA,
  'GET /mba/:phoneNumberId/faq': MBA,
  'POST /mba/:phoneNumberId/faq': MBA,
  'PUT /mba/:phoneNumberId/faq/:faqId': MBA,
  'DELETE /mba/:phoneNumberId/faq/:faqId': MBA,
  'POST /mba/:phoneNumberId/faq/preview': MBA,
  'POST /mba/:phoneNumberId/faq/import': MBA,
  'GET /mba/:phoneNumberId/skills': MBA,
  'POST /mba/:phoneNumberId/skills': MBA,
  'PUT /mba/:phoneNumberId/skills/:skillId': MBA,
  'DELETE /mba/:phoneNumberId/skills/:skillId': MBA,
  'GET /mba/:phoneNumberId/messages-interactifs': MBA,
  'POST /mba/:phoneNumberId/messages-interactifs': MBA,
  'PUT /mba/:phoneNumberId/messages-interactifs/:messageId': MBA,
  'DELETE /mba/:phoneNumberId/messages-interactifs/:messageId': MBA,
  'GET /mba/:phoneNumberId/websites': MBA,
  'POST /mba/:phoneNumberId/websites': MBA,
  'DELETE /mba/:phoneNumberId/websites/:websiteId': MBA,
  'GET /mba/:phoneNumberId/files': MBA,
  'POST /mba/:phoneNumberId/files': MBA,
  'DELETE /mba/:phoneNumberId/files/:fileId': MBA,
  'POST /mba/:phoneNumberId/test': MBA,
  'PUT /mba-activation': MBA,
};
