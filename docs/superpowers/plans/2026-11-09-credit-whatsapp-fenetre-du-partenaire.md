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
tolère une API d'avant. Julien pose `META_SOLUTION_ID` dans le conteneur et le `.env.prod` de la machine (la commande
lui est donnée prête) ; vide, rien ne change.

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
