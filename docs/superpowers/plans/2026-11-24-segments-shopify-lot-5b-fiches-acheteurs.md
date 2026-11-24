# Segments Shopify, lot 5b : « Rattraper » fait entrer les acheteurs

Spec : `docs/superpowers/specs/2026-11-21-segments-shopify-enrichis.md`, chantier 2 (le rattrapage) et la partie
« fiches d'acheteurs » du lot 7 de la feuille de route, avancée ici. Plan du lot 5 :
`docs/superpowers/plans/2026-11-23-segments-shopify-lot-5-rattrapage.md`.

Décision de Julien du 2026-11-24, après le premier rattrapage réel de Maison Saint-Honoré (39 commandes, 4 fiches
dans l'espace, 34 acheteurs au numéro utilisable sans fiche, rien de gardé) : « Rattraper » doit IMPORTER les acheteurs
avec ce qu'ils ont acheté, sauf ceux sans téléphone portable ; l'attestation de la boutique (ses clients consentent à
recevoir ses messages WhatsApp, la case du branchement, `shopify_attestations`) vaut consentement, on ne vérifie rien
de plus client par client. Elle remplace l'arbitrage du 2026-11-23 (« une commande sans fiche est comptée, jamais
gardée »).

## Règles (validées par Julien le 2026-11-24)

1. Chaque commande payée de la fenêtre dont l'acheteur a un **mobile utilisable** (la règle du numéro du lot 2a :
   fixe sauté, candidat suivant essayé) entre : sa fiche est créée si aucune fiche vivante ne porte ce numéro, puis la
   commande et ses lignes s'y rattachent. Une fiche existante reçoit la commande comme au lot 5. Sans mobile
   utilisable : comptée, jamais gardée.
2. Sous l'**attestation en vigueur**, la fiche est créée avec l'accord, la même étiquette « Shopify » et la même trace
   de consentement que l'import des abonnés. Sans attestation en vigueur, l'aperçu et le lancement refusent avec la
   phrase qui dit de la cocher (comme les automations).
3. Le **plafond de contacts de l'offre** n'est jamais dépassé : au-delà, comptée « non créée (plafond de l'offre) ».
4. Une fiche ainsi créée et jamais écrite est **supprimée au premier `131026`**, la règle des fiches nées d'un envoi
   Shopify (lot 2a), sans boucle de recréation.
5. Invariants inchangés : un numéro qui a dit STOP n'est jamais réabonné ; une fiche supprimée par le marchand n'est
   pas recréée en silence ; aucune fiche d'un autre espace n'est touchée ; deux commandes du même numéro donnent une
   seule fiche, même dans une page.
6. L'aperçu annonce « N fiches à créer » (et ce que le plafond empêcherait) ; le résultat, « N fiches créées ». Toutes
   les offres, comme le rattrapage : la console pour le Pro, les outils MCP pour tous.

## Tâches

1. Le rattachement (`src/shopify/reprise.ts`, `rattacher`) crée les fiches manquantes par le même chemin que l'import
   des abonnés (consentement, étiquette, plafond, STOP), dans la même transaction que la commande et ses lignes.
2. La lecture GraphQL des commandes rend ce qu'il faut pour la fiche (nom du client) ; les comptes de la reprise
   gagnent les fiches créées et celles que le plafond a empêchées (colonnes de `shopify_reprises` si nécessaire :
   migration à juger selon la règle « l'ancien code survit-il ? »).
3. La garde de l'attestation à l'aperçu, au lancement et au job.
4. La console (carte « Rattraper », aperçu, résultat), les outils MCP (aperçu, lancement, état), la skill shopify.
5. Les docs : `features.md`, `documentation.md`, la fiche « Brancher ma boutique Shopify » (français et anglais) et ses
   pages, le plugin (version montée).

## Tests

Unitaires sur les faux du lot 5 (création, numéro déjà porté, deux commandes du même numéro dans une page, fixe sauté,
STOP, fiche supprimée, plafond, attestation absente), intégration sur le banc PGlite puis la CI (la création réelle,
l'unicité par numéro, l'isolation entre espaces, la suppression au premier `131026`), e2e de la carte. Chaque garde
vérifiée dans les deux sens par une mutation scriptée.

## Méthode de livraison

**Implémenteur par lot + revue humaine du DIFF**, parce que le lot crée des fiches avec un consentement que les
campagnes marketing liront, sur le chemin d'un job qui écrit en production, avec des invariants (STOP, plafond de
l'offre, unicité par numéro, suppression au premier `131026`) qu'aucun test ne voit d'un coup d'œil. Un implémenteur
code, je relis le diff, UNE relecture indépendante passe, Julien approuve le déploiement. L'essai réel qui clôt le
lot : « Rattraper » sur Maison Saint-Honoré annonce les fiches à créer, les crée, et la fiche d'un acheteur montre sa
commande et ses produits ; relancé, il ne crée rien de plus.

## Déploiement

Selon la migration éventuelle (comptes de la reprise) : `avant` si le code neuf l'écrit, l'ancien code l'ignorant.
Puis l'API et les workers, la console, `aide:charger`, le plugin après l'API, l'essai réel.
