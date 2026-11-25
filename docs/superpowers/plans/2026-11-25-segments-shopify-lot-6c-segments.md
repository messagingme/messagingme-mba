# Segments Shopify, lot 6c : les segments natifs Shopify

Spec : `docs/superpowers/specs/2026-11-21-segments-shopify-enrichis.md`, chantier 4, lot 4c ; feuille de route, lot 6
(après 6a les collections, 6b et 6b bis les étiquettes, en production). Julien a autorisé l'enchaînement des lots ; les
recommandations de la spec valent décisions, ce qu'elle laisse ouvert est tranché ci-dessous au plus simple.

Mesuré le 2026-11-25 chez Shopify, en lecture seule, sur les deux boutiques branchées : 5 segments chacune (ceux que
Shopify crée), la liste pour 13 points ; les membres par `customerSegmentMembers(segmentId:, first: 1000)`, acceptés en
synchrone sur ces segments, environ 140 points demandés par page ; le numéro d'un membre
(`gid://shopify/CustomerSegmentMember/<n>`) est l'identifiant du client (5 sur 5 retrouvés comme `Customer`), et
plusieurs sont déjà reliés à une fiche par la synchronisation des étiquettes.

## Décisions

1. **Une seule synchronisation pour les étiquettes et les segments** : le même interrupteur de la carte Shopify, le même
   job, la même relecture quotidienne, le même geste « maintenant ». Le marchand choisit en plus les segments à suivre,
   20 au plus (question 11 de la spec). Tranché parce qu'un seul réglage se comprend mieux que deux, et que les segments
   réutilisent les liens client-fiche que pose la synchronisation des étiquettes.
2. **Un membre atteint les fiches de son client par ces liens** (tous ses numéros, décision « le max de numéros » du
   2026-11-25). Un membre sans fiche est compté puis oublié : aucune liste brute des membres n'est gardée.
3. **Les appartenances sont rangées par fiche** et remplacées à la fin d'une lecture COMPLÈTE du segment ; une lecture
   inachevée garde les anciennes et le segment se dit partiel. Jamais une cible rétrécie au milieu d'une lecture.
4. **Le critère `segment_segment_shopify`** : 1 à 20 segments, tous ou l'un d'eux. Refusé, jamais « personne », tant que
   le segment n'a pas été lu, s'il n'est plus suivi ou s'il a disparu chez Shopify (le refus le nomme).
5. **Aucun webhook de segment** (question 12 de la spec) : la relecture quotidienne et le geste suffisent.
6. **La requête asynchrone** (`USE_CUSTOMER_SEGMENT_MEMBERS_QUERY_CREATE_MUTATION`, segments lourds) est gérée :
   `customerSegmentMembersQueryCreate`, suivi de `done`, puis lecture par `queryId`, reprise au passage suivant.
7. La liste des segments se relit à chaque synchronisation ; un segment disparu chez Shopify perd ses membres et garde son
   nom pour le refus.

## Schéma (migration 0327, BLOQUANTE)

- `shopify_segments` : les segments lus (identifiant, nom, requête ShopifyQL gardée pour l'affichage, jamais réévaluée),
  `suivi`, `absent_le`, la dernière lecture complète (`lu_le`, nulle : critère refusé), `partiel`, les comptes (membres
  chez Shopify, fiches ici), et la lecture en cours (début, curseur de page, requête asynchrone, membres comptés).
- `shopify_segment_membres` : (espace, segment, fiche, vu le), clé étrangère vers le segment et vers la fiche, en cascade ;
  un index sur `contact_id` pour la cascade de la fiche.
- BLOQUANTE : `purgeMany` et `effacerBranchement` nomment les deux tables. Poussée SEULE, `migration=avant`, relue en
  base, avant le code.

## Tâches

1. `src/shopify/segments-lues.ts` : la liste, une page de membres (par segment ou par requête asynchrone), la création et
   le suivi de la requête asynchrone ; `fetchPublic`, Zod, le frein de Shopify, comme `etiquettes-lues.ts`.
2. `src/shopify/segments.pg.ts` : la liste écrite, le choix des segments suivis (20 au plus), une page de membres écrite
   sous le jeton de la synchronisation, la fin d'une lecture, la garde du critère, la vue.
3. `src/shopify/etiquettes.ts` : la liste relue au début, une troisième étape après les étiquettes, sous le même bail.
4. Le critère : `web/lib/partage/segments.ts`, `src/crm/contact-filters.ts`, `src/crm/segments.ts`, la garde dans
   `PgContactStore`.
5. Les routes (la liste et l'état, le choix des segments suivis), l'outil MCP (`sync_shopify_customer_tags` reçoit les
   segments à suivre, `get_shopify_state` les rend, `shopify_segments` dans les cibles).
6. La console : le bloc « Segments Shopify » des filtres (choix, mode, date, copie explicite), le choix des segments sur la
   carte Shopify.
7. La purge et l'effacement du branchement ; textes, aide, plugin, `features.md`, `documentation.md`.

## Tests

Unitaires (la lecture GraphQL et la requête asynchrone sur un faux `fetch`, le job sur le faux magasin, le critère et sa
validation), intégration sur le vrai Postgres (banc PGlite avant la CI : la migration relue, l'écriture sous jeton, le
remplacement en fin de lecture et la lecture partielle, le critère refusé puis appliqué, l'espace sur chaque requête, la
purge, l'effacement, la cascade), e2e de la console, auto-attaque ; chaque garde vérifiée dans les deux sens par mutation.

## Méthode de livraison

**Implémenteur par lot + revue humaine du DIFF**, l'implémenteur étant moi, parce que c'est un chemin que la production
emprunte (la synchronisation écrit les appartenances qui ciblent les campagnes), que la migration est bloquante, et que le
code porte des invariants invisibles (le bail partagé avec les étiquettes, le remplacement en fin de lecture, l'espace sur
chaque requête). Mutations scriptées, UNE relecture indépendante en fin de lot, Julien approuve les deux déploiements.
L'essai réel qui clôt le lot est décrit plus bas : un segment suivi sur « Messaging Me demo » retient la fiche de Julien.

## Déploiement et essai réel

1. La 0327 seule (`migration=avant`), relue en base. 2. Le code (`migration=aucune`), le vrai code joué en lecture seule ;
l'aide se charge au déploiement ; le plugin après l'API. **L'essai réel qui clôt le lot**, sur « Messaging Me demo » :
suivre « Customers who have purchased at least once » sur la carte Shopify, « Synchroniser maintenant » ; Contacts >
Filtres > Segments Shopify, ce segment retient la fiche de Julien ; « Copier en étiquette Messaging Me » la pose sur elle.
