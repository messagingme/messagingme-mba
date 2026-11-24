# Lot 1 du CSM virtuel, lot E : la recette du pilote (B5)

Source : le plan « Lot 1 : tout en outils » (https://claude.ai/artifact/LfwZTpZXFZ6sNALo6jsGAw), ligne B5 des briques
(« Blocs Question (champ, réponses, pas de réponse) et Action (tag, champ) ») et étape 2 du parcours pilote (« écrire le
scénario en brouillon : questions, réponses rangées dans les champs, relance si pas de réponse, passage à l'équipe »).
Suit le lot D (`2026-11-24-csm-lot1-d-brouillon.md`, le brouillon).

## Le but

Que Claude écrive, en recette, le parcours de qualification du pilote : des questions dont la réponse se range dans un
champ de la fiche, un menu facultatif, une échéance « pas de réponse » qui mène à une relance, des étiquettes et des
champs posés en chemin, puis le passage à l'équipe. Et qu'il relise de même un scénario de la console fait de ces
blocs.

## Ce qui change

- La recette (`src/workflow/recette.ts`) gagne deux étapes :
  - `question` : le texte, le champ qui range la réponse (un champ de l'espace), un menu facultatif (libellé du bouton,
    lignes avec titre et description, ranger le titre choisi), une échéance facultative (valeur et unité, les mêmes
    que le bloc Attente). Ses suites : une par ligne du menu (chacune exigée, comme une réponse rapide), `autre_reponse`
    (avec menu) ou `suite` (sans menu) pour la réponse écrite, `sans_reponse` à l'échéance (exigée si l'échéance est
    posée, refusée sinon).
  - `action` : une liste d'opérations jouées dans l'ordre (poser une étiquette, en retirer, donner une valeur à un
    champ, vider un champ), puis `suite`. Le consentement n'en fait pas partie : il vient du contact, jamais de Claude.
- La compilation (`src/workflow/recette-graphe.ts`) les pose en blocs `question` (`body`, `rows`, `buttonLabel`,
  `champReponse`, `rangerLigne`, `timeoutValue`, `timeoutUnit`, sorties `row:<i>`, `timeout` et libre) et `action`
  (première opération à plat, les suivantes dans `data.suite`, `web/lib/partage/actions-bloc.ts`). La relecture les
  lit en retour ; une Question qui attend un fichier, une ligne sans titre, une opération de consentement restent
  « indescriptibles », comme toute recette relue que l'écriture refuserait. `signatureDe` (lot D) apprend la Question : ses lignes et son
  échéance sont ses sorties.
- Chaque borne appliquée est annoncée dans le schéma donné au modèle (`RECETTE`, `src/mcp/outils-scenarios.ts`) et dans
  le contrat de `/v1` (`schemaRecetteDoc`), donc le SDK se régénère (`npm run sdk:contrat`) : ajout pour les
  intégrateurs, rien ne casse.
- La parité : `POST /workflows` et `PATCH /workflows/:id` disent les blocs que la recette ne dit pas encore (attente,
  condition, appel, fonction, « Aller à », e-mail, RCS, formulaire, envoi à l'agent de Meta), rangés pour la recette
  complète, hors du pilote.

## Hors du lot

La recette complète (tous les blocs du Pro) reste la brique du plan qui la porte : le pilote n'a besoin que de la
Question et de l'Action. Une Question qui attend un fichier non plus.

## Tests

- Aller-retour : chaque forme neuve, compilée puis relue, redonne la même recette (empreinte égale).
- Le moteur lit ce que la compilation pose : `actionOf` rend `sendQuestion`, `reglagesQuestion` le champ et la case,
  `delaiSansReponseMs` l'échéance, `actionsDeLaSousAction` chaque opération.
- Les refus : champ inconnu de l'espace, ligne sans suite, `sans_reponse` sans échéance et l'inverse, `suite` avec menu,
  bornes dépassées, opération inconnue ; chacun avec son chemin.
- Les bornes : `tests/mcp-outils-scenarios.test.ts` exige chacune dans le schéma annoncé.
- Les ids : un scénario de la console fait de Questions et d'Actions garde l'id de chaque bloc inchangé à sa réécriture
  (le test de la reprise des ids du lot D, étendu).

## Déploiement

Aucune migration : `migration=aucune`. Le contrat de `/v1` et le SDK changent (ajout) ; les descriptions d'outils
changent, servies par l'API. Le plugin ne se republie que si `plugin/` change. ⚠️ La fenêtre : la doc de `/v1`, la
vitrine, `llms-full` et le SDK annoncent la Question et l'Action dès le push, l'API ne les accepte qu'au déploiement ;
il suit donc le push au plus près (après celui du lot 2 des packs de contacts, qui le précède dans la file).

## Méthode de livraison

En direct, puis la relecture indépendante du lot avant le déploiement : la production emprunte ce chemin (`/v1` et les
outils compilent des recettes), mais l'ajout est borné à deux étapes neuves et l'aller-retour se vérifie par des
tests. L'invariant à garder : un bloc inchangé garde son id (les parcours en cours). L'essai réel qui clôt le lot :
depuis Claude Code, sur un espace de test, le parcours de qualification écrit en brouillon, relu par `get_scenario`,
ouvert dans la console, puis mis en ligne d'un clic et joué depuis un téléphone (avec B6 pour la simulation).
