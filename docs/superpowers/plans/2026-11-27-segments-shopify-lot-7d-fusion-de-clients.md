# Segments Shopify enrichis, lot 7d : deux clients fusionnés dans Shopify restent un seul client chez nous

Spec `docs/superpowers/specs/2026-11-21-segments-shopify-enrichis.md`, question 15, tranchée par Julien le 2026-11-27 :
« Demander le droit » `read_customer_merge`.

## Le but

Quand le marchand fusionne deux clients dans Shopify, le client absorbé disparaît, ses commandes passent au client gardé.
Aujourd'hui nos liens (`shopify_clients`), les étiquettes Shopify qu'ils portent (`shopify_etiquettes`) et les commandes
notées (`shopify_commandes.client_id`) gardent l'identifiant absorbé jusqu'à la relecture suivante (quotidienne en Pro).
À la fusion terminée, tout ce qui portait l'absorbé passe au gardé, tout de suite.

## Ce que la doc de Shopify fixe (lue le 2026-11-27)

- Le sujet `CUSTOMERS_MERGE` (en-tête `customers/merge`), « Triggers when two customers are merged », exige le droit
  `read_customer_merge`, sans approbation de Shopify (`WebhookSubscriptionTopic`, page des droits d'accès).
- Le corps d'exemple : `admin_graphql_api_customer_kept_id` et `admin_graphql_api_customer_deleted_id` (des GID
  `gid://shopify/Customer/<n>`), `admin_graphql_api_job_id`, `status`, `errors`. Les statuts d'une demande de fusion
  (`CustomerMergeRequestStatus`) : `REQUESTED`, `IN_PROGRESS`, `COMPLETED`, `FAILED` ; l'exemple écrit `failed`.
- 🔴 Ce que la doc NE dit PAS : à quel moment l'événement part (à la demande, à la fin, à l'échec), et si le client
  absorbé déclenche aussi `customers/delete`. La mesure sur la boutique de démo le tranche après le déploiement ; d'ici
  là, le code n'agit que sur un statut `completed` lu en toutes lettres, et journalise tout le reste (le statut, et pour
  un corps illisible le NOM de ses clés, jamais leurs valeurs).

## Ce que le code impose

- 🔴 Le droit n'entre PAS encore dans la liste proposée aux marchands (la carte de la console, `DROITS_SHOPIFY`, et le
  `shopify.app.toml` de la skill) : un droit que Shopify refuserait ferait échouer la publication de l'app de CHAQUE
  nouveau marchand, comme une ligne non vérifiée du toml au lot 6d. Il y entre après la mesure sur l'app de démo (lot
  suivant). Un test tient désormais les deux listes égales (`tests/shopify-droits-parite.test.ts`). Sans le droit, rien
  ne change : la relecture reste le filet.
- Boutique de la CONSOLE : le sujet s'abonne par l'API, comme les étiquettes en direct (lot 6d), au même moment (début
  d'une synchronisation des étiquettes, hors Free), et seulement si l'app a le droit. Jamais une boutique de Claude Code :
  ses webhooks sont dans son app, et le sujet n'y entrera qu'une fois vérifié par la CLI.
- Le traitement répond toujours 200 (un webhook de fusion n'est pas une confirmation de commande, la relecture répare).
- La fusion, dans l'espace et en une transaction (`PgEtiquettesStore.fusionnerClients`) : les liens de l'absorbé recopiés
  sur le gardé (une fiche déjà liée au gardé ne se double pas), ses étiquettes aussi, puis ses liens retirés (la cascade
  emporte ses étiquettes), et ses commandes notées passent au gardé. Un gardé égal à l'absorbé, ou un absorbé inconnu,
  ne fait rien. Rien d'un autre espace.

## Tests

- Unitaires : le corps lu (GID, statut, illisible), seul `completed` agit, toujours 200 ; l'abonnement seulement avec le
  droit, boutique de la console hors Free, jamais Claude Code ; la parité des droits console et skill.
- PGlite : la fusion contre de vraies lignes (liens, étiquettes, doublon déjà lié au gardé, commandes, un autre espace).
- Mutations scriptées du traitement, de l'abonnement et de la fusion.

## Déploiement

Sans migration, sans plugin (rien ne change sous `plugin/`). L'API (`migration=aucune`). Puis la mesure réelle : Julien
ajoute `read_customer_merge` (et `read_all_orders`, l'essai 284.16) à l'app de « Messaging Me demo » (ce qui mesure que
Shopify accepte le droit), lance « Synchroniser maintenant » (l'abonnement), fusionne deux clients de test dans Shopify ;
on lit le journal (`shopify_fusion`, ou le statut, ou les clés d'un corps illisible) et la base.

## Méthode de livraison

Implémenteur par lot et revue humaine du diff : la production emprunte ce chemin (un webhook entrant qui réécrit des
liens), le contrat de Shopify n'est pas entièrement documenté, mais tout est réversible (aucune migration) et
vérifiable par des tests et une mesure. Une relecture indépendante en fin de lot. L'essai réel qui clôt le lot : deux
clients de la boutique de démo fusionnés, la fiche du client absorbé porte ensuite le client gardé et ses étiquettes.
