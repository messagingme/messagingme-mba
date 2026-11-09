# L'aide à la connexion du numéro, de Claude Code (ou Codex) à la console

Date : 2026-11-08. Cadré avec Julien en deux rondes de questions, après l'onboarding d'un de ses proches par Claude
Desktop, le 2026-11-07. Mesures faites sur `origin/main` (`39ce526f`).

## Pourquoi

Un utilisateur de l'application WhatsApp Business installe le plugin dans Claude Desktop pour connecter son numéro.
Trois défauts :

1. **Le premier message de Claude présente la formule Free avec « 1 000 contacts ».** C'est 100 contacts et 1 000
   modèles par mois. Aucun texte du dépôt ni du plugin publié (v0.3.28) ne le dit : Claude a écrit son intro lui-même.
   Hypothèse : il a lu le README, où la ligne Pro (« 1,000 contacts created ») suit la ligne Free. Plus tard, au
   moment des questions, Claude donnait les bons chiffres (ils viennent du serveur).
2. **La connexion MCP n'est pas expliquée.** C'est la première étape, obligatoire, et `/messagingme:demarrer` dit
   seulement « tapez /mcp, choisissez le serveur, Authenticate » : ni pourquoi, ni qu'une adresse e-mail (ou Google)
   sera demandée, ni que l'espace naît à ce moment.
3. **Claude annonce le lien de connexion et ne l'écrit jamais.** Il dit « ce lien expire à 19 h 19, je surveille la
   connexion », puis boucle sur `watch_whatsapp_connection` (« rien n'a encore changé, environ 2 min 30 »). Il a
   fallu lui redemander le lien. La consigne de `start_whatsapp_connection` commence pourtant par « Écris ce lien EN
   ENTIER » (`LIEN_EN_ENTIER`, `src/mcp/outils-numero.ts`), et la skill `mise-en-service` le dit aussi. C'est la
   deuxième fois (essai 99, 2026-10-13) : une consigne ne suffit pas, il faut un filet dans l'outil.

Plus largement, la personne ne sait pas ce qui va se passer : une fenêtre de Meta qui demande ses identifiants
Facebook, un compte Meta Business créé en chemin, un QR code à scanner, un code de vérification qui arrive « dans
Claude », et qui paie quoi. Et rien de public ne permet à Claude, aux e-mails ou à la console de renvoyer vers les
étapes exactes de SA situation.

**Le succès** : quelle que soit sa situation, une personne connecte son numéro depuis Claude Code, Codex ou la console
sans que personne ait à relancer Claude ou à l'appeler. À chaque étape, elle sait ce qui va arriver. Si ça bloque,
une page publique lui dit quoi faire, et Claude sait la lui donner.

## Objectifs

1. Claude écrit toujours le lien, et explique AVANT la fenêtre de Meta ce qui va se passer et qui paiera quoi, selon
   le chemin choisi.
2. Un message d'accueil fixe, écrit par nous, remplace l'intro improvisée : les offres avec leurs vrais chiffres, et la
   connexion MCP présentée comme l'étape 1, avec son pourquoi.
3. L'arbre des situations couvre les six cas de Julien, et le même arbre vit partout (vitrine, console, Claude).
4. Le centre d'aide a deux rubriques, « Démarrer avec Claude Code ou Codex » et « Démarrer avec la console », un mode
   op par chemin, un guide (questionnaire qui mène au bon mode op) et une page de dépannage.
5. Claude, les e-mails et la console renvoient vers ces pages par leur adresse.
6. La console s'affiche dans la langue du navigateur quand la personne n'a rien choisi.
7. Les modes op portent des vidéos tournées par Julien, découpées par étape, titrées en français et en anglais.

## Non-objectifs

- **Le Crédit WhatsApp avec l'application gardée.** Il est exclu aujourd'hui par un choix de la v1 (« Meta ne
  documente pas la combinaison », spec `2026-10-30-credit-whatsapp-design.md`), pas par une impossibilité mesurée.
  C'est la question 7, ouverte, posée au partenaire, et rien ne lui est écrit sans Julien. Chantier à part. Les pages
  disent ce qui est vrai aujourd'hui, et changeront avec lui.
- Changer l'ORDRE des questions de l'arbre (offre, qui paie Meta, compte Meta Business, application, numéro) : il est
  en production à trois endroits et tenu par un test de parité. Seules ses feuilles changent (cas 4, WhatsApp
  ordinaire). La page de dépannage a sa propre entrée.
- Un nouveau mode de connexion : les six cas se servent des quatre modes existants (`fourni`, `apporte`,
  `coexistence`, `fourni_application`).
- Un plugin propre à Codex : c'est le même plugin (voir « Codex », mesuré).

## Anti-objectifs (ce qui ferait échouer le chantier même s'il marche)

- Claude qui dit « je vous donne le lien » sans le lien.
- Un mode op qui contredit ce que disent Claude ou la console : une phrase partagée a UNE source, comme aujourd'hui
  (`web/lib/partage/`, tests de parité).
- Un prix de Meta écrit de mémoire, un délai inventé, une étape de la fenêtre de Meta décrite sans capture ni essai.
- Le mot « portefeuille » (ou tout jargon de Meta) sans explication.
- Le nom de l'infrastructure sous-jacente ou du partenaire de la ligne de crédit, où que ce soit.
- Un « il faut payer » systématique : avec l'application gardée, ce que la personne tape dans l'application reste
  gratuit.

## Décisions de Julien (2026-11-08)

- **Ordre** : le plugin d'abord (lot 1, les trois défauts et l'explication avant la connexion). Les liens du plugin
  vers les modes op viennent quand les pages existent.
- **Cas 4** (pas de compte Meta Business, une application WhatsApp Business, mais il ne veut pas utiliser ce
  numéro-là) : un numéro fourni par la fenêtre de Meta (mode `fourni`), le compte Meta Business créé en chemin.
- **WhatsApp ordinaire** (règle tirée de son texte) : un numéro utilisé dans WhatsApp ordinaire passe d'abord dans
  l'application WhatsApp Business (la personne le fait elle-même), puis on garde l'application (`coexistence`).
  Aujourd'hui, on lui dit de prendre un autre numéro.
- **Guide et dépannage** : deux pages séparées. Le guide (le questionnaire qui mène au bon mode op) et la page de
  dépannage (les symptômes).
- **Vidéos** : par parcours, pas par cas. Julien tourne sans parler, lentement, une pause d'une seconde avant chaque
  clic. Claude découpe, ajoute titres et courtes légendes en français et en anglais (mêmes images).
- **Délais du code** : ceux des pages, sourcés (environ 45 s avant de pouvoir le redemander, dix demandes au plus par
  numéro sur 72 h, règle de Meta), plus le sien : au-delà de 48 h sans code, nous contacter.
- **Cinq modes op, un par parcours** (pas six, un par cas) : le guide envoie chacun des six cas sur la bonne page et la
  bonne branche du compte Meta Business.
- **Les captures des parcours B à E sont tirées des vidéos de Julien** (il tourne de toute façon), plus trois ou quatre
  captures de téléphone pour l'installation de WhatsApp Business. Les pages B à E attendent ses rushes ; tout le reste
  part avant (lot 4a).
- **Tunnel de la console** : il pose déjà les mêmes questions que Claude, y compris sans compte Meta Business, et le
  bouton « Garder mon application WhatsApp Business » est sur l'Accueil pour toutes les offres. « Démarrer avec la
  console » n'exige donc pas de compte Meta Business ; la fiche actuelle le laisse croire, elle est reprise.

## Ce qui existe et sert

- Les 9 captures de la fenêtre de Meta pour « garder l'application », en français et en anglais
  (`site/img/aide/garder-mon-application-whatsapp-business/`).
- Les fiches publiques de la rubrique « Démarrer » : `choisir-mon-offre`, `ce-qu-il-faut-chez-meta`,
  `connecter-mon-numero-whatsapp`, `garder-mon-application-whatsapp-business`, et celles de la console
  (`me-reperer-dans-la-console`, `integrer-whatsapp-a-hubspot`, `brancher-ma-boutique-shopify`).
- Les pages « Depuis Claude Code » de `/developpeurs/` (`scripts/vitrine/aide-claude-textes.ts` : installer le plugin,
  connecter son numéro ; plus `compte-meta-business`).
- Le questionnaire de `/demarrer/` (`scripts/vitrine/tunnel.ts`, `tunnel-textes.ts`), le même arbre que la console
  (`web/lib/questions-numero.ts`) et la skill, tenu par `tests/questions-numero-vitrine.test.ts`.
- Les étapes partagées : `ETAPES_NUMERO_FOURNI`, `ETAPES_CARTE_META`, `PREREQUIS_META`, `ETAPES_COMPTE_FOURNI`
  (`web/lib/partage/`).
- Il MANQUE : une page qui explique les modèles (pourquoi Meta les exige, les catégories, ce qui est facturé, le lien
  vers la grille officielle de Meta), et toute page sur la connexion MCP. Et le plugin ne cite aucune page d'aide.

## Codex (mesuré le 2026-11-08, Codex CLI 0.151, dans un dossier Codex jetable)

Codex lit notre marketplace telle quelle (`.claude-plugin/marketplace.json`) : `codex plugin marketplace add
messagingme/messagingme-plugin`, puis `codex plugin add messagingme@messagingme`. Il montre au modèle nos six skills
et liste notre serveur MCP (« Not logged in »). Seule l'autorisation diffère : `codex mcp login messagingme` au lieu
de `/mcp`, puis Authenticate. Pas encore mesuré : la connexion OAuth complète et une session réelle (essai réel du
lot 1). D'où : la rubrique s'appelle « Démarrer avec Claude Code ou Codex », et chaque texte qui donne `/mcp` donne
aussi la commande de Codex. Les explications vivent côté serveur (consignes des outils) autant que possible : tout
client MCP en profite, plugin ou pas.

## Les six cas et leurs chemins

L'arbre garde son ordre. Les feuilles :

| Cas | Situation | Chemin | Mode | Compte Meta Business |
|---|---|---|---|---|
| 1 | Ni compte, ni application, ni numéro | Numéro fourni, mis dans l'application, puis on la garde | `fourni_application` | créé dans la fenêtre de Meta, à l'étape « garder l'application » |
| 2 | Pas de compte (ou ne sait pas), pas d'application, un numéro | Il télécharge l'application, y met son numéro (s'il est dans WhatsApp ordinaire, l'application propose de le transférer), puis on la garde | `coexistence` | idem |
| 3 | Pas de compte, l'application, il garde ce numéro | Garder l'application | `coexistence` | idem |
| 4 | Pas de compte, l'application, il ne veut pas ce numéro | Numéro fourni, par la fenêtre de Meta | `fourni` | créé dans la fenêtre de Meta |
| 5 | Un compte et un numéro | Libre : son numéro par la fenêtre de Meta (`apporte`). Dans l'application : on la garde (cas 3). Dans WhatsApp ordinaire : il le passe dans l'application, puis on la garde | `apporte` ou `coexistence` | il choisit le sien |
| 6 | Un compte, pas de numéro | Numéro fourni, par la fenêtre de Meta | `fourni` | il choisit le sien |

Ces six cas ne passent que par CINQ parcours d'écrans, qui sont aussi les vidéos :

- **A. Garder mon application WhatsApp Business** (cas 3, et 5 quand le numéro y est) : la fiche existante, ses 9
  captures. L'URL actuelle reste (`/aide/garder-mon-application-whatsapp-business/`).
- **B. Mettre mon numéro dans WhatsApp Business, puis le garder** (cas 2, et 5 depuis WhatsApp ordinaire) :
  télécharger l'application, l'inscrire ou transférer le compte WhatsApp, puis le parcours A.
- **C. Un numéro fourni, dans l'application WhatsApp Business** (cas 1) : obtenir le numéro, créer le compte de
  l'application avec lui (pays +44, le code arrive dans Claude ou sur la page), puis le parcours A.
- **D. Un numéro fourni, par la fenêtre de Meta** (cas 4 et 6) : obtenir le numéro, la fenêtre de Meta, « Enter a new
  phone number », le pays GB (+44) puis les chiffres sans le +44, le code qui arrive dans Claude ou sur la page,
  « Finish ». L'étape du compte Meta Business a ses deux branches (choisir le sien, en créer un).
- **E. Mon propre numéro, par la fenêtre de Meta** (cas 5, numéro libre) : la fenêtre de Meta, son numéro, le code
  qu'il reçoit lui-même.

**Décidé par Julien** : un mode op par PARCOURS (cinq pages), et le guide envoie chacun des six cas sur la bonne page,
avec la bonne branche du compte Meta Business. Six pages par cas dupliqueraient D pour les cas 4 et 6, et A dans le
cas 5.

Le serveur ne connaît que le mode : `coexistence` mène à A (au moment du lien, la personne de B a déjà mis son numéro
dans l'application ; Claude cite B plus tôt, quand il lui dit de télécharger l'application), `fourni_application` à
C, `fourni` à D, `apporte` à E.

Chaque mode op a la même forme : ce que vous allez faire et ce qu'il vous faut (identifiants Facebook, téléphone, 5 à
15 minutes), qui paiera quoi, les étapes une par une avec une capture ou un extrait vidéo chacune, comment commencer
(« Depuis Claude Code ou Codex : dites… » ; « Depuis la console : le bouton… »), et ce qui se passe après (la carte
chez Meta, l'agent IA).

### L'étape délicate des numéros fournis (C et D)

Julien la veut limpide. Le mode op dit, dans l'ordre : où la personne achète ou obtient le numéro (la page du lien,
« Payer 3,50 € HT par mois » ou « Obtenir mon numéro » en Pro) ; où elle VOIT le numéro attribué (sur la page, et
Claude l'écrit) ; comment le saisir (pays GB +44 dans la liste, puis les chiffres sans +44) ; ce qu'est le code de
vérification (un code à six chiffres que Meta, ou WhatsApp, envoie par SMS ou appel au numéro pour prouver qu'il est
à vous) ; pourquoi il apparaît dans Claude ou sur la page (le numéro est chez nous : nous recevons ce SMS ou cet appel
et vous le transmettons) ; où le taper (fenêtre de Meta pour D, application WhatsApp Business pour C).

## Lot 1 : le plugin et le serveur MCP (les trois défauts, l'explication avant)

**Serveur** (`src/mcp/outils-numero.ts`, déployé avec l'API) :

- **Le lien dans la consigne** : la consigne de `start_whatsapp_connection` contient l'adresse elle-même, à l'endroit
  où elle dit de l'écrire, pas seulement un champ `url` à côté.
- **Le filet** : tant que rien n'a bougé, chaque réponse de `watch_whatsapp_connection` (le premier appel compris)
  redonne le lien et exige qu'il soit écrit en entier si le dernier message de Claude ne le contenait pas (« la
  personne ne voit pas les résultats d'outils »). Comment l'outil d'attente obtient le lien (un lien neuf signé pour le
  même mode, ce qui suppose que la skill passe toujours `mode`) : au constructeur.
- **Ce qui va se passer, avant le lien**, par mode, dans la consigne : la fenêtre de Meta et les identifiants
  Facebook ; le compte Meta Business, choisi ou créé en chemin (le nom de l'entreprise, une adresse e-mail, le pays,
  le site) ; pour `coexistence` et la fin de `fourni_application`, le QR code à scanner depuis l'application (ou le
  code d'accès) ; pour `fourni` et `fourni_application`, le +44 et le code qui arrive dans Claude, avec ce qu'est ce
  code ; la page à garder ouverte jusqu'au bout ; puis l'adresse du mode op du parcours (A existe déjà ; les autres au
  lot 4b).
- **Qui paie quoi, sans systématisme** : application gardée, « ce que vous tapez dans l'application reste gratuit ; ce
  que Messaging Me envoie pour vous (modèles, et réponses au-delà de la franchise mensuelle de Meta) est facturé par
  Meta sur une carte chez Meta, à poser avant le premier modèle ; je peux vous donner les étapes ». Numéro API (`fourni`,
  `apporte`) : tout ce qui part du numéro passe par Messaging Me, donc les modèles, et les réponses au-delà de la
  franchise, sont facturés par Meta. Les phrases sur le Crédit WhatsApp restent (pas possible avec l'application), sans
  dire « Meta facture forcément sur votre carte » comme si tout était payant. La source de ces faits est
  `brain/MESSAGINGME.md` et les fiches existantes ; aucun prix. `NOTE_CARTE_APPLICATION` (console, questionnaire de la
  vitrine, FAQ) reste telle quelle, parce qu'elle est vraie et que la changer remuerait ces trois endroits : la nuance
  se pose AVANT elle, dans la consigne (décidé au plan du lot 1).
- `get_setup_state` (ou la consigne) indique au lot 4b l'adresse du guide et de la page de dépannage, pour que Claude
  les donne quand la personne bloque.

**Plugin** (publié par Julien après l'API, version montée) :

- **Le message d'accueil fixe** (dans `demarrer`, et en tête de `mise-en-service` quand les outils ne sont pas
  encore là) : ce que fait Messaging Me en une phrase ; les deux offres en une ligne chacune, chiffres tirés de la
  grille (`DROITS`) par `npm run plugin:generer`, jamais écrits à la main ; puis l'étape 1, « relier Claude Code (ou
  Codex) à Messaging Me » : pourquoi (Claude agit dans VOTRE espace, il lui faut votre accord), comment (`/mcp`,
  `plugin:messagingme:messagingme`, Authenticate ; dans Codex, `codex mcp login messagingme`), ce qui se passe (une
  page s'ouvre dans le navigateur : continuer avec Google ou avec une adresse e-mail ; sans compte, l'espace naît à ce
  moment ; puis « Autoriser »), et à quoi sert l'adresse (elle vous identifie, reçoit les e-mails de service et ouvre
  la console). Claude le recopie au lieu d'improviser.
- Le README dit la même chose, dans le même ordre.
- La skill `mise-en-service` reçoit la commande de Codex partout où elle donne `/mcp`, et le cas 4 et la règle
  WhatsApp ordinaire arrivent au lot 3, pas ici.

**Méthode de livraison** : implémenteur et revue humaine du diff. La production emprunte ce chemin à chaque
onboarding par Claude, et les consignes portent des invariants de parité avec la console. **Essai réel** : un
onboarding dans Claude Desktop sur un espace de test, chemin « garder l'application » : Claude écrit le lien sans
qu'on le lui demande, explique la fenêtre de Meta, le QR code et qui paie avant le lien. Et un second en Codex
(installation, `codex mcp login`, `get_setup_state`).

## Lot 2 : la langue du navigateur dans la console

Quand rien n'est mémorisé ni passé par `?lang=`, `LocaleProvider` (`web/lib/i18n.tsx`) prend `navigator.language` :
français s'il commence par `fr`, anglais sinon. Vaut pour toute la console, donc l'écran d'autorisation (`/autoriser`)
et la page du lien (`/brancher`).

**Rayon de souffle** : les e2e tournent dans Playwright, dont la langue par défaut est `en-US` : ils passeraient en
anglais et leurs sélecteurs français casseraient. Fixer `locale: 'fr-FR'` dans `web/playwright.config.ts` (et ajouter
un cas en anglais). Les captures d'aide (`npm run aide:captures`) aussi.

**Méthode de livraison** : en direct, isolé et réversible. **Essai réel** : ouvrir `/autoriser` depuis un navigateur
en anglais sans choix mémorisé.

**Livré le 2026-11-09** (`d3902dd6`, puis les jaunes de sa relecture). Décisions de Julien à la relecture : la règle du
navigateur vaut pour TOUS, y compris un utilisateur déjà installé qui n'a jamais choisi (il repasse en français d'un
clic dans le menu du compte, mémorisé ensuite) ; et la vitrine française ne pose pas `?lang=fr` sur ses liens : le
navigateur du visiteur décide (la vitrine anglaise garde son `?lang=en`). Captures d'aide : non touchées, elles posent
leur langue elles-mêmes.

## Lot 2b : la langue des e-mails apprise à la création du compte

Relevé à la relecture du lot 2 (jaune A1). La langue des e-mails de service (`identities.langue`, migration 0234,
`fr` par défaut) n'est écrite que quand la personne bascule la langue dans la console (`AccountMenu`, `/compte`). Une
console qui s'ouvre en anglais sans bascule laisse donc des e-mails en français ; le défaut existait déjà pour une
arrivée par `?lang=en` et pour l'inscription par lien (`inscriptions_attente.langue` n'est pas reportée sur
l'identité), le lot 2 l'élargit. À faire : la langue de l'écran voyage jusqu'à la création de l'identité, par Google
(`/auth/google`, `continuerAvecGoogle`, puis `ensureIdentity`) comme par e-mail (l'insertion de la confirmation reprend
`inscriptions_attente.langue`). **Méthode de livraison** : implémenteur et revue du diff, parce que le chemin touche
l'inscription et l'identité. **Essai réel** : créer un espace par Google depuis un navigateur anglais, puis recevoir
un e-mail de service en anglais.

## Lot 3 : l'arbre, partout

Le cas 4 (après « Oui, j'ai l'application » : « Voulez-vous utiliser ce numéro-là ? » ; non, numéro fourni par la
fenêtre de Meta) et la règle WhatsApp ordinaire (après « un numéro » : s'il est dans WhatsApp ordinaire, le passer
dans l'application WhatsApp Business, puis la garder ; pour `apporte`, un numéro qui sert dans WhatsApp ordinaire ne
part plus vers un autre numéro). En même temps dans `scripts/vitrine/tunnel-textes.ts`, `web/lib/questions-numero.ts`
(et l'écran qui l'affiche), la skill `mise-en-service` et les consignes du serveur ; les tests de parité suivent.

**Méthode de livraison** : implémenteur et revue humaine du diff (écran d'onboarding de la console, parité à trois
endroits). **Essai réel** : parcourir les six cas dans `/demarrer/`, dans la console et avec Claude, et comparer les
feuilles.

## Lot 4 : le centre d'aide

Il part en deux temps. **4a**, tout de suite : les rubriques, le guide, le dépannage, installer le plugin, la connexion
MCP (captures de `/autoriser` par `npm run aide:captures`, la vidéo s'ajoute au lot 6), ce qu'il faut chez Meta, payer
Meta, les modèles, le mode op A (ses captures existent) et les fiches de la console. **4c**, à réception des rushes :
les modes op B à E, leurs captures tirées des vidéos. Le guide mène déjà aux cinq parcours ; tant qu'une page B à E
n'existe pas, sa fin renvoie à la page de connexion de la console ou à Claude, qui donnent les mêmes étapes.

### Les rubriques

`RUBRIQUES` (`src/aide/fiches.ts`) remplace `demarrer` par deux rubriques. Une fiche peut appartenir aux deux (les
modes op, « Ce qu'il faut chez Meta », le guide, le dépannage) : le champ `rubrique` accepte deux valeurs ; la forme
exacte est au constructeur.

**Démarrer avec Claude Code ou Codex**, dans l'ordre :

1. Installer le plugin (Claude Code, Codex), même court : les commandes, où les taper, la mise à jour.
2. Relier Claude Code à Messaging Me (la connexion MCP) : pourquoi c'est la première étape, ce qui s'ouvre, Google ou
   e-mail, l'espace créé, « Autoriser », et ce que Claude peut faire ensuite. Vidéo de Julien.
3. Ce qu'il faut chez Meta, avant et après (réécrite, voir plus bas).
4. Le guide : trouver mon chemin en cinq questions.
5. Les modes op A à E.
6. Payer Meta : poser ma carte. Pourquoi, où (les étapes de `ETAPES_CARTE_META`), et la nuance de l'application
   gardée (ce qu'on y tape ne change pas ; la carte sert aux envois automatiques, « comme une API »).
7. Les modèles WhatsApp : pourquoi Meta les exige (écrire en premier, hors de la fenêtre de 24 h), les catégories
   (marketing, utility, authentication) et ce qui décide de la catégorie, ce qui est facturé et par qui, et le lien
   vers la grille officielle de Meta (`https://developers.facebook.com/docs/whatsapp/pricing`). Les textes existent en
   partie dans la FAQ du plugin (`scripts/plugin/faq.ts`) : une source, pas une copie.
8. Le dépannage.

**Démarrer avec la console**, dans l'ordre : choisir mon offre ; ce qu'il faut chez Meta ; connecter mon numéro et
lire son état (repris : il renvoie au guide et aux modes op) ; le guide ; garder mon application (A) ; me repérer dans
la console ; intégrer WhatsApp à HubSpot ; brancher ma boutique Shopify ; payer Meta, ma carte ou le Crédit WhatsApp
(la différence, quoi faire dans chaque cas, quand le Crédit WhatsApp est possible : formule Pro ou Business, sur
demande, pas avec l'application) ; le dépannage.

### « Ce qu'il faut chez Meta », réécrite

Plus de « portefeuille » sans explication. Le fond : à la fin, tout le monde a un compte Meta Business (l'ancien
Business Manager, que Meta appelle aujourd'hui « portefeuille business » dans ses écrans) ; on n'est pas obligé d'en
avoir un avant, la fenêtre de Meta le crée en chemin ; il porte votre compte WhatsApp, votre numéro et votre carte.
Puis ce qu'il faut AVANT (des identifiants Facebook, un téléphone, et selon le chemin un numéro) et APRÈS (la carte).
La console et Claude disent la même chose : `PREREQUIS_META` change avec elle.

### Le guide

Le MÊME arbre que `/demarrer/`, la console et Claude, depuis la même source de textes
(`scripts/vitrine/tunnel-textes.ts`, `web/lib/questions-numero.ts`) : pas un second questionnaire. Il commence à « Qui
paie vos messages à Meta ? », comme la console (la personne qui arrive par un e-mail a déjà son offre), et seule sa
fin change : le mode op et sa bonne branche, la phrase à dire à Claude (à copier), le bouton de la console.
`/demarrer/` garde sa fin (la commande à coller dans Claude Code) et y ajoute le lien vers le mode op. Une page
interactive sur le mécanisme du questionnaire de `/demarrer/` (HTML statique et `site.js`), qui reste lisible sans
JavaScript (toutes les branches en liste, pour les moteurs) : une question par écran, de grandes cartes de choix, le
fil des réponses déjà données. Avec le lot 3, l'arbre compte au plus cinq questions après l'offre (qui paie Meta, le
compte, l'application, le numéro, où il sert), d'où le titre. En tête, le résumé « les cinq points à vérifier » (pour
les moteurs et les IA), dans l'ordre de l'arbre : qui paie Meta (votre carte, ou le Crédit WhatsApp, nous faisons les
deux) ; avez-vous un compte Meta Business (oui : un numéro API ; non : la fenêtre de Meta le crée en chemin) ;
avez-vous l'application WhatsApp Business (oui : pour envoyer en automatique, on la garde) ; avez-vous un numéro ; où
sert-il (application WhatsApp Business, WhatsApp ordinaire, nulle part). Titre visé : « Connecter son numéro WhatsApp, quelle que soit votre situation : le guide en 5 questions »,
avec dans la description WhatsApp Business, coexistence et API.

**Choix de Claude** : sur les pages publiques, le mot « coexistence » apparaît une fois, présenté comme le nom que Meta
donne à « garder son application » (les gens le cherchent). Claude, lui, ne le dit toujours jamais.

### Le dépannage

Une page séparée. Première question : « Vous êtes dans Claude Code ou Codex, ou dans la console ? ». Puis l'entrée
macro, « Je n'arrive pas à connecter mon numéro », qui suit l'arbre de Julien par le numéro (j'ai un numéro que je
peux utiliser ; il me faut un numéro ; je vous ai acheté un numéro) et mène au mode op, et les symptômes précis, chacun
en carte dépliable (cause, quoi faire, lien), parmi lesquels :

- Claude dit qu'il attend, mais je n'ai pas de lien : demandez-lui « donne-moi le lien de connexion » ; il est valable
  une heure, il en donne un neuf si l'heure est passée.
- J'ai un numéro fourni et je n'arrive pas à le saisir : choisissez GB (+44) dans la liste des pays, puis collez les
  chiffres qui suivent +44.
- Le code n'arrive pas : environ 45 s avant de pouvoir le redemander, puis l'autre méthode (SMS ou appel) ; dix
  demandes au plus par numéro sur 72 h, au-delà Meta bloque ; au-delà de 48 h sans code, écrivez-nous.
- Meta dit que le numéro n'est pas éligible (« More activity on the WhatsApp Business App is needed »).
- Mon numéro est dans WhatsApp ordinaire.
- La fenêtre de Meta ne s'ouvre pas.
- Mon numéro est connecté mais « à activer ».
- Mes modèles ne partent pas (la carte chez Meta).

Chaque cause et chaque remède se relisent dans le code ou une fiche existante avant d'être écrits ; aucun ne
s'invente. Les questions-réponses portent un bloc `FAQPage` (JSON-LD).

### Le reste du lot

- Les pages `/developpeurs/installer-le-plugin/`, `/developpeurs/connecter-son-numero/` et
  `/developpeurs/compte-meta-business/` (et leurs jumelles anglaises) doublonnent les nouvelles fiches : elles
  redirigent (301, `site/vercel.json`) vers elles, et `/developpeurs/` renvoie à la rubrique. **Choix de Claude**, pour
  qu'il n'y ait qu'une version de chaque étape.
- Toute page neuve a sa version anglaise (`docs/aide/fiches/en/`), entre dans `site/sitemap.xml`, `site/llms.txt`, et
  porte son JSON-LD (fil d'Ariane). Fiches publiques = pages de la vitrine : `npm run vitrine:aide` dans le même
  commit, `aide:charger` après le push (règle du `CLAUDE.md`).
- Les fiches qui citent une section de `features.md` portent son empreinte (`tests/aide-proposer.test.ts`).
- Les pages neuves sont une nouveauté publique : Julien les voit (captures) avant le push.
- Deux écarts relevés à la relecture du lot 1, à reprendre ici : la vitrine dit « 1 000 messages envoyés par mois » pour
  la limite de la Free (`scripts/vitrine/cas-textes.ts`, `scripts/vitrine/anglais/tarifs.json`) quand le plugin dit
  désormais « modèles », ce qui est exact (une réponse dans les 24 heures ne compte pas) ; et la page « Connecter votre
  numéro WhatsApp depuis Claude » (`scripts/vitrine/aide-claude-textes.ts`) dit « le lien, puis les étapes », alors que
  ce qui va se passer et qui paie viennent désormais avant le lien.
- Et un relevé à la relecture du lot 2 (jaune A5) : la fiche publique « Me repérer dans la console » dit la bascule
  mémorisée, pas la règle d'ouverture ; une phrase (« sans choix, la console s'ouvre dans la langue de votre
  navigateur : en français s'il est en français, en anglais sinon »), sa version `en/`, `vitrine:aide` et `aide:charger`,
  pour que le bot d'aide sache répondre à « pourquoi ma console est en anglais ? ».

**Méthode de livraison** : en direct, page par page, avec relecture de Julien sur captures. Contenu visuel et
rédactionnel, réversible, qu'aucun test ne juge (le projet n'envoie pas l'UI en feature-loop). **Essai réel** :
quelqu'un qui ne connaît pas le produit trouve son mode op par le guide sur un téléphone, et le suit.

## Lot 4b : Claude renvoie vers les pages

Le serveur et la skill citent les adresses du guide, du dépannage et du mode op du parcours en cours. Les adresses
viennent du registre des pages (`scripts/vitrine/aide-pages.ts`) ou d'une constante partagée, jamais tapées à la main,
et un test exige que chaque adresse citée existe dans `site/sitemap.xml`. Plugin publié par Julien ensuite.

## Lot 5 : les e-mails

- `relance_numero` (« Votre numéro WhatsApp n'est pas encore connecté ») : son bouton mène au guide (« Trouver mon
  chemin en 5 questions »), une ligne en dessous mène au dépannage, et la phrase dit les deux entrées (la console, ou
  le demander à Claude). **Choix de Claude** : le guide plutôt que la console, parce qu'il mène au bon geste dans les
  deux cas.
- Pour chaque autre e-mail du catalogue (`src/emails-produit/catalogue.ts`), une table e-mail par e-mail : la page
  publique qui l'aide, ou aucune. Par exemple les e-mails de l'application reliée par QR code (`application_*`) vers
  « garder mon application », `relance_repondeur` vers « construire un agent IA ». Seules des pages publiques.
- **Rayon de souffle** : un texte modifié dans `/ops` (table `emails_produit_textes`) masque le texte du code ; lire
  en production, avant, si `relance_numero` y a une version.

**Méthode de livraison** : en direct, avec revue du diff (des e-mails qui partent). **Essai réel** : l'aperçu de
`/ops` et un envoi réel sur un espace de test.

## Lot 6 : les vidéos

Julien tourne, sans parler, sur son PC en français :

1. La connexion MCP, dans Claude Desktop (installation du plugin, `/mcp`, la page d'autorisation, Google ou e-mail,
   « Autoriser », retour dans Claude).
2. Le parcours de la fenêtre de Meta, numéro API (+44), avec un compte Facebook SANS compte Meta Business pour capter
   la création en chemin.
3. Le parcours « garder l'application », avec le QR code.
4. Le numéro fourni mis dans l'application (le paiement, le numéro affiché, l'inscription dans l'application, le code
   dans Claude).

Plus, au téléphone, trois ou quatre captures : l'installation de WhatsApp Business, l'inscription d'un numéro, et le
transfert d'un compte WhatsApp ordinaire (le début de B). Le parcours E reprend les écrans de D (mêmes écrans, son
propre numéro, le code reçu sur son téléphone) : pas de tournage à part.

Claude découpe par étape, en tire les captures des modes op B à E (lot 4c), ajoute titres et légendes en français et
en anglais sur les mêmes images, et pose les extraits dans les modes op. **Choix de Claude** : les pages anglaises de B
à E montrent l'interface de Meta en français (tournée sur un PC en français), légendée en anglais ; A garde ses
captures anglaises. Les films de la vitrine suivent leurs règles (`site/films/`, `?v=` au remplacement, version
verticale au téléphone).

## Ce qui est laissé au constructeur

La forme technique du filet du lot 1, le format d'un champ `rubrique` à deux valeurs, les adresses exactes des pages
neuves (courtes, en français, mots-clés en tête ; leurs jumelles anglaises), la mise en page du guide et du
dépannage, le texte exact (relu par Julien avant publication), la table des e-mails du lot 5.
