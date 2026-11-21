# Plan : incidents de santé analysés, décision par Telegram

Spec : [2026-11-21-incidents-sante-design.md](../specs/2026-11-21-incidents-sante-design.md). Dépôt des incidents :
`messagingme/messagingme-incidents` (privé, créé le 2026-11-21).

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff** pour les lots 1, 3 et 4. Ils touchent des chemins que la production
emprunte (le worker qui alerte, une route publique appelée par Telegram, des secrets) et portent un invariant
invisible : aucune fuite d'instantané vers un dépôt public, et aucun clic hors de la conversation de Julien. **En
direct** pour le lot 0 (deux réglages isolés, réversibles et déjà mesurés) et pour le lot 2 (une consigne de tâche,
hors du code). L'essai réel qui clôt la feature est décrit en fin de plan : une alerte provoquée sur la SANDBOX,
suivie jusqu'au clic dans Telegram.

## Lot 0 : les deux correctifs du 2026-11-21 (issue 2, approuvés)

- `push-analysis` entre dans `FILES_VIDEES_EN_CONTINU` (`src/queue/names.ts`), et son test d'inventaire suit.
- L'alerte « entrants » juge l'ATTENTE (`started_on - start_after`) et non le bout en bout, avec un effectif minimum
  de 20 jobs sur le quart d'heure, comme la veille de réception de Meta. Le message rouge ne parle de saturation
  que si l'attente monte.
- Tests : un quart d'heure de 7 jobs dont un traitement de 20 s reste vert ; 25 jobs en attente de 40 s passent rouge.
  Chaque test est vérifié dans les deux sens.

## Lot 1 : capture de l'instantané par le serveur

- Migration : table `incidents` (id, brique, état, ouvert_le, clos_le, instantané jsonb, issue, décision,
  décidé_le). Elle part `avant`.
- Au passage orange ou rouge d'une brique ou d'une veille de charge : capture en lecture seule (files, jobs lents,
  `pg_stat_activity`, `pool_attentes`, Cockpit, imports et campagnes en cours), une par brique et par 30 minutes au
  plus. Elle n'empêche jamais l'alerte de partir. Seconde capture au retour au vert.
- Tests : échec de capture puis alerte quand même ; plafond de 30 minutes ; instantané borné en taille (65 536
  caractères au plus, la limite du déclencheur).

## Lot 2 : la tâche cloud

- Création de la tâche (claude.ai, déclencheur API seul), qui clone `messagingme-incidents` et `messagingme-mba`.
- Sa consigne : lire l'instantané du bloc de données, classer selon la typologie, écrire
  `incidents/AAAA-MM-JJ-HHMM-<brique>.md` avec UNE des quatre issues, pousser, envoyer le rapport sur Telegram. Une
  issue 3 corrige tout de suite et le dit ; une issue 2 attend un clic.
- Secret réseau : le jeton du bot Telegram, lié à `api.telegram.org`. Le jeton de déclenchement va au conteneur et
  au `.env.prod`, posé par Julien.

## Lot 3 : le réveil

- Après la capture, le worker appelle l'URL de déclenchement, une seule fois, sans nouvelle tentative en boucle.
  Il passe l'instantané comme texte, et l'identifiant de l'incident est noté.
- Désactivé tant que `INCIDENTS_DECLENCHEUR_TOKEN` est vide.

## Lot 4 : la décision par Telegram

- Boutons (Approuver, Refuser, Plus tard) sur les rapports d'issue 2.
- Route du webhook du bot : vérifie `X-Telegram-Bot-Api-Secret-Token`, n'accepte que la conversation de Julien,
  inscrit la décision sur l'incident, puis réveille la tâche avec l'incident et la décision.
- Approuver autorise jusqu'au déploiement. L'approbation de l'environnement GitHub reste, sauf décision contraire
  de Julien.
- Nouvelle route hors classe `tenant` : elle déclare sa fausse autorité dans `FAUSSES_AUTORITES` (auto-attaque).

## Déploiement

Lot 0 seul d'abord (`migration=aucune`). Les lots 1, 3 et 4 ensemble ensuite (`migration=avant`), après la revue du
diff et la CI lue job par job.

## Essai réel qui clôt la feature

Une alerte orange provoquée volontairement sur la SANDBOX, pour vérifier toute la chaîne : instantané en base,
tâche réveillée, rapport poussé dans `messagingme-incidents`, message Telegram avec boutons. Puis un clic
« Refuser », dont la décision doit apparaître dans le fichier de l'incident.
