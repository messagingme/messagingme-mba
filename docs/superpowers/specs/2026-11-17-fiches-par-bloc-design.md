# Une fiche d'aide par bloc du constructeur de scénario

**Date** : 2026-11-17. **Statut** : design validé par Julien le 2026-11-17 (quatre questions, puis le design entier).

## Pourquoi

Julien : « expliquer chaque node, comment on fait, qu'est-ce qu'on met, qu'on met pas, les règles même petites ».
Aujourd'hui, une seule fiche (`creer-un-scenario.md`) consacre un paragraphe à chaque bloc : elle dit ce que fait le
bloc, pas quoi saisir dans chaque case, et les règles qui font refuser une publication ne sont écrites que dans le code.
Le bloc Fonction JS n'est expliqué nulle part, et la sortie « Toute autre réponse » du Message rapide non plus.

## Objectifs

- Une fiche par bloc de la palette (16), qu'un client lit pour remplir le panneau du bloc sans se tromper.
- On MONTRE : une capture de la vraie console par geste, une flèche sur l'élément précis, quelques mots.
- Les règles (limites, interdits, refus de publication) sont RELEVÉES DANS LE CODE, jamais écrites de mémoire.
- Chaque information à UN seul endroit (Julien : « si l'info existe ailleurs c'est qu'elle est à un endroit de trop »).

## Non-objectifs

- La voie Claude Code (construire un scénario par `create_scenario`) : elle a ses pages à part, pas ici.
- Les blocs retirés du produit (`tag`, `field`, `mba_handoff`, `mba_disable`).
- Un nouveau rendu de page : le gabarit actuel des fiches suffit.

## Anti-objectifs

- Un pavé. Une étape qui se lit en paragraphe a raté.
- Une règle recopiée à deux endroits, ou une règle fausse parce que lue en diagonale.

## Les approches pour la flèche

| Approche | Ce qu'elle coûte |
|---|---|
| **Posée dans la vraie page avant la photo** (retenue) | Un calque ajouté par `capturer`, placé sur la boîte de l'élément visé (celle que le film lit déjà). Se refait seule à chaque capture, en français comme en anglais. |
| Dessinée après coup sur l'image | Une bibliothèque d'images absente du dépôt ; ffmpeg ne trace que des rectangles. |
| Dessinée à la main | À refaire à chaque capture, elle finit par pointer à côté. |

## Ce qui est décidé

1. **Une flèche par capture.** Une étape = un geste = une capture = une flèche. Option de `capturer`
   (`web/e2e/captures/donnees-demo.ts`) : les captures des autres fiches ne changent pas.
2. **Le gabarit d'une fiche de bloc**, dans la grammaire actuelle (`src/aide/structure.ts`) :
   - le chapeau : à quoi sert le bloc, en une phrase ;
   - une étape `**N. Titre.**` par chose à remplir ou à relier, avec une tête de quelques mots et sa capture fléchée ;
   - sous l'étape, ses règles en lignes courtes (le détail replié de l'étape) ;
   - la dernière étape : les sorties à relier.
3. **Publiques, avec leur version anglaise** : les captures ne s'affichent que sur la vitrine.
4. **Zéro redite.** « Créer un scénario » ne garde que la toile (relier, sauvegarde, lien de test, code d'un bloc,
   dossiers, journal des erreurs) et renvoie vers les fiches des blocs. Ce que les fiches Mail, RCS, Formulaire et
   Agent IA disent de leur bloc déménage dans la fiche du bloc.
5. **Les accès.**
   - Le centre d'aide : une rubrique neuve, « Construire un scénario ».
   - Le « ? » de l'écran Scénarios : le lien « Comment faire » de la barre du haut (`LienCommentFaire`), qui
     s'allume dès que `creer-un-scenario` devient publique avec `comment_faire: oui`. Pas un lien par bloc.
   - Le tchat d'aide : il trouve déjà les fiches ; sa ligne « D'après : … » devient un lien vers la page publique de
     la fiche. Champ AJOUTÉ à côté de `sources`, jamais à sa place : une console publiée avant l'API ne casse pas.
6. **Trois lots.** Lot 1 : le Message rapide seul, rendu montré à Julien avant la suite. Lot 2 : Modèle, Question,
   Condition, Action, Attente. Lot 3 : les dix autres, le lien du tchat, et « Créer un scénario » publique.

## Laissé au constructeur

- Le dessin de la flèche, tranché au lot 1 et validé par Julien sur le rendu : corail sur halo blanc (il tranche sur le
  bleu de la console sans se lire comme une erreur), un cadre autour de l'élément, et la capture CADRÉE sur 640 x 400
  autour de la flèche, en double densité : dans la page d'aide, une capture de toute la console réduite au tiers
  rendait l'élément visé illisible.
- La source de chaque fiche dans `features.md` (`source_section`) : la section des scénarios, partagée.
- Le rang des pages dans la rubrique : l'ordre de la palette (`NODE_ORDER`).
