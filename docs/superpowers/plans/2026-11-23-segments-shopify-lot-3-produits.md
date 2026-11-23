# Segments Shopify, lot 3 : les produits achetés et le réassort

Spec : `docs/superpowers/specs/2026-11-21-segments-shopify-enrichis.md`, chantier 1 (le lot 1a) et la feuille de route,
lot 3. Décisions de Julien du 2026-11-23, posées en questions fermées : les collections partent au lot 6, avec leur droit
d'accès `read_products` (du code éteint jusque-là ne s'essaierait pas) ; une carte cadeau est gardée mais écartée des
filtres produit, sa commande comptant toujours ; l'e-mail `customers/data_request` ne change pas ici (lot RGPD à part,
au backlog) ; la sixième part de la carte « Joignabilité WhatsApp », décidée au lot 2b, part avec ce lot.

## Tâches

1. **Migration 0311** (`avant`, non bloquante) : `shopify_commande_lignes`, clé `(tenant_id, commande_id, ligne_id)` ;
   `produit_id`, `variante_id`, `sku` nullables (vides ramenés à nul) ; `titre` requis et `variante_titre`, 200
   caractères ; `quantite` de 1 à 100 000 ; `carte_cadeau`. Clé étrangère `(tenant_id, commande_id)` vers
   `shopify_commandes` en cascade : la purge d'une fiche, `customers/redact` et l'effacement du branchement emportent les
   lignes. `shopify_commandes.lignes_tronquees` (défaut faux). Deux index partiels dont le prédicat est mot pour mot le
   `where` des requêtes (`produit_id`, puis `sku`, hors cartes cadeaux).
2. **Les lignes au paiement** : `schemaCommande` lit `line_items` sans jamais refuser la commande (une ligne illisible
   est écartée seule), 250 lignes au plus dans l'ordre du corps, le reste levant `lignes_tronquees`. Elles s'écrivent
   avec la commande (`lierCommande`, aux deux appels : l'attribution et la confirmation), par une écriture à part, au
   mieux : une panne se journalise, la commande reste notée, la confirmation part. Un webhook rejoué fait un upsert.
3. **Trois critères** (clés réservées de `web/lib/partage/segments.ts`, opérateur `segment`, validés par `lireSegment`,
   traduits par `clauseSegment`) : « a acheté » (1 à 20 produits ou SKU, tous exigés, fenêtre en jours facultative) ;
   « n'a pas acheté » (même forme, aucun ; refusé sans « a acheté », qui viserait presque tout l'espace) ;
   « réassort » (un produit ou un SKU, dernier achat il y a au moins et au plus N jours, exige un achat connu). Les
   cartes cadeaux n'y entrent jamais. Chaque sous-requête nomme `tenant_id = $1`.
4. **L'annonce et la recherche** : `GET .../contacts/segments` annonce `produits` ; une recherche des produits déjà vus
   dans l'espace (titre, SKU, identifiant, hors cartes cadeaux, 20 au plus) nourrit le sélecteur de la console.
5. **MCP** : `bought`, `not_bought` et `days_since_product` sur les outils de la cible commune, bornes dans le schéma ;
   `get_shopify_state` rend les produits vus les plus achetés, pour que l'assistant trouve un identifiant ou un SKU.
6. **Console** : dans le volet Shopify, « Produit acheté » (sélecteur, exclusion sur la même ligne, jamais seule) et
   « Réassort », montrés seulement si l'API annonce `produits` ; l'onglet Shopify de la fiche liste titre, variante, SKU
   et quantité sous chaque commande, et dit une commande incomplète (plus de 250 lignes). La phrase de suivi du volet ne
   le dit pas : il faudrait une lecture de plus, pour un cas que personne n'a encore vu.
7. **Carte « Joignabilité WhatsApp »** : une sixième part, « pas de message livrable » (aucun message parti pour la
   commande, ou tous en échec sans suppression de fiche) ; « en attente d'accusé » ne garde que le message parti sans
   accusé encore. La console lit aussi une réponse à cinq parts, celle d'une API plus ancienne.
8. **Doc et aide** : `features.md` (la phrase qui dit les produits non gardés), les fiches d'aide qui en dépendent
   (empreinte, et `vitrine:aide` avec l'anglais si elles sont publiques), `documentation.md`, le journal ; le catalogue
   MCP régénéré pour les schémas changés.

## Tests

- Lecture du corps : ligne illisible écartée, commande gardée ; plafond et drapeau ; vides ramenés à nul ; carte cadeau.
- Écriture : les deux chemins écrivent les lignes ; une panne des lignes ne coûte ni la commande ni la confirmation ;
  rejeu idempotent.
- Critères : chaque garde vue rouge sans elle (tous, aucun, exclusion seule refusée, réassort sans achat connu, carte
  cadeau exclue, isolation entre espaces), bornes et refus, outil MCP.
- Intégration (Postgres) : les requêtes de segment, la cascade (purge d'une fiche, effacement du branchement), les deux
  index partiels servis par leur requête, la sixième part.
- Console : vitest des lectures, e2e du volet (lignes présentes si annoncées, absentes sinon), de l'onglet et de la carte.

## Méthode de livraison

**Implémenteur par lot + revue humaine du DIFF**, parce que `orders/paid` est un chemin chaud de la production, que ces
critères choisissent l'audience d'une campagne (un critère faux envoie à la mauvaise population) et que le code porte
des invariants invisibles : un index partiel égal à son `where`, la cascade de la purge, « l'exclusion jamais seule ».
Je code, UNE relecture indépendante passe, Julien relit le diff avant le déploiement. L'essai réel qui clôt le lot :
sur la boutique de développement, une commande de deux produits dont une carte cadeau ; ses lignes arrivent avec
`product_id`, `variant_id` et `sku` (la mesure de la question 7 de la spec), l'onglet de la fiche les montre,
« a acheté » ce produit trouve la fiche, la carte cadeau ne la trouve pas, et le réassort la trouve sa fenêtre posée.

## Déploiement

Migration `avant` (le code neuf nomme la table sur `orders/paid`, l'ancien code ne la connaît pas), puis l'API et les
workers. La console part au même push : elle ne montre les critères que si l'API les annonce, et lit la carte à cinq
ou six parts.
