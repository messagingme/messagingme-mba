# Fiches par bloc, lot 3 : les dix derniers blocs, et « Créer un scénario » publique

**Goal :** les fiches publiques des dix blocs restants sur le gabarit des lots 1 et 2, « Créer un scénario » refaite en
étapes fléchées et rendue publique avec son lien « Comment faire » sur l'écran Scénario, et chaque passage d'un bloc
retiré des fiches qui le racontaient.

**Spec :** `docs/superpowers/specs/2026-11-17-fiches-par-bloc-design.md`. **Lots précédents :** 8166fbdbf, e6b63112c.

## Méthode de livraison

**En direct, sans agent d'implémentation**, parce que le gabarit est validé par deux lots, que le lot se défait d'un
commit et que la console ne change que si un texte de l'écran ment. Deux agents relèvent les règles des dix blocs,
chaque règle est revérifiée à la source avant d'entrer dans une fiche, puis le lot passe UNE relecture. Essai réel qui
clôt le lot : sur l'écran Scénario en production, le lien « Comment faire » ouvre « Créer un scénario », qui mène à
chaque bloc ; et une question au tchat d'aide sur un bloc du lot.

## Contraintes

- Les règles viennent du code, `fichier:ligne` vérifié ; un texte de l'écran que le code dément se corrige dans le lot,
  en cherchant d'abord chaque phrase de l'ancien texte dans `web/e2e` (absences comprises).
- Zéro redite : les paragraphes des blocs de `creer-un-scenario.md`, et ce que `creer-un-formulaire-whatsapp.md`,
  `envoyer-un-e-mail-depuis-un-scenario.md`, `envoyer-un-message-rcs.md`, `construire-un-agent-ia.md` et
  `le-repondeur-de-meta.md` disent d'un bloc, partent dans la fiche du bloc ; il en reste une ligne de renvoi.
- Rangs de la rubrique : `creer-un-scenario` en tête, puis l'ordre de la palette (`NODE_ORDER`), puis les blocs
  présentés à part (RCS, mail, agent IA, appel API, extraction JSON).
- Le tchat d'aide ne se charge jamais en dessous de la révision du dernier chargement d'un pair.

## Review Focus

- Une règle tirée d'une fiche existante sans preuve dans le code.
- Un passage d'un bloc resté dans une autre fiche (redite), ou une information perdue en le retirant.
- Une capture d'un bloc grisé dans la palette, faute de la bonne simulation (`/settings`, boîte SMTP, agent RCS).
- La version anglaise de `creer-un-scenario`, neuve, et les comptes de `tests/vitrine-aide.test.ts`.
- `COMMENT_FAIRE` de `tests/aide-fiches-format.test.ts` et `web/lib/aide-pages.ts`, régénéré, qui gagne `workflows`.

---

### Tâche 1 : les dix fiches

**Fichiers :** `docs/aide/fiches/bloc-<formulaire|assigner|envoyer-au-mba|aller-a|fonction-js|message-rcs|envoi-de-mail|
agent-ia|appel-api|extraire-du-json>.md`, leurs versions `en/`, `web/e2e/captures/bloc-<…>.capture.ts`,
`tests/aide-blocs-bornes.test.ts` (une ligne par borne qui a une constante).

- [ ] Une étape par case ou par sortie, sa capture fléchée, ses règles en lignes courtes.
- [ ] Captures relues une à une dans les deux langues, puis `node scripts/aide/captures-webp.mjs`.

### Tâche 2 : « Créer un scénario » publique

**Fichiers :** `docs/aide/fiches/creer-un-scenario.md` et `en/creer-un-scenario.md` (neuve),
`web/e2e/captures/creer-un-scenario.capture.ts`, `tests/aide-fiches-format.test.ts` (`VAGUE`, `COMMENT_FAIRE`).

- [ ] En étapes fléchées : créer, poser un bloc, relier, essayer, mettre en ligne, ranger ; puis la liste des blocs,
  une ligne et le nom de sa fiche chacun ; le Journal des erreurs en « Bon à savoir ».
- [ ] `publique: oui`, `rubrique: construire-un-scenario`, `comment_faire: oui`.

### Tâche 3 : redites, comptes, livrer

- [ ] Les passages des blocs retirés des fiches voisines ; `traduit_de` reposé pour chaque fiche publique touchée.
- [ ] `npm run vitrine:aide`, tests `aide-`, `vitrine-`, `web-`, `plan-methode`, la suite racine, typecheck et lint
  des deux côtés.
- [ ] Une relecture ; publication en plomberie sur l'origin du moment, jamais pendant la CI d'un pair ; puis
  `aide:charger` sur l'image en service et l'essai réel.
