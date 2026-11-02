# Ranger la réponse d'un bloc Question, pièce jointe comprise : design

Cadrage du 2026-11-02 avec Julien. Ce document dit ce qu'on construit et pourquoi ; le plan d'exécution viendra après.

## Intention

Un scénario doit pouvoir **demander une pièce d'identité** au contact, la **reconnaître** quand elle arrive, et la
**transmettre au stockage du client** par le bloc « Appel API » qui existe déjà. Plus largement, toute réponse à un bloc
Question (un texte écrit, une ligne choisie, un fichier) doit pouvoir être **rangée dans un champ personnalisé** du
contact, pour qu'un bloc suivant (Appel API, Condition) s'en serve.

Aujourd'hui, rien de cela n'est possible dans un scénario :

- le bloc Question **route** la réponse, il ne la range nulle part (`executor.advance`, `src/workflow/executor.ts`) ;
- le bloc Action « Poser un champ = dernier message » range un texte, mais une photo y devient `[image]`
  (`src/webhooks/inbound.ts`, `body: caption ?? '[type]'`) ;
- le bloc Appel API n'envoie que des variables texte (`src/agent/variables.ts`) ;
- nous ne gardons pas le fichier reçu : seulement l'identifiant de Meta, dont l'adresse de téléchargement vit quelques
  minutes, exige notre jeton, et disparaît au bout de 7 jours (`src/inbox/media-entrant.ts`, `DUREE_MEDIA_RECU_JOURS`).

Le seul chemin actuel (webhook sortant `message.received` puis `GET /v1/messages/{id}/media`) oblige le client à
écrire une application qui trie chaque message reçu. Le besoin est dans le scénario, il doit s'y régler.

## Décisions de Julien

| Sujet | Décision |
|---|---|
| Cas qui motive | Une **pièce d'identité** demandée au contact |
| Ce que le champ contient pour un fichier | Une **mention sans valeur** (« Pièce reçue le 02/11 à 14 h 32 (photo) »), jamais un lien |
| Le lien vers le fichier | **Fabriqué au moment où l'Appel API part**, et n'existe que dans cet appel |
| Durée du lien | **15 minutes** après sa fabrication |
| Types acceptés | **Des cases sur le bloc** : photo, PDF, autre document, vidéo, vocal ; photo et PDF cochés par défaut |
| Tri | Une sortie **« Fichier reçu »**, qui ne prend que les types cochés |
| Plusieurs fichiers d'affilée | **Un seul par question** : le premier compte, les suivants vont à l'Inbox comme aujourd'hui |
| Texte écrit | Rangé dans un **champ personnalisé créé par le client**, choisi dans la liste |
| Ligne du menu | Son titre est rangé **seulement si la case prévue est cochée** : ce n'est pas obligatoire |
| Rien n'est copié chez nous | Le fichier reste chez Meta (7 jours), comme tout fichier reçu aujourd'hui |
| « Fichier reçu » reliée à rien | **La publication est refusée** tant que l'attente d'un fichier est cochée et la sortie libre de toute flèche |
| Classement d'un fichier | Par son **type réel** (MIME), pas par la catégorie de WhatsApp : une photo envoyée « en fichier » reste une photo |
| Fin de parcours silencieuse | **Inchangée** : le message du contact part chez le répondeur (agent de Meta ou agent IA) comme aujourd'hui, même quand la Question l'a rangé |

## Ce que voit le client dans l'éditeur

Sur le bloc Question, sous la question et le menu, trois réglages nouveaux, **tous facultatifs** :

1. **« Ranger la réponse dans le champ… »** : la liste des champs personnalisés de l'espace (les mêmes que le bloc Action
   « Poser un champ »). Vide par défaut. Vide = le bloc ne range rien, exactement comme aujourd'hui.
2. **« Ranger aussi la ligne choisie dans le menu »** : une case, décochée par défaut, visible quand le menu a des lignes
   et qu'un champ est choisi.
3. **« Attendre un fichier »** : une case, décochée par défaut. Cochée, elle montre les types (photo, PDF, autre
   document, vidéo, vocal ; photo et PDF cochés) et fait apparaître la sortie **« Fichier reçu »** sur le bloc.

Un menu et l'attente d'un fichier peuvent coexister sur le même bloc (une ligne « Je n'ai pas ma pièce », par exemple).

## Ce qui se passe quand le contact répond

| Réponse du contact | Sortie prise | Ce que reçoit le champ (s'il est choisi) |
|---|---|---|
| Un fichier d'un type coché | « Fichier reçu » | La mention de la pièce (voir plus bas) |
| Un fichier d'un type non coché, ou attente de fichier désactivée | « Toute autre réponse » | Rien, le champ n'est pas touché |
| Un texte écrit | « Toute autre réponse » | Le texte |
| Une ligne du menu | La sortie de la ligne | Le titre de la ligne, seulement si la case 2 est cochée |
| Rien dans le délai | « Pas de réponse » | Rien |

Les sorties existantes ne changent pas : un bloc Question enregistré avant ce lot se comporte exactement comme avant.
Les autres règles de routage restent celles d'aujourd'hui (`executor.advance`) : une ligne du menu reliée à rien retombe
sur « Toute autre réponse », et ne remonte à un humain que si celle-ci n'est pas reliée non plus. « Fichier reçu » n'a
pas besoin de règle de repli : un scénario dont cette sortie n'est reliée à rien ne peut pas être publié.

**Comment un fichier est classé.** Par le type MIME annoncé avec le message, quelle que soit la catégorie que WhatsApp
lui donne (`image` ou `document`) :

| Case | Types MIME |
|---|---|
| Photo | `image/*` (JPEG, PNG, HEIC, WebP…), envoyée comme image ou comme fichier |
| PDF | `application/pdf` |
| Vidéo | `video/*` |
| Vocal | `audio/*` : une note vocale comme un fichier audio |
| Autre document | tout autre fichier envoyé comme document (Word, tableur, texte…) |

Un sticker n'est jamais un fichier attendu, bien que son type soit `image/webp` : il se reconnaît à sa catégorie
WhatsApp, et il prend « Toute autre réponse ». Un message sans type MIME lisible n'est classé dans aucune case.

**Fin de parcours silencieuse (décision de Julien).** Quand le parcours finit sans avoir envoyé de message, le message du
contact est transmis au répondeur comme aujourd'hui (`aLuLaSaisie`, `src/workflow/executor.ts`), même si la Question
l'a rangé : une photo y arrive comme « [image] ». Ce lot ne change pas cette règle.

**La mention** est un texte lisible par un humain, à la date et l'heure du fuseau de l'espace, avec le genre du fichier :
« Pièce reçue le 02/11/2026 à 14 h 32 (photo) ». Elle ne contient aucun moyen d'accéder au fichier. La légende
éventuelle de la photo n'est pas rangée.

## Le lien, fabriqué à l'appel

Quand un bloc **Appel API d'un scénario** résout une variable qui lit un champ, et que ce champ porte une mention de pièce
écrite par un bloc Question, la variable vaut **un lien neuf** au lieu de la mention :
`<PUBLIC_API_URL>/f/<jeton>`. Le jeton désigne la pièce (l'espace et le message reçu) et son échéance, à 15 minutes, et
il est signé. Le stockage du client télécharge le fichier par un simple `GET`, pendant ces 15 minutes, autant de fois
qu'il le veut.

Le lien ne se fabrique que si **le champ porte encore la mention écrite par la Question**. Un champ réécrit depuis par un
autre chemin (bloc Action, API, console, import, Flow) n'est plus une pièce : la variable vaut alors sa valeur, comme
pour n'importe quel champ.

**Ailleurs, jamais de lien** : un connecteur appelé par l'agent IA, par la poussée d'un désabonnement ou par le bouton
« Essayer » de Tools > Connecteurs API envoie la mention, telle quelle. La fiche dans la console, l'export, l'API, le
serveur MCP et les webhooks sortants ne montrent que la mention.

`GET /f/<jeton>` sert le fichier par le chemin qui existe (`lireMediaRecu`, avec ses en-têtes `enTetesMedia` :
`nosniff`, `no-store`, `attachment` hors des images affichables). Ses réponses :

- jeton illisible, falsifié ou échu : refus, sans dire lequel des trois ;
- pièce au-delà des 7 jours de Meta : « expiré » (comme `media_expired` de l'API) ;
- fichier au-delà du plafond `MEDIA_ENTRANT_TAILLE_MAX_KO` : refus lisible, comme l'API ;
- toujours un 4xx, jamais un 5xx (Cloudflare remplacerait le corps).

Chaque téléchargement réussi laisse une **trace visible par un admin de l'espace** (date, scénario si on le connaît,
pièce), sans jamais le jeton.

## Objectifs

- Demander une pièce, la reconnaître par son type, la transmettre au stockage du client, **sans quitter le scénario**.
- Ranger dans un champ personnalisé n'importe quelle réponse à une Question : texte, ligne de menu, fichier.
- Un lien vers une pièce d'identité qui n'existe **que dans l'appel qui en a besoin**, et ne dure que 15 minutes.

## Non-objectifs

- Plusieurs fichiers pour une même question, ou une collecte jusqu'à un mot de fin.
- Copier le fichier chez nous, ou dépasser les 7 jours de Meta.
- Envoyer le fichier lui-même (les octets) vers l'URL du client : le connecteur reste en JSON.
- Vérifier la pièce : lecture du document, contrôle d'identité, détection d'un faux. Le produit transmet, il ne juge pas.
- RCS : le bloc Question est WhatsApp seulement, il le reste.
- Le fichier d'une réponse de Formulaire (Flow).
- L'API et le MCP de création de scénarios (spec du 2026-11-02, qui exclut déjà le bloc Question de sa v1).

## Anti-objectifs (ce qui en ferait un échec, même si ça marche)

- **Un lien vers une pièce d'identité qui vit plus longtemps ou va plus loin que l'appel qui l'utilise** : dans un champ,
  un journal (appels de connecteur, erreurs de livraison, `console.warn`), un export, une réponse d'API, un prompt de
  l'agent IA.
- **Une pièce périmée transmise** : un Appel API qui envoie le lien d'un fichier alors que le champ a été réécrit depuis.
- **Un contact bloqué ou perdu** parce qu'il a envoyé un fichier : toute réponse doit continuer de prendre une sortie, ou
  remonter à un humain selon les règles actuelles.
- **Un bloc Question existant qui change de comportement** sans que le client ait touché à ses réglages.

## Contraintes

- **Isolation entre espaces** : le jeton et chaque lecture portent l'espace, et le fichier se relit par l'espace
  (`lireMessagePourTranscription(tenantId, …)` le fait déjà). Un jeton d'un espace ne doit rien ouvrir dans un autre.
- **La capacité de fabriquer un lien n'est donnée qu'au chemin du scénario** (le câblage de `creerAppelHttpScenario`),
  dans l'objet imbriqué des capacités, garde `satisfies` posée sur le spread (règle du `Pick` recopié, CLAUDE.md du
  projet, et `tests/campagne-cablage.test.ts` pour le modèle).
- **Aucune variable d'environnement nouvelle dont l'absence casse la production** : la clé de signature se dérive d'un
  secret existant (`AUTH_SECRET`) avec une étiquette propre à cet usage.
- **La route `/f/` est publique** : elle entre au registre des modules de routes avec la classe `code-url`, comme `/r/`
  et `/m/`, et l'auto-attaque doit la connaître (`FAUSSES_AUTORITES` si besoin). Elle est servie à la racine de
  `PUBLIC_API_URL` (`src/lib/adresses-publiques.ts`), jamais depuis le domaine de la console. Elle porte un plafond de
  débit.
- **Purge RGPD** : si une table nouvelle garde le lien entre un champ et un message reçu, la purge d'un contact et
  d'un espace la nomme, et sa migration est poussée seule et appliquée avant le code (règle du CLAUDE.md du projet).
- **Le refus de publier se juge côté serveur**, à la publication, comme le refus d'un « Aller à » invalide
  (`src/http/workflows.ts`, 422 `aller_a_invalide`) ; l'éditeur le dit avant, mais c'est le serveur qui tranche, pour
  que tout chemin de publication y passe.
- **360dialog** : la lecture d'un fichier reçu passe déjà par la clé du bon fournisseur (`telechargerEntrant(…,
  tenantId)`), rien à ajouter, mais l'essai doit le couvrir si un espace 360dialog est disponible.
- **`features.md` et la fiche d'aide du bloc Question** se mettent à jour dans le même commit, empreinte comprise
  (`tests/aide-proposer.test.ts`).
- **Une autre session modifie en ce moment `src/workflow/` et `WorkflowConfigPanel.tsx`** : le plan doit partir de
  `origin/main` à jour et annoncer l'édition des fichiers de câblage partagés (`src/worker.ts`, `src/server.ts`).

## Mes choix (Julien peut les contester)

- Un fichier d'un type non coché ne touche pas le champ : il prend « Toute autre réponse » comme un texte, mais rien
  n'est rangé, pour qu'un Appel API placé derrière « Fichier reçu » ne voie jamais une pièce refusée.
- Le lien n'est pas à usage unique : un stockage qui réessaie dans les 15 minutes doit y arriver.
- Un sticker n'est jamais un fichier attendu (aucune case ne le propose), même si son type MIME est une image.
- La légende d'une photo n'est pas rangée.
- Le bouton « Essayer » des connecteurs ne fabrique pas de lien : le lien de test d'un scénario, qui joue le vrai
  parcours, est l'endroit pour essayer la chaîne entière.

## Laissé au constructeur

- Où vit le lien entre un champ et le message reçu (table dédiée, ou autre forme), tant que la règle « le champ porte
  encore la mention écrite par la Question » est vérifiable au moment de l'appel.
- Le format exact du jeton et de la signature (HMAC, comparaison à temps constant, `timingSafeEqualStr` existe).
- Où le téléchargement laisse sa trace pour l'admin de l'espace (audit trails, journal des appels), sans le jeton.
- La forme des nouvelles données du bloc dans le graphe (`node.data`) et le nom du handle de la sortie « Fichier
  reçu », pourvu que `parseGraph` et les anciens scénarios restent valides.
- Le texte exact de la mention et sa langue (celle de l'espace si elle se lit, le français sinon).

## Essai réel qui clôt la fonctionnalité

Depuis un vrai téléphone, sur l'espace SANDBOX, un scénario : Question « Envoyez une photo de votre pièce d'identité »
avec un champ choisi et l'attente d'un fichier (photo et PDF), puis sur « Fichier reçu » un Appel API vers un récepteur
de test qui télécharge le lien reçu.

1. Envoyer une photo : le parcours prend « Fichier reçu », le champ montre la mention, le récepteur reçoit un lien et
   télécharge **le même fichier** (mêmes octets que dans l'Inbox), la trace du téléchargement apparaît pour l'admin.
2. Rouvrir ce lien au-delà de 15 minutes : refus.
3. Recommencer en écrivant un texte : « Toute autre réponse », le champ porte le texte, aucun lien ne part.
4. Recommencer avec une photo envoyée « en fichier » (document JPEG) : « Fichier reçu », comme une photo.
5. Recommencer avec une vidéo (non cochée) : « Toute autre réponse », le champ n'est pas touché.
6. Réécrire le champ à la main dans la console, puis rejouer l'Appel API : il envoie la valeur écrite, pas de lien.
7. Vérifier que la fiche, l'export et `GET /v1/contacts/{id}` ne montrent que la mention.
8. Délier « Fichier reçu » et tenter de publier : la publication est refusée, avec sa raison.

## Relecture

Un relecteur a lu ce document sans contexte. Trois de ses questions revenaient à Julien et sont tranchées plus haut : la
sortie « Fichier reçu » reliée à rien (publication refusée), le classement par type réel plutôt que par catégorie
WhatsApp, et la fin de parcours silencieuse (inchangée). Il a aussi relevé qu'une première version décrivait mal la
règle actuelle d'une ligne de menu sans suite ; la description ci-dessus est celle du code.
