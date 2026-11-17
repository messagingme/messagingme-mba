# Fiches par bloc, lot 2 : Envoi template, Question, Action, Condition, Attente

**Goal :** les fiches publiques de cinq blocs, sur le gabarit du lot 1 (une capture fléchée par geste, les règles
relevées dans le code et repliées sous leur étape), leurs paragraphes retirés de « Créer un scénario », et le texte du
panneau Attente corrigé.

**Spec :** `docs/superpowers/specs/2026-11-17-fiches-par-bloc-design.md`. **Lot précédent :**
`docs/superpowers/plans/2026-11-17-fiches-par-bloc-lot-1.md` (8166fbdbf).

## Méthode de livraison

**En direct, sans agent d'implémentation**, parce que le gabarit est validé (lot 1), que le lot se défait d'un commit
et que son seul changement de la console est un texte. Un agent relève les règles dans le code, mais chaque règle est
revérifiée à la source avant d'entrer dans une fiche, puis le lot passe une relecture. Essai réel qui clôt le lot : une
question au tchat d'aide sur chaque bloc, en production, après `aide:charger`, et les cinq pages relues en ligne.

## Contraintes

- Les règles viennent du code, avec leur `fichier:ligne` vérifié ; jamais de l'ancienne fiche seule.
- Zéro redite : chaque paragraphe de bloc de `creer-un-scenario.md` devient une ligne qui renvoie à sa fiche, et ce
  qu'il était seul à dire passe d'abord dans la fiche.
- Les rangs de la rubrique suivent la palette (`NODE_ORDER`) : Envoi template 1, Message rapide 2 (était 1),
  Question 3, Action 5, Condition 6, Attente 7 ; les trous attendent le lot 3.

## Review Focus

- Une règle écrite d'après l'ancien paragraphe sans preuve dans le code.
- Un texte de l'écran que le code contredit, recopié dans une fiche (le panneau Attente en est un).
- Une capture anglaise en français, ou une flèche posée avant le défilement du panneau.
- Les comptes de `tests/vitrine-aide.test.ts` et la `VAGUE` de `tests/aide-fiches-format.test.ts`.
- Une fiche d'un pair modifiée sur origin pendant le lot : régénérer sur l'origin du moment.

---

### Tâche 1 : le texte du panneau Attente

**Fichier :** `web/components/WorkflowConfigPanel.tsx` (bloc `wait`, mode date ou heures ouvrées).

- [ ] Dire ce qui se passe vraiment : l'éditeur avertit, et le message rapide ou le formulaire placé après ne part
  pas au réveil ; rien n'est refusé à la publication (`waitBeforeSessionMessage` n'a aucun appelant serveur).
- [ ] `npm run lint` et `npx tsc --noEmit` dans `web/`.

### Tâche 2 : les cinq fiches et leurs captures

**Fichiers :** `docs/aide/fiches/bloc-<envoi-template|question|action|condition|attente>.md` et leurs versions
`en/`, `web/e2e/captures/bloc-<…>.capture.ts`, `tests/aide-bloc-<…>.test.ts` pour chaque borne qui a une constante.

- [ ] Chaque fiche : une étape par case ou par sortie, sa capture fléchée, ses règles en lignes courtes.
- [ ] Captures en français et en anglais, relues une à une, puis `node scripts/aide/captures-webp.mjs`.
- [ ] `traduit_de` posé d'après `tests/aide-fiches-anglais.test.ts`.

### Tâche 3 : redites, rangs, outillage documenté

**Fichiers :** `docs/aide/fiches/creer-un-scenario.md`, `docs/aide/fiches/bloc-message-rapide.md` (rang 2),
`tests/aide-fiches-format.test.ts`, `tests/vitrine-aide.test.ts`, `documentation.md` (l'option `fleche` de `capturer`,
modules partagés).

- [ ] `grep` de chaque bloc dans `docs/aide/fiches/` : une ligne de renvoi, rien d'autre.
- [ ] `npm run vitrine:aide`, puis les tests `aide-`, `vitrine-`, `plan-methode`, et la suite racine entière.

### Tâche 4 : livrer

- [ ] Une relecture du lot ; publication en plomberie sur l'origin du moment, jamais pendant la CI d'un pair.
- [ ] `aide:charger` sur l'image en service (`DEPLOY.md`), clés comparées avant et après ; puis l'essai réel.
