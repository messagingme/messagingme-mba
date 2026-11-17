# Fiches par bloc, lot 1 : le Message rapide

**Goal :** la fiche publique du bloc Message rapide, une capture fléchée par geste, ses règles relevées dans le code,
et son paragraphe retiré de « Créer un scénario ».

**Spec :** `docs/superpowers/specs/2026-11-17-fiches-par-bloc-design.md`.

## Méthode de livraison

**En direct, sans agent**, parce que le lot ne touche aucun chemin que la production emprunte (une fiche, ses captures,
l'outil de capture, la génération de la vitrine), qu'il se défait d'un commit, et que son critère est un œil : Julien
juge le rendu avant les quinze autres blocs. Essai réel qui clôt le lot : Julien regarde la page générée servie en
local, puis la page publiée et une réponse du tchat d'aide sur le Message rapide en production, après `aide:charger`.

## Contraintes

- Chaque règle de la fiche se relève dans le code (`web/lib/partage/message-rapide.ts`, `WorkflowConfigPanel.tsx`,
  `WorkflowNode.tsx`, `src/workflow/engine.ts`), jamais de mémoire.
- Aucune information de la fiche ne reste dans `creer-un-scenario.md` ni ailleurs.
- Pas de tiret cadratin ni demi-cadratin. Vouvoiement.

## Review Focus

- Une limite chiffrée de la fiche qui diverge de sa constante (texte, boutons, libellés) : un test la dérive.
- La flèche posée avant le défilement du panneau : elle pointerait à côté. Elle se pose APRÈS le défilement.
- La capture anglaise qui montre du français : chaque capture se relit dans les deux langues.
- Le port 3000 tenu par la console d'une autre session : la capture montrerait son code (`captures-aide-port-pris`).
- Les captures des autres fiches qui changeraient : la flèche est une option, désactivée par défaut.

---

### Tâche 1 : la flèche dans `capturer`

**Fichier :** `web/e2e/captures/donnees-demo.ts`.

- [ ] `capturer(page, cle, numero, locale, zone?, ou = 'haut', pointeur?, fleche = false)` : avec `fleche` et un
  `pointeur`, APRÈS le défilement, un calque `position: fixed` (SVG, couleur de la marque) entoure la boîte du pointeur
  et y pose une flèche venue du côté le plus libre de la fenêtre ; retiré juste après la photo. Le `.json` reste écrit.
- [ ] Vérification : les captures de la tâche 3, relues à l'œil, en français et en anglais.

### Tâche 2 : la rubrique « Construire un scénario »

**Fichiers :** `src/aide/fiches.ts` (`RUBRIQUES`), `scripts/vitrine/aide-pages.ts` (`NOMS_RUBRIQUES` :
« Construire un scénario » / « Build a scenario »), `scripts/vitrine/aide.ts` (`GROUPES_ACCUEIL`, groupe console,
après « Parler aux clients »), `tests/aide-fiches-format.test.ts` (`VAGUE` : `'bloc-message-rapide':
['construire-un-scenario', 1]`).

- [ ] Ajouter la rubrique, puis `npx vitest run tests/aide-fiches-format.test.ts` : rouge tant que la fiche n'existe
  pas, vert après la tâche 3.

### Tâche 3 : la fiche et ses captures

**Fichiers :** `docs/aide/fiches/bloc-message-rapide.md`, `docs/aide/fiches/en/bloc-message-rapide.md`,
`web/e2e/captures/bloc-message-rapide.capture.ts`, `tests/aide-bloc-message-rapide.test.ts`.

- [ ] En-tête : `ecran: workflows`, `source_section` et `source_empreinte` de `creer-un-scenario.md`, `publique: oui`,
  `rubrique: construire-un-scenario`, `rang: 1`, une `description`.
- [ ] Sept étapes, une capture fléchée chacune : écrire le message ; joindre un fichier ; ajouter des réponses
  rapides ; ou un bouton de lien ; relier chaque réponse ; « Toute autre réponse » ; « Puis, sans attendre ». Sous
  chaque étape, ses règles en lignes `- ` courtes.
- [ ] Test `tests/aide-bloc-message-rapide.test.ts` : la fiche française porte les valeurs de `TEXTE_MAX_SIMPLE`,
  `TEXTE_MAX_AVEC_FICHIER_OU_BOUTON`, `MAX_REPONSES_RAPIDES` et `MAX_TEXTE_REPONSE_RAPIDE`, écrites à la française
  (`4 096`, `1 024`, `trois`, `20`). Vérifié dans les deux sens (une constante changée le rend rouge).
- [ ] Scénario de capture sur `/workflows?open=wf1` (simulations de `workflow-puis-sans-attendre.spec.ts`, données de
  `donnees-demo.ts`), en français et en anglais, puis `node scripts/aide/captures-webp.mjs`.
- [ ] Version anglaise traduite, `traduit_de` posé d'après le test.

### Tâche 4 : retirer la redite

**Fichier :** `docs/aide/fiches/creer-un-scenario.md`.

- [ ] Le paragraphe « Message rapide » devient une ligne qui renvoie à la fiche du bloc ; rien de ce qu'elle dit n'y
  reste. `npx vitest run tests/aide-proposer.test.ts` vert.

### Tâche 5 : générer, montrer, livrer

- [ ] `npm run vitrine:aide`, puis la suite racine entière, `npm run typecheck`, `npm run lint`.
- [ ] Page servie en local et montrée à Julien ; ses retours appliqués.
- [ ] Une relecture du lot, puis publication sur `origin/main` en plomberie, sans pousser pendant la CI d'un pair.
- [ ] `aide:charger` en production pour le tchat d'aide (`DEPLOY.md`), puis l'essai réel.
