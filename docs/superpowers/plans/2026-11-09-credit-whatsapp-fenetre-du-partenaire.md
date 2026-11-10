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
  part que vers un espace qui a droit à la ligne et qui n'a encore aucun numéro rattaché (délié compris, depuis le lot
  E4). Le droit se lit sur l'offre et
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
ont droit. Mesuré le 2026-11-09 par Julien, la vraie règle passée sur les 16 espaces en lecture seule
(`docs/prive/credit-whatsapp/sonde-fenetre-partenaire.mjs`) : 7 en Free, 9 en Entreprise, aucun en formule Pro ni en
Business ; la fenêtre s'ouvre à UN espace, une Entreprise de test sans numéro ; les huit autres Entreprises y ont droit
mais ont déjà leur numéro (lot D).

**En production le 2026-11-09** (run 42651171128, `01cf6682`) ; `META_SOLUTION_ID` posée dans le conteneur de l'API le
même jour, avec l'accord de Julien. L'essai réel est le 236 de la liste privée.

### E4. Le lot de suite : les jaunes 5, 6, 9 et 10 (accord de Julien du 2026-11-09)

Sans attendre l'essai 236 : aucun ne dépend de la question 2. Méthode : implémenteur par lot, TDD, puis une relecture
indépendante du diff (la configuration de la connexion et sa fin sont des chemins de production).

- [x] Jaune 5 : la règle compte les numéros RATTACHÉS, déliés compris (`numerosRattaches`, câblé sur
  `numerosDeLEspace` sans filtre). Tests : un numéro délié ferme la fenêtre ; le câblage le dit.
- [x] Jaune 6 : une règle qui ne se lit pas (base) ferme la fenêtre, journalisée, au lieu de faire échouer la
  configuration de la connexion et l'état des cartes. Test : une lecture qui lève rend `null`.
- [x] Jaune 9 : la relecture du droit à la fin ne compte pas le numéro qui vient d'arriver (`numerosCouverts` rend la
  liste, `droitALaLigne` reçoit le numéro à écarter). Test : une option d'une place dont la ligne couvre déjà le compte
  du numéro reconnecté, l'alerte dit le droit.
- [x] Jaune 10 : le commentaire de `useConnexionNumero` dit que deux connexions peuvent vivre ensemble ;
  `META_SOLUTION_ID` dans `.env.example`, des chiffres ou rien, espaces retirées au démarrage ; la fenêtre fermée quand
  l'inscription n'est pas configurée (la carte ne se dit plus ouverte sur un bouton grisé) ; variable vide, une fin
  marquée `parLaLigne` n'alerte pas. Tests : la garde de configuration dans les deux sens ; des places à 0 ; le câblage
  de l'inscription éteinte ; l'alerte muette variable vide. Le test d'une option `en_retard` attend la décision du
  jaune 8.

**Essai réel** : celui du lot E (le 236), sur l'Entreprise de test sans numéro ; en plus, une fois le numéro connecté,
le délier ne rouvre pas la fenêtre (le numéro reste rattaché), le déconnecter la rouvre (« Déconnecter le numéro »
supprime le numéro de l'espace).

### La relecture du lot E4 (2026-11-09) : aucun rouge, 6 jaunes

Commit `39ecffac` (relu sur `e6d8a9b0`, même contenu avant le report sur un commit de doc). Le lot ne fait que fermer :
il ne rend jamais l'identifiant à un espace sans droit et ne couche pas l'API au démarrage (la valeur posée est faite
de chiffres). En production, seul un espace délié voit un changement : sa fenêtre se ferme. Les six jaunes, pour le lot
suivant (avec les jaunes 1 à 4 du lot E, une fois l'essai 236 fait) :
1. La sortie tôt variable vide rend muette une vraie connexion : la variable vidée pour fermer la fenêtre, une page de
   la console lue avant garde son identifiant et ouvre quand même la fenêtre du partenaire ; avant ce lot, l'alerte
   partait. Un corps forgé ne la justifie pas (chaque fin exige un vrai code de Meta) : alerter avec un texte dédié
   (« fenêtre fermée ») plutôt que sortir sans trace.
2. La sonde privée (`docs/prive/credit-whatsapp/sonde-fenetre-partenaire.mjs`) construisait ses dépendances à
   l'ancienne : mise à jour après le déploiement de ce lot.
3. Le test du jaune 6 n'épingle pas le journal (`fenetre_partenaire_illisible`) : espionner la sortie d'erreur.
4. La parité « inscription non configurée » n'est tenue que d'un côté : le test du câblage fige la condition de la
   fenêtre, pas `configId` et `appId` du bloc `embeddedSignup` d'où la route tire `enabled`.
5. Un numéro reconnecté sur un compte que la ligne de l'option couvre déjà reçoit « poser la ligne dans /ops », alors que
   `/ops` répondra « déjà sur la ligne » : à dire dans la réécriture de l'alerte (jaune 2 du lot E).
6. Ce plan disait encore « aucun numéro vivant » (§ « Ce qui est décidé ») : corrigé.

### E5. Les jaunes 1 à 4 du lot E et 1, 3, 4, 5 du lot E4 (accord de Julien du 2026-11-09 : « ok avance »)

L'essai 236 a répondu en partie à la question 2 : le compte connecté par la fenêtre est bien partagé avec le partenaire
(sans le droit d'envoyer), mais **sa ligne ne s'attache pas d'elle-même** (« Missing valid payment method » juste après) :
Julien la lui demande. Et l'alerte de la connexion n'est jamais arrivée, alors que Telegram est configuré dans l'API.
Méthode : implémenteur par lot, TDD, puis une relecture indépendante du diff (la fin d'une connexion, l'état des cartes et
une migration sont des chemins de production).

- [x] Migration (son numéro se lit au moment du push, `npm run migrations` sur une copie à jour) :
  `phone_numbers.par_la_ligne_le timestamptz`, nullable, `lock_timeout` de 5 s. Elle part en `migration=avant` : le code
  l'écrit. Elle part avec le numéro à la déconnexion (sa ligne `phone_numbers` est supprimée).
- [x] Jaune 3, la trace : la fin d'une connexion par la fenêtre marque le numéro arrivé (`marquerParLaLigne`), la trace
  d'audit `numero.connecte` porte `parLaLigne`, une alerte qui ne part pas est journalisée
  (`alerte_fenetre_partenaire_perdue`), un droit illisible alerte quand même. Tests : la marque, l'audit, le journal de
  l'alerte perdue, l'alerte du droit illisible ; en intégration, la marque relue par `numerosDeLEspace`.
- [x] Jaune 4, l’état : une Entreprise dont un numéro est arrivé par la fenêtre lit `en_attente` tant qu'aucune ligne
  n'est posée ; la carte, l'Accueil et `get_setup_state` suivent (`creditPaieMeta`). Tests : l'état, sa source câblée.
- [x] Jaune 2 et 5 du lot E4, l’alerte : « poser la ligne dans /ops tout de suite, puis demander au partenaire
  d'attacher sa ligne à ce compte WhatsApp » ; un compte déjà couvert par la ligne de l'option, rien à poser ; sans
  droit, ne pas poser et demander au partenaire de ne rien attacher. Tests : chaque texte.
- [x] Jaune 1, la fenêtre refusée chez nous : une fin `parLaLigne` qui échoue (compte d'un autre espace, second numéro,
  échange refusé) alerte aussi, le compte étant peut-être déjà partagé. Test : le cas `ratee` s'inverse.
- [x] Lot E4 : variable vide, une fin marquée par la ligne alerte (« fenêtre fermée ») au lieu de se taire (jaune 1) ;
  le journal de la règle illisible épinglé (3) ; la parité de l'inscription des deux côtés du câblage (4).

**Ordre de déploiement** : la migration d'abord (`migration=avant`), l'API dans le même run ; la console ne change pas.

**Essai réel** : l'essai 236 continue (son numéro, connecté avant ce lot, n'a pas la marque : sans effet, sa ligne est
posée). Une prochaine connexion par la fenêtre doit envoyer l'alerte au nouveau texte, et la carte d'une Entreprise dire
« Votre ligne s'ouvre sous 24 h ouvrées » avant la pose.

### La relecture du lot E5 (2026-11-09) : un rouge, corrigé ; 8 jaunes

Commit `77f3988c`. **Le rouge** : la marque ne disparaissait qu'avec le numéro ; une ligne retirée (ou jamais posée sur
décision de Julien) laissait l'Entreprise « en attente » pour toujours, et `creditPaieMeta` taisait « Ajoutez votre
carte chez Meta » alors que Meta bloquait ses envois. Corrigé avant tout déploiement : le numéro n'est marqué que quand
l'alerte dit de poser (jamais sans droit, fenêtre fermée ni droit illisible) ; l'attente (`attendLigne`) s'éteint dès
qu'une ligne de l'espace a été posée depuis la marque, retirées comprises. Tests : quatre cas sans marque et la source de
l'état, vus rouges sur l'ancien comportement ; l'extinction par une ligne posée puis retirée, en intégration (CI seule).
Les huit jaunes, pour le lot suivant :
1. « Poser tout de suite » : entre la pose et l'attache du partenaire, la carte dit « payés par votre Crédit WhatsApp »
   et une campagne lancée alors échoue en entier ; un compte qui aurait déjà un moyen de paiement chez Meta serait débité
   deux fois. À Julien : vérifier le moyen de paiement chez Meta avant de poser, et ce que dit la carte pendant l'attente.
2. Un corps forgé (`code` bidon, `parLaLigne: true`) déclenche l'alerte « connexion REFUSÉE » à volonté, et `wabaId`,
   ni borné ni validé, part dans le texte : une alerte de refus par espace et par demi-heure, `wabaId` cité s'il est fait
   de chiffres.
3. La cause de l'alerte perdue de l'essai 236 reste inconnue : relire les lignes `[telegram]` du conteneur de l'API, ou
   lister dans `/ops` les espaces dont un numéro attend sa ligne.
4. `attendLigne` est facultatif dans les types : le câblage réel est désormais épinglé (`tests/credit-whatsapp-cablage`).
5. « Déjà couvert » ne lit que les lignes de l'option : une Entreprise reconnectée sur un compte couvert par une ligne
   `ops` reçoit « poser » et `/ops` répond « déjà sur la ligne » ; lire la couverture toute origine.
6. Un compte relié sans numéro : « poser tout de suite » sans numéro à poser, et le numéro ajouté ensuite n'est jamais
   marqué.
7. Une exception après le rattachement (`saveCredentials`) rend 500 sans marque ni alerte, alors que le compte est
   partagé : un `catch` qui alerte quand `parLaLigne`.
8. Le journal d'une alerte perdue garde le numéro affiché dans son texte, quand l'audit refuse de le garder.


**En production le 2026-11-09** : run 42688984174 (`2d9943e8`, `migration=avant`, 0284 de l'Inbox HubSpot et 0285 appliquées avant la bascule).

### E6. Les huit jaunes du lot E5 (accord de Julien du 2026-11-09 : « Oui, enchaîne »)

Deux décisions de Julien du même jour : **la ligne se pose APRÈS l'attache du partenaire** (jaune 1 : avant, Meta
refuse les envois pendant que la carte dit « payés par votre Crédit WhatsApp », et un compte qui a déjà sa carte chez
Meta paierait deux fois) ; **la liste dans `/ops`** (jaune 3 : le geste à faire ne dépend plus de Telegram), sans bouton
d'essai Telegram ni lecture de Cockpit. Méthode : implémenteur par lot, TDD, puis une relecture indépendante du diff
(l'alerte de la connexion, une route de `/ops` et l'état des cartes sont des chemins de production). Aucune migration.

- [x] Jaune 1, l'ordre des gestes : l'alerte d'un numéro à poser dit « demander au partenaire d'attacher sa ligne,
  puis poser la nôtre quand il confirme l'attache, pas avant » ; la marque reste, l'Entreprise lit « Votre ligne s'ouvre
  sous 24 h ouvrées. » jusqu'à la pose. Test : le texte.
- [x] Jaune 2, le refus forgé : une alerte de refus par espace et par demi-heure (verrou court jamais relâché, le refus
  retenu journalisé) ; le compte n'est cité que s'il est fait de chiffres. Tests : deux refus, une alerte ; un compte
  `waba-x` dit « inconnu » ; un verrou illisible alerte quand même.
- [x] Jaune 3, la liste : `GET /ops/credit-whatsapp/en-attente`, les numéros marqués sans ligne posée depuis, tous
  espaces, par le MÊME prédicat que `numerosDeLEspace` (un fragment SQL écrit une fois) ; sa section dans la carte
  Crédit WhatsApp de `/ops`, qui tolère une API sans la route. Tests : la route sous la garde de `/ops`, le prédicat en
  intégration, l'e2e de la carte.
- [x] Jaune 4 : `attendLigne` requis dans les types (`SourcesEtatLigne`, la route de l'onglet) ; les fixtures le disent.
- [x] Jaune 5, la couverture toute origine : « déjà couvert » lit la ligne qui couvre le numéro (`ligneDuNumero`, une
  ligne `ops` comprise) ; celle d'un AUTRE espace a son texte (la retirer dans `/ops` avant de poser) et marque le
  numéro, qui attend sa ligne. Tests : une ligne `ops` de l'espace, une ligne d'un autre espace.
- [x] Jaune 6, le compte relié sans numéro : l'alerte ne dit plus de poser (rien à poser sans numéro) mais de demander
  l'attache ; le numéro connecté ensuite par la fenêtre enverra sa propre alerte, connecté autrement il se pose à son
  arrivée. Décidé : pas de marque au niveau du compte, une migration pour un cas rare (dans le parcours ordinaire, le
  numéro arrive par la fenêtre, qui le marque). Test : le texte, et aucune marque.
- [x] Jaune 7, l'exception : une connexion par la fenêtre qui lève en route (le rattachement, le jeton, la trace)
  alerte (« connexion INTERROMPUE ») avant de remonter en 500, sous la même retenue que le refus. Test : le rattachement
  qui lève (la base), par la fenêtre et en connexion directe.
- [x] Jaune 8, le journal : une alerte perdue se journalise par son cas, jamais par son texte (le numéro affiché).
  Test : le journal sans le numéro.

**Ordre de déploiement** : l'API seule (`migration=aucune`) ; la carte de `/ops` part au push et dit la liste
illisible le temps du déploiement.

**Essai réel** : à la prochaine connexion par la fenêtre (un espace Entreprise de test SANS numéro), l'alerte dit de
demander l'attache puis de poser, et le numéro figure dans la liste de `/ops` jusqu'à la pose.

### La relecture du lot E6 (2026-11-10) : aucun rouge, 7 jaunes

Commit `1c7cdec0`. Aucun rouge : le lot part, ses jaunes attendent le lot suivant.
1. La retenue tient UNE clé par espace, prise avant de distinguer le refus de l'interruption : un refus (forgé ou
   légitime) tait 30 min l'alerte « INTERROMPUE », seul signal d'un compte relié à moitié, dont le numéro reste sans
   marque et hors de la liste. Une clé à part pour l'interruption, et la marque tentée dans le `catch`.
2. Une ligne de l'espace encore en cours (un ancien numéro déconnecté, sa ligne jamais retirée) fait dire `active` aux
   cartes pendant que la liste de `/ops` montre le nouveau numéro en attente : pour une Entreprise, lire l'attente avant
   les lignes, ou ne compter que les lignes qui couvrent un numéro rattaché.
3. « Déjà couvert » ne regarde pas `arreteeLe` : une ligne arrêtée de l'espace (la garde refuse les envois) fait dire
   « rien à poser ». Lui donner son cas, avec la marque.
4. Le texte « autre espace » ne nomme ni l'espace ni le numéro de la ligne à retirer, et son ordre (retirer, demander,
   poser) ouvre une fenêtre d'envois non comptés si la ligne du partenaire est encore attachée : les citer, et vérifier
   l'attache d'abord.
5. Rien n'éteint une attente jamais posée (un partenaire qui n'attache pas) : la seule sortie est de poser puis retirer
   la ligne, écrite désormais dans le manuel ; un geste « ne pas poser » signé dans la liste serait meilleur.
6. L'alerte de refus cite le message de Graph tel quel, qui peut reprendre le compte forgé du corps : un libellé fixe par
   cause, le message de Meta au journal.
7. Les cases du lot, cochées avec cette relecture.
