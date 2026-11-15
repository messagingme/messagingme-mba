# Relancer sur WhatsApp les leads des formulaires Meta Ads

Date : 2026-11-15. Cadré avec Julien en deux rondes de questions. Code lu sur `origin/main` (l'arbre partagé avait
223 commits de retard). Doc Meta consultée le même jour, chaque affirmation sourcée plus bas.

## Pourquoi

Un annonceur qui diffuse des publicités à formulaire instantané (Lead Ads) sur Facebook ou Instagram récupère ses
leads dans un export CSV, ou par un CRM branché au milieu. Le lead a rempli le formulaire il y a des heures quand
quelqu'un le rappelle. Le délai de première réponse est ce qui fait la conversion d'un lead, et WhatsApp est le
canal où il répond.

Les pros le font avec HubSpot ou Salesforce entre les deux. Le petit annonceur n'a pas de CRM : c'est la cible Free.
L'accroche : « Relancez sur WhatsApp, dans la minute, les leads de vos formulaires Meta Ads. »

**Le succès** : un annonceur relie sa Page et choisit le message en une conversation avec Claude (ou dans la console),
et chaque nouveau lead reçoit son WhatsApp moins d'une minute après avoir rempli le formulaire, sans Zapier et sans
CRM.

## Ce qui existe déjà (mesuré sur `origin/main`)

- **Une seule app Meta, plusieurs configurations Facebook Login for Business** : `META_ES_CONFIG_ID` (la fenêtre de
  connexion du numéro, `src/http/embedded-signup.ts`) et `META_ADS_CONFIG_ID` (la fenêtre des Publicités,
  `src/http/pubs.ts`). Une configuration n'est que la liste des droits que la fenêtre demande ; elle se crée une fois
  dans le tableau de bord de Meta. Qui a droit à quoi se décide dans NOTRE code (`src/offres/offres.ts`).
- **Les Publicités Click-to-WhatsApp** (Entreprise) lisent déjà les Pages accordées (`MetaPubsClient.actifsAccordes`,
  `GET /me/accounts`) et stockent un jeton par espace (`src/pubs/connexion.pg.ts`). Leur déconnexion retire
  `ads_management`, `ads_read` et `pages_manage_ads` (`PERMISSIONS_PUB`, `src/meta/pubs.ts`).
- **Le webhook Meta** (`src/webhooks/receiver.ts`) vérifie la signature et met le corps brut en file, sans le lire :
  il ne distingue pas encore l'objet `page` de `whatsapp_business_account`.
- **Le patron à recopier est Shopify** (`features.md`, « Boutique Shopify ») : ouvert à toutes les offres, Free par
  Claude Code, console dès Pro ; un message (modèle) par événement, créé chez Meta et activé seul à l'approbation ;
  une ligne dans Campagnes par envoi ; consentement déclaré par le client ; limite de contacts appliquée.
- **Le lien signé d'une heure** vers une page de la console utilisable sans connexion (`/brancher#jeton`,
  `src/mcp/outils-numero.ts`) et son outil d'attente : c'est ainsi qu'un client Free, qui n'a pas la console, passe
  par une fenêtre de Meta.
- **Free n'a pas les scénarios** (`FONCTIONS_PRO` les ouvre ; `src/mcp/outils-scenarios.ts` les refuse en Free).
- **Contournement d'aujourd'hui** : Zapier ou Make poste le lead sur un webhook entrant, qui lance un scénario. Il
  marche en Pro, pas en Free (ni console, ni scénarios).

## Ce que dit Meta (doc consultée le 2026-11-15)

DIT = écrit dans la doc ; SUPPOSÉ = déduit ou source tierce ; À MESURER = à trancher par un appel réel avant le code.

1. **Webhook** (DIT) : objet `page`, champ `leadgen`, valeur `{leadgen_id, page_id, form_id, adgroup_id, ad_id,
   created_time}`, sans les réponses. Arrivée « jusqu'à quelques minutes ». Retries pendant 36 h, puis abandon ; à
   nous de dédupliquer.
   developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen
2. **Abonnement de la Page** (DIT) : `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen` avec un jeton de Page
   d'une personne qui a la tâche « Publicité » (ADVERTISE) sur la Page. `pages_manage_metadata` est requise pour les
   webhooks. Pas de notification si la Page a désactivé la plateforme d'apps.
3. **Lecture du lead** (DIT) : `GET /{leadgen-id}?fields=field_data,custom_disclaimer_responses,form_id,ad_id,created_time,is_organic`.
   `field_data` est une liste `{name, values[]}` ; les cases de consentement sont dans `custom_disclaimer_responses`.
   🔴 `leads_retrieval` DÉPEND de `ads_management`, `ads_read`, `business_management`, `pages_manage_ads`,
   `pages_read_engagement`, `pages_show_list` : la fenêtre de Meta affichera donc des droits publicitaires, même à un
   client qui ne veut que ses leads.
   developers.facebook.com/docs/permissions/reference/leads_retrieval
4. **Instagram** (DIT) : « les leads générés par la publicité appartiennent toujours à la Page Facebook ». Même
   webhook, même lecture. Le champ `platform` (fb / ig) : À MESURER (absent de la doc, présent selon des tiers).
5. **Leads Access Manager** (DIT) : sans personnalisation, tous les admins de la Page lisent les leads ; personnalisé,
   notre app doit y être autorisée par un admin du portefeuille. Diagnostic par
   `GET /{page-id}?fields=has_lead_access.user_id(...).app_id(...)`, qui rend `can_access_lead`, `failure_reason` et
   `failure_resolution`. developers.facebook.com/docs/graph-api/reference/has-lead-access/
6. **App Review** (DIT) : servir des tiers exige l'accès Advanced, permission par permission, avec un enregistrement
   d'écran (1080p, sans son) ; décision annoncée « sous une semaine ». La soumission doit porter `leads_retrieval` et
   `pages_manage_ads`.
7. **Embedded Signup v4** (DIT) : la configuration peut porter des actifs et des droits en plus ; le produit
   Click-to-WhatsApp ajoute Pages et comptes publicitaires et « relie automatiquement les numéros aux Pages
   Facebook ». Ajouter `leads_retrieval` à une configuration Embedded Signup : À MESURER (la doc ne l'interdit ni ne
   le dit).
8. **Lister les formulaires** (`GET /{page-id}/leadgen_forms`) : la référence est contradictoire, des tiers disent que
   ça marche avec un jeton de Page. À MESURER.
9. **Test** (DIT) : l'outil Lead Ads Testing Tool (developers.facebook.com/tools/lead-ads-testing) crée un lead de
   test par formulaire, avec suivi de la livraison du webhook ; il ne marche pas en mode développement.
10. **Fonction native de Meta** : l'écran de fin d'un formulaire accepte un bouton WhatsApp (DIT). Une option de
    relance par WhatsApp dans le Gestionnaire de publicités existerait (SUPPOSÉ, sources tierces). Aucune API de Meta
    n'envoie d'elle-même un modèle à un lead : la relance passe par nous.

## Décisions de Julien (2026-11-15)

1. **Toutes les offres, Free comprise.** Free par Claude Code (MCP) et l'API, console dès Pro : les deux chemins
   appliquent les mêmes règles, le dernier geste gagne (comme Shopify).
2. **Consentement déclaré, sans case** : comme Shopify, le formulaire rempli suffit, sous la responsabilité du client.
   La fiche devient consentante avec la source `meta_lead:<form_id>`. Un contact qui a dit STOP le reste et ne reçoit
   rien. Aucune case du formulaire n'est lue.
3. **Ce que reçoit le lead** : en toutes offres, un modèle par formulaire, ses variables remplies par le lead ; dès
   Pro, au choix, un scénario qui commence par un modèle. La réponse du lead va au répondeur habituel de l'espace.
4. **Un seul geste dès le lot 1, pour tout le monde** : la configuration de connexion du numéro (`META_ES_CONFIG_ID`)
   demande AUSSI les Pages et les droits des leads. Un nouveau client relie son numéro et sa Page dans la même
   fenêtre de Meta.
5. **Les espaces déjà connectés** relient leurs formulaires par une seconde fenêtre, qui RÉUTILISE la configuration
   des Publicités (`META_ADS_CONFIG_ID`), étendue des droits des leads. L'écran Publicités reste réservé à
   l'Entreprise par notre code.

**Choix pris par défaut dans cette spec, à contester à la relecture :**
- Un formulaire sans message réglé ne crée AUCUNE fiche : en Free (100 contacts), des leads non relancés mangeraient
  la limite. Ils sont seulement comptés (« reçus, non relancés »).
- Le message part tout de suite, nuit comprise (la vitesse est la promesse). Une option « attendre l'ouverture de
  l'espace » se règle par formulaire.
- Toutes les Pages accordées sont abonnées ; le message se règle par formulaire.

## Non-objectifs

- Créer ou modifier les formulaires depuis Messaging Me (ils restent dans le Gestionnaire de publicités).
- Créer les publicités à formulaire (les Publicités Click-to-WhatsApp, Entreprise, restent seules à créer des pubs).
- Lire une case de consentement (décision 2).
- Les leads organiques et ceux d'avant le branchement : seul un lead reçu après l'abonnement de la Page est relancé.
- Un connecteur CRM au milieu : le client qui a HubSpot garde son chemin (déclencheur « étape de deal »).

## Anti-objectifs (ce qui ferait échouer le chantier même s'il marche)

- 🔴 **Casser la connexion du numéro.** Elle est le chemin le plus critique du produit, et la décision 4 la touche.
  Une configuration qui demande `leads_retrieval` avant que Meta l'ait accordé en Advanced fait échouer la fenêtre
  pour TOUS les clients (l'accès Standard ne sert que les comptes qui ont un rôle sur l'app). L'ordre est donc
  imposé : App Review accordée, mesure sur une configuration de test, puis seulement la configuration de production.
- Un lead relancé deux fois (webhook redélivré, rattrapage qui repasse).
- Un « Déconnecter » des Publicités qui coupe en silence les formulaires (il retire `ads_management`, dont
  `leads_retrieval` dépend).
- Un prix de Meta ou une catégorie de modèle écrite de mémoire : la catégorie affichée est celle que Meta attribue.
- Annoncer que la Page « doit être liée au numéro WhatsApp » : la relance n'en a PAS besoin (on lit le lead par la
  Page, on envoie par le numéro). La liaison faite par Embedded Signup v4 sert les Publicités Click-to-WhatsApp.
- Le nom de l'infrastructure sous-jacente, où que ce soit.

## Le parcours

### Relier la Page

- **Nouveau client** : la fenêtre de connexion du numéro accorde aussi les Pages. Après l'échange du code, le serveur
  lit les Pages (`GET /me/accounts`), obtient le jeton de chacune et l'abonne au champ `leadgen`. Une erreur sur les
  Pages ne fait JAMAIS échouer la connexion du numéro : le numéro est connecté, les formulaires sont dits « à relier »
  avec la raison.
- **Espace déjà connecté** : « Relier mes formulaires » ouvre la fenêtre des Publicités (configuration étendue), puis
  le même abonnement. Depuis Claude Code, par un lien signé d'une heure vers `/brancher#jeton` (un mode
  `formulaires`), comme le numéro.
- **Une connexion des Pages par espace**, distincte de celle des Publicités en base (table propre), même si le jeton
  vient de la même fenêtre : chacune se coupe sans couper l'autre.
- **La déconnexion des Publicités ne retire plus `ads_management` ni `pages_manage_ads` quand les formulaires sont
  reliés**, et inversement. Seule la dernière des deux à partir retire les droits partagés.
- **Diagnostic d'accès** : pour chaque Page, `has_lead_access` ; un `can_access_lead` faux s'affiche avec la
  résolution donnée par Meta (Leads Access Manager) et le chemin dans les paramètres de l'entreprise.

### Recevoir un lead

1. Le récepteur aiguille sur `object` : `page` part sur une file propre (`lead-meta`, ajoutée à `BASE_QUEUES`), sans
   jamais entrer dans le traitement des messages WhatsApp. Zod `safeParse` sur le corps.
2. Le job retrouve l'espace par `page_id` (table des Pages reliées) et le réglage du formulaire par `form_id`. Pas de
   réglage : compter « reçu, non relancé », s'arrêter.
3. **Idempotence** : `insert ... on conflict (tenant_id, leadgen_id) do nothing` AVANT toute lecture chez Meta ; une
   seconde livraison s'arrête là.
4. Lecture du lead par Graph avec le jeton de la Page. Le téléphone (`phone_number`, ou une question de type numéro)
   est normalisé en E.164 avec le pays de l'espace par défaut ; illisible, le lead est compté « numéro illisible ».
5. Fiche créée ou retrouvée, réponses écrites dans les champs choisis, consentement déclaré (décision 2). Limite de
   contacts atteinte : rien ne part, compté, e-mail aux admins au premier refus du mois (comme Shopify).
6. Envoi du modèle (ou démarrage du scénario dès Pro) par les chemins existants, avec leurs gardes (STOP, contact
   bloqué, modèles du mois). Une ligne dans Campagnes : « Formulaire Meta · <nom du formulaire> ».
7. **Rattrapage** : toutes les 15 minutes, pour chaque formulaire réglé, `GET /{form-id}/leads` depuis le dernier lead
   vu (borné, une page). Il couvre une panne de notre côté au-delà des 36 h de retries, et une Page désabonnée. La
   même idempotence garantit qu'un lead n'est relancé qu'une fois.
8. **Les données du lead** ne sont gardées que le temps de l'envoi : le brut (`field_data`) est effacé après
   traitement, seule la fiche et la trace (`leadgen_id`, formulaire, date, issue) restent. La purge RGPD nomme la
   table (migration poussée seule, avant le code).

### Le message

- Un assistant propose un texte (« Bonjour {prénom}, merci pour votre demande sur {nom du formulaire}... »), modifiable,
  où `{prénom}` et chaque question du formulaire sont des variables, avec un aperçu WhatsApp. « Envoyer à Meta et
  activer dès l'approbation », exactement comme Shopify : un nouveau texte crée un nouveau modèle, l'ancien part
  jusqu'à l'approbation.
- Le prénom absent : remplacé par « à vous », comme Shopify.
- La catégorie affichée est celle que Meta attribue (une relance de lead sera probablement marketing, donc payante :
  à ne jamais affirmer avant la réponse de Meta).

## Les outils (MCP, API, console)

**MCP, trois outils**, et aucun pour un nouveau client : sa Page arrive avec le numéro.

| Outil | Rôle |
|---|---|
| `connect_lead_forms` | Espace déjà connecté : le lien signé `/brancher#…` (mode `formulaires`), à écrire EN ENTIER (même règle que `start_whatsapp_connection`). Déjà relié : le dit et rend l'état. |
| `get_lead_forms` | L'état complet : Pages reliées et leur accès aux leads (avec la résolution de Meta), formulaires et leurs questions, message réglé et son statut chez Meta, et les chiffres des 30 jours (reçus, relancés, réponses, non relancés par cause, délai médian lead → envoi). |
| `set_lead_form_message` | Un formulaire (ou `tous`) : le texte du message et le mapping des questions vers les champs ; dès Pro, `scenario_id` à la place ; `actif: false` arrête. |

`start_whatsapp_connection` ne gagne aucun paramètre, mais son texte d'avant le lien annonce que la fenêtre de Meta
demandera aussi la Page Facebook et des droits publicitaires, et pourquoi (« pour relancer les leads de vos
formulaires ; nous ne créons ni ne modifions aucune publicité »).

Une skill du plugin (`formulaires-meta`) enchaîne : `get_lead_forms`, au besoin `connect_lead_forms`, puis
`set_lead_form_message`, puis le test (le lead de test de Meta, lien de l'outil donné en entier).

**API publique** : `GET /v1/lead-forms` et `PUT /v1/lead-forms/{formId}/message`, mêmes règles ; un événement de
webhook sortant `lead.received` (issue comprise). Chaque route entre dans le registre OpenAPI et l'auto-attaque.

**Console** (Pro et au-delà) : **Tools > Intégrations > Formulaires Meta**, sur le modèle de la carte Shopify :
sans Page, le bouton « Relier mes formulaires » ; avec, la liste des formulaires, l'état de chacun, l'assistant du
message, les chiffres, « Couper ». Le tunnel de connexion du numéro dit, avant la fenêtre de Meta, ce qu'elle va
demander de plus.

## La doc client : ce que le client doit faire

Une fiche d'aide, deux chemins (`?ou=claude|console`), un seul gabarit, publique donc page de la vitrine
(`npm run vitrine:aide`, version `en/`). Captures tirées de l'essai réel de Julien.

**Avant** (le prérequis, dit avant le lien par Claude et par la console) :
1. Être admin de la Page Facebook, avec la tâche « Publicité ».
2. Pour les pubs diffusées sur Instagram : le compte Instagram est relié à la Page (il l'est déjà s'il y diffuse ;
   les leads arrivent par la Page).
3. Si l'entreprise a personnalisé l'accès aux prospects (Paramètres de l'entreprise, Intégrations, Accès aux
   prospects) : y autoriser notre application. `get_lead_forms` et la carte le détectent et disent quoi faire.

**Le geste** :
- Nouveau client : rien de plus, la Page se choisit dans la fenêtre de connexion du numéro.
- Déjà connecté : un lien (Claude) ou un bouton (console), puis la fenêtre de Meta, où l'on coche sa Page.

**Ensuite** : choisir le formulaire et le message, attendre l'approbation de Meta (le message s'active seul), puis
créer un lead de test avec l'outil de Meta et le voir arriver sur WhatsApp.

**Dépannage** (page à part) : aucun lead n'arrive (Page non abonnée, accès aux prospects, plateforme d'apps
désactivée sur la Page), lead reçu mais rien envoyé (pas de message réglé, modèle en attente ou refusé, limite de
contacts, numéro illisible, STOP).

## Ce que Julien fait chez Meta (avant le lot 1, bloquant)

1. **App Review** : accès Advanced pour `leads_retrieval` et `pages_manage_metadata` (vérifier dans le tableau de bord
   que `ads_management`, `pages_manage_ads`, `pages_show_list`, `pages_read_engagement` le sont déjà, ce que les
   Publicités en production laissent penser). Enregistrement d'écran tourné sur l'espace SANDBOX.
2. **Webhooks de l'app** : abonner l'objet Page, champ `leadgen`, à `https://api.messagingme.app/webhooks/meta`.
3. Après l'accord seulement : étendre la configuration des Publicités, puis créer une configuration de connexion du
   numéro de TEST, la mesurer, et alors seulement mettre à jour `META_ES_CONFIG_ID`.

## Mesures avant le code (lecture seule, sur SANDBOX)

1. Une configuration Embedded Signup v4 accepte-t-elle `leads_retrieval` et `pages_manage_metadata` ? Le jeton rendu
   (utilisateur système d'intégration) lit-il `/me/accounts` et le jeton d'une Page ?
2. `GET /{page-id}/leadgen_forms` avec ce jeton : formulaires et questions rendus ?
3. Un lead de test Instagram porte-t-il `platform` ?

Une mesure qui contredit la spec la fait revoir AVANT le plan, pas pendant.

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff** : la production emprunte la connexion du numéro, un webhook, un envoi
facturé et une migration nommée par la purge RGPD, et le code touché porte des invariants invisibles (droits Meta
partagés entre deux connexions, idempotence par `leadgen_id`).

- **Lot 0** (Julien, Meta) : App Review, abonnement des webhooks de l'app, puis les trois mesures.
- **Lot 1** (serveur) : migration (Pages reliées, réglages des formulaires, leads traités) poussée seule ;
  aiguillage du récepteur et file `lead-meta` ; lecture, fiche, envoi, rattrapage ; abonnement des Pages après
  Embedded Signup et par la fenêtre des Publicités ; déconnexions coordonnées ; les trois outils MCP, l'API et
  l'événement sortant.
- **Lot 2** (console) : la carte Formulaires Meta et le texte du tunnel, poussés APRÈS le déploiement de l'API qui
  porte leurs routes.
- **Lot 3** (doc) : la fiche et le dépannage (deux chemins, vitrine, anglais), la skill du plugin et la publication
  du plugin, `features.md`.
- **Lot 4** : la configuration de connexion du numéro de production, après la mesure 1.

**Essai réel qui clôt la fonctionnalité** : sur SANDBOX, une vraie Page, un vrai formulaire ; un lead de test de
Meta arrive sur WhatsApp au numéro d'essai en moins d'une minute, une seule fois ; puis un nouveau client relie numéro
et Page dans une seule fenêtre de Meta ; puis un lead venu d'une publicité Instagram réelle, si Julien en diffuse une.
