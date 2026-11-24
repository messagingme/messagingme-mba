# Lot 1 du CSM virtuel, lot D : le brouillon (B4)

Source : le plan « Lot 1 : tout en outils » (https://claude.ai/artifact/LfwZTpZXFZ6sNALo6jsGAw), sections « Brouillon et
publication » et lignes B4 des briques et des tests. Suit le lot C (`2026-11-24-csm-lot1-c-clic-et-versions.md`, en
production le 2026-11-24 : le clic de mise en ligne et les versions).

## Le but

Que le CSM écrive TOUJOURS en brouillon, y compris sur un scénario fait dans la console, et que rien n'atteigne les
contacts avant le clic d'un admin (la mise en ligne de B2, action « publier », qui publie le brouillon tel que montré).
Sans l'option, rien ne change : l'API publique et les outils publient comme aujourd'hui.

## Ce qui change

- Le service des scénarios par recette (`src/workflow/scenarios-api.ts`) prend une option `brouillon` :
  - créer en brouillon : le scénario naît avec un graphe publié VIDE et la recette compilée en brouillon (rien ne peut
    le lancer, aucune version) ;
  - remplacer en brouillon : seul le brouillon change, sous le verrou de la ligne ; l'empreinte se compare à celle du
    brouillon s'il y en a un, sinon à celle du publié (une modification concurrente, console comprise, est refusée) ;
    permis sur un scénario de la console, tant que son état se décrit par une recette (sinon le même refus qu'aujourd'hui) ;
  - relire rend aussi le brouillon (sa recette et son empreinte), ou `null`.
- MCP : `create_scenario` et `update_scenario` gagnent `brouillon` (le CSM le passe toujours) ; `get_scenario` rend le
  brouillon ; la publication passe par `propose_go_live` (action « publier »). Les descriptions cessent de dire que toute
  écriture publie.
- `/v1/scenarios` : REPORTÉ après le pilote (décision prise en écrivant, `todo.md`). Le plan du lot y voulait `brouillon`
  dans le corps de `POST` et `PUT` et `POST /v1/scenarios/{id}/publish`. Le pilote passe par Claude ; l'option seule, sans
  la route, laisserait un intégrateur avec un brouillon qu'il ne peut pas mettre en ligne, et la route doit câbler la
  publication (un template en revue la programme), un code de refus neuf, la doc des développeurs et le SDK. `/v1` ne
  change donc pas : il publie toujours directement.
- Le rejeu d'une création : le nom d'un scénario est unique dans l'espace, et le refus `scenario_name_taken` rend
  l'identifiant existant. C'est la clé d'idempotence d'une création ; aucune clé de plus.

## Tests

- Un brouillon créé par MCP ne part pas (graphe publié vide, aucune version), se relit, se publie par une mise en ligne.
- Un brouillon écrit sur un scénario de la console garde le publié intact ; la console le voit comme un brouillon.
- Une modification concurrente (le brouillon changé dans la console entre la lecture et l'écriture) est refusée.
- `/v1` publie comme avant : ses tests existants restent verts, inchangés.
- Le magasin, sur le vrai Postgres (banc PGlite, puis le job `integration`) : la création en brouillon (graphe publié
  vide, aucune version, nom unique), le remplacement du brouillon (publié intact, console comprise, brouillon égal au
  publié effacé, contrôle sous verrou).
- Les outils : `brouillon` lu, retiré de la recette, refusé s'il n'est pas un booléen, annoncé dans le schéma.
- Les tables de parité : le brouillon de la console (`PATCH /workflows/:id`) servi par `update_scenario`.

## Déploiement

Aucune migration : `migration=aucune`. Les descriptions d'outils changent, servies par l'API : la liste du site et la doc
générée des outils suivent. Le plugin ne se republie que si `plugin/` change, avec sa version montée.

## Méthode de livraison

En direct, puis la relecture indépendante du lot avant le déploiement : la production emprunte ce chemin (l'API publique
écrit des scénarios), mais le changement est additif (une option des outils) et le défaut ne bouge pas. L'essai réel qui
clôt le lot : depuis Claude Code, sur un espace de test, un scénario écrit en brouillon, la console le montre comme
brouillon non publié, une mise en ligne le publie ; un brouillon posé sur un scénario de la console.
