# Segments Shopify, lot 6a : les collections, et `read_all_orders` dans les listes de droits

Spec : `docs/superpowers/specs/2026-11-21-segments-shopify-enrichis.md`, chantier 1, lot 1b (« La résolution des
collections », modèle, scopes, impact, cas limites) ; feuille de route, lot 6.

Décisions de Julien du 2026-11-24 (AskUserQuestion) : le lot 6 se livre en sous-lots successifs, chacun relu et
déployé : **6a les collections**, puis les étiquettes Shopify, les segments Shopify, les webhooks d'étiquettes. Et
**`read_all_orders` entre dans les listes de droits dès 6a** (le lot 7 s'en sert pour les 24 mois du Pro). La page
officielle des scopes (`shopify.dev/docs/api/usage/access-scopes`) : une app créée dans l'organisation du marchand n'a
besoin d'aucune approbation pour ce droit ; sous une organisation partenaire, la création de la version échoue
(`app_access` sur `scopes`) tant que Shopify ne l'a pas approuvé. Seul le rattrapage au-delà de 60 jours en a besoin :
la skill et la fiche disent alors de le retirer. `read_products` est déjà demandé (lot 5, suite).

## Tâches

1. **Migration 0314** : `shopify_produits` (espace, produit, titre borné, `collections_lues_le`,
   `collections_incompletes`, un bail de réservation) et `shopify_produit_collections` (espace, produit, collection,
   titre borné ; clé étrangère vers le produit, en cascade ; index `(tenant_id, collection_id)` pour le filtre). L'état
   de la lecture par espace (dernière issue, refus faute de droit) dans une petite table neuve, jamais une colonne de
   `shopify_boutiques`, que chaque webhook lit. Identifiants en texte numérique, comme `produit_id` des lignes : le GID
   se reconstruit pour l'appel. 🔴 Migration BLOQUANTE : `effacerBranchement` (coupure, `shop/redact`) la nomme.
2. **Les droits** : `read_all_orders` dans `DROITS_SHOPIFY` (console, étape 4 en français et en anglais) et dans le
   gabarit `shopify.app.toml` de la skill ; la section de la skill qui ajoute un droit à une app installée le nomme,
   avec le repli si la version est refusée (`app_access`, organisation partenaire) : le retirer. La fiche « Brancher ma
   boutique Shopify » (français et anglais) le dit ; la capture de l'étape 2 est refaite.
3. **La résolution** (`src/shopify/collections.ts`, file `shopify-collections` dans `BASE_QUEUES`) : un job par espace.
   Droits lus d'abord (`lireDroitsDeLApp`) : sans `read_products`, rien n'est lu, l'état le dit. Les produits vus dans
   `shopify_commande_lignes` (produit connu, hors cartes cadeaux) entrent dans `shopify_produits` ; ceux jamais lus ou
   lus il y a plus de 24 h se réservent par lot (bail, `for update skip locked` : pg-boss ne déduplique rien), se lisent
   par `nodes(ids:)` avec `collections(first: 50)`, coût journalisé comme le rattrapage ; chaque produit lu remplace ses
   collections en bloc et pose sa date ; `hasNextPage` le marque incomplet ; un produit supprimé chez Shopify est lu,
   sans collection. Enfilée par la lecture de la liste (console ou MCP) quand un produit n'a jamais été lu ou date de
   plus de 24 h. Aucun passage quotidien de toutes les boutiques, aucun appel sur le chemin du webhook.
4. **Le filtre** `segment_collection` (`CLES_SEGMENT`, `CLES_COMMANDES`) : `{ collections: 1 à 20 identifiants, jours? }`,
   « a acheté au moins un produit de CHACUNE de ces collections » (commande payée, dans la fenêtre ou depuis le début du
   suivi), telles qu'elles sont dans la boutique à la dernière lecture ; cartes cadeaux exclues. 🔴 Refusé, jamais
   « personne », si aucune lecture n'a abouti pour l'espace ou si une collection demandée n'est plus connue (avec son
   nom s'il l'est). Chaque sous-requête nomme `tenant_id = $1`.
5. **L'API** : `GET .../contacts/segments` annonce `collections: true` ; `GET .../contacts/segments/collections?q=`
   rend les collections lues (identifiant, titre, nombre de produits vus), l'état de la lecture (lue le, en cours,
   refus) et enfile une lecture si besoin.
6. **La console** (volet Shopify des filtres et onglet Shopify de l'audience, `FiltresShopify`) : « A acheté dans la
   collection », sélecteur des collections lues, fenêtre en jours, la phrase « telles qu'elles sont dans la boutique,
   lues le … », la lecture en cours, le refus faute de droit avec la phrase qui dit de l'ajouter. Montré seulement si
   l'API annonce `collections: true` ; un critère déjà posé reste visible pour être retiré.
7. **Le MCP** : `collections` dans la cible commune (`{ ids, within_days? }`, bornes dans le schéma), refus sans
   lecture aboutie ; `get_shopify_state` rend l'état de la lecture et les collections lues, et enfile une lecture si
   besoin. Descriptions en anglais : « as they are in the store at the last reading (date given) ». Skill et version du
   plugin montées, catalogue MCP régénéré.
8. **L'effacement** : `effacerBranchement` emporte le cache des collections et l'état ; test qui coupe une boutique.
9. **Les docs** : `features.md` (empreinte des fiches qui citent la section), `documentation.md`, la fiche d'aide des
   filtres Shopify et celle du branchement (français et anglais, pages de la vitrine régénérées), le journal.

## Tests

- Unitaires : la résolution sur un faux Shopify (lots, coût, `hasNextPage`, nœud nul, droits refusés, bail repris) ;
  le filtre (le SQL, le refus sans lecture, la collection inconnue) ; le MCP (schéma, bornes annoncées égales aux
  appliquées, refus) ; `queue-names`, `routes-inertes`, `scope-tenant` (la route neuve), l'inventaire des appels
  sortants si la lecture passe par un chemin neuf ; e2e de la console (le critère, la phrase, le refus, la liste des
  droits).
- Intégration, banc PGlite puis CI : la migration 0314 relue (contraintes sous leur nom, index), le filtre sur deux
  espaces (aucune fuite), la réservation (`skip locked`, bail), `effacerBranchement`.
- Chaque garde vérifiée dans les deux sens par une mutation (script, md5 avant et après).

## Méthode de livraison

**Implémenteur par lot + revue humaine du DIFF**, parce que le filtre de collection choisit l'audience des campagnes
(qui reçoit un message), que la résolution appelle Shopify depuis la production sur la boutique d'un client, et que
l'effacement touche la coupure et `shop/redact` ; des invariants (`tenant_id` sur chaque requête, index au prédicat
exact, bail de la réservation) qu'aucun test ne voit d'un coup d'œil. Un implémenteur code, je relis le diff, UNE
relecture indépendante passe, Julien approuve le déploiement. L'essai réel qui clôt le lot : sur « Messaging Me demo »,
le sélecteur montre les collections de la boutique de développement lues le jour même ; « a acheté dans la collection
X » retient le client d'une commande d'un produit de X et lui seul ; un produit ajouté à une collection chez Shopify y
entre à la lecture suivante.

## Déploiement

1. La migration 0314 poussée SEULE, `migration=avant`, relue en base (contraintes, index, cascade).
2. Le code (API, workers, console) : `migration=aucune`. La console ne montre le critère que si l'API l'annonce : pas
   de fenêtre où l'écran appelle une route absente.
3. `aide:charger`, plugin (après l'API), vitrine régénérée au push, essai réel.
4. Les boutiques déjà branchées ajoutent `read_all_orders` à leur app quand le lot 7 en aura besoin : rien ne casse
   sans lui.
