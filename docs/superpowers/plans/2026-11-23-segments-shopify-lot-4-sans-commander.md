# Segments Shopify, lot 4 : « A écrit sans commander » et « A cliqué sans commander »

Spec : `docs/superpowers/specs/2026-11-21-segments-shopify-enrichis.md`, « Les deux boutons prêts », le modèle de données
du chantier 7 (les deux colonnes) et la feuille de route, lot 4. Décisions de Julien du 2026-11-23, posées en questions
fermées : la pastille compte le bouton seul, jamais croisé avec les autres filtres du panneau ; une période réglable à
côté des boutons viendra plus tard (au backlog), le lot part sans réglage.

## Tâches

1. **Migration 0312** (`avant`, BLOQUANTE : la purge d'une fiche nommera les colonnes) : `contacts.derniere_reponse_le`
   (le dernier message reçu, réaction et appui de bouton compris) et `contacts.dernier_clic_le` (le dernier clic
   attribué), nullables. Remplies par deux agrégats calculés AVANT l'`alter` (messages entrants encore conservés, clics
   attribués), par espace, sans jamais reculer, jamais sur une fiche purgée (`anonymized_at`). `lock_timeout` de 5 s.
   Poussée SEULE et déployée avant le code qui la nomme.
2. **Les écritures** : le message entrant (`noterActivite`) pose aussi `derniere_reponse_le`, le clic attribué
   (`recordClick`) `dernier_clic_le`, dans la même instruction au mieux que `derniere_activite_le`, sans reculer. La
   purge d'une fiche les remet à nul, au même endroit que `derniere_activite_le`.
3. **Deux critères** : `segment_ecrit_sans_commande` et `segment_clic_sans_commande`, valeur JSON `true` et rien
   d'autre, réservés aux espaces qui ont une boutique (`CLES_COMMANDES`). La date non nulle, et aucune ligne de
   `shopify_commandes` pour la fiche dans l'espace (une commande de test ou remboursée compte).
4. **Les pastilles** : `GET .../contacts/segments` rend `boutons` (le compte de chaque bouton seul, par
   `buildContactWhere`) quand une boutique est connue ; au mieux, une panne les omet sans faire tomber la réponse.
5. **Console** : dans le volet Shopify, donc aussi dans l'onglet Shopify de l'audience, deux boutons bascule avec leur
   pastille ; masqués sans compte ou à zéro, sauf déjà posés (un brouillon) ; leurs légendes disent « message reçu
   encore connu » et « aucune commande enregistrée depuis » la date de suivi de la boutique.
6. **MCP** : `wrote_without_order` et `clicked_without_order`, `true` seul (annoncé dans le schéma), refusés sans
   boutique ; la description de `find_contacts` les cite.
7. **Doc et aide** : `features.md`, `documentation.md`, les fiches d'aide du volet (empreintes, `vitrine:aide` et
   l'anglais pour les publiques), le journal, et la période réglable au `todo.md`.

## Tests

- Migration : l'ordre (le plafond d'attente en tête, les agrégats avant l'`alter`), les colonnes nullables ; le
  remplissage joué sur le banc PGlite (message entrant, réaction, sortant ignoré, clic attribué ou anonyme, autre
  espace, fiche purgée, date plus récente gardée).
- Écritures : le message entrant et le clic posent leur date sans reculer, un message redélivré n'écrit rien ; la purge
  les efface.
- Critères : date nulle exclue, une commande (même de test) exclut, aucune commande d'un autre espace ne compte, une
  valeur autre que `true` refusée, refus sans boutique dans le MCP ; chaque garde vue rouge sans elle.
- Pastilles : le compte du bouton seul, absent sans boutique, omis sur une panne.
- Console : vitest des lectures ; e2e des boutons (masqués à zéro, pastille, bascule envoyée à l'API, brouillon posé
  visible à zéro, API plus ancienne sans boutons).

## Méthode de livraison

**Implémenteur par lot + revue humaine du DIFF**, parce que le lot écrit sur deux chemins chauds de la production (le
message entrant du webhook Meta, le clic d'un lien suivi), touche la purge RGPD d'une fiche, et que ces boutons
choisissent l'audience d'une campagne. Je code, UNE relecture indépendante passe, Julien relit le diff avant le
déploiement du code. L'essai réel qui clôt le lot : sur un espace de test à boutique de développement, un contact qui
écrit sans avoir commandé apparaît dans « A écrit sans commander » et la pastille le compte ; un clic sur un lien suivi
le fait entrer dans « A cliqué sans commander » ; une commande sur la boutique le fait sortir des deux.

## Déploiement

En deux temps, la règle d'une migration que la purge nomme. D'abord la migration 0312 seule (avec son test et ce plan) :
CI, déploiement `migration=avant`, relecture en base (colonnes, remplissage). Ensuite le code, CI, déploiement
`migration=aucune`. La console part avec le code : elle ne montre les boutons que si l'API rend leurs comptes.
