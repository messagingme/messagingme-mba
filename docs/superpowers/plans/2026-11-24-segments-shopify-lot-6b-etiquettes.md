# Segments Shopify, lot 6b : les étiquettes Shopify

Spec : `docs/superpowers/specs/2026-11-21-segments-shopify-enrichis.md`, chantier 4 « Étiquettes et segments natifs
Shopify », lot 4a (la reprise des étiquettes) ; feuille de route, lot 6. Décision de Julien du 2026-11-24 : le lot 6 se
livre en sous-lots, chacun relu et déployé : 6a les collections (en production), **6b les étiquettes**, puis les
segments Shopify (4c), puis les webhooks d'étiquettes (4b). Julien a autorisé l'enchaînement des lots ; les
recommandations de la spec valent décisions, sauf ce qu'elles laissent ouvert, tranché ci-dessous au plus simple.

## Règles

1. **Trois listes qui ne se mélangent pas** : les étiquettes Messaging Me (inchangées), les étiquettes Shopify (une
   table à part, en lecture), et plus tard les segments. La synchro ne copie JAMAIS une étiquette Shopify dans les
   étiquettes Messaging Me ; un même mot des deux côtés fait deux critères. Le seul pont : la copie explicite, « créer
   une étiquette Messaging Me avec les fiches de cette étiquette Shopify, maintenant » (un `tag_contacts` sur la cible
   du moment, sans suivi).
2. **Le lien client** : `shopify_clients` (espace, identifiant de client Shopify, fiche, vu le), rempli par les
   commandes déjà notées (`shopify_commandes.client_id`) et par la synchro ; une fiche sans identifiant passe une fois
   par son téléphone (`defaultPhoneNumber`), jamais par une adresse. On ne crée aucune fiche, on ne touche aucune fiche
   supprimée ; un client sans fiche adressable est compté puis oublié (ni téléphone ni identifiant gardé).
3. **La synchro est éteinte** tant que le marchand ne l'allume pas (réglage de la carte Shopify, ou l'outil MCP) ;
   aucun passage quotidien de toutes les boutiques. Allumée : Pro, Business et Entreprise, une reprise au plus toutes les
   24 h, plus un bouton « maintenant » ; Free : le même travail, à la demande depuis le MCP, au plus une fois par 24 h.
   Lecture par lots (`nodes(ids:)` des clients connus, 250 au plus par appel, plafond d'entrée de l'API), coût
   journalisé, frein de Shopify respecté ; les étiquettes d'une fiche sont remplacées en bloc à chaque lecture réussie.
   `read_customers` suffit (aucun droit nouveau).
4. **Le filtre** `segment_etiquette_shopify` (clé réservée, `CLES_SEGMENT`) : 1 à 20 étiquettes, mode « toutes » ou
   « l'une d'elles ». 🔴 Refusé, jamais « personne », tant qu'aucune synchro n'a abouti ; une fois lue (même à zéro
   fiche), il s'applique et la réponse porte la date (`shopify_tags_synced_at`). Une étiquette Shopify dont le texte
   ressemble à une clé réservée n'a aucun effet sur les clés : elle vit dans sa table. Borne du texte d'une étiquette :
   celle du champ `Customer.tags` de l'API `2026-10`, lue dans la doc au moment du lot (jamais devinée).
5. **RGPD** : étiquettes et liens sont des données de la fiche : ils partent avec elle (clé étrangère en cascade), avec
   `customers/redact` et avec l'effacement du branchement. Lire une étiquette ne crée aucun consentement ; la copie
   vers une étiquette Messaging Me non plus.

## Tâches

1. **Migration** : `shopify_clients`, `shopify_etiquettes` (espace, fiche, étiquette, vue le), l'état de la synchro
   par espace (allumée, dernière synchro aboutie, demande, issue, message ; jamais une colonne de `shopify_boutiques`).
   Index au prédicat exact des requêtes. Le numéro se lit par `npm run migrations` (0315 et 0316 sont à une session
   voisine, 0317 et 0318 au lot 5b) ; si `effacerBranchement` la nomme, elle est BLOQUANTE : un fichier autonome, poussé
   seul, avant le code.
2. **La synchro** (`src/shopify/etiquettes.ts`, file dans `BASE_QUEUES`) : réservation par bail et jeton (pg-boss ne
   déduplique rien), droits lus d'abord, lecture des clients par lots, rapprochement par téléphone une seule fois, la
   boutique relue avant chaque écriture, l'état écrit à la fin ; la reprise de 24 h des espaces allumés par le balayage
   existant, jamais un passage de toutes les boutiques.
3. **Le filtre** et son refus (sur le modèle de la garde des collections du lot 6a, dans `PgContactStore`), l'annonce
   dans `GET .../contacts/segments` (`etiquettesShopify` : la console ne montre le critère que si l'API l'annonce).
4. **La console** : le bloc « Étiquettes Shopify », distinct du bloc « Étiquettes », dans le volet Shopify des filtres
   et l'onglet Shopify de l'audience, avec la date de synchro et le bouton de copie explicite ; le réglage « Synchroniser
   les étiquettes » et le bouton « maintenant » sur la carte Shopify ; l'onglet Shopify de la fiche montre ses
   étiquettes Shopify.
5. **Le MCP** : `sync_shopify_customer_tags` (allume et enfile, outil d'écriture avec son `ecran`, refus codés de
   `CODES_REFUS`), `shopify_tags` dans la cible commune (bornes dans le schéma), la date dans la réponse de
   `find_contacts`, `get_shopify_state` qui dit l'état de la synchro ; les descriptions disent que ces étiquettes ne sont
   pas celles de Messaging Me et qu'une campagne à cible figée passe par `tag_contacts`.
6. **Les docs** : `features.md`, `documentation.md`, les fiches d'aide (le volet Shopify des filtres, la carte Shopify)
   en français et en anglais, leurs pages, la skill shopify et la version du plugin.

## Tests

Unitaires (la synchro sur un faux Shopify : lots, coût, frein, rapprochement par téléphone, client sans fiche, fiche
supprimée, boutique coupée ; le filtre et son refus ; le MCP), intégration sur le banc PGlite puis la CI (les tables,
l'isolation entre espaces, la cascade de la fiche, l'effacement du branchement, la réservation), e2e de la console.
Chaque garde vérifiée dans les deux sens par une mutation scriptée.

## Méthode de livraison

**Implémenteur par lot + revue humaine du DIFF**, parce que le filtre choisit l'audience des campagnes, que la
synchro appelle Shopify depuis la production et écrit sur les fiches, et que l'effacement touche la coupure et
`shop/redact` ; des invariants (isolation, refus jamais « personne », aucune copie silencieuse vers les étiquettes
Messaging Me) qu'aucun test ne voit d'un coup d'œil. Un implémenteur code, je relis le diff, UNE relecture
indépendante passe, Julien approuve le déploiement. L'essai réel qui clôt le lot : sur la boutique de développement,
une étiquette « VIP » posée sur un client chez Shopify ; la synchro allumée la lit ; le filtre « Étiquette Shopify :
VIP » retient sa fiche et elle seule ; la copie explicite crée l'étiquette Messaging Me « VIP » sur cette fiche.

## Déploiement

La migration seule (`migration=avant`) si elle est bloquante, relue en base ; puis le code (`migration=aucune`), la
console ne montrant le critère que si l'API l'annonce ; les fiches d'aide se chargent au déploiement ; le plugin après
l'API ; l'essai réel.
