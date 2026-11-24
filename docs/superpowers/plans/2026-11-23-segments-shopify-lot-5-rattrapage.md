# Segments Shopify, lot 5 : le rattrapage des commandes des 60 derniers jours

Spec : `docs/superpowers/specs/2026-11-21-segments-shopify-enrichis.md`, chantier 2 (« Rattrapage de l'historique »,
son lot 2a) et la feuille de route, lot 5. Décisions de Julien du 2026-11-23, posées en questions fermées : une commande
sans fiche est COMPTÉE, jamais gardée ; 60 jours pour TOUTES les offres (la Free par Claude Code, le Pro et au-dessus
aussi par un bouton de la console) ; aucun lancement au branchement, un aperçu puis un geste. Et pour le lot 7 : le Pro
remontera à 24 mois (question 4 de la spec, tranchée).

## Tâches

1. **Migration 0313** (`avant`, non bloquante : une table neuve que seul le code neuf lit) : `shopify_reprises`, une
   ligne par reprise (espace, genre `commandes`, statut `en_attente` / `en_cours` / `termine` / `refuse` / `erreur`,
   début de la fenêtre, curseur, comptes, erreur, auteur, dates, bail et jeton de garde). Un index unique partiel tient
   « une reprise vivante par espace et par genre ». Aucune donnée de personne : des comptes seulement.
2. **La lecture** : une page des commandes CRÉÉES dans la fenêtre, par l'API Admin GraphQL (la requête mesurée sur la
   boutique de développement), avec leurs lignes. Le frein `THROTTLED` de l'import des clients, son refus
   `acces_refuse` (données protégées, droit manquant), et une page trop lourde (5xx, `INTERNAL_SERVER_ERROR`) redemandée
   plus petite. Chaque commande lue se convertit en corps du webhook (`schemaCommande`) : le même numéro, la même fiche
   et les mêmes lignes que `orders/paid`. Seules les commandes payées comptent (payée, remboursée en tout ou partie).
3. **Le rattachement** : une commande DÉJÀ connue garde sa fiche et reçoit ses lignes (celles d'avant le lot 3 n'en ont
   pas) ; une commande inconnue se rattache à la fiche active de son numéro utilisable, sinon elle est comptée « sans
   fiche » ou « sans numéro utilisable », sans rien garder. Ni attribution, ni joignabilité, ni message, ni fiche créée ;
   `commandes_depuis` ne bouge pas.
4. **Le job** : une file neuve (`BASE_QUEUES`, ses tables typées, son rôle) ; un passage de 2 minutes au plus, puis la
   reprise se réenfile à son curseur ; le bail sur sa ligne, renouvelé à chaque page, jeton de garde. Boutique coupée :
   `erreur`. Refus de Shopify : `refuse`. Panne passagère : le bail se libère et pg-boss rejoue le job. Une reprise
   vivante sans passage depuis 15 minutes est dite interrompue, et close en `erreur` au lancement suivant, qui part.
5. **L'aperçu**, synchrone et borné à 25 s comme celui des clients : commandes payées lues, déjà connues, rattachables,
   sans fiche, sans numéro utilisable, et `complet` ; aucun numéro rendu.
6. **Les portes** : trois routes du module Shopify de la console (aperçu, lancement en 202 ou 409, état de la dernière
   reprise), donc Pro et au-dessus ; trois outils MCP ouverts à toutes les offres, à une personne nommée
   (`preview_shopify_order_history`, `import_shopify_order_history`, `get_shopify_order_history`), au catalogue, aux
   familles et aux textes. Le dernier rattrapage terminé se lit dans le suivi des segments, au mieux :
   `find_contacts` rend `orders_backfilled_since` quand un critère de commande est posé, et le volet des achats le dit.
7. **La console** : « Rattraper » sur la carte Shopify (aperçu, lancement, état relu toutes les 10 s tant qu'il tourne) ;
   le volet des achats dit depuis quand les commandes ont été rattrapées. L'écran tolère une API sans les routes.
8. **Doc et aide** : `features.md`, `documentation.md`, la fiche « Brancher ma boutique Shopify » (publique, français et
   anglais, `vitrine:aide`), le README du plugin régénéré, le journal, la question 4 de la spec marquée tranchée.

## Tests

- Lecture : pagination au curseur, frein, refus, page trop lourde réduite, identifiants ramenés au numérique, commandes
  non payées écartées, conversion vers `schemaCommande` (le même numéro et les mêmes lignes que le webhook).
- Rattachement : commande connue (sa fiche gardée, ses lignes posées), inconnue avec fiche, sans fiche, sans numéro
  utilisable, fiche supprimée ou anonymisée ignorée, reprise relancée sans doublon.
- Job : passage borné puis réenfilement au curseur, bail et jeton de garde, deux lancements, reprise abandonnée close,
  boutique coupée, refus.
- Intégration (Postgres) : `shopify_reprises` et son index unique, les écritures de la reprise sur les vraies tables.
- Portes : offres (console Pro, MCP toutes offres), personne nommée, sans boutique ; `orders_backfill`.
- Console : vitest des lectures, e2e de la carte (aperçu, lancement, état, API ancienne). Files : `tests/queue-names`.

## Méthode de livraison

**Implémenteur par lot + revue humaine du DIFF**, parce que le rattrapage écrit dans les commandes et leurs lignes, que
les segments et l'audience des campagnes lisent ; qu'il appelle Shopify depuis la production sur la boutique d'un
client ; et qu'il tient un worker (bail, curseur, réenfilement), des invariants qu'aucun test ne voit d'un coup d'œil.
Je code, UNE relecture indépendante passe, Julien relit le diff. L'essai réel qui clôt le lot : sur la boutique de
développement, une commande payée pendant une coupure du branchement (que le webhook n'a donc pas reçue), puis le
branchement rétabli ; l'aperçu la compte rattachable, le rattrapage lancé depuis la console finit « terminé », et
l'onglet Shopify de la fiche la montre avec ses lignes.

## Déploiement

Migration `avant` (table neuve, l'ancien code l'ignore), puis l'API et les workers. La console part au même push : sans
les routes, elle ne montre pas le bouton. La vitrine, `web/public` et le README listent les trois outils dès le push :
le déploiement de l'API suit le vert de la CI, pour garder cette fenêtre courte. Après lui : `aide:charger` (la fiche
publique « Brancher ma boutique Shopify » est retouchée), puis le plugin (README régénéré, version montée), publié à
la main par Julien.

## Suite du 2026-11-24 : le droit `read_products`

La relecture en base après le déploiement (run 45345072980) a mesuré, sur la boutique d'essai, ce qu'aucun faux ne
voyait : la requête des commandes rend ACCESS_DENIED sur `product` et `variant` des lignes, qui exigent
`read_products` (le webhook, lui, porte leurs identifiants sans ce droit). Aucune boutique ne l'avait. Décision de
Julien, en question fermée : le demander dès maintenant plutôt qu'au lot 6.

1. **Les droits lus avant toute lecture** (`lireDroitsDeLApp`, `currentAppInstallation.accessScopes`) : sans
   `read_products`, l'aperçu, le lancement et le job refusent avec la phrase qui dit comment l'ajouter, sans rien lire.
   Un champ refusé se dit par le message de Shopify, jamais par une cause devinée.
2. **`read_products` dans les deux listes de droits** : le gabarit de l'app de la skill et la liste copiable de la
   console ; la skill sait l'ajouter à une app déjà installée (portées, `app deploy`, lien d'installation).
3. **Aide** : la fiche (français et anglais), la page « Depuis Claude », la capture de l'étape 2 refaite.

Tests : les droits lus, le refus sans eux (aperçu, lancement, job), le message de Shopify rendu tel quel ; e2e de la
liste copiable. Déploiement : `migration=aucune`. Puis l'app de la boutique d'essai reçoit `read_products`, et
l'essai réel du lot reprend.
