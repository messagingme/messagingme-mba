# Lot 1 du CSM virtuel, lot F : simulation et déroulé (B6)

Source : le plan « Lot 1 : tout en outils » (https://claude.ai/artifact/LfwZTpZXFZ6sNALo6jsGAw), ligne B6 des briques
(« Simuler un parcours sans effet ; lire le déroulé d'un contact réel ») et étapes 3 et 6 du parcours pilote (« jouer
deux contacts fictifs, dont un qui finit chez l'équipe ; montrer les blocs exécutés, la branche prise, les effets
prévus » ; « suivre la première vraie conversation ; en cas d'échec, donner la cause et la correction »). Les lignes de
la table de parité rangées en B6 : le lien de test du brouillon, les deux journaux d'erreurs. Suit le lot E (la
recette du pilote).

## Le but

Que Claude prouve un parcours avant de le proposer à la mise en ligne, sans rien envoyer à personne, puis qu'il lise
ce qui s'est vraiment passé pour un contact et dise la cause d'un échec.

## Ce qui change

- `simulate_scenario` (lecture) : joue le brouillon (ou la version publiée) pour un contact fictif dont Claude écrit
  les réponses (un choix de menu ou de bouton par son texte, une réponse écrite, « pas de réponse »), et rend chaque
  bloc passé, la branche prise et les effets prévus (message, étiquette, champ, passage à l'équipe, agent), puis
  l'état final. Fonction PURE sur le graphe (`walk` du moteur) : elle ne reçoit aucune dépendance qui envoie, appelle
  un connecteur ou écrit, donc elle ne peut pas le faire. Le choix de la suite d'une réponse est une fonction pure de
  la simulation, tenue égale à celui de l'exécuteur par un test de parité qui joue l'exécuteur réel (ses faux de
  `tests/workflow-executor.test.ts`) pour chaque sorte de réponse : l'exécuteur, que la production emprunte à chaque
  réponse d'un contact, ne bouge pas.
- `get_scenario_test_link` : le lien de test du brouillon (le même service que la console, jeton idempotent), pour
  essayer le parcours depuis son propre téléphone avant la mise en ligne.
- `get_contact_journey` (lecture) : le déroulé d'un contact dans un scénario : ses parcours, le bloc où il en est,
  les blocs passés et leurs dates, la dernière erreur.
- `list_delivery_errors` et `list_system_errors` (lecture) : les deux journaux d'erreurs de la console, par le même
  service.
- La table de parité : les trois adresses rangées en B6 passent aux outils.

## Tests

- La simulation : le parcours du pilote joué pour deux contacts fictifs (l'un qualifié, l'autre qui finit chez
  l'équipe) rend les blocs, les branches et les effets attendus ; une réponse inconnue, une échéance sans sortie, un
  bloc que le moteur ne joue pas sont dits, pas devinés ; la fonction n'a aucune dépendance.
- La parité exécuteur et simulation : pour chaque sorte de réponse (choix de menu, bouton de template, réponse rapide,
  réponse écrite, échéance), la suite choisie par la simulation est celle que prend l'exécuteur réel, vérifiée dans
  les deux sens.
- Le déroulé et les journaux : l'espace d'un autre client ne se lit jamais (`tests/scope-tenant.test.ts`), et le
  déroulé correspond aux événements enregistrés (intégration).

## Déploiement

Aucune migration attendue (les tables des parcours et des événements existent) : `migration=aucune`. Des outils
neufs : le plugin se republie après l'API, sa version montée.

## Méthode de livraison

En direct, puis la relecture indépendante du lot avant le déploiement : aucun chemin de production ne change (des
lectures, un lien que la console sait déjà faire, une simulation pure), et l'invariant qui compte (la branche prise
pour une réponse, la même en simulation qu'en production) est tenu par le test de parité contre l'exécuteur réel, pas
par une recopie relue à l'œil. L'essai réel qui clôt le lot : sur un espace de test, le parcours du pilote simulé pour
deux contacts, essayé par le lien de test depuis un téléphone, puis son déroulé relu.
