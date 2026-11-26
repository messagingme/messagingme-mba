# Une réponse se range sans ses images, et un champ JSON s'insère tel quel dans un appel (2026-11-26)

**Pourquoi.** Essai Everial (Wizidee), suite du plan `2026-11-25-connecteur-oauth-et-piece-en-fichier`. Une pièce
recto verso s'analyse face par face (`/api/v1/analyze`), puis les arbres `validation` de chaque face partent ensemble à
`/api/v1/consolidate` (`{"validations": [...]}`), qui dit si le dossier est complet. Mesuré le 2026-11-26 sur une vraie
CNI : la réponse d'un recto fait 440 Ko, son arbre `validation` 133 Ko (photo et signature du titulaire en base64), et 3 Ko
sans ses images ; `/consolidate` rend exactement le même résultat avec ou sans les images.

## Méthode de livraison

**Implémenteur (moi) + une relecture indépendante du diff en fin de lot** : le corps d'un appel de connecteur est un
chemin que la production emprunte (agent IA, scénarios, poussée d'opt-out), et la substitution de variables porte la
garde « une valeur ne devient jamais de la structure ». Réversible, aucune migration. Essai réel qui clôt le lot : le
parcours recto, verso puis consolidation de la SANDBOX, joué avec la CNI de Julien depuis son téléphone.

## 1. Une réponse rangée dans un champ JSON perd ses images

Avant d'écrire la réponse d'un Appel API dans un champ `json`, toute chaîne qui est une image (data URI `data:image/…`,
ou base64 d'au moins 1 000 caractères) est retirée. Règle générale : une image d'une pièce n'entre jamais dans une fiche
contact (console, export, API). Le plafond de 16 Ko s'applique ensuite.

## 2. Une donnée de type « JSON »

Nouveau type de donnée envoyée, `json`, réservé à l'origine « champ du contact ». La valeur du champ (texte JSON) est
lue comme JSON et, placée seule dans un corps JSON (`"x": "{{v}}"` ou `["{{v}}"]`, la pastille entre guillemets comme
partout), s'y insère comme objet. Vide ou
illisible : `null`, et dans une liste l'élément disparaît (un verso absent ne laisse pas de trou). Hors d'un corps JSON
(chemin, paramètre, en-tête, formulaire), la route refuse. Jamais pour une donnée décidée par l'agent : l'agent IA et le
relais du MBA ne voient pas ce type.

## 3. Console

Le type « JSON (champ JSON) » dans l'éditeur de donnée, `features.md` et la fiche des connecteurs.

## Déploiement

Aucune migration (le type vit dans le JSON de `connector_requests.variables`). L'API d'abord, la console ensuite.
