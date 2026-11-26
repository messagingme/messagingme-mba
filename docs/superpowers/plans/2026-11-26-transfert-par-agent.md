# « Quand votre équipe est joignable » réglé par agent IA

Décision de Julien (2026-11-26) : le réglage vit dans « Sécurité » > « IA » pour tout l'espace, alors que c'est le
comportement d'un agent. Il passe sur chaque agent, à côté de l'outil « Passer la main à un humain ». Les horaires
restent ceux de l'espace (« Paramètres » > « Général »).

## Méthode de livraison

Implémenteur par lot puis une relecture du diff : le chemin est emprunté par chaque tour d'agent en production (la
phrase que l'agent dit en passant la main) et il porte une migration. L'essai réel qui le clôt est décrit en fin de plan.

## Tâches

1. Migration `agents.transfert_mode` (nullable, CHECK sur les trois valeurs), en `avant` : le code l'écrit. Null = la
   valeur de l'espace, puis `always`. Aucun remplissage : un agent existant garde exactement ce qu'il disait.
2. Store et PATCH de l'agent (`transfertMode`, à `null` pour revenir à l'espace), lu par `lireContexteAgent` :
   mode de l'agent, sinon celui de l'espace, sinon `always`. Production et bac à sable lisent le même contexte.
3. MCP `set_transfer_mode` : `agent_id` facultatif. Avec, il règle cet agent ; sans, l'espace et tous ses agents,
   comme son texte l'annonce. `get_agent` rend le mode effectif de l'agent.
4. Entretien : une condition sur les heures d'ouverture au point « humain » ou dans un moment propose
   « Seulement aux heures d'ouverture » sur l'agent (ligne du diff). L'étape « Horaires » ne parle plus que des
   horaires de l'espace.
5. Console : le choix (trois boutons, mêmes textes) dans les réglages de l'outil « Passer la main » ; la carte quitte
   « Sécurité » > « IA ».
6. Aide et features : où se règle la promesse.

## Tests

Contexte (mode de l'agent, de l'espace, défaut), PATCH (valeur refusée, null), MCP avec et sans `agent_id`, ligne de
diff de l'entretien, e2e de l'écran de l'outil. Chaque test vérifié dans les deux sens.

## Déploiement

Migration `avant`, puis l'API ; la console part au push (l'écran tolère une API sans le champ).

## Essai réel

L'essai réel qui clôt le lot : un agent en « Seulement aux heures d'ouverture » hors des horaires de l'espace : « je veux un conseiller » dans
« Tester » doit dire quand l'équipe reprend, un second agent de l'espace en « À toute heure » annoncer un conseiller.
