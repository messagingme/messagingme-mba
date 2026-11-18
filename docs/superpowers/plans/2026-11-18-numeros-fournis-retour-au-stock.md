# Le numéro fourni qui n'a jamais servi revient au stock

Constat du 2026-11-17 (espace « Zigi Arjun’s workspace ») : deux numéros sortis du stock sans jamais servir, l'un
bloqué par « Remplacer » alors qu'aucun code n'avait pu être lu, l'autre resté attribué. Julien les a remis à la main.
Les lots 1 à 5 du plan `2026-11-17-numero-fourni-application-et-essai.md` ont fermé le cas précis (l'appel de
l'application WhatsApp rendu au stock, plus de numéro gratuit pendant l'essai du Pro). Restent deux trous :

1. **« Le code n'arrive pas ? En obtenir un autre »** (`remplacerNumero`) bloque le numéro quand Meta a appelé sans
   qu'on lise le code, et quand personne n'a appelé. Bloqué, il est perdu jusqu'à un geste de Julien (et `/ops` n'a
   délibérément aucun retour au stock). C'est un jaune du lot 3 du plan du 2026-11-17, repris ici.
2. **Un numéro attribué jamais utilisé** reste à l'espace tant que sa formule le comprend (Pro payée, Business,
   Entreprise, ou un Pro en essai d'avant le lot 2) : rien ne le reprend.

Décisions de Julien (rondes de questions du 2026-11-18) :

- **Remplacer sans aucun code lu** : retour au stock. Si Meta a appelé, toujours. Si personne n'a appelé : retour au
  stock la première fois ; si le client suivant le remplace aussi sans appel, il est bloqué et Julien est prévenu (Meta
  le refuse sans doute, déjà actif sur WhatsApp ailleurs).
- **Inutilisé** : retour au stock 24 h après l'attribution, sans appel depuis 24 h.
- **Une ligne Telegram** à chaque retour automatique (remplacement ou inutilisé) et à chaque blocage au 2e échec.
- **Les numéros déjà bloqués restent bloqués.**
- **Les abonnés au numéro (3,50 €, Free ou Pro en essai) gardent le leur**, décision de construction : ils le paient, et
  le leur reprendre ne libère rien (l'abonné passe en file d'attente, `numerosDisponibles` lui garde un numéro).

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff**, un lot, une relecture indépendante à la fin : l'attribution d'un
numéro et un balayage du worker sont des chemins que la production emprunte, et le code porte des invariants invisibles
(un numéro par espace tenu par un index partiel, la purge des codes qui épargne seulement les numéros attribués, le
verrou de la ligne qui sérialise un appel entrant avec le remplacement). Les critères se prouvent par des tests
d'intégration (banc PGlite en local, Postgres de la CI), l'essai réel est écrit plus bas.

## Le lot

**Ce qui « a pu livrer un code »**, une seule définition SQL dans `src/otp/store.pg.ts`, partagée par le remplacement et
la reprise : un appel reçu depuis l'attribution, avec un code lu OU une transcription en panne (`transcription_indisponible`,
qui peut encore rendre un code au rejeu), et qui n'est pas un appel de l'application sûrement caché
(`APPEL_APPLICATION_CACHE_SQL`). `code_introuvable` ne livre rien : personne n'entend l'appel que notre central décroche.

1. **Migration 0294** : `numeros_fournis.remplace_sans_appel_le timestamptz` et `remplace_sans_appel_par uuid`
   (nulles, l'espace sans clé étrangère). Posées quand un remplacement sans aucun appel rend le numéro au stock ;
   remises à nulles quand un numéro rendu avait reçu un appel. Part en `avant` : le code neuf les lit et les écrit,
   l'ancien les ignore.
2. **`remplacerNumero`** : sous le verrou de la ligne (inchangé), quatre issues au lieu de deux.
   - un appel a pu livrer un code : bloqué (comme avant) ;
   - des appels, aucun n'a pu livrer de code : rendu au stock, marque effacée ;
   - aucun appel, pas de marque d'un autre espace : rendu au stock, marque posée ;
   - aucun appel, marque d'un autre espace et aucun appel depuis elle : bloqué, cause `sans_appel` (rendue à la route).
   Un numéro marqué s'attribue après les autres (`attribuerAvec`).
   Réserve vide sur une issue « rendu » : l'espace garde son numéro, comme aujourd'hui.
3. **La route `/numero-fourni/remplacer`** : alerte `numeroRendu` sur un numéro rendu, `numeroBloque` avec sa cause au
   2e échec. Jaune du lot 3 repris : quand rien n'a été remplacé (réserve vide, numéro gardé), le verrou d'une heure se
   relâche.
4. **`PgNumerosFournisStore.reprendreInutilises(delai)`** : les numéros `attribue` depuis 24 h, sans appel depuis 24 h,
   sans appel qui a pu livrer un code depuis l'attribution, dont l'espace n'a pas d'abonnement du numéro vivant, et
   que rien ne porte (ni compte de l'application, ni numéro de Meta aux mêmes chiffres ou aux chiffres inconnus dans
   l'espace, `vuDeMeta` et `UTILISE_AILLEURS_SQL`). Chaque numéro dans sa transaction : verrou de la ligne, puis la
   même condition relue, puis `libre`. Rend les numéros repris et leur espace.
5. **Le balayage** `src/numero/reprise-inutilises.ts`, toutes les heures dans le worker (`taches.programmer`, rôle
   principal, à côté de `abonnements-numero`) : reprend, sert l'abonné qui attend (`servirLAttente`, origine
   `inutilise`), envoie la ligne Telegram. Un échec par numéro n'arrête pas les autres.

Tests :
- intégration (`tests/integration/numeros-fournis.integration.test.ts`) : les quatre issues du remplacement, la marque
  posée puis effacée, le 2e échec bloqué ; la reprise sur chaque condition (moins de 24 h, un appel récent, un code lu,
  une transcription en panne, un abonnement vivant, un compte de l'application, un numéro de Meta relié), et un appel
  de l'application caché qui ne retient pas le numéro. Le test « remplacer : l'actuel passe en bloque » est réécrit en
  gardant ses deux cas (le blocage, la réserve vide).
- unitaires : le balayage (abonné servi, Telegram par numéro, un échec qui n'arrête pas les autres), la route (alertes,
  verrou relâché).
- chaque test neuf vu rouge sans son code, sur le banc PGlite pour l'intégration.

## Déploiement

1. **Avant** : une sonde en lecture seule (commande pour Julien) liste ce que le premier tour reprendrait.
2. Push après la CI des pairs, verdict job par job, puis l'API par le workflow avec `migration=avant` (relue en base
   après : colonne, type, nullabilité).
3. Rien côté console ni plugin : aucun texte ne parle du stock ni du blocage.

**Essai réel** :
- le premier tour du balayage après le déploiement : chaque ligne Telegram correspond à un numéro de la sonde ;
- sur un espace de test en formule Pro, obtenir un numéro puis « Le code n'arrive pas ? En obtenir un autre » sans le
  saisir chez Meta : l'ancien revient au stock (ligne Telegram, `libre` dans `/ops`), le nouveau est attribué.

## Relecture du lot

Aucun rouge. Deux jaunes visaient la décision elle-même, corrigés avant le push (la 0294 n'était pas partie) :

- **Le même client récupérait le numéro qu'il venait de rendre** (le plus ancien libre) et son propre second échec le
  bloquait, alors que la décision vise le client SUIVANT. La marque retient l'espace qui l'a posée
  (`remplace_sans_appel_par`) et ne bloque que le remplacement d'un autre espace (`MARQUE_D_UN_AUTRE_SQL`) ; un numéro
  marqué s'attribue après les autres.
- **La marque survivait à un appel** quand le numéro revenait par « Abandonner » : elle ne compte plus si un appel est
  arrivé depuis elle.

Faits avec eux : les textes (l'alerte de la reprise dit « aucun code n'a pu y être lu », pas « jamais utilisé » ;
`features.md` dit la condition des 24 h sans appel) et la limite d'un appel en cours de transcription, écrite au code.
Les autres jaunes vont au `todo.md` : la libération qui compte des appels d'avant l'attribution (`vuDeMeta`), une course
rare entre la reprise et le remplacement, et rien ne dit au client que son numéro n'est gardé que 24 h.
