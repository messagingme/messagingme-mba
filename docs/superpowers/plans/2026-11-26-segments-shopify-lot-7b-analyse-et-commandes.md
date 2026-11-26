# Segments Shopify, lot 7b : la dernière analyse et la dernière commande, dans le temps

Spec : `docs/superpowers/specs/2026-11-21-segments-shopify-enrichis.md`, chantier 7, lot 7b ; feuille de route, lot 7
(« ensuite l'Entreprise »). Julien a demandé d'enchaîner les lots le 2026-11-26.

Aujourd'hui, « sentiment négatif » et « au moins une commande » s'additionnent, mais rien ne dit si la commande vient
avant ou après la conversation analysée. Ce lot ajoute ce rapport, en Entreprise seulement : il croise, au moment du
filtre, deux colonnes déjà payées (`contacts.analyse_le`, `shopify_commandes.payee_le`). Aucun modèle appelé, aucune
migration, aucun crédit débité.

## Décisions

1. **Une clé de segment réservée, `segment_commande_vs_analyse`, et trois valeurs fermées** (la spec) :
   `aucune_apres` (la fiche a une analyse, et aucune commande payée après elle, qu'elle n'ait jamais commandé ou
   seulement avant), `commande_apres` (au moins une commande payée après l'analyse), `analyse_apres_commande` (au moins
   une commande, et la dernière avant l'analyse). Toute autre valeur est refusée ; une fiche sans analyse n'est dans
   aucun des trois. 🔴 **Le temps de l'analyse est son dernier message** (`analyse_fenetre_fin`), pas l'heure où le job
   l'a faite (`analyse_le`, au moins 25 minutes plus tard) : sinon la question suivie d'un achat dans la demi-heure
   serait « sans commande après », et relancée (le rouge de la relecture).
2. **Il voyage dans `fieldFilters`, opérateur `segment`**, comme les autres critères : un serveur plus ancien le
   refuse en 400 (« opérateur segment réservé »), jamais tout l'espace.
3. **Il demande une boutique ET la fonction `analyse`** : l'outil le refuse sans boutique (« aucune commande après
   l'analyse » viserait tout l'espace analysé) et sans `analyse` (lien de l'offre) ; la console ne l'offre, dans la
   section « Dernière analyse », que si l'API l'annonce (`analyseCommandes` de `GET .../contacts/segments` : une
   boutique et la fonction `analyse`). L'annonce ferme aussi la fenêtre entre le push de la console et le déploiement
   de l'API : une API plus ancienne ne l'annonce pas.
4. **Le SQL ne corrèle pas la requête principale** : une sous-requête jointe à `contacts` par l'espace, comme les autres
   critères de commandes (`id in (...)`), pour servir tous les lecteurs de `buildContactWhere` quel que soit leur alias.
5. **La dernière analyse seulement** : la fiche n'en garde qu'une ; l'outil et l'aide le disent, comme la spec.

## Tâches

1. `web/lib/partage/segments.ts` : la clé, ses valeurs, sa lecture (`lireSegment`), son nom de refus.
2. `src/crm/segments.ts` : sa clause.
3. `src/mcp/cible.ts` : `order_vs_analysis` (schéma annoncé, énumération fermée), refusé sans boutique et sans
   `analyse` ; `find_contacts` rend la date du suivi des commandes quand il est posé.
4. `web/components/ContactFilterPanel.tsx` : le choix dans la section « Dernière analyse ».
5. Tests (lecture, clause sur PGlite, outil, console), doc MCP générée, `features.md`, `documentation.md`, l'aide des
   filtres si elle les décrit.

## Tests

Unitaires : les trois valeurs et le refus du reste, le refus sans boutique et sans `analyse` dans l'outil, le schéma
annoncé ; intégration sur PGlite : les trois valeurs contre de vraies fiches (analysée sans commande, commande avant,
commande après, sans analyse, une autre fiche d'un autre espace) ; console : le choix pose et retire le critère.

## Méthode de livraison

**En direct, puis une relecture indépendante et la mutation des gardes**, parce que le lot est petit (une clé, une
clause, un contrôle, un refus d'offre, spec « S »), sans migration, mais qu'il décide une audience de campagne : une
clause fausse enverrait des messages aux mauvaises personnes. L'essai réel qui clôt le lot, sur « Messaging Me demo »
(Entreprise, boutique branchée, la fiche de Julien analysée et avec des commandes) : Contacts > Filtres, section
« Dernière analyse », chaque valeur retient ou écarte sa fiche selon les dates relues en base.
