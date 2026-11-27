# Segments Shopify enrichis, lot 7c : « a écrit », « a cliqué », « a cliqué sans jamais écrire »

Spec `docs/superpowers/specs/2026-11-21-segments-shopify-enrichis.md`, chantier 7, « Pro, léger, coût IA nul », et son
« Modèle de données ». Oublié par la feuille de route (relevé le 2026-11-26, `todo.md`) ; Julien : « Oui, code-les ».

## Le but

Dans « Achats et activité » des filtres de contacts (donc l'audience d'une campagne), et pour Claude Code, trois
critères sans modèle ni boutique, offerts dès le Pro :
- **a écrit dans les N derniers jours** : un message reçu (un appui de bouton en est un) ;
- **a cliqué un lien dans les N derniers jours** : un clic attribué sur un lien suivi ;
- **a cliqué dans les N derniers jours, sans jamais écrire** : le clic dans la fenêtre, et AUCUN message reçu connu.

« Actif » et « inactif » restent tels quels (les brouillons enregistrés les portent).

## Ce que le code impose

- Les deux dates existent depuis le lot 4 (migration 0312) : `contacts.derniere_reponse_le` et `contacts.dernier_clic_le`,
  écrites par le message entrant et le clic, sans jamais reculer, remises à vide par la purge d'une fiche. Aucune
  migration.
- Clés réservées de la spec : `segment_reponse`, `segment_clic`, `segment_clic_sans_reponse`, un nombre de jours (1 à
  `BORNES_SEGMENTS.joursMax`), lus par `lireJours` comme `actif`. 🔴 « Sans jamais écrire » est
  `derniere_reponse_le is null`, pas « pas écrit dans les N jours ». Une valeur illisible vise personne (`false`).
- 🔴 La profondeur des réponses : chaque message est noté depuis le 2026-11-23 (déploiement du lot 4) ; avant, 0312 n'a
  lu que les messages encore conservés. « Jamais écrit » veut donc dire « aucun message connu », et on le dit
  (`REPONSES_COMPLETES_DEPUIS`, `reply_complete_since` dans la réponse de l'outil, une note sous le critère dans la
  console). Les clics sont conservés 730 jours : complets depuis leur début.
- La console ne propose les trois critères que si `GET .../contacts/segments` l'annonce (`reponsesCompletesDepuis`) :
  une API plus ancienne les refuserait en 400 (l'opérateur `segment` sur une clé qu'elle ne réserve pas).
- Ils forment `CLES_REPONSE_CLIC`, à côté de `CLES_ACTIVITE` (qui lit `derniere_activite_le`), jamais dans `CLES_COMMANDES` : aucune
  boutique n'est exigée. Seuls « a écrit » et « sans jamais écrire » lisent la réponse et rendent sa profondeur.
- MCP : `replied_within_days`, `clicked_within_days`, `clicked_without_reply_days` dans la cible commune
  (`find_contacts`, `prepare_campaign`), bornes annoncées dans le schéma. La parité des critères
  (`tests/parite/criteres.ts`) les exige dès qu'ils existent côté console.

## Tests

- Unitaires : la lecture des trois valeurs (bornes, refus nommés), leurs clauses (`contact-where`), l'annonce
  (`http-import`), la lecture console de l'annonce, la traduction et les bornes MCP, la parité des critères.
- PGlite : les trois clauses contre de vraies fiches (écrit hier, écrit il y a 40 jours, cliqué sans écrire, cliqué et
  écrit il y a un an, jamais rien, une fiche d'un autre espace).
- e2e sur la build de production : les trois champs absents sans l'annonce, chacun envoie sa clé, une saisie hors bornes
  n'envoie rien.
- Mutations scriptées des clauses, de la validation, de l'annonce et de la traduction MCP.

## Déploiement

Sans migration. L'API d'abord (`migration=aucune`), la console en même temps : elle ne montre rien tant que l'API ne
l'annonce pas. La fiche d'aide part avec le workflow. Aucun plugin à publier : rien ne change sous `plugin/`, les
arguments de l'outil sont servis par l'API. Avant le déploiement, en lecture seule : aucun champ personnalisé d'un espace
ne porte déjà l'une des trois clés, que `estCleReservee` réserve désormais.

## Méthode de livraison

Implémenteur par lot et revue humaine du diff : la production emprunte ce chemin (l'audience d'une campagne marketing,
donc un envoi), la règle « une valeur fausse vise personne » est un invariant invisible, mais tout est réversible
(aucune migration) et vérifiable par des tests. Une relecture indépendante en fin de lot. L'essai réel qui clôt le lot :
sur la démo, « a cliqué sans jamais écrire » retrouve une fiche qui a cliqué un lien sans écrire, et pas celle de Julien.
