# Incidents de santé : capture, rapport, décision par Telegram

Décidé avec Julien le 2026-11-21, après les alertes du matin (10:33 `push-analysis`, 10:53 entrants).

## Le besoin

Chaque alerte de santé devient un incident analysé, qui finit sur UNE des quatre issues :

1. **Pas d'action**, avec la raison.
2. **Approbation demandée** pour une action précise.
3. **Correction faite d'urgence** par Claude, et dite.
4. **Problème d'archi ou de performance** : à Julien d'agir, avec des préconisations.

Le recueil des incidents doit dire, chiffres à l'appui, s'il faut changer l'archi ou la taille des workers.

## Les trois étages

### 1. Capture par le serveur, au moment de l'alerte

Quand une brique de santé ou une veille de charge passe orange ou rouge, le worker écrit une ligne `incidents` avec
un instantané pris tout de suite. Une seconde capture se fait au retour au vert, ce qui donne la durée. L'instantané
contient :

- par file : profondeur, âge du plus vieux, attente et traitement des jobs récents ;
- les jobs lents de la fenêtre, un par un ;
- `pg_stat_activity` (connexions, attentes de verrou, requêtes longues) et `pool_attentes` ;
- le processeur et la mémoire de la machine des workers (Cockpit) ;
- ce qui tournait : imports, campagnes, fichiers séjours.

Contraintes : la capture est en lecture seule, plafonnée à une par alerte et par 30 minutes, et elle ne bloque
jamais l'alerte si elle échoue. Plus aucune sonde n'est à lancer après coup.

### 2. Rapport par une routine Claude dans le cloud, RÉVEILLÉE PAR L'ALERTE

Pas de passage à heure fixe (décision de Julien) : c'est l'incident qui réveille Claude.

Vérifié dans la documentation officielle (https://code.claude.com/docs/en/routines.md), le 2026-11-21 :

- **Déclencheur API.** Une tâche cloud Claude Code a une URL `POST .../v1/claude_code/routines/{id}/fire`, protégée
  par un jeton propre à cette tâche. Ce jeton ne sait que déclencher la tâche, il ne lit rien. L'appel peut porter
  un texte libre de 65 536 caractères au plus. Pas besoin d'événement GitHub.
- **Le serveur appelle directement cette URL** quand l'instantané est figé, et lui passe l'instantané en texte. Le
  jeton est une variable du conteneur et du `.env.prod` de la machine, posée par Julien.
  ⚠️ L'appel n'a pas de clé d'idempotence : on ne le rejoue pas en boucle.
- **La routine n'a aucun accès à la production** : tout ce qu'elle sait vient de l'instantané. C'est pour ça que la
  capture du serveur doit être complète.
- **Un dépôt PRIVÉ dédié**, `messagingme-incidents` (décision de Julien) : un fichier par incident (rapport, issue,
  décision, suite). C'est le recueil qui sert à décider de l'archi. La tâche clone ce dépôt ET `messagingme-mba`, ce
  que la documentation autorise.
- **Tout au même endroit** : chaque exécution est une session à part, et toutes sont rangées dans l'historique de la
  tâche (claude.ai/code/routines). On ne peut pas poster dans une session existante.
- **Coût** : l'usage de l'abonnement, une exécution par incident, rien au repos. Elle tourne même PC éteint.
  Plafond : 30 déclenchements par heure et par tâche.
- **Secrets** : le jeton du bot Telegram va dans un « secret réseau » lié à `api.telegram.org` (il n'entre jamais
  dans la session), jamais dans les variables d'environnement, lisibles par tous.
- Elle classe l'incident selon la typologie (capacité worker, rafale métier, voisin bruyant, base, dépendance
  externe, plomberie, plateforme, faux positif), écrit le rapport dans le dépôt des incidents et l'envoie sur
  Telegram.
- À vérifier au premier essai : la documentation ne dit pas si la routine peut lancer `gh workflow run` (le
  déploiement) par la connexion GitHub. Si elle ne le peut pas, le déploiement reste un geste de Julien.

### 3. Décision par Telegram

- Un rapport d'issue 2 porte des boutons (Approuver, Refuser, Plus tard). Pas de texte libre interprété.
- Le clic arrive par le webhook du bot. La route vérifie le `secret_token` de Telegram et n'accepte que la
  conversation de Julien. La décision s'inscrit sur l'incident.
- **Approuver autorise jusqu'au déploiement** (choix de Julien) : correctif, tests, push sur `main`, CI lue job par
  job, puis `deploy-scaleway.yml`. ⚠️ L'approbation de l'environnement dans GitHub reste en place tant que Julien ne
  la retire pas : le déploiement attendra donc aussi ce clic-là.
- **Délai** : aucun. Le clic réveille la routine par le même mécanisme que l'alerte, et elle exécute la décision.
- Le résultat (commit, verdict de la CI, déploiement) revient en réponse dans Telegram.

## Premier cas : le matin du 2026-11-21

| Alerte | Cause mesurée | Issue |
|---|---|---|
| 10:33 `push-analysis` en retard | 20 jobs de 0 s, attente jusqu'à 539 s : prise un par sondage, rafale stricte `> 20` jamais engagée | 2 : mettre la file dans `FILES_VIDEES_EN_CONTINU` |
| 10:53 entrants orange 18,4 s | 22 entrants, attente 0,0 s pour tous ; un seul traitement de 20,2 s à 10:50:14. Le p95 sur 15 min n'a pas d'effectif minimum | 2 : juger l'attente et exiger un effectif minimum (faux positif) |
| Taille du worker | rien ne la met en cause | 1 |

Reste ouvert : pourquoi le retour au vert à 11:28 et pas vers 11:05.
