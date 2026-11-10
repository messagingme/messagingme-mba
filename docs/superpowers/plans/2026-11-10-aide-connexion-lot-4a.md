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
6. **Payer Meta : poser votre carte** (`ETAPES_CARTE_META`) et **les modèles WhatsApp** (une source avec la FAQ du plugin).
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
- **« Payer Meta » et « Les modèles WhatsApp » ne sont pas des fiches** : comme le dépannage, des pages composées de
  sources (`scripts/vitrine/aide-sources-textes.ts`), dont seuls les titres de section et les chapeaux sont écrits. La
  réponse de la FAQ « que facture Meta » porte aussi les étapes de la carte : elle se coupe avant, pour que la page ne les
  donne qu'une fois, et, sur « Payer Meta » qui sert aussi la console, avant le tarif que donne Claude.
- **Qui paie Meta se dit par `CE_QUI_EST_FACTURE`, jamais par la réponse « que facture Meta » de la FAQ** (rouge de la
  relecture de 4a-2) : celle-ci dit que Meta facture toujours l'entreprise et que Messaging Me ne touche pas à ces frais,
  faux avec le Crédit WhatsApp que « Payer Meta » propose, et fait payer toutes les réponses quand la console dit « au-delà
  de la franchise ». Les pages n'en gardent que le tarif que donne Claude ; la réponse elle-même se corrige à la source
  avec 4a-3, qui republie déjà le plugin.
- **Deux catégories de modèles, pas trois** : la spec nommait aussi « authentication » ; la page s'en tient à utility et
  marketing, les deux seules que `create_template` accepte (`src/mcp/outils-modeles.ts`) et que la FAQ du plugin décrit.
- **Codex dans « Installer le plugin »** : ses commandes viennent de `web/lib/demarrer.ts`, « dans un terminal » et la
  note de la page d'autorisation de la fin du tunnel ; la mise à jour est la question de la FAQ, telle quelle. Rien
  n'écrit encore comment mettre le plugin à jour dans Codex, ni ce qu'on y tape pour lancer la mise en service (le tunnel
  y fait coller une demande propre à chaque chemin) : on ne l'invente pas (backlog, à mesurer).
- **« Ce qu'il faut chez Meta » réécrite part dans un lot à elle (4a-3)** : elle change `PREREQUIS_META`, donc la console
  et Claude, et demande un déploiement de l'API, quand le reste de 4a-2 ne touche que la vitrine.
- **4a-3 garde trois conditions, dans le même ordre** : la console et Claude lisent `PREREQUIS_META` par position. Le
  compte Meta Business se nomme comme Meta l'écrit (« portefeuille business »), Facebook est dans [0], le téléphone dans
  [2] avec le numéro (jamais dit au numéro fourni). `PREREQUIS_LIGNE`, sa version sans carte, suit la même écriture.
- **Qui paie Meta se dit partout avec la franchise et l'exception du Crédit WhatsApp** (rouges des relectures de 4a-2 et
  4a-3) : la FAQ du plugin, sa skill `regles-whatsapp` et son README, le guide « compte Meta Business », la fiche. Restent
  hors du lot, au backlog : le guide « Pièges de Meta » de la console, les cas d'usage et les tarifs de la vitrine (3v-2).
- **La page « compte Meta Business » des Développeurs reste** : la spec la voyait rediriger vers la fiche ; elle se génère
  des mêmes textes (`guide-meta.ts`), ne double donc rien, et les liens déjà donnés vers elle continuent de servir.

## Trois livraisons

**4a-1** : les deux rubriques, le guide, le dépannage. **4a-2** : « Payer Meta », « Les modèles WhatsApp », Codex et la
mise à jour dans « Installer le plugin ». **4a-3** : « Ce qu'il faut chez Meta » réécrite (avec `PREREQUIS_META`, donc la
console et Claude : un déploiement de l'API).

## Ordre de déploiement

4a-1 : la vitrine seule, par Vercel, puis `aide:charger` par Julien à la prochaine image de l'API (le bot y lit les fiches
rangées). 4a-2 : la vitrine seule, par Vercel ; aucune fiche ne change, rien pour `aide:charger`. 4a-3 : le push publie
la console et la vitrine (Vercel) ; l'API suit aussitôt, pour que Claude dise les mêmes conditions que la console
(`PREREQUIS_META` dans sa consigne ; les deux restent justes entre-temps, seule la tournure diffère), puis `aide:charger`
(la fiche) et la publication du plugin 0.3.34 (sa FAQ, sa skill `regles-whatsapp`, son README), par Julien.
