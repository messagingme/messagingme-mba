# La fenêtre du partenaire : connecter un numéro par la ligne (lot E du Crédit WhatsApp)

> Lot E du plan `2026-11-04-credit-whatsapp-ligne-a-la-connexion.md`, attendu « quand la doc du partenaire arrive ».
> Spec : `docs/superpowers/specs/2026-11-04-credit-whatsapp-ligne-a-la-connexion-design.md`, décision 2. Débloqué le
> 2026-11-09 : la solution multi-partenaires du partenaire est acceptée et active (son identifiant et ses permissions
> dans la note privée, jamais dans le dépôt). Le partenaire n'est jamais nommé ici.

**But** : un client qui a droit à la ligne et n'a encore aucun numéro connecte son numéro par la fenêtre de Meta ouverte
avec la solution du partenaire. Son compte WhatsApp est alors partagé avec le partenaire, qui y branche sa ligne de
crédit ; seule notre application envoie (« Only me », relu par l'API le 2026-11-09).

## Ce qui est décidé

- **La fenêtre** s'ouvre avec `extras: { setup: { solutionID }, featureType: '', sessionInfoVersion: '3' }` (doc Meta des
  solutions multi-partenaires), jamais en coexistence (décision 8 de la spec : le Crédit WhatsApp exclut l'application).
  Sans l'identifiant, la connexion directe (la carte du client chez Meta) reste ce qu'elle est.
- **La garde est au serveur** : l'identifiant de la solution (`META_SOLUTION_ID`, configuration ; vide, aucun bouton) ne
  part que vers un espace qui a droit à la ligne et qui n'a encore aucun numéro vivant. Le droit se lit sur l'offre et
  l'option, jamais sur Stripe ni sur le solde : une Entreprise (illimitée, sans option) ; une formule Pro ou un Business
  avec une option vivante et une place libre ; jamais une Free, ni un essai. Un numéro déjà connecté (celui de l'essai)
  relève du lot D.
- **Après la connexion** (la voie « en attendant » de la spec) : Julien est alerté, et pose la ligne dans `/ops` une fois
  celle du partenaire branchée ; la console dit « Votre ligne s'ouvre sous 24 h ouvrées ». La pose automatique attend le
  premier essai, qui dira comment et quand le partenaire branche sa ligne (question 2 de la note privée).
- **Textes validés par Julien le 2026-11-09** : le bouton « Connecter sans carte chez Meta » (« Connect without a card
  at Meta ») ; la carte, option payée : « Votre option est payée : connectez votre numéro, Meta ne vous facturera pas.
  Votre ligne s'ouvre ensuite sous 24 h ouvrées. » ; en Entreprise : « Connectez votre numéro, Meta ne vous facturera
  pas. Votre ligne s'ouvre ensuite sous 24 h ouvrées. »

## Tâches

- [x] **E1, le serveur.** `fenetreDuPartenaire` : la règle, en un seul endroit. `GET /embedded-signup/config` rend
  `solutionId` seulement quand elle est vraie ; la vue de l'état (`/credit-whatsapp/etat`) dit `fenetrePartenaire` pour
  la carte. `POST /embedded-signup/complete` accepte `parLaLigne`, relit le droit (sans la condition « aucun numéro »,
  le numéro vient d'arriver) et alerte Julien : le geste à faire, ou « sans droit : ne pas brancher la ligne ». Tests :
  la règle sur chacun de ses cas ; la config sans droit ne rend jamais l'identifiant ; la fin alerte dans les deux cas.
- [x] **E2, la console.** `optionsFenetreMeta` reçoit l'identifiant ; `useConnexionNumero` ouvre la fenêtre par la
  solution quand on le lui demande, et refuse de l'ouvrir sans identifiant (jamais une connexion directe à la place) ;
  la carte « Crédit WhatsApp » montre le bouton et ses textes. Tests : unitaires de la fenêtre ; e2e de la carte, sur
  une construction de production (le bouton, `FB.login` appelé avec la solution, la fin envoyée avec `parLaLigne`).
  Décidé à l'implémentation : la carte chez Meta se reprend d'un clic, et le bouton du partenaire reste alors en second
  et referme son guide dans le même clic que la fenêtre (sans lui, revenir au bouton demandait de recharger la page).
- [x] **E3, la doc.** `features.md`, `documentation.md`, la fiche d'aide qui décrit les cartes, ce plan.

## Ordre de déploiement

L'API d'abord, puis la console : sans `solutionId` dans la config, la carte ne montre pas le bouton, donc l'écran
tolère une API d'avant. `META_SOLUTION_ID` ne se lit que dans l'API : il se pose dans le conteneur seul, en COMPLÉTANT
ses variables comme le fait le workflow de déploiement (un PATCH remplace la table entière), avec l'accord de Julien ;
le `.env.prod` de la machine n'en a pas besoin. Vide, rien ne change.

## Méthode de livraison

**Implémenteur par lot, puis une relecture indépendante du diff** : la connexion d'un numéro est un chemin de la
production, et la garde porte un invariant invisible (l'identifiant de la solution ne part qu'à un espace qui a droit à
la ligne, sans quoi la ligne du partenaire paierait les messages d'un espace qui ne l'a pas payée). TDD ; l'e2e de la
carte sur une construction de production.

**Essai réel** : sur un espace de TEST passé en Entreprise dans `/ops` (jamais Groupama PJ), sans numéro, avec
`META_SOLUTION_ID` posé : la carte montre « Connecter sans carte chez Meta », la fenêtre de Meta s'ouvre par la
solution, un numéro de test s'y connecte, Julien reçoit l'alerte ; on lit chez Meta que le compte est partagé avec le
partenaire, puis quand et comment sa ligne se branche ; Julien pose la ligne dans `/ops`, un modèle part et se
provisionne.

## La relecture du lot E (2026-11-09)

Une relecture indépendante du commit `01cf6682` : **aucun rouge, onze jaunes**. Variable vide, la production ne change
pas, quel que soit l'ordre de déploiement ; déployé tel quel. Mutations vérifiées avant elle : 12 côté serveur, 2 côté
console, 5 sur l'écran construit (dont une, la carte chez Meta active par défaut, qu'aucun test ne voyait : l'état
« ligne en attente » la masquait, l'e2e de l'Entreprise la tient désormais).

**À fermer avant de laisser la variable posée pour un vrai client, ou avant d'ouvrir la vente** (tous dépendent de la
question 2 de la note privée, que l'essai réel tranche : la ligne du partenaire s'attache-t-elle d'office au partage ?) :
1. Une fenêtre du partenaire réussie chez Meta mais refusée chez nous (compte d'un autre espace, second numéro, échange
   refusé, réseau, onglet fermé) n'alerte personne, alors que le partage a eu lieu : alerter aussi sur `!r.ok` quand
   `parLaLigne` (le test `ratee` s'inverse) ; l'onglet fermé ne se rattrape que par le webhook `PARTNER_ADDED`.
2. L'alerte dit « vérifier que le partenaire a branché sa ligne, PUIS poser la ligne dans /ops » : entre les deux, des
   envois partent sans débit. Écrire « poser la ligne dans /ops tout de suite » (un refus de Meta faute de paiement rend
   la provision). « Sans droit : ne pas brancher » devient « demander la révocation au partenaire » si l'attache est
   d'office.
3. L'alerte est la seule trace, et `sendTelegram` rend `false` sans lever : porter `parLaLigne` dans la trace d'audit
   `numero.connecte`, journaliser l'alerte perdue, alerter aussi quand le droit est illisible.
4. Une Entreprise connectée par la fenêtre lit ensuite l'état `a_prendre` : la carte dit « Sur demande » et met « Ma
   carte chez Meta » en avant, l'Accueil et `get_setup_state` peuvent dire d'ajouter sa carte. Lui donner l'état
   `en_attente` tant que sa ligne n'est pas posée, sur la marque gardée en base (point 3).

**Le lot de suite** : 5. compter tous les numéros, déliés compris, comme `hasNumber` et `linkTenant` (le test de
câblage s'inverse) ; 6. la configuration et l'état des cartes rendent `null` / `false` quand la règle ne se lit pas,
au lieu d'un 500 qui éteint toute connexion ; 9. après « Déconnecter le numéro », ne pas compter le numéro qui vient
d'arriver dans la relecture du droit ; 10. le commentaire « une seule instance par page » de `useConnexionNumero`,
`META_SOLUTION_ID` dans `.env.example` et contrôlé au démarrage (chiffres seuls, `trim`), la carte qui se dit ouverte
quand l'inscription est éteinte, `connexionParLaLigne` qui sort tôt variable vide, les tests d'une option `en_retard`,
de places à 0 et d'une fin ratée.

**À Julien** : 8. une option `en_retard` (Stripe relance) ouvre la fenêtre et la carte dit « Votre option est payée » ;
l'attache au partenaire ne se défait pas : réserver la fenêtre à une option `actif`, ou changer le texte.

**À l'ouverture de la vente** : 7. les autres entrées (la zone directe de l'Accueil, `/brancher`, l'onglet Crédit
WhatsApp, le serveur MCP) ne mènent pas à la fenêtre du partenaire ; la fiche publique « Connecter mon numéro WhatsApp »
et sa version anglaise disent encore « sur demande ». 11. Poser la variable ouvre la fenêtre à TOUS les espaces qui y
ont droit : le 2026-11-09, d'après ce qu'on sait, seulement des espaces de test (l'option n'est pas en vente, Groupama
PJ a son numéro) ; la sonde qui le mesure (la vraie règle sur chaque espace, en lecture seule) reste à lancer.

**En production le 2026-11-09** (run 42651171128, `01cf6682`) ; `META_SOLUTION_ID` posée dans le conteneur de l'API le
même jour, avec l'accord de Julien. L'essai réel est le 236 de la liste privée.
