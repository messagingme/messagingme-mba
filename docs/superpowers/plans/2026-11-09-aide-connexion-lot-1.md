# Lot 1 de l'aide à la connexion : le plugin et le serveur MCP

> **Pour l'exécutant :** skill requise, `superpowers:subagent-driven-development` ou `superpowers:executing-plans`. Les
> étapes se cochent (`- [ ]`).

**But :** Claude écrit toujours le lien de connexion, explique avant la fenêtre de Meta ce qui va se passer et qui paie
quoi selon le chemin, et accueille la personne avec les vrais chiffres des offres et la connexion MCP présentée comme
l'étape 1, dans Claude Code comme dans Codex.

**Architecture :** tout ce qui doit marcher sans le plugin (Codex, tout client MCP) vit dans les réponses des outils
(`src/mcp/outils-numero.ts`) et dans des textes partagés (`web/lib/partage/`). Le plugin reçoit un accueil GÉNÉRÉ par
`npm run plugin:generer` depuis la grille des offres, jamais tapé à la main.

**Spec :** [docs/superpowers/specs/2026-11-08-aide-connexion-numero-design.md](../specs/2026-11-08-aide-connexion-numero-design.md), section « Lot 1 ».

## Contraintes globales

- Aucun tiret cadratin ni demi-cadratin, dans le code, les textes et les commits.
- Chaque texte partagé a son français ET son anglais (`{ fr, en }`) ; Claude le redit « dans la langue de la personne ».
- Le mot « coexistence » ne figure que dans les appels d'outils, jamais dans ce que Claude doit dire.
- Aucun prix de Meta ; la phrase sur les réponses facturées se relit dans `~/.claude/brain/MESSAGINGME.md` avant d'être
  écrite (franchise mensuelle depuis le 2026-10-01).
- Ni le partenaire de la ligne de crédit ni l'infrastructure sous-jacente ne sont nommés.
- `NOTE_CARTE_APPLICATION` (`web/lib/questions-numero.ts`) NE CHANGE PAS : elle est vraie, et la changer remuerait le
  questionnaire de la vitrine, la FAQ et la console. La nuance se pose AVANT elle, dans la consigne.

## Points de vigilance (non couverts par les cas nominaux, chacun reçoit son test)

1. **Un plugin ancien (0.3.28) appelle l'attente sans `mode`** : pas de lien neuf possible, la suite dit quand même
   d'écrire celui de `start_whatsapp_connection` (tâche 1).
2. **Claude répète le lien à chaque tour d'attente** : la suite dit de ne l'écrire que si le dernier message ne le
   contenait pas (tâche 1).
3. **L'heure du lien est passée** pendant l'attente : le lien rendu par l'attente est neuf, signé pour la même personne,
   le même espace et le même mode (tâche 1).
4. **Codex, sans nos skills** : la consigne seule porte les étapes, qui paie, et l'adresse du mode op (tâche 2).
5. **Un espace relié par QR code qui passe en garder l'application** : l'attente en cours de coexistence porte aussi le
   rappel du lien (tâche 1).

---

### Tâche 1 : le lien ne se perd plus

**Fichiers :** `src/mcp/outils-numero.ts`, `tests/mcp-numero.test.ts`.

**Interfaces :**
- Produit : `lienEnEntier(url: string): string` (remplace la constante `LIEN_EN_ENTIER`, l'adresse est DANS la
  phrase) ; `rappelDuLien(lien: string | null): string` ; un champ `lien: string | null` dans la réponse de
  `watch_whatsapp_connection`.
- Règle : le rappel s'ajoute aux deux suites d'attente sans signe, et à elles seules : `COEXISTENCE_EN_COURS` et
  « Rien n'a encore bougé ». Avec `mode` passé, `lien` est un lien neuf (`deps.numero.signerLien({ tenantId, userId,
  mode })`, l'adresse bâtie comme dans `start_whatsapp_connection`) ; sans `mode`, `lien` vaut `null` et le rappel
  renvoie au lien de `start_whatsapp_connection` (ou à le rappeler). La description de l'outil dit de toujours passer
  `mode`.

- [ ] **Tests d'abord** (`tests/mcp-numero.test.ts`) :
  - `start_whatsapp_connection`, pour chacun des quatre modes : `consigne` contient `r.url` en entier.
  - attente, `VIDE`, `mode: 'coexistence'` : `lien` vérifié par `verifyLienNumero` porte `mode: 'coexistence'` et
    l'espace ; `suite` contient `lien`, « ne voit pas » et « si ton dernier message » (pas de répétition).
  - attente, `VIDE`, sans `mode` : `lien === null`, `suite` cite `start_whatsapp_connection` et « en entier ».
  - attente, `mode: 'fourni_application'`, `VIDE` : le rappel aussi (cette voie tombe sur « Rien n'a encore bougé »).
  - attente avec un code arrivé, un numéro attribué, ou un numéro connecté : `lien === null`, aucun rappel.
  - le cas existant « rien encore : la suite dit de redonner le lien » est GARDÉ, ses assertions conservées.
- [ ] Les voir échouer : `npx vitest run tests/mcp-numero.test.ts`, attendu : les nouveaux cas rouges.
- [ ] Implémenter, puis `npx vitest run tests/mcp-numero.test.ts` vert.
- [ ] Vérifier le filet dans les deux sens : retirer le rappel de `COEXISTENCE_EN_COURS`, voir le cas coexistence
  échouer pour la bonne raison, restaurer.

### Tâche 2 : ce qui va se passer, et qui paie

**Fichiers :** `web/lib/partage/etapes-application.ts`, `web/lib/partage/etapes-numero-fourni.ts`,
`web/lib/partage/etapes-meta.ts`, créer `web/lib/partage/aide-connexion.ts`, `src/mcp/outils-numero.ts`,
`tests/mcp-numero.test.ts`, créer `tests/aide-connexion-adresses.test.ts`.

**Interfaces :**
- Produit, dans `web/lib/partage/` (texte `{ fr, en }`) :
  - `ETAPES_FENETRE_GARDER` (`etapes-application.ts`) : les cinq temps de la fenêtre de Meta pour garder l'application,
    tirés de la fiche `garder-mon-application-whatsapp-business` (essai 161) : se connecter avec son profil Facebook ;
    saisir le numéro de l'application avec son pays, que Meta vérifie (message ou appel) ; choisir son compte Meta
    Business ou « Créez un portefeuille business » (le nom de l'entreprise, une adresse e-mail, le pays, le site) ;
    scanner depuis l'application le QR code de la fenêtre (ou saisir le code d'accès qu'elle propose) ; confirmer le
    partage avec Messaging Me, puis « Terminer ».
  - `CODE_VERIFICATION_FOURNI` (`etapes-numero-fourni.ts`) : ce qu'est le code (six chiffres envoyés par SMS ou appel
    au numéro pour prouver qu'il est à vous), pourquoi il arrive dans Claude et sur la page (le numéro est chez nous :
    nous recevons ce SMS ou cet appel et vous le transmettons), où le taper.
  - `CE_QUI_EST_FACTURE` (`etapes-meta.ts`) : `application` (ce que vous tapez dans l'application reste gratuit ; ce
    que Messaging Me envoie pour vous est facturé par Meta, sur une carte à poser chez Meta avant le premier modèle) et
    `api` (tout ce qui part du numéro passe par Messaging Me et Meta le facture, carte à poser juste après la
    connexion).
  - `AIDE_GARDER_APPLICATION` (`aide-connexion.ts`) : `{ fr: 'https://app.messagingme.fr/aide/garder-mon-application-whatsapp-business/', en: 'https://app.messagingme.fr/en/help/keep-my-whatsapp-business-app/' }`.
    Le lot 4b ajoutera les autres pages dans ce même fichier.
- Consignes (`src/mcp/outils-numero.ts`), chacune dans l'ordre « ce qui va se passer, qui paie, le lien » :
  - `coexistence` : `ETAPES_FENETRE_GARDER`, `CE_QUI_EST_FACTURE.application`, puis `NOTE_CARTE_APPLICATION` (inchangée),
    l'offre de donner les étapes de la carte (`ETAPES_CARTE_META`) si la personne le veut, et `AIDE_GARDER_APPLICATION`
    (l'adresse de sa langue).
  - `fourni` : la fenêtre de Meta s'ouvre sur le profil Facebook, le compte Meta Business choisi ou créé en chemin, les
    étapes existantes, `CODE_VERIFICATION_FOURNI`, `CE_QUI_EST_FACTURE.api`.
  - `apporte` : idem sans le +44 ni `CODE_VERIFICATION_FOURNI` (le code arrive sur son téléphone).
  - `fourni_application` : les étapes existantes du compte, `CODE_VERIFICATION_FOURNI` (tapé dans l'application), puis
    `ETAPES_FENETRE_GARDER`, `CE_QUI_EST_FACTURE.application`, `NOTE_CARTE_APPLICATION`, `AIDE_GARDER_APPLICATION`.

- [ ] **Tests d'abord** :
  - `tests/mcp-numero.test.ts` : la consigne `coexistence` contient chaque étape `ETAPES_FENETRE_GARDER[i].fr`,
    `CE_QUI_EST_FACTURE.application.fr`, `« ${NOTE_CARTE_APPLICATION.fr} »` et `AIDE_GARDER_APPLICATION.fr`, et ne
    contient plus la phrase seule « Vous payez Meta avec votre carte » sans la nuance AVANT elle (l'index de la nuance
    précède celui de la note) ; `fourni` contient `CODE_VERIFICATION_FOURNI.fr`, `CE_QUI_EST_FACTURE.api.fr` et
    « Facebook » ; `fourni_application` contient les deux familles. Le cas existant qui comparait la consigne
    `coexistence` au mot près est réécrit en GARDANT ce qu'il exerçait (le lien en entier, la fenêtre, l'application,
    ce qui est facturé, l'attente en mode coexistence).
  - `tests/aide-connexion-adresses.test.ts` : chaque adresse de `aide-connexion.ts` correspond à un
    `site/<chemin>/index.html` existant, et figure dans `site/sitemap.xml`.
- [ ] Les voir échouer, implémenter, les voir passer : `npx vitest run tests/mcp-numero.test.ts tests/aide-connexion-adresses.test.ts`.
- [ ] Rayon de souffle : `grep -rn "CARTE_AVEC_APPLICATION\|LIEN_EN_ENTIER" src tests` ne rend plus que les usages
  voulus ; le catalogue MCP et sa doc générée (`web/public`, `npm run vitrine:cas`) sont à jour si une description
  d'outil a changé (la suite web le dit).

### Tâche 3 : l'accueil du plugin, et Codex

**Fichiers :** `web/lib/demarrer.ts`, `scripts/plugin/generer.ts`, `plugin/skills/demarrer/SKILL.md`,
`plugin/skills/mise-en-service/SKILL.md`, `plugin/README.md`, `plugin/.claude-plugin/plugin.json`,
`tests/plugin.test.ts`, `tests/plugin-readme.test.ts`.

**Interfaces :**
- Produit : `COMMANDES_CODEX` (`['codex plugin marketplace add messagingme/messagingme-plugin', 'codex plugin add messagingme@messagingme']`)
  et `AUTORISATION_CODEX` (`'codex mcp login messagingme'`) dans `web/lib/demarrer.ts` ; `blocAccueil(): string` et
  `skillAvecAccueil(md: string): string` dans `scripts/plugin/generer.ts` (même mécanique `remplacerBloc`, marques
  `<!-- accueil:debut ... -->` et `<!-- accueil:fin -->`), appelés par `main()` sur les deux skills et sur
  `plugin/README.md` (la spec : le README dit la même chose, dans le même ordre).
- Le bloc (anglais, comme les skills) : « avant toute chose, donne cet accueil dans la langue de la personne, avec ces
  chiffres et aucun autre », puis : ce que fait Messaging Me en une phrase ; Free et Pro en une ligne chacun, chiffres
  tirés de `DROITS`, `PRIX_PRO_HT_CENTIMES`, `ESSAI_PRO_JOURS` (Free : 100 contacts, ceux qui écrivent compris, 1 000
  modèles par mois, un utilisateur ; Pro : son prix, son essai, la console, le numéro fourni inclus) ; l'étape 1,
  relier Claude Code (ou Codex) à Messaging Me, avec son pourquoi (Claude agit dans VOTRE espace, il lui faut votre
  accord), son comment (`/mcp`, `SERVEUR_PLUGIN_MCP`, Authenticate ; dans Codex, `AUTORISATION_CODEX`), ce qui se passe
  (une page dans le navigateur, Google ou une adresse e-mail, l'espace créé à ce moment s'il n'existe pas,
  « Autoriser ») et à quoi sert l'adresse (elle vous identifie, reçoit les e-mails de service, ouvre la console) ;
  puis les étapes suivantes (le numéro, l'agent IA, la bulle).
- `mise-en-service`, parties écrites à la main : `AUTORISATION_CODEX` à côté de chaque `/mcp` ; à l'étape de la
  connexion, « dis ce que la consigne annonce AVANT le lien », et « passe toujours `mode` à
  `watch_whatsapp_connection` ». Version du plugin montée (0.3.29).

- [ ] **Tests d'abord** :
  - `tests/plugin.test.ts` : `COMMANDES_CODEX` et `AUTORISATION_CODEX` dérivés des manifestes (dépôt de
    `plugin.json`, nom du plugin, nom du catalogue, clé de `.mcp.json`), comme `COMMANDES_PLUGIN` ; le README les cite.
  - `tests/plugin-readme.test.ts` : les deux skills et le README portent le bloc d'accueil égal à `blocAccueil()` (sinon
    `npm run plugin:generer`) ; le bloc contient `${DROITS.base.limites.contacts} contacts`, les modèles du mois de la
    Free, `SERVEUR_PLUGIN_MCP` et `AUTORISATION_CODEX`, et AUCUN autre nombre de contacts que ceux de `DROITS` pour la
    Free (le défaut d'origine).
- [ ] Les voir échouer, implémenter, `npm run plugin:generer`, les voir passer.
- [ ] Mutation : passer `DROITS.base.limites.contacts` à 1000 sans régénérer, voir le test du bloc échouer, restaurer.

### Fin du lot

- [ ] `npm run typecheck`, `npm run lint`, `npm test` (suite racine ENTIÈRE, rediriger vers un fichier et lire
  « Test Files »), `npx tsx scripts/auto-attaque.mts`, et la suite de `web/` (des fichiers de `web/lib/partage` ont changé).
- [ ] Une relecture indépendante du lot (correctness, cas limites, rayon de souffle : qui supposait l'ancienne consigne,
  l'ancien champ de l'attente, `LIEN_EN_ENTIER`).
- [ ] Commit par plomberie sur `origin/main` (fichiers du lot seulement, `src/mcp/outils-numero.ts` n'est pas un fichier
  de câblage partagé mais l'arbre l'est), push, CI lue job par job (`gh run view <id> --json jobs`).
- [ ] Déploiement de l'API : `gh workflow run deploy-scaleway.yml --ref main -f migration=aucune -f commit=<sha>`, approuvé
  par Julien. Puis Julien publie le plugin (`gh workflow run plugin.yml --ref main`), après avoir vérifié que la tête
  de `main` n'emporte rien de non déployé.
- [ ] Ligne au journal (`docs/JOURNAL-TECHNIQUE.md`) et à `docs/prive/ESSAIS-REELS.md`.

## Ordre de déploiement

API d'abord (tâches 1 et 2 : les consignes et l'attente ; un plugin 0.3.28 en profite déjà, et le cas sans `mode` est
couvert), puis le plugin (tâche 3). Aucune migration. Aucun écran de la console ne change.

## Méthode de livraison

**Implémenteur et revue humaine du diff**, parce que la production emprunte ce chemin à chaque onboarding par Claude
ou Codex, que les consignes portent des invariants de parité avec la console et la vitrine (`NOTE_CARTE_APPLICATION`,
les étapes partagées), et qu'un texte mal posé fait dire une chose fausse à chaque client. Les trois tâches sont
petites et dépendantes (la 3 cite le comportement des 1 et 2) : un seul implémenteur, une relecture en fin de lot.

**Essai réel qui clôt le lot** : un onboarding dans Claude Desktop, sur un espace de test, chemin « garder
l'application » : Claude donne l'accueil avec 100 contacts, explique la connexion MCP, puis, avant le lien, la fenêtre
de Meta, le QR code et qui paie ; il écrit le lien sans qu'on le lui demande, et le redonne si on le laisse attendre.
Puis la même installation dans Codex (`codex plugin add`, `codex mcp login messagingme`, `get_setup_state` répond).
