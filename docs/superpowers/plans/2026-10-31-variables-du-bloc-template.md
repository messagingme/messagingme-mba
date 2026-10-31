# Choisir le champ de chaque variable dans le bloc « Envoi template » (2026-10-31)

Demande de Julien : changer, dans le panneau de droite du bloc, le champ du contact qui remplit `{{1}}`. Décisions
(AskUserQuestion du 2026-10-31) : le choix vaut **pour ce bloc seulement** (le template et ses autres usages ne
changent pas, aucune revalidation Meta) ; le bloc part de la correspondance du template ; pour le premier template
d'un scénario lancé en campagne, l'étape Contenu **reprend le choix du bloc et reste modifiable**.

## Méthode de livraison

**En direct, puis une relecture indépendante en fin de lot et la revue du diff serveur par Julien avant le
déploiement de l'API** : le changement touche l'envoi d'un template par un scénario, chemin que la production
emprunte, mais il est petit, réversible (une donnée de bloc absente rend l'ancien comportement) et ses critères se
testent sur l'envoi lui-même. L'essai réel qui clôt la feature est décrit à la fin (un envoi vers le téléphone de
Julien) : aucun test ne le remplace.

## Tâches

1. **Serveur.** `node.data.variables` (sources éparses `{ position, source }`, validées par `parseParamHints`,
   illisibles = ignorées et journalisées) voyage dans l'action `sendTemplate` du moteur, puis jusqu'à
   `sendTemplate` des dépendances. À l'envoi hors campagne, chaque position prend la source du bloc, sinon celle du
   template. Le premier template d'une campagne garde ses valeurs explicites (`paramMapping`). La route HubSpot
   « Lancer un scénario (transaction) », qui remplit elle-même le modèle d'ouverture, prend aussi les choix du bloc
   (`modeleDOuverture` les rend).
2. **Console, bloc.** Le panneau remplace la liste en lecture par un sélecteur par variable (champs de base, mes
   champs, date du jour, texte fixe), le même que l'étape Contenu (composant partagé). Défaut : la source du
   template ; une position sans source affiche « Aucun champ » et l'alerte. Changer de template efface les choix.
3. **Console, campagne.** `choisirScenario` lit les sources du premier bloc template et les pose par-dessus celles
   du template dans les lignes de l'étape Contenu.

## Tests attendus

- Moteur : l'action porte les sources du bloc ; une donnée malformée n'en porte aucune.
- Envoi : une source du bloc remplace celle du template à sa position, les autres positions gardent le template ;
  une position sans aucune source refuse l'envoi. Vérifié dans les deux sens (source du bloc ignorée = rouge).
- Console : fusion template + bloc (fonction pure), et la campagne qui part des sources du bloc.

## Ordre de déploiement

Commit serveur d'abord, déploiement de l'API (approbation de Julien), PUIS le commit console : sinon, entre le push
et le déploiement, le panneau montrerait un champ que l'envoi ignorerait.

## Essai réel

Sur le scénario de `essai_proposition_tarifaire`, passer `{{1}}` de Prénom à Nom dans le bloc, lancer le test depuis
ce bloc vers le téléphone de Julien : le message reçu porte le nom, pas le prénom.
