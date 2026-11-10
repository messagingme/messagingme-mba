# Relancer une fois l'événement que Meta met en échec (2026-11-10)

## Le constat, mesuré

Le 2026-11-10 à 12 h 27 (heure de Paris), sur l'espace MUTAC, le bloc « Envoyer au MBA » du scénario « devis » a confié
la conversation à l'agent de Meta et l'a prévenu de la question du client (`agent_event` `message_sans_suite`). Meta a
répondu `accepted`, puis l'a traité dix secondes et l'a mis en échec : `GET /{numéro}/agent_event/{id}` rend
`{"status":"failed","error_message":"internal_server_error"}`. Le client n'a eu aucune réponse jusqu'à son message
suivant. Notre code s'arrête au `accepted` : un échec chez Meta ne se voit nulle part.

## Ce que fait le lot

1. **Après chaque `message_sans_suite` accepté**, une tâche différée (file pg-boss neuve `agent-evenement-issue`,
   20 s plus tard) lit l'issue chez Meta (`agentEventStatut`, nouvelle méthode du client de l'agent).
2. **En vol** (`request_received`, `processing`) ou lecture en panne : relue 20 s plus tard, trois lectures au plus.
3. **`failed` sur une cause passagère** (`internal_server_error`, `agent_temporarily_unavailable`) : l'événement est
   renvoyé UNE fois, si trois gardes tiennent : le fil est toujours à l'agent (`mba` chez nous), le client n'a rien
   écrit depuis, l'agent n'a rien écrit depuis. Les deux dernières se comparent par identifiant de message, relevé à
   l'envoi (jamais par horloge). L'issue du renvoi est relue, et seulement journalisée.
4. **Toute issue se journalise** (`agent_event_issue`), brute : `sent`, `success`, `skipped` et sa raison, `failed` et
   sa cause. C'est la mesure qui manquait le 2026-10-03.

Branchement : le socle donne au contrôle du fil un client dont `agentEvent` programme la lecture ; le worker consomme
la file. Les autres événements (`reponse_hors_parcours`, `envoi_echoue`, `lien_de_test`) ne changent pas : à reprendre
s'ils montrent le même échec.

## Tests attendus

- Le module de l'issue, sur des faux : chaque statut, chaque garde, une seule relance, trois lectures au plus, un
  `accepted` sans identifiant ne programme rien, une panne de programmation ne lève pas.
- Le socle : l'`agentEvent` que reçoit le fil programme bien la lecture (vrai socle, fausse file).
- Les files : `BASE_QUEUES`, cadence, notification, rôle, consommateur du worker (`tests/queue-names.test.ts`).
- Le test de la relance vérifié dans les deux sens (la relance retirée, il rougit).

## Ordre de déploiement

Aucune migration. Une seule image : l'API et le worker partent ensemble, la file est créée au démarrage.

## Méthode de livraison

**Implémenteur par lot, puis revue humaine du diff**, parce que le lot touche un chemin que la production emprunte (la
remise d'une conversation à l'agent de Meta) et peut faire écrire l'agent deux fois à un client si une garde est fausse.
Une relecture indépendante en fin de lot, sur le diff.

Essai réel qui clôt le lot : sur MUTAC, le scénario « devis » jusqu'au bloc Question, une question, puis lire dans les
journaux du worker la ligne `agent_event_issue` de l'événement (et, s'il échoue, celle de sa relance et la réponse de
l'agent sur le téléphone).
