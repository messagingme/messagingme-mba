# Agent IA : l'onglet Objectif seul, le transfert et les règles d'arrêt dans les Outils (2026-11-25)

Demande de Julien du 2026-11-24, après l'entretien de Maison Saint-Honoré : « Objectif et transferts » n'est pas clair.
Périmètre : les agents IA « Other AI agent » seulement, jamais le MBA de Meta.

## Décisions (questions fermées du 2026-11-24)

- L'onglet ne garde que l'objectif. Il s'appelle « Objectif ».
- « Quand passer la main à un humain » devient la description (« quand l'appeler ») de l'outil « Passer la main à un
  humain » (`escalader`). Aucune reprise des textes existants.
- Les règles d'arrêt (`sorties`) sortent de l'onglet : elles se règlent dans l'outil « Terminer » (« Toujours là »),
  qui EST déjà l'outil d'arrêt. Une règle reste une sortie du bloc Agent IA : aucun scénario existant ne bouge.
- Activer l'agent n'exige plus ni règle d'arrêt, ni règle de transfert, ni outil actif. Restent : l'objectif et la
  base de connaissance (et l'outil de recherche quand la base est remplie, conditionnel inchangé sur ce point).
- Pendant « Construire en parlant », l'en-tête ne montre pas les étapes de la fiche.
- L'entretien demande une règle d'arrêt comme une OPTION : « y a-t-il un cas où l'agent doit s'arrêter, sans passer la
  main ni lancer un scénario ? Par exemple s'il est insulté. »

## Le risque assumé

« Aucune reprise » coupe la consigne de transfert des agents DÉJÀ ACTIFS au déploiement du lot 2 : le prompt lit
`reglesTransfert` à chaque tour, et Audencia en a une longue. Julien l'a confirmé le 2026-11-25 (« repartir de zéro,
assumé ») : la description de l'outil « Passer la main » se réécrit à la main chez ces agents après le déploiement.

## Lots

1. **Serveur, conditions d'activation** (`src/agent/setup/lint.ts`, `gestion.ts`, MCP `activate_agent`, plugin) :
   retirer les trois manques ; revoir le conditionnel « recherche » qui dépendait de `outilsActifs > 0`.
2. **Le transfert dans l'outil** : le prompt ne lit plus `reglesTransfert` ; le point d'entretien `humain` propose la
   description de `escalader` (posé par le serveur et ACTIVÉ, comme `lire_contact`) ; `fichePatchSchema` refuse la clé
   au lieu de l'avaler ; `update_agent` (MCP), la skill de mise en service et le cas d'usage de la vitrine suivent.
3. **Les règles d'arrêt dans l'outil Terminer** : l'éditeur (`AgentSorties`) passe dans les réglages de « Terminer » ;
   le point `aboutissements` devient optionnel ; les textes qui renvoient à « l'onglet Objectif » sont réécrits.
4. **Console** : l'onglet « Objectif » seul ; l'en-tête sans étapes sur l'onglet « Construire en parlant » ; aide (trois
   fiches, FR et EN, captures), `features.md`, manuel.

## Méthode de livraison

Implémenteur par lot, puis revue humaine du diff : parce que le lot 2 change le prompt de tous les agents actifs en
production (une consigne perdue ne se voit qu'aux conversations suivantes) et que les lots 1 et 3 touchent la garde
d'activation et les sorties des scénarios, des invariants qu'aucun test d'écran ne voit. Une relecture indépendante par
lot, mutations des gardes. Essai réel qui clôt la feature : l'agent de Maison Saint-Honoré construit en parlant jusqu'à
« Enregistrer et activer », une règle « s'arrêter si le client insulte » posée depuis l'outil Terminer, puis une
conversation dans « Tester » qui passe la main et une qui s'arrête.

## Relecture du lot 1 (aucun rouge), ce qu'elle laisse aux lots suivants

- Lot 2 : le prompt promet encore « passe la main » quand l'outil de transfert n'est pas actif (`src/agent/prompt.ts`) ;
  conditionner la phrase à l'outil.
- Lot 3 : « Déclarez au moins une règle d'arrêt » (`ReglagesOutil.tsx`, `ToujoursLa.tsx`) devient l'état courant d'un
  « Terminer » actif sans règle : le dire comme une option.
- Lot 4 : les e2e qui simulent le manque « Aucun outil actif » (`agents-connecteurs.spec.ts`, `agents-construction.spec.ts`)
  se rebâtissent sur un manque réel ; la phrase « sans aucun outil actif, l'agent ne peut rien faire » de l'aide se lit
  comme une interdiction.
