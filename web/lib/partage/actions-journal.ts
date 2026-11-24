/**
 * Vocabulaire commun à l'écriture, à l'écran et au CSV. `audit_log.action` est un texte libre en base : dériver
 * `AuditAction` de ces clés empêche qu'une action nouvelle s'écrive sans libellés français et anglais.
 * Le détail n'y est jamais défini : le store filtre les données personnelles au point d'écriture, et chaque geste
 * décide quelles données non personnelles permettent d'expliquer son effet.
 */
const CATALOGUE_ACTIONS_AUDIT = {
  'contact.created': ['Contact ajouté', 'Contact added'],
  'contact.imported': ['Import de contacts', 'Contact import'],
  'contact.purged': ['Contact supprimé', 'Contact deleted'],
  // L'option « le plus ancien laisse sa place » (lot 2 du 2026-11-24) : les plus anciens purgés pour faire de la place, le
  // détail porte leur nombre, leurs identifiants internes et le chemin qui créait, jamais un numéro ni un nom.
  'contacts.remplaces': ['Contacts les plus anciens remplacés', 'Oldest contacts replaced'],
  'settings.contacts_remplacer_anciens': ['Remplacement des contacts les plus anciens réglé', 'Oldest contacts replacement set'],
  'contact.optin': ['Passage en opt-in', 'Marked as opted in'],
  'contact.optout': ['Passage en opt-out', 'Marked as opted out'],
  'workflow.published': ['Scénario mis en ligne', 'Scenario published'],
  // Menu « Scénario », lot 3 : un template écrit depuis un bloc (le détail porte l'état rendu par Meta), et la mise en
  // ligne programmée pendant sa validation (le détail porte le nombre de templates attendus).
  'workflow.modele_soumis': ['Template écrit depuis un bloc', 'Template written from a block'],
  'workflow.publication_programmee': ['Mise en ligne programmée', 'Publication scheduled'],
  'workflow.programmation_annulee': ['Mise en ligne programmée annulée', 'Scheduled publication cancelled'],
  // Un scénario supprimé par l'API ou le MCP (spec 2026-11-02-scenarios-api) : le détail ne porte que l'origine.
  'workflow.deleted': ['Scénario supprimé', 'Scenario deleted'],
  // Effacement irréversible : la trace ne porte que l'identifiant interne et le nombre de messages effacés.
  'conversation.effacee': ['Conversation effacée', 'Conversation erased'],
  // Le branchement d'un outil qui reçoit les signaux (lot 6 de l'API publique). Ni le libellé, ni la cible
  // (`integration` / `signaux`), ni le détail ne nomment l'outil : ce journal est un écran de la marque, et la
  // spec (§ 10) réserve ce nom à l'écran de réglage (`src/http/integration-batch.ts`).
  'integration.branchee': ['Outil branché sur les signaux', 'Tool connected to signals'],
  'integration.modifiee': ['Réglage d’un outil modifié', 'Tool settings changed'],
  'integration.debranchee': ['Outil débranché', 'Tool disconnected'],
  // Les webhooks sortants (lot 12) : le détail porte l'adresse et les types, jamais le secret.
  'evenements.adresse_creee': ['Webhook sortant créé', 'Outgoing webhook created'],
  'evenements.adresse_modifiee': ['Webhook sortant modifié', 'Outgoing webhook changed'],
  'evenements.adresse_supprimee': ['Webhook sortant supprimé', 'Outgoing webhook deleted'],
  'evenements.secret_tourne': ['Secret d’un webhook sortant renouvelé', 'Outgoing webhook secret rotated'],
  'evenements.envoi_rejoue': ['Envoi d’un webhook sortant rejoué', 'Outgoing webhook delivery replayed'],
  // L'app Salesforce (plan du 2026-09-26) : ces libellés NOMMENT l'outil, décision de Julien du 2026-09-26.
  'salesforce.allumee': ['Salesforce allumé pour l’espace', 'Salesforce turned on for the workspace'],
  'salesforce.eteinte': ['Salesforce éteint pour l’espace', 'Salesforce turned off for the workspace'],
  'salesforce.connectee': ['Org Salesforce reliée', 'Salesforce org connected'],
  'salesforce.modifiee': ['Réglages Salesforce modifiés', 'Salesforce settings changed'],
  'salesforce.deconnectee': ['Org Salesforce déconnectée', 'Salesforce org disconnected'],
  'shopify.coupee': ['Boutique Shopify coupée', 'Shopify store cut'],
  // Le branchement et les messages depuis la console (conception 2026-10-22).
  'shopify.branchee': ['Boutique Shopify branchée', 'Shopify store connected'],
  'shopify.message': ['Message Shopify préparé', 'Shopify message prepared'],
  'shopify.reglage': ['Message Shopify réglé', 'Shopify message settings changed'],
  'shopify.import': ['Clients Shopify importés', 'Shopify customers imported'],
  // Le menu « Scénario », lot 5 : la pause de la boutique et l'interrupteur d'une automation (sa ligne).
  'shopify.pause': ['Boutique Shopify mise en pause', 'Shopify store paused'],
  'shopify.reprise': ['Boutique Shopify reprise', 'Shopify store resumed'],
  'shopify.ligne': ['Automation Shopify réglée', 'Shopify automation changed'],
  'shopify.attestation': ['Consentement des clients Shopify attesté ou retiré', 'Shopify customers consent confirmed or withdrawn'],
  // Segments Shopify enrichis, lot 5 : le rattrapage des commandes des 60 derniers jours (le détail : la reprise, sa date de début).
  'shopify.rattrapage': ['Rattrapage des commandes Shopify lancé', 'Shopify order history catch-up started'],
  // L'interrupteur du numéro sur l'Accueil (migration 0180). La cible est l'ESPACE, jamais le numéro affiché.
  'numero.delie': ['Numéro WhatsApp délié', 'WhatsApp number unlinked'],
  'numero.relie': ['Numéro WhatsApp relié', 'WhatsApp number relinked'],
  // Déconnexion définitive : identifiants Meta et étapes seulement, jamais le numéro affiché.
  'numero.deconnecte': ['Numéro WhatsApp déconnecté de l’espace', 'WhatsApp number disconnected from the workspace'],
  // Compte & équipe : le détail est VIDE. Un nom d'espace peut porter le nom d'une personne (inscription par
  // Google) ou un numéro, et ce journal n'en garde aucun (`src/audit/store.pg.ts`).
  'espace.renomme': ['Espace renommé', 'Workspace renamed'],
  // Le second facteur des admins, au choix de l'espace (migration 0230). Le détail est vide : l'action dit le sens.
  'espace.second_facteur_exige': ['Double authentification exigée des administrateurs', 'Two-factor authentication required for administrators'],
  'espace.second_facteur_libre': ['Double authentification laissée au choix des administrateurs', 'Two-factor authentication left to administrators'],
  // La double authentification (plan du 2026-09-25). Le détail ne porte ni code ni secret, seulement l'étape
  // d'un refus (`connexion`, `activation`, `codes`, `desactivation`).
  'mfa.active': ['Double authentification activée', 'Two-factor authentication enabled'],
  'mfa.code_secours_utilise': ['Code de secours utilisé', 'Backup code used'],
  'mfa.echec': ['Code de double authentification refusé', 'Two-factor code rejected'],
  'mfa.reinitialise': ['Double authentification réinitialisée', 'Two-factor authentication reset'],
  'mfa.codes_regeneres': ['Codes de secours régénérés', 'Backup codes regenerated'],
  'mfa.desactive': ['Double authentification désactivée', 'Two-factor authentication disabled'],
  // Claude connecté par le consentement (migration 0204), et l'accès révoqué depuis la page des clés d'API. Le
  // détail porte le client et les droits, jamais un jeton ni un code.
  'oauth.autorise': ['Claude autorisé dans l’espace', 'Claude authorized in the workspace'],
  'oauth.revoque': ['Accès de Claude révoqué', 'Claude access revoked'],
  // Les accès et les portes (2026-09-16) : ces actions s'écrivaient sans libellé, et l'écran montrait leur identifiant.
  'utilisateur.invite': ['Collaborateur invité', 'Teammate invited'],
  // Un lien d'invitation neuf copié depuis Compte et équipe (2026-11-19) : la ligne dit qui l'a tiré, jamais le lien.
  'utilisateur.lien_invitation': ['Lien d’invitation copié', 'Invitation link copied'],
  'utilisateur.role_change': ['Rôle d’un collaborateur changé', 'Teammate role changed'],
  'utilisateur.desactive': ['Collaborateur désactivé', 'Teammate deactivated'],
  'utilisateur.retire': ['Collaborateur retiré de l’espace', 'Teammate removed from the workspace'],
  // Sur un compte existant seulement : une adresse inconnue n'a pas d'espace où écrire la tentative.
  'connexion.echouee': ['Connexion refusée', 'Sign-in failed'],
  'cle_api.creee': ['Clé d’API créée', 'API key created'],
  'cle_api.revoquee': ['Clé d’API révoquée', 'API key revoked'],
  'webhook.cree': ['Webhook entrant créé', 'Incoming webhook created'],
  'webhook.modifie': ['Webhook entrant modifié', 'Incoming webhook changed'],
  'webhook.supprime': ['Webhook entrant supprimé', 'Incoming webhook deleted'],
  'webhook.secret_change': ['Secret d’un webhook entrant changé', 'Incoming webhook secret changed'],
  'connecteur.cree': ['Connecteur créé', 'Connector created'],
  'connecteur.modifie': ['Connecteur modifié', 'Connector changed'],
  'connecteur.supprime': ['Connecteur supprimé', 'Connector deleted'],
  'numero.connecte': ['Numéro WhatsApp connecté', 'WhatsApp number connected'],
  'compte.relie_sans_numero': ['Compte WhatsApp relié sans numéro', 'WhatsApp account linked without a number'],
  'numero.active': ['Numéro WhatsApp activé', 'WhatsApp number activated'],
  'contact.exporte': ['Historique d’un contact exporté', 'Contact history exported'],
  // L'export CSV d'une sélection du mini-CRM (2026-11-24) : le détail porte le nombre de fiches et les colonnes cochées.
  'contacts.exportes': ['Contacts exportés en CSV', 'Contacts exported to CSV'],
  // Les publicités Click-to-WhatsApp.
  'pubs.connectee': ['Compte publicitaire connecté', 'Ad account connected'],
  'pubs.actifs_choisis': ['Compte et page publicitaires choisis', 'Ad account and page selected'],
  'pubs.deconnectee': ['Compte publicitaire déconnecté', 'Ad account disconnected'],
  // Créer reste en pause chez Meta ; publier engage le budget du client, donc les deux gestes sont tracés séparément.
  'pubs.creee': ['Publicité créée', 'Ad created'],
  'pubs.publiee': ['Publicité publiée', 'Ad published'],
  'pubs.pausee': ['Publicité mise en pause', 'Ad paused'],
  'pubs.reprise': ['Publicité relancée', 'Ad resumed'],
  'pubs.archivee': ['Publicité archivée', 'Ad archived'],
  'pubs.desarchivee': ['Publicité désarchivée', 'Ad unarchived'],
  // Écrite depuis l'exploitation (`/ops`) : l'acteur est l'adresse de l'exploitant, le détail ce qui a bougé.
  'api.limites_modifiees': ['Limites de l’API modifiées par l’exploitation', 'API limits changed by operations'],
  // Les réglages sensibles (lot 5) : jamais un mot de passe ni une clé, seulement ce qui a changé.
  'email.boite_ajoutee': ['Boîte d’envoi e-mail ajoutée', 'Email sending account added'],
  'email.boite_modifiee': ['Boîte d’envoi e-mail modifiée', 'Email sending account changed'],
  'email.boite_supprimee': ['Boîte d’envoi e-mail supprimée', 'Email sending account removed'],
  'rcs.canal_active': ['Canal RCS activé', 'RCS channel activated'],
  'rcs.canal_desactive': ['Canal RCS désactivé', 'RCS channel deactivated'],
  'ia.mention_reglee': ['Mention « je suis une IA » réglée', '“I am an AI” disclosure set'],
  'agent.modele_change': ['Modèle d’un agent IA changé', 'AI agent model changed'],
  'agent.mention_modifiee': ['Phrase de mention d’IA d’un agent modifiée', 'AI agent disclosure sentence changed'],
  // Les gestes de Messaging Me dans l'espace : l'acteur est l'adresse de l'exploitant, jamais sa note libre.
  'ops.offre_posee': ['Offre posée par Messaging Me', 'Plan set by Messaging Me'],
  'ops.scenario_duplique': ['Scénario dupliqué depuis un autre espace par Messaging Me', 'Scenario duplicated from another workspace by Messaging Me'],
  'ops.verrou': ['Espace verrouillé ou déverrouillé par Messaging Me', 'Workspace locked or unlocked by Messaging Me'],
  'ops.cle_modele_revoquee': ['Clé du modèle révoquée par Messaging Me', 'Model key revoked by Messaging Me'],
  'ops.credit_ajoute': ['Crédit IA ajouté par Messaging Me', 'AI credit added by Messaging Me'],
  'ops.pub_connectee': ['Connexion publicitaire posée par Messaging Me', 'Ads connection set by Messaging Me'],
  'ops.risque_balaye': ['Risque de désengagement recalculé par Messaging Me', 'Disengagement risk recomputed by Messaging Me'],
  'ops.espace_observe': ['Espace observé par Messaging Me (lecture seule)', 'Workspace viewed by Messaging Me (read-only)'],
  'ops.numero_rattache': ['Numéro WhatsApp rattaché par Messaging Me', 'WhatsApp number connected by Messaging Me'],
  // Le Crédit WhatsApp (plan du 2026-10-30) : le détail porte l'identifiant Meta du numéro, jamais le numéro affiché.
  'ops.ligne_credit_posee': ['Numéro passé à la ligne de crédit par Messaging Me', 'Number moved to the credit line by Messaging Me'],
  'ops.ligne_credit_retiree': ['Numéro retiré de la ligne de crédit par Messaging Me', 'Number removed from the credit line by Messaging Me'],
  // « Ne pas poser » (relecture du lot E6, jaune 5) : la ligne attendue ne viendra pas. Le détail ne porte que
  // l'identifiant Meta du numéro, jamais la note de l'exploitant, qui peut nommer le partenaire.
  'ops.attente_ligne_abandonnee': ['Attente de la ligne de crédit levée par Messaging Me', 'Credit line wait cleared by Messaging Me'],
  // La pièce reçue par un bloc Question (2026-11-02) : téléchargée par le lien qu'un Appel API de scénario a fabriqué.
  // La cible est le message, jamais le jeton ni le contact.
  'piece.telechargee': ['Pièce reçue téléchargée par un lien de scénario', 'Received attachment downloaded through a scenario link'],
  // Une écriture faite par un outil MCP, Claude Code ou demain le CSM virtuel (lot 1 du CSM virtuel, B0c). La cible est
  // l'outil ; le détail porte qui (`par` : une personne connectée ou une clé d'API) et l'écran de ce qui a été fait,
  // jamais les arguments, qui peuvent porter des données de contact.
  'mcp.ecriture': ['Écriture par un outil (Claude, MCP)', 'Write by a tool (Claude, MCP)'],
  // Le oui de mise en ligne (lot 1 du CSM virtuel, B2) : le clic d'un admin sur le bouton préparé par Claude, puis ce que
  // l'exécution a donné. La cible est la mise en ligne ; chaque action garde aussi sa propre trace (publication, répondeur).
  'mise_en_ligne.acceptee': ['Mise en ligne acceptée d’un clic', 'Go-live accepted with one click'],
  'mise_en_ligne.faite': ['Mise en ligne faite', 'Go-live done'],
  'mise_en_ligne.echouee': ['Mise en ligne arrêtée par un refus', 'Go-live stopped by a refusal'],
} as const satisfies Record<string, readonly [string, string]>;

/** Une nouvelle action doit porter ses deux libellés avant de pouvoir être écrite. */
export type AuditAction = keyof typeof CATALOGUE_ACTIONS_AUDIT;

/** Une entrée historique peut avoir un identifiant inconnu : l'écran l'affiche alors tel quel. */
export const ACTIONS_JOURNAL: Readonly<Partial<Record<string, readonly [string, string]>>> = CATALOGUE_ACTIONS_AUDIT;
