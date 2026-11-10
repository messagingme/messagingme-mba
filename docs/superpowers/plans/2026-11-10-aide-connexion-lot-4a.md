# Lot 4a de l'aide à la connexion : le centre d'aide

**But :** qu'une personne qui ne connaît pas le produit trouve seule comment connecter son numéro, depuis Claude Code,
Codex ou la console : deux rubriques, un guide qui pose l'arbre, un dépannage, et les pages de chaque étape.

**Spec :** [docs/superpowers/specs/2026-11-08-aide-connexion-numero-design.md](../specs/2026-11-08-aide-connexion-numero-design.md),
« Lot 4 : le centre d'aide » (4a tout de suite ; 4c, les modes op B à E, à réception des rushes de Julien).

## Méthode de livraison

En direct, page par page, parce que c'est du contenu rédactionnel et visuel, réversible, qu'aucun test ne juge sur le
fond ; chaque page neuve est une nouveauté publique, donc Julien la voit en captures (téléphone et ordinateur) AVANT le
push. Les gardes mécaniques restent : parité de l'arbre (`tests/questions-numero-vitrine.test.ts`), empreintes des
fiches (`tests/aide-proposer.test.ts`), traductions (`tests/aide-fiches-anglais.test.ts`), plan du site et `llms.txt`.

**Essai réel :** sur un téléphone, quelqu'un qui ne connaît pas le produit part de la page d'accueil de l'aide, trouve
son chemin par le guide, et connecte son numéro en suivant la page où le guide l'a mené.

## Ce qui change, dans l'ordre de livraison

1. **Les deux rubriques** : `RUBRIQUES` (`src/aide/fiches.ts`) remplace `demarrer` par « Démarrer avec Claude Code ou
   Codex » et « Démarrer avec la console » ; une fiche peut appartenir aux deux. Le menu de la vitrine, l'aide de la
   console et le bot d'aide suivent (`vitrine:aide`, `aide:charger` après le déploiement de l'API).
2. **Le guide** : le MÊME arbre que `/demarrer/`, la console et Claude, depuis les mêmes textes
   (`scripts/vitrine/tunnel-textes.ts`, `web/lib/questions-numero.ts`), à partir de « Qui paie vos messages à Meta ? » ;
   sa fin donne le mode op, la phrase à dire à Claude et le bouton de la console. Lisible sans script (toutes les
   branches en liste), « les cinq points à vérifier » en tête.
3. **Le dépannage** : « Claude Code ou Codex, ou la console ? », l'entrée « Je n'arrive pas à connecter mon numéro »,
   puis les symptômes en cartes dépliables, chaque cause relue dans le code ou une fiche avant d'être écrite ; bloc
   `FAQPage`.
4. **Installer le plugin**, puis **relier Claude Code à Messaging Me** (la connexion MCP, captures de `/autoriser` par
   `aide:captures`).
5. **Ce qu'il faut chez Meta**, réécrite (le compte Meta Business expliqué, l'avant et l'après) : `PREREQUIS_META`
   change avec elle, donc la console et Claude aussi (déploiement de l'API).
6. **Payer Meta : poser ma carte** (`ETAPES_CARTE_META`) et **les modèles WhatsApp** (une source avec la FAQ du plugin).
7. Les fiches de la console rangées dans « Démarrer avec la console » ; le mode op A dans les deux rubriques.
8. Les trois pages Développeurs qui doublonnent (`installer-le-plugin`, `connecter-son-numero`, `compte-meta-business`,
   et leurs jumelles) redirigent en 301 vers les nouvelles fiches (`site/vercel.json`).

Chaque page : sa version anglaise, le plan du site, `llms.txt`, son fil d'Ariane en JSON-LD.

## Ce qui a été tranché en chemin (2026-11-10)

- **Les pages Claude Code ne se recopient pas en fiches** : « Installer le plugin et relier votre espace » et « Connecter
  votre numéro WhatsApp depuis Claude » (`scripts/vitrine/aide-claude-textes.ts`, `demarrer`) entrent telles quelles dans
  la rubrique Claude Code, à leur rang. Elles tirent déjà leurs commandes et leurs outils du produit ; une copie en fiche,
  puis une redirection, aurait fait deux versions de chaque étape. Rien à rediriger.
- **Les rubriques ne demandent pas de déploiement de l'API** : la publication des fiches (`publicationDe`) n'est lue que
  par le générateur de la vitrine et les tests, jamais par le bot.
- **Le guide compte quatre questions, pas cinq** : depuis « Qui paie vos messages à Meta ? », l'arbre en a quatre au
  plus ; le titre lit le nombre sur l'arbre. Ses cinq points restent cinq (ce sont des points, pas des questions).
- **Le dépannage suit le format FAQ de la vitrine** (`.dev-faq`, une question une fois, la réponse affichée égale à la
  réponse balisée) : « Claude Code ou Codex, ou la console ? » y est un filtre ; sans script, tout se lit.

## Deux livraisons

**4a-1** : les deux rubriques, le guide, le dépannage. **4a-2** : « Ce qu'il faut chez Meta » réécrite (avec
`PREREQUIS_META`, donc la console et Claude : un déploiement de l'API), « Payer Meta », « Les modèles WhatsApp », Codex et
la mise à jour dans « Installer le plugin ».

## Ordre de déploiement

4a-1 : la vitrine seule, par Vercel, puis `aide:charger` par Julien à la prochaine image de l'API (le bot y lit les fiches
rangées). 4a-2 : l'API d'abord (`PREREQUIS_META`), puis la vitrine, puis `aide:charger`.
