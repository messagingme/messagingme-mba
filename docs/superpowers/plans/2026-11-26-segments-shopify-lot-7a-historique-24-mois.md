# Segments Shopify, lot 7a : le rattrapage remonte à 24 mois en Pro

Spec : `docs/superpowers/specs/2026-11-21-segments-shopify-enrichis.md`, chantier 2, lot 2b ; feuille de route, lot 7
(« d'abord le Pro »). Julien a demandé d'enchaîner les lots le 2026-11-26. Les fiches d'acheteurs (lot 5b) et leur
suppression au premier `131026` (lot 2a) sont déjà en production : ce lot n'ajoute que la profondeur.

Le rattrapage lit aujourd'hui les commandes payées créées dans les 60 derniers jours, la fenêtre que `read_orders`
ouvre. Avec `read_all_orders` (demandé dans la liste des portées depuis le lot 6a), Shopify rend tout l'historique ;
la décision de Julien du 2026-11-23 borne le Pro à 24 mois. Aucune migration : la fenêtre est déjà écrite sur la
reprise (`fenetre_debut`), et le job la relit.

## Ce que la mesure dit (2026-11-26, en lecture seule, par le vrai code)

Sur « Messaging Me demo » (branchée par la console, offre Entreprise) : l'app a `read_customers`, `read_orders`,
`read_checkouts`, `read_fulfillments` et `read_products`, PAS `read_all_orders` ; sa plus ancienne commande lisible date
du 2026-10-21 (12 commandes dans la fenêtre, aucune avant). La boutique est trop jeune pour prouver la lecture d'une
commande de plus de 60 jours : l'essai réel prouve la détection du droit et la fenêtre annoncée, pas plus.

## Décisions

1. **24 mois quand l'offre n'est pas la Free ET que l'app a `read_all_orders`** ; sinon 60 jours, et l'aperçu dit
   pourquoi pas plus : la Free (« avec l'offre Pro »), ou le droit absent (« ajoutez read_all_orders à l'app »). Le
   droit se lit déjà à l'ouverture (`lireDroitsDeLApp`), aucun appel de plus.
2. **Le job ne prétend jamais avoir lu 24 mois sans le droit** : une reprise longue (sa fenêtre commence plus de 90
   jours avant) dont l'app a perdu `read_all_orders` s'arrête en `refuse` en le disant, au lieu de finir « terminée »
   sur les seuls 60 jours que Shopify rendrait en silence.
3. **Une offre qui change en route ne change pas la fenêtre** d'une reprise lancée : elle est écrite au lancement.
4. **La console tolère une API plus ancienne** : la raison de la fenêtre est un champ facultatif de l'aperçu ; sans
   elle, l'écran dit la date comme aujourd'hui. Les textes « des 60 derniers jours » de la carte et de la fenêtre
   deviennent « depuis le … », la date venant de l'aperçu.

5. **Un contact supprimé ne renaît jamais, sur 24 mois non plus** (relecture, le seul rouge) : la trace des numéros
   effacés passe de 90 à 760 jours, au-dessus de la fenêtre longue ; et elle n'existe que depuis le soir du 2026-11-24
   (migration 0317) : dans un espace qui a purgé un contact AVANT, une commande payée avant cette date ne crée aucune
   fiche, elle se rattache seulement (`TRACE_DES_EFFACEMENTS_DEPUIS`, `purgesAvantTrace`). Mesuré le 2026-11-26, en
   lecture seule : 11 contacts purgés avant la trace, dans trois espaces (SANDBOX, AA-LUAS, MUTAC), aucun avec une
   boutique ; la règle ne coûte donc rien aujourd'hui et tient demain. La fenêtre de suppression de la console dit
   l'empreinte gardée deux ans.

## Tâches

1. `src/shopify/reprise.ts` : `debutDeFenetre(maintenant, longue)`, `FENETRE_LONGUE_MOIS = 24`, l'offre dans
   `DepsReprise` et `cablerReprise`, le droit rendu par `ouvrir`, la fenêtre et sa raison dans l'aperçu et au lancement,
   le refus du job sans le droit.
2. `web/lib/partage/reprise-shopify.ts` : `fenetre` facultatif (`longue`, `limite` : `free` ou `sans_droit`).
3. Câblage : `src/index.ts`, `src/worker.ts` (l'offre de l'espace, comme les étiquettes).
4. `src/mcp/outils-shopify.ts` : les descriptions des trois outils du rattrapage, et la fenêtre dans leurs sorties ;
   la doc générée de la console (`npm run doc:md`).
5. `web/components/ShopifyRattrapage.tsx` : les textes sans « 60 jours », la raison de la fenêtre dans l'aperçu.
6. Tests ; `features.md`, `documentation.md`, la fiche d'aide de la boutique (FR et EN, page publique), la skill
   `shopify` du plugin (version montée, publiée après l'API).

## Tests

Unitaires : la fenêtre selon l'offre et le droit (Free, Pro sans droit, Pro avec droit, Entreprise), la date à 24 mois,
le lancement qui écrit la longue fenêtre, le job qui refuse une reprise longue sans le droit et poursuit une courte,
les sorties MCP ; la console : la raison affichée, et rien sans le champ (API plus ancienne).

## Méthode de livraison

**En direct, puis une relecture indépendante et la mutation des gardes**, parce que le lot est petit et sans migration,
mais touche le rattrapage, qui crée des fiches consentantes en production : la fenêtre décide combien. L'essai réel qui
clôt le lot, sur « Messaging Me demo » : l'aperçu dit « depuis le » une date à 60 jours et la raison (le droit absent) ;
puis Julien ajoute `read_all_orders` à l'app de la boutique, publie, réinstalle, et l'aperçu dit une date à 24 mois.
