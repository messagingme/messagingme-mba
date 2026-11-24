/**
 * LA PARITÉ DES ADRESSES : CHAQUE ROUTE DE CONSOLE OUVERTE AU PRO, ET CE QUI LA SERT EN OUTIL MCP (lot 1 du CSM virtuel,
 * brique B1, plan `docs/superpowers/plans/2026-11-24-csm-lot1-b1-parite.md`).
 *
 * 🔴 CETTE TABLE EST LA LISTE DE TRAVAIL DU LOT 1. Les outils MCP appellent les services, pas les routes : le lien d'une
 * route à son outil ne se déduit pas, il s'écrit ici. `tests/parite-adresses.test.ts` exige une entrée pour chaque
 * route que l'inventaire trouve ouverte au Pro (`tests/parite/inventaire.ts`), et aucune autre : une route ajoutée sans
 * décision casse la CI. Les routes Business et Entreprise n'y sont pas, l'inventaire les écarte en mesurant l'offre (lot 7).
 *
 * Quatre décisions :
 * - `outils` : les outils qui servent la route ; `reste`, ce qu'ils ne couvrent pas encore (c'est encore du travail) ;
 * - `humain` : un geste que les garde-fous du plan laissent à la personne ;
 * - `exclue` : pas d'outil, exprès, et pourquoi ;
 * - `aFaire` : la brique qui la couvrira (B2 à B10) et ce qu'il faut exposer.
 * Le lot 1 est fini quand il ne reste ni `aFaire` ni `reste`.
 *
 * ⚠️ Une route dont la page s'ouvre par le lien d'un outil (`start_whatsapp_connection`) est servie par cet outil : la
 * personne y agit elle-même, et c'est le modèle des garde-fous (« l'outil rend un lien, la personne valide »).
 */

export type Brique = 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7' | 'B8' | 'B10';

export type Decision =
  | { readonly outils: readonly string[]; readonly reste?: string }
  | { readonly humain: string }
  | { readonly exclue: string }
  | { readonly aFaire: Brique; readonly quoi: string };

const outil = (...outils: string[]): Decision => ({ outils });
const enPartie = (outils: string[], reste: string): Decision => ({ outils, reste });
const humain = (raison: string): Decision => ({ humain: raison });
const exclue = (raison: string): Decision => ({ exclue: raison });
const aFaire = (brique: Brique, quoi: string): Decision => ({ aFaire: brique, quoi });

/** Ce que la console fait pour son propre affichage : celui qui pilote par outils n'en a pas l'usage. */
const ecran = (quoi: string): Decision => exclue(`plomberie d’écran : ${quoi}`);
/** Une fonction d'une offre supérieure dont la route reste ouverte au Pro (pour débrancher, ou parce que le handler refuse). */
const lot7 = (quoi: string): Decision => exclue(`${quoi} : offre Business ou Entreprise, au lot 7`);
const SHOPIFY = exclue('Shopify : chantier à part (décision du 23 novembre 2026)');
const ASSISTANT = exclue('l’assistant de construction de l’agent IA : exclu exprès du lot 1');
const ICI_PAR_LE_LIEN = outil('start_whatsapp_connection');

export const ADRESSES: Readonly<Record<string, Decision>> = {
  // Webhooks entrants (webhooksAdmin)
  'GET /webhooks': aFaire('B10', 'webhooks entrants : lister'),
  'GET /webhooks/:id': aFaire('B10', 'webhooks entrants : lire, dernier contenu reçu compris'),
  'POST /webhooks': aFaire('B10', 'webhooks entrants : créer (valeurs reliées aux champs, scénario lancé, contacts créés)'),
  'PATCH /webhooks/:id': aFaire('B10', 'webhooks entrants : modifier ; brancher un scénario sur un webhook se fait au clic'),
  'DELETE /webhooks/:id': aFaire('B10', 'webhooks entrants : supprimer'),
  'POST /webhooks/:id/secret': aFaire('B10', 'webhooks entrants : poser un secret neuf, montré une seule fois'),
  'DELETE /webhooks/:id/secret': aFaire('B10', 'webhooks entrants : retirer le secret'),
  'DELETE /webhooks/:id/payload': aFaire('B10', 'webhooks entrants : effacer le dernier contenu reçu'),

  // Applications autorisées (oauthConsentement)
  'POST /oauth/autoriser': humain('connexion OAuth : la personne autorise elle-même une application'),
  'GET /oauth/autorisations': aFaire('B10', 'compte : lister les applications autorisées'),
  'DELETE /oauth/autorisations/:id': aFaire('B10', 'compte : révoquer une application autorisée'),

  // Outils de l'agent IA (agentTools)
  'GET /agents/:agentId/tools': enPartie(['get_agent'], 'les réglages communs et la cible de chaque outil'),
  'POST /agents/:agentId/tools': enPartie(['set_agent_tools', 'set_agent_action'], 'la cible des autres outils (tag, champ, bloc, scénario, enchaînement, qualification)'),
  'POST /agents/:agentId/tools/connecteur': aFaire('B10', 'agent IA : donner à un agent un appel de connecteur API'),
  'PATCH /agents/:agentId/tools/:outilId': enPartie(['set_agent_action'], 'les réglages communs des autres outils (nom vu par le modèle, quand l’appeler, quand ne pas l’appeler, gestes) et leur cible'),
  'PUT /agents/:agentId/tools/:outilId/activation': aFaire('B10', 'agent IA : activer ou désactiver un outil'),
  'PUT /agents/:agentId/tools/:outilId/autonomie': aFaire('B10', 'agent IA : l’autonomie d’un outil ; sur un appel DELETE, elle reste un clic dans la console'),
  'DELETE /agents/:agentId/tools/:outilId': enPartie(['delete_agent_action'], 'détacher les outils qui ne sont pas des actions'),
  'PUT /agents/:agentId/tools/:outilId/rattachement': aFaire('B10', 'agent IA : rattacher un outil de la bibliothèque à un agent, ou l’en détacher'),
  'GET /agents/:agentId/tools/offrables': aFaire('B10', 'agent IA : les outils qu’on peut encore donner à l’agent'),

  // Shopify
  'GET /integrations/shopify': outil('get_shopify_state'),
  'DELETE /integrations/shopify': outil('disconnect_shopify'),
  'POST /integrations/shopify': outil('connect_shopify'),
  'PATCH /integrations/shopify': SHOPIFY,
  'POST /integrations/shopify/attestation': SHOPIFY,
  'PUT /integrations/shopify/lignes/:evenement': SHOPIFY,
  'POST /integrations/shopify/messages': SHOPIFY,
  'PATCH /integrations/shopify/messages/:evenement': SHOPIFY,
  'GET /integrations/shopify/clients/apercu': outil('preview_shopify_customers'),
  'POST /integrations/shopify/clients/import': outil('import_shopify_customers'),
  'GET /integrations/shopify/commandes/apercu': outil('preview_shopify_order_history'),
  'POST /integrations/shopify/commandes/rattrapage': outil('import_shopify_order_history'),
  'GET /integrations/shopify/commandes/rattrapage': outil('get_shopify_order_history'),

  // L'abonnement du numéro fourni (abonnementNumero)
  'GET /abonnement-numero': outil('get_number_subscription'),

  // La séance (me)
  'GET /me': ecran('l’identité de la séance (personne, espace, rôle)'),
  'POST /moi/accueil': ecran('le choix fait dans la fenêtre de bienvenue'),
  'GET /espaces': ecran('les espaces de la personne ; un jeton MCP vaut pour un seul espace'),
  'POST /changer-espace': ecran('changer d’espace dans la console ; un jeton MCP vaut pour un seul espace'),

  // Ce que reçoit la personne (emailsMoi)
  'GET /moi/emails': aFaire('B10', 'compte : lire ses préférences d’e-mails'),
  'PUT /moi/emails': aFaire('B10', 'compte : régler ses préférences d’e-mails'),
  'GET /moi/partage-meta': ecran('l’état du partage avec Meta, que la personne règle elle-même'),
  'PUT /moi/partage-meta': humain('le partage avec Meta reste à la personne'),

  // Le numéro fourni et la filière application (numeroFourni) : la page ouverte par le lien de l'outil les appelle
  'POST /numero-fourni': ICI_PAR_LE_LIEN,
  'POST /numero-fourni/destination': ICI_PAR_LE_LIEN,
  'POST /numero-fourni/abonnement': ICI_PAR_LE_LIEN,
  'POST /numero-fourni/portail': outil('manage_number_subscription'),
  'GET /numero-fourni': outil('watch_whatsapp_connection'),
  'GET /connexion-numero': outil('watch_whatsapp_connection'),
  'POST /application/relier': ICI_PAR_LE_LIEN,
  'GET /application/qr': ICI_PAR_LE_LIEN,
  'POST /numero-fourni/remplacer': aFaire('B10', 'numéro : remplacer le numéro fourni'),
  'POST /numero-fourni/abandonner': aFaire('B10', 'numéro : abandonner le numéro fourni'),

  // La connexion du numéro (embeddedSignup)
  'GET /embedded-signup/config': ICI_PAR_LE_LIEN,
  'POST /embedded-signup/complete': humain('connexion à Meta : la personne passe la fenêtre de Meta, sur la page du lien de start_whatsapp_connection'),
  'POST /numero/code': aFaire('B7', 'numéro : demander le code de vérification (appel ou SMS, 10 par 72 heures chez Meta)'),
  'POST /numero/activer': aFaire('B7', 'numéro : activer un numéro relié avec son code'),
  'POST /numero/delier': aFaire('B10', 'numéro : délier'),
  'POST /numero/relier': aFaire('B10', 'numéro : relier de nouveau'),
  'GET /numero/deconnexion': aFaire('B10', 'numéro : ce que la déconnexion coupera'),
  'POST /numero/deconnecter': aFaire('B10', 'numéro : déconnecter, au clic (ne se rattrape pas)'),

  // L'équipe et l'espace (admin)
  'GET /users': enPartie(['list_members'], 'le rôle, l’adresse et l’état de chaque membre'),
  'POST /invitations': aFaire('B10', 'équipe : inviter'),
  'POST /users/:userId/lien-invitation': aFaire('B10', 'équipe : refaire un lien d’invitation'),
  'PATCH /users/:userId/name': aFaire('B10', 'équipe : renommer un membre'),
  'PATCH /users/:userId/role': aFaire('B10', 'équipe : changer un rôle'),
  'PATCH /users/:userId/disabled': aFaire('B10', 'équipe : désactiver ou réactiver un membre'),
  'DELETE /users/:userId': aFaire('B10', 'équipe : retirer un membre'),
  'DELETE /users/:userId/mfa': humain('réinitialiser le second facteur d’un membre reste à la personne'),
  'GET /nom': aFaire('B10', 'aide : lire le nom et le code de l’espace'),
  'PATCH /nom': aFaire('B10', 'compte : renommer l’espace'),
  'GET /second-facteur': ecran('l’exigence du second facteur, que la personne règle elle-même'),
  'PUT /second-facteur': humain('exiger le second facteur reste à la personne'),

  // L'e-mail (email)
  'GET /email/accounts': aFaire('B10', 'e-mail : lister les boîtes d’envoi'),
  'POST /email/accounts': aFaire('B10', 'e-mail : créer une boîte d’envoi ; le mot de passe SMTP se saisit sur une page sécurisée, par lien signé'),
  'PATCH /email/accounts/:id': aFaire('B10', 'e-mail : modifier une boîte d’envoi (même règle pour le mot de passe)'),
  'DELETE /email/accounts/:id': aFaire('B10', 'e-mail : supprimer une boîte d’envoi'),
  'POST /email/accounts/:id/test': aFaire('B10', 'e-mail : tester une boîte d’envoi'),
  'GET /email/templates': aFaire('B10', 'e-mail : lister les modèles d’e-mail'),
  'POST /email/templates': aFaire('B10', 'e-mail : créer un modèle d’e-mail'),
  'PATCH /email/templates/:id': aFaire('B10', 'e-mail : modifier un modèle d’e-mail'),
  'DELETE /email/templates/:id': aFaire('B10', 'e-mail : supprimer un modèle d’e-mail'),

  // Les systèmes des connecteurs API (agentSources)
  'GET /agent-sources': aFaire('B10', 'agent IA, connecteurs API : lister les systèmes'),
  'POST /agent-sources': aFaire('B10', 'agent IA, connecteurs API : déclarer un système ; sa clé se saisit sur une page sécurisée, par lien signé'),
  'PATCH /agent-sources/:id': aFaire('B10', 'agent IA, connecteurs API : modifier un système (même règle pour la clé)'),
  'DELETE /agent-sources/:id': aFaire('B10', 'agent IA, connecteurs API : supprimer un système'),
  'POST /agent-sources/:id/epreuve': aFaire('B10', 'agent IA, connecteurs API : éprouver un système'),

  // Bien démarrer (demarrage)
  'GET /demarrage': enPartie(['get_setup_state'], 'la progression « Bien démarrer » de la console, dont l’étape des premiers scénarios'),

  // Les champs (fields)
  'GET /user-fields/usage': aFaire('B10', 'contacts : savoir où un champ est utilisé'),
  'GET /champs-fiche': ecran('le catalogue des champs et des opérateurs de filtre de l’écran des contacts ; find_contacts annonce les siens'),
  'GET /user-fields': outil('list_fields'),
  'POST /user-fields': outil('create_field'),
  'PATCH /user-fields/:key': aFaire('B10', 'contacts : modifier un champ'),
  'DELETE /user-fields/:key': aFaire('B10', 'contacts : supprimer un champ'),

  // Les médias d'en-tête des modèles (media)
  'POST /media': aFaire('B10', 'modèles : déposer un média d’en-tête'),

  // Le bac à sable de l'agent IA (agentTest)
  'GET /agents/:agentId/tests': aFaire('B10', 'agent IA : relire les essais gardés du bac à sable'),
  'POST /agents/:agentId/test': outil('test_agent'),

  // Les étiquettes (tags)
  'GET /tags': aFaire('B10', 'contacts : lister les étiquettes'),
  'POST /tags': enPartie(['tag_contacts'], 'créer une étiquette sans la poser sur des contacts'),
  'PATCH /tags': aFaire('B10', 'contacts : renommer une étiquette'),
  'DELETE /tags': aFaire('B10', 'contacts : supprimer une étiquette'),

  // Les clés d'API (apiKeys)
  'POST /api-keys': outil('create_api_key'),
  'GET /api-keys': aFaire('B10', 'compte : lister les clés d’API'),
  'DELETE /api-keys/:id': aFaire('B10', 'compte : révoquer une clé d’API'),

  // HubSpot, resté ouvert au Pro pour pouvoir débrancher (hubspotInbox, hubspotChoix, account, settings)
  'GET /hubspot/inbox': lot7('HubSpot'),
  'PUT /hubspot/inbox': lot7('HubSpot'),
  'PUT /hubspot/choix': lot7('HubSpot'),
  'POST /hubspot/deconnexion': lot7('HubSpot'),
  'PATCH /phone-numbers/:phoneNumberId/hubspot': lot7('HubSpot'),
  'PATCH /settings/hubspot-lists': lot7('HubSpot'),
  'PATCH /settings/hubspot-actif': lot7('HubSpot'),

  // L'offre et ses paiements (offre, creditPaiement, offrePaiement)
  'GET /offre': outil('get_plan'),
  'POST /credit/paiement': outil('buy_credit'),
  'GET /credit/factures/:sessionId': aFaire('B10', 'offre : la facture d’un achat de crédit IA'),
  'POST /offre/paiement': outil('subscribe_pro'),
  'POST /offre/portail': aFaire('B10', 'offre : ouvrir le portail Stripe de l’offre (carte, factures) ; la personne y agit'),
  'POST /offre/sieges': aFaire('B10', 'offre : ajouter un utilisateur payant ; le paiement reste à la personne'),
  'POST /offre/packs-contacts': aFaire('B10', 'offre : ajouter ou retirer un pack de 1 000 contacts du Pro ; le paiement reste à la personne'),
  'POST /offre/resiliation': aFaire('B10', 'offre : résilier, au clic'),
  'POST /offre/pro/demarrer': aFaire('B10', 'offre : démarrer le Pro avant la fin de l’essai, au clic (la carte est prélevée)'),
  'GET /offre/factures': aFaire('B10', 'offre : lister les factures'),
  'GET /offre/tarif': aFaire('B10', 'offre : le tarif réel du Pro, lu chez Stripe'),
  'PUT /offre/numero': outil('return_number_at_plan_end'),

  // Les widgets (widgets)
  'GET /widgets': outil('list_widgets'),
  'POST /widgets': outil('create_widget'),
  'PATCH /widgets/:id': outil('update_widget'),
  'DELETE /widgets/:id': aFaire('B10', 'site : supprimer un widget'),

  // Les formulaires WhatsApp (flows)
  'POST /flows': aFaire('B10', 'formulaires WhatsApp : créer'),
  'PATCH /flows/:flowId': aFaire('B10', 'formulaires WhatsApp : modifier'),
  'POST /flows/:flowId/duplicate': aFaire('B10', 'formulaires WhatsApp : dupliquer'),
  'GET /flows': aFaire('B10', 'formulaires WhatsApp : lister'),
  'POST /flows/refresh': aFaire('B10', 'formulaires WhatsApp : relire leur état chez Meta'),
  'GET /flows/:flowId/sorties': aFaire('B10', 'formulaires WhatsApp : les sorties d’un formulaire'),
  'POST /flows/:flowId/publish': aFaire('B10', 'formulaires WhatsApp : publier chez Meta, au clic'),
  'DELETE /flows/:flowId': aFaire('B10', 'formulaires WhatsApp : supprimer'),

  // Le Support (support)
  'POST /support': aFaire('B7', 'support : écrire au Support avec le contexte de l’espace'),

  // Le rangement en dossiers (dossiers)
  'GET /dossiers': ecran('le rangement des scénarios et des modèles en dossiers'),
  'POST /dossiers': ecran('le rangement des scénarios et des modèles en dossiers'),
  'PATCH /dossiers/:id': ecran('le rangement des scénarios et des modèles en dossiers'),
  'DELETE /dossiers/:id': ecran('le rangement des scénarios et des modèles en dossiers'),
  'PUT /dossiers/rangement': ecran('le rangement des scénarios et des modèles en dossiers'),

  // L'Inbox (inbox)
  'GET /conversations': outil('list_conversations'),
  'GET /conversations/counts': ecran('les compteurs des onglets de l’Inbox'),
  'POST /conversations/:conversationId/archive': aFaire('B10', 'Inbox : archiver'),
  'POST /conversations/:conversationId/unarchive': aFaire('B10', 'Inbox : désarchiver'),
  'POST /conversations/:conversationId/signaler': aFaire('B10', 'Inbox : signaler'),
  'POST /conversations/:conversationId/ne-plus-signaler': aFaire('B10', 'Inbox : ne plus signaler'),
  'POST /conversations/:conversationId/urgent': aFaire('B10', 'Inbox : marquer urgent'),
  'POST /conversations/:conversationId/ne-plus-urgent': aFaire('B10', 'Inbox : ne plus marquer urgent'),
  'POST /conversations/:conversationId/traiter': aFaire('B10', 'Inbox : marquer traité'),
  'POST /conversations/:conversationId/ne-plus-traiter': aFaire('B10', 'Inbox : ne plus marquer traité'),
  'POST /contacts/:contactId/conversation': ecran('ouvrir le fil d’un contact depuis sa fiche ; un envoi crée le fil de lui-même'),
  'POST /conversations/:conversationId/prendre': outil('control_conversation'),
  'GET /conversations/:conversationId/messages/:messageId/media': aFaire('B10', 'Inbox : lire le média d’un message'),
  'POST /conversations/:conversationId/messages/:messageId/transcrire': aFaire('B10', 'Inbox : transcrire un vocal (débité sur le crédit IA)'),
  'POST /conversations/:conversationId/traduire': exclue('traduction à l’écran : le modèle qui pilote lit la conversation dans sa langue'),
  'GET /conversations/todo-count': ecran('le compteur « À traiter » de la barre'),
  'GET /conversations/unread-count': ecran('le compteur des non-lus de la barre'),
  'POST /conversations/:conversationId/read': aFaire('B10', 'Inbox : marquer comme lu'),
  'DELETE /conversations/:conversationId/messages': aFaire('B10', 'Inbox : effacer les messages d’une conversation, au clic (ne se rattrape pas)'),
  'GET /conversations/:conversationId/messages': outil('get_messages'),
  'GET /conversations/:conversationId/detail': outil('get_conversation'),
  'GET /conversations/membres-affectables': outil('list_members'),
  'POST /conversations/:conversationId/assignee/moi': outil('assign_conversation'),
  'PATCH /conversations/:conversationId/assignee': outil('assign_conversation'),
  'POST /conversations/:conversationId/reply': outil('reply_in_open_window', 'send_message'),
  'POST /conversations/:conversationId/send-rcs': lot7('le RCS'),
  'GET /conversations/:conversationId/template-params': ecran('les variables d’un modèle préremplies depuis la fiche, pour l’écran d’envoi'),
  'POST /conversations/:conversationId/send-template': outil('send_template_to_contact'),
  'POST /conversations/:conversationId/workflow': outil('send_scenario_to_contact'),
  'POST /conversations/:conversationId/release': outil('control_conversation'),

  // La liste des contacts et l'import (import)
  'GET /contacts': outil('find_contacts', 'search_contacts'),
  'GET /contacts/segments': SHOPIFY,
  'GET /contacts/segments/produits': SHOPIFY,
  'GET /contacts/segments/collections': SHOPIFY,
  'GET /contacts/count': outil('find_contacts'),
  'GET /contacts/ids': outil('find_contacts'),
  'POST /contacts/import/preview': aFaire('B10', 'contacts : aperçu d’un import'),
  'POST /contacts/import': aFaire('B10', 'contacts : importer (consentement déclaré)'),

  // Les automations (automations)
  'GET /automations': aFaire('B10', 'automations : lister'),
  'GET /automations/actions-agent': aFaire('B10', 'automations : les actions d’agent qui peuvent déclencher'),
  'POST /automations': aFaire('B10', 'automations : créer (mot-clé, nouveau contact, date, tag, publicité, action d’agent), allumée au clic'),
  'PATCH /automations/:id': aFaire('B10', 'automations : modifier, allumer, éteindre'),
  'DELETE /automations/:id': aFaire('B10', 'automations : supprimer'),

  // La fiche contact, le journal et les erreurs (contacts)
  'GET /contacts/desabonnes': aFaire('B10', 'contacts : lister les désabonnés'),
  'GET /contacts/refus-possibles': aFaire('B10', 'contacts : les STOP ambigus à relire'),
  'GET /contacts/blocked': aFaire('B10', 'contacts : lister les contacts bloqués'),
  'PATCH /contacts/:contactId/blocked': outil('block_contact'),
  'PATCH /contacts/:contactId': enPartie(['set_contact_field', 'tag_contacts'], 'le nom, l’e-mail, le consentement et le retrait d’étiquettes sur une fiche'),
  'GET /contacts/:contactId/history': aFaire('B10', 'contacts : l’historique d’une fiche'),
  'GET /contacts/:contactId/resume': outil('get_contact'),
  'GET /contacts/:contactId/shopify': SHOPIFY,
  'GET /contacts/:contactId/bilan': aFaire('B10', 'contacts : risque, joignabilité et source du consentement d’une fiche'),
  'GET /contacts/:contactId/history/export': aFaire('B10', 'contacts : l’export RGPD de l’historique'),
  'POST /contacts': aFaire('B10', 'contacts : ajouter un contact'),
  'POST /contacts/bulk': enPartie(['tag_contacts', 'set_contact_field'], 'l’opt-in, l’opt-out et le retrait d’étiquettes en masse'),
  'POST /contacts/export': humain('extraire des données personnelles dans un fichier : la personne coche chaque colonne, et le geste est tracé au journal'),
  'GET /audit': aFaire('B10', 'chiffres : le journal d’audit'),
  'GET /erreurs-livraison': aFaire('B6', 'déroulé : le journal des erreurs de livraison'),
  'GET /erreurs-systeme': aFaire('B6', 'déroulé : le journal des erreurs du système'),
  'POST /contacts/purge': outil('prepare_contacts_deletion', 'delete_contacts'),

  // L'historique des réglages (historique)
  'GET /historique': aFaire('B10', 'agent IA : l’historique des réglages (qui a changé quoi)'),

  // Les chiffres (stats)
  'GET /stats': outil('get_message_stats'),
  'GET /accueil/volumes': outil('get_message_stats'),
  'GET /stats/templates': aFaire('B10', 'chiffres : les statistiques par modèle'),
  'GET /stats/campaign-funnel': outil('get_campaign_stats'),
  'GET /stats/errors': aFaire('B10', 'chiffres : les échecs par code'),
  'GET /stats/errors/:code/contacts': aFaire('B10', 'chiffres : les contacts touchés par un code d’échec'),
  'GET /stats/cost': outil('get_message_stats'),
  'GET /stats/cost/campaigns': outil('get_campaign_stats'),
  'GET /stats/cost/pubs': lot7('les publicités'),
  'GET /stats/cost/messages': outil('get_message_stats'),
  'GET /stats/cost/ia': outil('get_ai_stats'),
  'GET /stats/performance': aFaire('B10', 'chiffres : la performance de l’équipe'),
  'GET /stats/ventes': outil('get_revenue_stats'),
  'GET /stats/roi': aFaire('B10', 'chiffres : le ROI'),
  'GET /stats/joignabilite': aFaire('B10', 'chiffres : la joignabilité des contacts'),
  'GET /stats/cost/campaigns/:campaignId': outil('get_campaign_stats'),

  // L'assistant de construction de l'agent IA (agentSetup)
  'GET /agents/:agentId/setup': ASSISTANT,
  'GET /agents/:agentId/setup/suggestions': ASSISTANT,
  'DELETE /agents/:agentId/setup': ASSISTANT,
  'POST /agents/:agentId/setup/piece-jointe': ASSISTANT,
  'POST /agents/:agentId/setup': ASSISTANT,

  // La connaissance de l'agent IA (agentKnowledge)
  'GET /agents/:agentId/knowledge': outil('list_knowledge'),
  'POST /agents/:agentId/knowledge': outil('add_knowledge'),
  'PATCH /agents/:agentId/knowledge/:ficheId': aFaire('B10', 'agent IA : modifier une fiche de connaissance'),
  'DELETE /agents/:agentId/knowledge/:ficheId': outil('delete_knowledge'),
  'POST /agents/:agentId/knowledge/supprimer': outil('delete_knowledge'),
  'POST /agents/:agentId/knowledge/document': enPartie(['import_document_text'], 'le fichier lui-même : seul son texte, extrait sur le poste, passe par l’outil'),
  'POST /agents/:agentId/knowledge/apercu': outil('preview_site'),
  'POST /agents/:agentId/knowledge/import': outil('import_site'),

  // Les réglages de l'espace (settings)
  'GET /settings': aFaire('B10', 'aide : lire les réglages de l’espace (heures d’ouverture, fuseau)'),
  'PUT /settings': lot7('l’agent de Meta (son interrupteur)'),
  'GET /settings/poussee-optout': aFaire('B10', 'contacts : lire l’appel de connecteur prévenu à chaque désabonnement'),
  'PATCH /settings/poussee-optout': aFaire('B10', 'contacts : choisir l’appel de connecteur prévenu à chaque désabonnement, au clic (des données partent chez un tiers)'),
  'GET /settings/mention-ia': aFaire('B10', 'agent IA : lire la fréquence de la mention d’IA'),
  'PATCH /settings/mention-ia': aFaire('B10', 'agent IA : régler la fréquence de la mention d’IA'),
  'GET /settings/transfert-agent': aFaire('B10', 'agent IA : lire ce que les agents promettent au transfert'),
  'PATCH /settings/transfert-agent': outil('set_transfer_mode'),
  'GET /settings/agents-peuvent-prendre': aFaire('B10', 'Inbox : lire qui peut prendre une conversation'),
  'PATCH /settings/agents-peuvent-prendre': aFaire('B10', 'Inbox : régler qui peut prendre une conversation'),
  'PATCH /settings/control-handback': aFaire('B10', 'Inbox : le délai de reprise'),
  'PATCH /settings/mba-handoff': lot7('l’agent de Meta'),
  'PATCH /settings/timezone': aFaire('B10', 'compte : le fuseau horaire'),
  'PATCH /settings/business-hours': outil('set_business_hours'),

  // Les modèles WhatsApp (templates)
  'GET /templates': outil('list_templates'),
  'POST /templates': outil('create_template'),
  'GET /templates/:templateName/param-hints': aFaire('B10', 'modèles : relire le rattachement des variables aux champs'),
  'PATCH /templates/:templateName': outil('update_template'),
  'DELETE /templates/:templateName': outil('delete_template'),

  // Les webhooks sortants (evenements)
  'GET /evenements/adresses': outil('list_webhook_endpoints'),
  'POST /evenements/adresses': outil('create_webhook_endpoint'),
  'PATCH /evenements/adresses/:adresseId': outil('update_webhook_endpoint'),
  'POST /evenements/adresses/:adresseId/rotation': outil('update_webhook_endpoint'),
  'DELETE /evenements/adresses/:adresseId': outil('delete_webhook_endpoint'),
  'POST /evenements/adresses/:adresseId/essai': outil('send_test_event'),
  'GET /evenements/adresses/:adresseId/envois': outil('get_webhook_deliveries'),
  'POST /evenements/envois/:envoiId/rejeu': outil('replay_webhook_delivery'),
  'POST /evenements/adresses/:adresseId/rejeu-echecs': aFaire('B10', 'webhooks sortants : rejouer d’un coup tous les échecs'),

  // L'état du compte WhatsApp (account)
  'GET /account-status': aFaire('B7', 'numéro : lire l’état du compte (nom, qualité, palier, vérification d’entreprise, Marketing Messages)'),

  // Les appels des connecteurs API (agentRequetes)
  'GET /agent-requetes': aFaire('B10', 'agent IA, connecteurs API : lister les appels'),
  'POST /agent-requetes': aFaire('B10', 'agent IA, connecteurs API : déclarer un appel'),
  'PATCH /agent-requetes/:id': aFaire('B10', 'agent IA, connecteurs API : modifier un appel, son risque compris'),
  'DELETE /agent-requetes/:id': aFaire('B10', 'agent IA, connecteurs API : supprimer un appel'),
  'POST /agent-requetes/:id/test': aFaire('B10', 'agent IA, connecteurs API : essayer un appel'),
  'POST /agent-requetes/test': aFaire('B10', 'agent IA, connecteurs API : essayer un appel avant de l’enregistrer'),

  // Le catalogue des outils d'agent (agentCatalogue)
  'GET /agent-tools': aFaire('B10', 'agent IA : le catalogue des outils d’agent'),

  // Les agents IA et le répondeur (agents)
  'GET /agents/solde': outil('get_credit'),
  'GET /agents/mouvements': outil('get_credit'),
  'GET /agents/:agentId/consommation': aFaire('B10', 'agent IA : la consommation d’un agent'),
  'GET /agents/:agentId/messages': aFaire('B10', 'agent IA : l’historique des messages d’un agent'),
  'GET /agents': outil('list_agents'),
  'GET /repondeur': outil('get_setup_state'),
  'PUT /repondeur': outil('set_default_responder'),
  'PUT /agents/repondeur': outil('set_default_responder'),
  'GET /agents/:agentId': outil('get_agent'),
  'POST /agents': outil('create_agent'),
  'GET /agents/:agentId/manques': outil('get_agent'),
  'GET /agents/modeles': outil('get_agent'),
  'PATCH /agents/:agentId': enPartie(['update_agent', 'set_agent_limits', 'activate_agent'], 'le nom donné au contact, l’inactivité et le contact inconnu'),
  'DELETE /agents/:agentId': aFaire('B10', 'agent IA : supprimer un agent'),

  // La médiathèque (rcsMedia)
  'POST /rcs/media': aFaire('B10', 'médiathèque : déposer un fichier (image, vidéo, PDF)'),
  'GET /rcs/media': aFaire('B10', 'médiathèque : lister'),
  'GET /rcs/media/:code/fichier': ecran('le fichier servi à la console pour son aperçu'),
  'DELETE /rcs/media/:code': aFaire('B10', 'médiathèque : supprimer un fichier'),
  'GET /m/:fichier': exclue('le visuel servi sans séance à Meta et aux destinataires'),

  // Les campagnes (campaigns)
  'GET /campaign-drafts': aFaire('B10', 'campagnes : lister les brouillons du formulaire'),
  'POST /campaign-drafts': aFaire('B10', 'campagnes : enregistrer un brouillon du formulaire'),
  'PUT /campaign-drafts/:draftId': aFaire('B10', 'campagnes : modifier un brouillon du formulaire'),
  'DELETE /campaign-drafts/:draftId': aFaire('B10', 'campagnes : supprimer un brouillon du formulaire'),
  'GET /campaigns': aFaire('B10', 'campagnes : lister avec leur statut'),
  'GET /campaigns/:campaignId': enPartie(['get_campaign_stats'], 'les options, les destinataires et le suivi de l’envoi'),
  'GET /phone-numbers': outil('get_setup_state'),
  'GET /rcs-agents': lot7('le RCS'),
  'POST /campaigns': outil('prepare_campaign'),
  'POST /campaigns/:campaignId/run': outil('launch_campaign'),
  'POST /campaigns/:campaignId/recipients/:recipientId/retry': aFaire('B8', 'campagnes : renvoyer à un destinataire en échec, au clic'),
  'POST /campaigns/:campaignId/pause': outil('control_campaign'),
  'POST /campaigns/:campaignId/cancel-schedule': outil('control_campaign'),
  'POST /campaigns/:campaignId/stop': aFaire('B10', 'campagnes : arrêter définitivement'),
  'POST /campaigns/:campaignId/archive': aFaire('B10', 'campagnes : archiver'),
  'POST /campaigns/:campaignId/unarchive': aFaire('B10', 'campagnes : désarchiver'),
  'DELETE /campaigns/:campaignId': aFaire('B10', 'campagnes : supprimer'),

  // Les scénarios (workflows)
  'POST /workflows/js-test': aFaire('B10', 'scénarios : éprouver une « Fonction JS » sur une valeur d’essai'),
  'POST /workflows': enPartie(['create_scenario'], 'les blocs que la recette ne dit pas encore (B5) et l’écriture en brouillon (B4)'),
  'POST /workflows/:id/duplicate': aFaire('B10', 'scénarios : dupliquer'),
  'GET /workflows': outil('list_scenarios'),
  'GET /nodes': ecran('le catalogue des blocs de l’éditeur ; la recette décrit les siens'),
  'GET /workflows/:id': enPartie(['get_scenario'], 'les scénarios faits dans la console, que la recette ne relit pas encore (B5)'),
  'PATCH /workflows/:id': aFaire('B4', 'scénarios : écrire en brouillon, y compris sur un scénario fait dans la console'),
  // La publication passe par le oui de mise en ligne (B2) : `propose_go_live` (action « publier »), puis le clic d'un admin.
  'POST /workflows/:id/publish': outil('propose_go_live'),
  'POST /workflows/:id/blocs/:nodeId/modele': aFaire('B10', 'scénarios : créer le modèle d’un bloc'),
  'GET /workflows/:id/modeles': aFaire('B10', 'scénarios : l’état des modèles que nomme le brouillon'),
  'DELETE /workflows/:id/programmation': aFaire('B10', 'scénarios : annuler une programmation'),
  'DELETE /workflows/:id': enPartie(['delete_scenario'], 'les scénarios faits dans la console'),
  'POST /workflows/:id/test-link': aFaire('B4', 'scénarios : le lien de test du brouillon'),

  // Le oui de mise en ligne (misesEnLigne, B2)
  'GET /mises-en-ligne/:id': outil('get_go_live'),
  'POST /mises-en-ligne/:id/accepter': humain('le clic d’un admin sur la page vaut accord (décision du 24 novembre) : le CSM ne peut pas se le donner, aucun outil ne clique'),

  // Les connecteurs MCP de l'agent IA (agentMcp)
  'GET /mcp': aFaire('B10', 'agent IA, connecteurs MCP : lister'),
  'POST /mcp': aFaire('B10', 'agent IA, connecteurs MCP : déclarer un serveur ; sa clé se saisit sur une page sécurisée, par lien signé'),
  'DELETE /mcp/:sourceId': aFaire('B10', 'agent IA, connecteurs MCP : supprimer un serveur'),
  'GET /mcp/:sourceId/outils': aFaire('B10', 'agent IA, connecteurs MCP : lister les outils d’un serveur'),
  'POST /mcp/:sourceId/apercu': aFaire('B10', 'agent IA, connecteurs MCP : l’aperçu des outils d’un serveur'),
  'POST /mcp/:sourceId/importer': aFaire('B10', 'agent IA, connecteurs MCP : importer des outils'),
  'PATCH /mcp/outils/:outilId': aFaire('B10', 'agent IA, connecteurs MCP : régler un outil importé'),
  'PUT /mcp/outils/:outilId/propose': aFaire('B10', 'agent IA, connecteurs MCP : proposer un outil importé aux agents, ou le retirer'),

  // La ligne de crédit WhatsApp (creditWhatsapp)
  'GET /credit-whatsapp/etat': aFaire('B10', 'offre : l’état de la ligne de crédit (cartes chez Meta, numéros)'),
  'GET /credit-whatsapp': aFaire('B10', 'offre : le crédit WhatsApp (solde, qui peut recharger)'),
  'POST /credit-whatsapp/option': outil('take_credit_line'),
  'PATCH /credit-whatsapp/option': aFaire('B10', 'offre : les places de la ligne de crédit'),
  'POST /credit-whatsapp/achat': outil('buy_credit'),
};
