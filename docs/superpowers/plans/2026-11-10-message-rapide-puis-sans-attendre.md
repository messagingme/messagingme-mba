# Message rapide : la sortie « Puis, sans attendre » (2026-11-10)

**Le besoin (Julien, capture du 2026-11-10).** Dès qu'un bloc « Message rapide » porte une réponse rapide, il ne se
relie plus que par ses boutons ou par « Toute autre réponse » (le contact écrit). Impossible d'enchaîner un bloc qui
part tout seul juste après le message, pendant que les boutons restent proposés.

**Les deux décisions de Julien (AskUserQuestion du 2026-11-10).**
- Derrière la sortie, seulement des blocs qui n'attendent rien : message rapide sans bouton, étiquette, champ, action,
  condition, e-mail, appel API, fonction JS. Les boutons du premier message restent actifs. La publication refuse un
  bloc qui attend sur cette suite (Question, Formulaire, message à boutons, modèle, agent IA, Attente, Assigner, RCS,
  Aller à, Envoyer au MBA).
- Sur le bloc « Message rapide » seul. Les modèles à boutons gardent leur comportement.

**Pourquoi cette règle et pas une autre.** Un parcours n'a qu'UN curseur (`run.currentNode`), et un tap revient en
`btn:<i>`, sans dire de quel message il vient. Laisser la suite prendre la main sur un bloc qui attend ferait lire un
tap sur l'ancien bouton comme une réponse au nouveau bloc, par position.

## Méthode de livraison

**Implémenteur par lot (moi, en direct, un seul lot) et UNE relecture indépendante du diff en fin de lot**, parce que
`walk` sert chaque parcours en production (un message parti ne se rappelle pas) et porte des invariants invisibles :
un seul curseur, `nextNode` qui prend la première arête, des miroirs console/moteur. Réversible sans migration : un
retour arrière ignore l'arête `ensuite` (le message attend comme aujourd'hui). L'essai réel qui clôt : sur l'espace
SANDBOX, un message rapide « Main menu » relié par « Puis, sans attendre » à un message sans bouton, publié, testé
depuis le téléphone de Julien par le lien de test : les deux messages arrivent, puis un tap sur « Main menu » suit sa
branche.

## Tâches

1. **Le nom partagé** : `SORTIE_ENSUITE = 'ensuite'` dans `web/lib/partage/sortie-ensuite.ts` (moteur et canevas).
2. **Le moteur** (`src/workflow/engine.ts`) : `passeSansAttente(node, ctx?)` ; `walk` accepte `sansAttente` (s'arrête
   AVANT un bloc qui attend) ; sur un message rapide à choix, la suite `ensuite` est parcourue en `sansAttente`, ses
   actions s'ajoutent, le repos reste `waiting` sur le message. `refusSuiteQuiAttend(graph)` : la raison du refus.
3. **La publication** (`src/http/workflows.ts`) : 422 `suite_qui_attend`, à côté de `fichier_sans_suite`.
4. **Le canevas** : la ligne « Puis, sans attendre » sous « Toute autre réponse », message rapide à boutons seulement
   (`WorkflowNode.tsx`) ; l'arête `ensuite` part quand le bloc n'a plus de bouton ou passe en bouton de lien
   (`WorkflowBuilder.tsx`, `sansSortieEnsuite`), sinon elle resterait suivie et invisible.
5. **Les mesures** (`web/lib/mesures-scenario.ts`) : `ensuite` est une sortie typée, pas un bouton « cliqué ».
6. **La doc** : `features.md` (Automatisations), la fiche `creer-un-scenario.md` et son empreinte, `documentation.md`.

## Tests attendus

- `walk` : message à boutons + suite (texte, étiquette, condition) : toutes les actions, repos `waiting` sur le message ;
  suite qui mène à une Question : la Question n'est PAS envoyée ; boucle de la suite vers le message : arrêt ; sans
  arête `ensuite` : inchangé ; texte libre et tap ne prennent jamais `ensuite` (exécuteur).
- `refusSuiteQuiAttend` : nul sans suite ou suite sans attente ; refus nommé pour chaque type qui attend, y compris
  derrière une condition.
- Route de publication : 422 `suite_qui_attend` avant `publish`.
- Canevas : la poignée existe sur un message à boutons, pas sur un modèle à boutons ; l'arête part avec le dernier bouton.
- Mesures : `ensuite` n'apparaît pas dans les choix.

## Ordre de déploiement

Un commit, sans migration. La console part au push (Vercel) : jusqu'au déploiement de l'API, une flèche « Puis, sans
attendre » se dessine et se publie sans effet (le message attend comme aujourd'hui). L'API se déploie juste après la
CI verte (`migration=aucune`), puis l'essai réel.
