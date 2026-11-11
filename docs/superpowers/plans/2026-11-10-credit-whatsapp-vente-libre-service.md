# La vente du Crédit WhatsApp en libre-service, côté serveur (lot 3v)

**Spec** : `docs/superpowers/specs/2026-11-08-aide-connexion-numero-design.md`, § « Décisions de Julien (2026-11-10) » ;
la révision du crédit, `docs/superpowers/specs/2026-11-04-credit-whatsapp-ligne-a-la-connexion-design.md`.

**Le découpage, validé par Julien le 2026-11-10** : ce chantier porte le serveur (la règle de l'essai, la pose
automatique une fois l'attache prouvée, la fenêtre du numéro fourni, la liste avant le prix, les jaunes du lot E7) ; la
session de l'aide à la connexion porte l'arbre (vitrine, console dont `QuiRegleMeta` et ses textes, skill, consignes
MCP). Frontières de fichiers croisées ; tout changement des valeurs d'`EtatLigne` ou de la vue `/credit-whatsapp`
s'annonce avant le push.

## Ce qui est décidé

Julien, le 2026-11-10 (spec) : la personne prend le Crédit WhatsApp SEULE, dans l'ordre l'option, puis la fenêtre du
partenaire, puis du crédit ; le numéro fourni passe aussi par la fenêtre ; l'option se prend et se paie dès le début de
l'essai Pro de 14 jours, la formule Pro se facture au bout de l'essai, un essai non payé arrête l'option sans
remboursement. Puis, le même jour (AskUserQuestion) :
- un Pro en essai prend l'option même s'il a programmé l'arrêt de sa formule à la fin de l'essai ;
- un Business en essai attend la confirmation de Julien, comme avant (la décision ne vise que l'essai Pro) ;
- un essai non payé arrête l'option à la CLÔTURE de la formule par Stripe, ce que fait déjà la fin de droit : le mois
  payé de l'option couvre les relances, et une carte réglée pendant les relances garde son option.

🔴 **La pose automatique attend la preuve de l'attache automatique.** Mesuré à l'essai réel 236 : avec
`META_SOLUTION_ID`, la ligne du partenaire ne s'attache PAS d'elle-même. Poser la nôtre avant son attache, c'est ce que
Julien a écarté le 2026-11-09 (Meta refuse les envois, un compte qui a déjà sa carte paierait deux fois). Il faut « le
bon lien » du partenaire et un essai réel qui le prouve (D0) avant de retirer la pose manuelle.

## Le contrat d'état pendant l'essai (envoyé à la session de l'aide à la connexion le 2026-11-10)

Les valeurs d'`EtatLigne` ne changent pas. Un Pro dans ses 14 jours (abonnement actif, essai en cours, fin programmée ou
non) sans option lit `a_prendre`, et non plus `essai` ; option payée, `en_attente` (la fenêtre s'ouvre tant qu'aucun
numéro n'est rattaché) ; ligne posée, `active`. `essai` ne vaut plus que pour un Business en essai et pour un Pro en
retard de prélèvement. `GET /credit-whatsapp/etat` garde sa forme ; la vue de l'onglet gagne `option.prisePossible`
(la règle de la prise), `option.formulePayee` garde son sens.

## Tâches

### V1. La règle de l'essai

- [x] `optionPrenable` (`src/offres/formule-payee.ts`) : vraie pour un Pro actif (essai compris, fin programmée ou non,
  jamais en retard ni fini) et pour un Business confirmé (`formulePayee`) ; jamais une Free ni une Entreprise. Tests :
  chaque cas, dont l'essai avec une fin programmée.
- [x] La prise (`ouvrirOption`) et l'état des cartes (`etatLigneCredit`) lisent `optionPrenable` : un Pro en essai prend
  l'option et lit `a_prendre`. Le refus `option_apres_essai` ne vaut plus que pour un Business en essai, son texte le
  dit ; `formule_en_retard` est inchangé. Tests : la prise d'un Pro en essai, d'un Pro en essai à fin programmée, d'un
  Business en essai (refusée), d'un Pro en retard (refusée) ; l'état de chacun.
- [x] La vue de l'onglet gagne `option.prisePossible` ; la reprise après un arrêt (`repriseOuverte`) suit la même règle.
  Tests : la vue, la reprise d'un Pro en essai.
- [x] Le câblage (`src/index.ts`, bloc de l'option) épinglé ; le manuel (`documentation.md`) et le journal.

Livré par `ea6979ff`, relu (§ « La relecture du lot V1 ») ; **en production le 2026-11-10** (run 42826757148,
`migration=aucune`, épinglé sur `200f7250` : `mba-api` et les workers en `200f7250`, sans erreur, fumée bonne).

### V2. Le numéro fourni par la fenêtre du partenaire

- [x] Lire le parcours du numéro fourni : il ne doit rien rattacher avant la fenêtre (sinon `solutionDuPartenaire` la
  ferme), et la console doit l'ouvrir avec `parLaLigne`. Corriger côté serveur ce qui l'empêche ; le reste à l'arbre.

**Lu le 2026-11-10 : rien ne l'empêche côté serveur.** Seul `linkTenant` (`src/account/es-store.pg.ts`) ajoute une
ligne à `phone_numbers`, la table que compte `numerosRattaches` : la fin de la connexion, et le rattachement d'un compte
360dialog, qui n'est pas un parcours du numéro fourni (les autres écrivains changent des colonnes ou suppriment). Un
numéro fourni attribué vit dans `numeros_fournis`, et un compte de l'application dans ses propres tables. `GET /embedded-signup/config` rend
donc `solutionId` à un espace qui y a droit, numéro fourni attribué ou non, y compris par le lien de Claude Code (garde
`adminOuLien`) ; la fin par la fenêtre (`parLaLigne`) passe par `connexionParLaLigne` comme son propre numéro. Ce qui
reste est à l'arbre, transmis à sa session le même jour : le parcours du numéro fourni (Connecter WhatsApp et `/brancher`)
ouvre la fenêtre avec `cfg.solutionId` et finit avec `parLaLigne`, en mode `fourni` et jamais `fourni_application` (la
ligne ne paie que les messages de l'API). Aucun code ici ; les jaunes 1, 5 et 6 de V1 partent avec ce lot.

### V3. La pose automatique (après D0)

- [ ] Bloquée tant que l'attache automatique n'est pas prouvée. Ensuite : `connexionParLaLigne` pose la ligne (origine
  `option` avec ses places, `ops` pour une Entreprise) au lieu de marquer l'attente, qui reste en repli.

### V4. Avant le prix

- [ ] La liste à Julien : `STRIPE_PRIX_OPTION_WA` (il ouvre l'onglet à tous les Pro et Business), la quantité fermée dans
  le portail de Stripe, puis pour 4b la clé restreinte élargie aux factures et les secrets Stripe du worker ; les jaunes
  « avant la vente » des lots B et C.
- [ ] Trois préalables venus de la relecture de V1 (jaunes 2 à 4) : la console qui lit `option.prisePossible` est en
  production (fait : `a830bece`, lot 3v-1 de la session de l'aide à la connexion, le 2026-11-10) ; le numéro d'essai
  déjà connecté a sa réponse (le lot D, ou une décision de Julien) ; le texte de l'e-mail du paiement refusé de la
  formule Pro, qui doit parler de l'option : VALIDÉ par Julien le 2026-11-11, il part avec V11.

### V5. Les jaunes des relectures du lot E7 et de V1

- [x] Les sept du lot E7, au plan `2026-11-09-credit-whatsapp-fenetre-du-partenaire.md` (§ « La relecture du lot E7 ») :
  « Ne pas poser » refusé (409) tant que la ligne d'un autre espace, ou une ligne arrêtée de l'espace, couvre encore le
  compte (1) ; la carte de `/ops` et le manuel disent ce que l'espace relit ensuite (2) ; la justification de l'attente
  avant les lignes réécrite, l'écart de `get_credit` écrit (3) ; une interruption retrouve en base le numéro rattaché,
  et l'alerte dit s'il attend dans la liste (4) ; la cause d'un refus `parLaLigne` au journal du serveur (5) ; « déjà
  couvert » marque le numéro, « ligne arrêtée » cite son numéro et suit « autre espace » (6) ; une alerte incertaine
  (délai dépassé, panne réseau) garde sa retenue, `envoyerTelegram` (7).
- [x] Les jaunes 1, 5 et 6 de V1 (§ « La relecture du lot V1 »), avec V2 : la conversion du webhook se tait tant que la
  fin de l'essai est à venir ; la vue de l'onglet lit la formule en une lecture (`formuleEtPrise`) ; les commentaires et
  la doc d'avant V1 remis à jour, dont la JSDoc de `prisePossible`.
- [x] Les jaunes 1, 2, 5, 6 et 7 de la relecture de V2 (§ « La relecture du lot V2 ») : le câblage de la conversion
  épinglé, vérifié par deux mutations (1) ; les JSDoc de la conversion (2) ; les deux commentaires d'avant V1 (5) ; une
  connexion en coexistence par la fenêtre n'est ni marquée ni à poser, l'alerte le dit (6) ; cinq minutes de tolérance
  d'horloge (7).

Livré par `7c81f9ba` (relu sous `f131d9a3`, avant un rebase sans conflit ; § « La relecture du lot V5 ») ; **en
production le 2026-11-10** (run 42874666331, `migration=aucune`, épinglé sur `54f404db` : `mba-api` et les workers en
`54f404db`, sans erreur, fumée bonne). V2 (`c7ab5b51`, relu sous `725eebea`) était parti avant, emporté par le
déploiement de l'Inbox HubSpot (run 42858518482, `1b9a9a23`, approuvé par Julien), vérifié en service le même soir.

### V6. Les jaunes de la relecture de V5

- [x] Les neuf (§ « La relecture du lot V5 ») : une interruption ne retrouve que le numéro annoncé, ou sans annonce le
  seul du compte du corps (1) ; les 409 de « Ne pas poser » nomment la ligne qui bloque et disent de ne la retirer
  qu'une fois la ligne du partenaire détachée, ou en posant la nouvelle dans le même geste (2) ; la coexistence ne
  remplace plus que « à poser », l'alerte dit les deux ailleurs (3) ; un numéro en coexistence n'est jamais marqué après
  une interruption (4) ; le commentaire de l'état et le manuel disent ce que lit une Entreprise déjà couverte (5) ;
  `coexistence` requis jusque dans le câblage (6) ; l'alerte d'une interruption dit ce qu'elle sait de la liste, relue
  après la marque, et « illisible » quand elle ne sait pas (7) ; une connexion jamais établie compte pour non reçue (8) ;
  la carte de `/ops` et le manuel disent ce que relit une Entreprise qui garde la ligne d'un ancien numéro (9).

## Ordre de déploiement

V1 : l'API seule, sans migration. Tant que le prix n'est pas posé (`enVente` faux), rien ne se voit ; la console de
l'arbre lit `prisePossible` quand l'API le rend, et le lit comme `formulePayee` avant.

V2 et les jaunes de V1 : l'API seule, sans migration, le contrat HTTP inchangé, rien pour la console.

V5 : l'API, sans migration, et le texte de la carte de `/ops` (Vercel au push). Le texte peut précéder l'API : il dit le
refus de « Ne pas poser » qu'elle apporte, sur un écran interne. Le contrat de `/ops` gagne deux codes de refus
(`couvert_autre_espace`, `couvert_arrete`), que la carte affiche par leur message.

V6 et V7 : l'API, sans migration, et le texte de la carte de `/ops` (Vercel au push, qui peut précéder l'API : la carte
n'affiche que le texte du 409, dont le corps gagne `ligne`, que rien ne lit encore). V6 est en production le 2026-11-10
(run 42885204406, `6e927b63`).

V8 : l'API, sans migration (des textes d'alerte, un avertissement au journal), et la consigne de la carte de `/ops`
(Vercel au push, qui peut précéder l'API : elle dit ce que « Ne pas poser » fait déjà).

V9 (jaunes 1 à 3) : rien à déployer côté API (des tests et une JSDoc) ; l'exemple du champ de note part avec la console,
au push.

V7, V8 et V9 sont en production ensemble le 2026-11-11 (run 42983102680, `baa1f16e`, une seule approbation, avec le lot
4a-3 de l'aide, d'accord avec sa session).

V10 : rien à déployer (des JSDoc et des tests) ; il ne pousse qu'après la CI de V9 et celle du lot de l'aide qui la suit.

V11 : l'API, sans migration (l'e-mail part du webhook de Stripe, le texte d'alerte de la fenêtre du partenaire) ; ses
JSDoc avec elle.

## Méthode de livraison

**Implémenteur par lot, puis une relecture indépendante du diff**, parce que la prise de l'option et l'état des cartes
sont des chemins de la production (un paiement Stripe, ce que la console et Claude disent au client) et portent un
invariant invisible : la règle de la prise est la MÊME pour la prise, l'état, la vue et la reprise, sinon un écran vend
ce que le serveur refuse. TDD.

**Essai réel** : à l'ouverture de la vente, sur un espace Pro de TEST dans ses 14 jours, l'option se prend depuis la
carte, se paie, la fenêtre du partenaire s'ouvre et connecte un numéro ; la carte lit `a_prendre`, puis `en_attente`,
puis `active` à la pose.

## La relecture du lot V1 (2026-11-10)

Un relecteur indépendant, sur le diff de `ea6979ff` : **aucun rouge, six jaunes**. V1 part tel quel ; chaque jaune va au
lot qui le porte.

1. **L'e-mail de la conversion pendant l'essai** (`signalerConversionDuPro`). Un espace Pro en essai sans option lit
   désormais `a_prendre`, la garde de l'e-mail, et sa fenêtre de 25 jours se compte depuis la fin de l'essai, dans le
   futur pendant l'essai : rien ne l'arrête. Aucun chemin ne l'appelle aujourd'hui pendant un essai (la facture à 0 €
   n'est pas une période payée, la mise à jour ne vaut que pour un abonnement `active`), mais la garde ne doit pas
   reposer sur Stripe : sortir quand `depuis` est dans le futur, et le cas du test devient un espace Pro en essai. V5.
2. **La console qui lit `prisePossible`, en production AVANT le prix.** Tant que l'onglet décide sur `formulePayee`, un
   espace Pro en essai lirait « Prendre l'option » sur les cartes et le bandeau, et l'onglet lui proposerait de démarrer
   la formule Pro tout de suite (49 € HT prélevés). `prisePossible` se combine avec `option.disponible` et l'absence
   d'option vivante : contrat précisé à la session de l'aide à la connexion le même jour, qui l'a pris. V4.
3. **Le numéro d'essai déjà connecté.** La fenêtre du partenaire se ferme dès qu'un numéro est rattaché : un espace Pro
   qui a connecté son numéro en direct (sa carte chez Meta), puis prend l'option, reste en `en_attente` sans fenêtre.
   Le lot D (la migration du numéro) ou une décision de Julien, avant le prix. V4.
4. **L'e-mail du paiement refusé de la formule Pro** (`paiement_refuse_pro`) ne dit pas que l'option s'arrêtera avec la
   formule : un texte à soumettre à Julien, avant le prix. V4.
5. **La vue de l'onglet lit la formule deux fois** (`formulePayee` puis `prisePossible`, chacune par `formuleDe`) : une
   seule lecture suffit. V5.
6. **Des commentaires et des passages écrits avant V1** : deux passages de `documentation.md` sur la règle de la prise,
   l'onglet dans `features.md`, des commentaires de `fenetre-partenaire.ts`, `index.ts` et `gestion-pro.ts`, l'en-tête
   de `formule-payee.test.ts` et un commentaire de `webhook-pro.test.ts` ; la JSDoc de `prisePossible` doit dire qu'il se
   combine avec `disponible` et l'absence d'option vivante. V5.

## La relecture du lot V2 (2026-11-10)

Un relecteur indépendant, sur le diff de `725eebea` : **aucun rouge, huit jaunes**. Le constat de V2 est confirmé : seul
`linkTenant` ajoute une ligne à `phone_numbers`, et rien côté serveur ne ferme la fenêtre à un numéro fourni. Les
jaunes 3, 4 et 8 (le manuel et ce plan) sont corrigés dans le commit qui inscrit cette relecture ; les autres vont à V5.

1. **La garde de la conversion ne tient que par le câblage** : `proPayeDepuis` doit rendre la fin de l'essai
   (`essaiFinLe ?? creeLe`), et le webhook passer par `signalerConversionDuPro`. Aucun test ne lit ce câblage : trois
   expressions de plus au test de câblage, vérifiées dans les deux sens.
2. **La JSDoc de `DepsConversion.etat`** dit encore « la règle de la formule payée », alors que c'est celle de la prise
   (`optionPrenable`) ; celle de `proPayeDepuis` doit dire que la date est à venir tant que l'essai court.
3. Le manuel disait `droitALaLigne` « jamais un essai » : corrigé, un espace Pro en essai avec son option y a droit.
4. Le manuel oubliait, dans `a_prendre`, l'Entreprise sans ligne ni numéro qui attend : corrigé.
5. **Des commentaires d'avant V1 hors du lot** : `noterFinEssai` dans `src/offres/abonnements-offre.pg.ts` (« l'option
   s'ouvre dans la foulée ») et `src/stripe/traitement-abonnements.ts` (« la formule payée se relit ») ; côté arbre,
   l'en-tête de `web/components/BandeauLigneCredit.tsx`, transmis à sa session.
6. **Défense en profondeur autour de V2** : un corps `parLaLigne: true` qui porte la coexistence aboutit côté serveur ;
   `connexionParLaLigne` ne reçoit pas `coexistence`, marque le numéro « à poser », et l'alerte ne dit pas qu'il garde
   l'application. Passer `coexistence` et le dire dans l'alerte, ou ne pas marquer le numéro.
7. **Trois horloges sans tolérance** dans `ecoule < 0` (Stripe, la base, le conteneur) : un écart plus grand que le délai
   du webhook ferait taire la conversion d'un essai écourté au tableau de bord, ou d'un Pro sans essai. Très improbable
   avec NTP ; une tolérance de quelques minutes, ou l'écrire.
8. L'ordre de déploiement ne parlait que de V1 : corrigé.

## La relecture du lot V5 (2026-11-10)

Un relecteur indépendant, sur le diff de `f131d9a3` : **aucun rouge, neuf jaunes**. Le lot part tel quel ; ses jaunes vont
à V6.

1. **L'interruption peut retrouver un numéro étranger** : quand le corps annonce un numéro qui n'est pas rattaché, le
   seul rattaché est étranger à cette connexion (`connecterNumero` prend le numéro annoncé tel quel, `linkTenant` refuse
   un second numéro). Une page restée ouverte et un autre numéro connecté entre-temps : ce numéro serait marqué, et
   l'alerte inviterait à poser sa ligne sur une attache vue sur un autre compte. Rare. Le repli seulement sans annonce,
   et vers un numéro du compte du corps ; le cas « ou en dit un autre » du test est à réécrire.
2. **Les deux 409 de « Ne pas poser »** disent de retirer la ligne sans condition, alors qu'une ligne arrêtée, ou celle
   d'un autre espace, peut encore payer chez Meta : « une fois la ligne du partenaire détachée, ou la nouvelle posée
   dans le même geste ». Et nommer l'espace et le numéro de la ligne couvrante dans le corps du 409.
3. **La coexistence jugée avant tout** : un compte sur la ligne d'un autre espace, sur une ligne arrêtée, ou sans droit,
   perd sa mention dans l'alerte. Lire `casDeConnexion` dans tous les cas ; la coexistence ne remplace que `a_poser`.
4. **L'interruption d'une connexion en coexistence** marque son numéro, que la pose refusera : `numerosRattaches` rend
   aussi la coexistence, et un numéro en coexistence n'est pas marqué.
5. **Une Entreprise déjà couverte dont l'attache est faite** lit « Votre ligne s'ouvre sous 24 h ouvrées » jusqu'au
   « Ne pas poser », pendant que l'onglet et `get_credit` la disent sur la ligne : l'écrire au commentaire et au manuel,
   ou lire `active` quand une ligne active couvre le numéro qui attend.
6. **Le câblage annote `n` sans `coexistence`** (`src/index.ts`, l'inscription) : retirer l'annotation, ou rendre
   `coexistence` requis dans `connexionParLaLigne`.
7. **« Aucun numéro rattaché à poser »** se dit aussi après une lecture ou une marque ratée, ou pour un numéro rattaché
   sans droit : trois textes, dont « illisible ».
8. **`envoyerTelegram` rend `incertaine`** sur une connexion jamais établie (ENOTFOUND, EAI_AGAIN, ECONNREFUSED) :
   `non_recue` sur ces codes, `incertaine` sur le délai et une coupure en cours.
9. **La carte de `/ops` tait l'Entreprise qui garde la ligne d'un ancien numéro**, qui lit `active` après « Ne pas
   poser » (préexistant) : le dire, ou ne compter pour `active` que les lignes qui couvrent un numéro rattaché.

## La relecture du lot V6 (2026-11-10)

Un relecteur indépendant, sur le diff de `66e5b8e1` : **aucun rouge, six jaunes**. Le lot part tel quel ; ses jaunes vont
à V7.

1. **L'alerte en coexistence promet une liste où le numéro n'est pas** : sur une ligne déjà active ou arrêtée de
   l'espace, le texte du cas garde « le numéro attend dans la liste de /ops » (et « Ne pas poser » pour la ligne active),
   alors qu'un numéro en coexistence n'est jamais marqué, et le suffixe ne le dément pas. Retirer la phrase de la liste
   en coexistence, et le tester par `not.toContain` ; décider à part si ces deux cas bloquants méritent la liste.
2. **Une annonce mal formée retombe sur le repli « sans annonce »** : un numéro annoncé qui n'a pas la forme d'un
   identifiant de Meta devient « aucun numéro annoncé », et le seul rattaché du compte du corps est marqué. Distinguer
   une annonce rejetée d'une annonce absente ; un rattaché dans le test du mal formé ; le repli « ni numéro ni compte »
   au manuel.
3. **La carte de `/ops` et le manuel confondent deux lignes actives** : « une Entreprise qui garde la ligne active d'un
   ancien numéro lit payés par votre Crédit WhatsApp, sans que son numéro soit couvert » n'est vrai que pour une ligne
   d'un AUTRE compte WhatsApp ; sur le même compte (« déjà couvert »), la ligne couvre bien le numéro. Lu à l'envers, le
   texte ferait retirer une ligne qui couvre le compte, l'attache vérifiée, et les envois partiraient payés par le
   partenaire sans provision. Écrire « d'un AUTRE compte WhatsApp », et l'issue du cas déjà couvert.
4. **`hors_liste` invente une cause** : il sort aussi pour un numéro qui n'est plus relu (déconnecté entre la marque et
   la relecture) ou dont l'attente vient d'être levée, et l'alerte dit « une ligne a été posée depuis sa première
   marque » ; le câblage de `marquer` jette le `false` de `marquerParLaLigne`. Un numéro absent à la relecture rend
   `aucun` ou `illisible`, et `hors_liste` un texte qui ne choisit pas la cause.
5. **Deux commentaires d'avant le jaune 8** : les JSDoc d'`alerter` et d'`alerterSansPerte` disent encore « incertaine
   (délai dépassé, panne réseau) ».
6. **L'ordre de déploiement n'a pas de ligne V6** : l'API sans migration, la carte au push (elle n'affiche que le texte
   du 409).

### V7. Les jaunes de la relecture de V6

- [x] Les six (§ « La relecture du lot V6 ») : en coexistence, l'alerte ne promet plus la liste ni « Ne pas poser » (1) ;
  une annonce mal formée, numéro ou compte, ne retombe sur aucun repli (2) ; la carte de `/ops` et le manuel distinguent
  le compte déjà couvert, dont la ligne couvre bien le numéro, de la ligne d'un ancien numéro d'un AUTRE compte (3) ; la
  marque rend ce qu'elle a écrit, un numéro parti avant la relecture dit « aucun », et « hors liste » ne choisit plus la
  cause (4) ; les JSDoc de l'alerte (5) ; l'ordre de déploiement de V6 et V7 (6). Reste une décision à Julien : les deux
  cas bloquants en coexistence (ligne arrêtée, ligne d'un autre espace) méritent-ils une place dans la liste ?

## La relecture du lot V7 (2026-11-10)

Un relecteur indépendant, sur le diff de `99926008` : **aucun rouge, cinq jaunes**. Le lot part tel quel ; ses jaunes
vont à V8.

1. **`enListe` suit la décision de marquer, pas son résultat** : une marque en panne, absente, ou rejouée sur un premier
   moment déjà éteint laisse l'alerte de connexion promettre la liste de /ops. Le fond est d'avant, mais la JSDoc neuve
   dit plus que le code : lire le résultat de `marquerSansLever` (et le dire), ou corriger la JSDoc ; un test qui fait
   lever `marquer`.
2. **En coexistence, les gestes de « ligne arrêtée », « autre espace » et « déjà couvert » ne se font qu'à moitié** :
   « retirer et poser », puis « la pose de /ops le refusera » ; retirer seul ouvrirait des envois payés par le partenaire
   sans provision. Chemin improbable (la fenêtre ne s'ouvre pas en coexistence). Un texte propre à ces trois cas en
   coexistence (ne rien retirer, ne rien poser, ne rien demander au partenaire sans décision), avec la décision laissée à
   Julien sur leur place dans la liste.
3. **La carte de `/ops` : « un compte déjà couvert garde sa ligne, qui couvre bien son numéro » ne vaut que l'attache
   vérifiée** : sur un compte couvert dont le partenaire n'attache pas, « Ne pas poser » seul garde notre ligne, et le
   client paierait deux fois (sa carte chez Meta et notre provision) ou Meta refuserait ses envois. Écrire « l'attache
   vérifiée », et « sans attache, retirer d'abord la nôtre (Ne pas poser ne la retire pas) ».
4. **L'asymétrie du rejet d'une annonce n'est tenue par aucun test** : un numéro valide avec un compte mal formé doit
   rester retrouvé et marqué.
5. **Des commentaires derrière le code** : celui de `deja_couvert` (faux en coexistence), la JSDoc de
   `fenetreRefuseeParLaLigne` (l'annonce rejetée, le repli sur l'espace), celle de `marquerSansLever` (`absente` ne se
   journalise pas : un `warn` aiderait), un titre de test (« délai dépassé, panne réseau »).

### V8. Les jaunes de la relecture de V7

- [x] Les cinq (§ « La relecture du lot V7 »), le 3 d'abord : la carte de `/ops` et le manuel disent que la ligne d'un
  compte déjà couvert ne couvre son numéro que l'attache vérifiée, et que sans elle « Ne pas poser » ne retire pas la
  nôtre : la retirer plutôt, le numéro restant dans la liste jusqu'à ce qu'on la repose (3, tenu par l'e2e de la carte) ;
  l'alerte de connexion dit ce que la marque a fait, relue (`marquerPuisRelire`, partagé avec l'interruption), « autre
  espace » compris (1) ; en coexistence, les trois cas couverts ont leur texte : ne rien retirer, ne rien poser, ne rien
  demander au partenaire sans décision (2) ; un test tient l'asymétrie du rejet (4) ; une marque absente se journalise en
  avertissement, les JSDoc et deux titres de test suivent le code (5). Reste la décision de Julien sur la place des cas
  bloquants en coexistence dans la liste.

## La relecture du lot V8 (2026-11-10)

Un relecteur indépendant, sur le diff de `74aedc43` : **aucun rouge, quatre jaunes**. Les cinq jaunes de V7 sont
corrigés ; la consigne de la carte est exacte au regard de `ATTEND_LIGNE_SQL` (retirer ne touche pas `depuis`, reposer
sort le numéro de la liste). Le lot part tel quel ; ses jaunes vont à V9.

1. **« Ne pas poser » n'est promis que dans la liste, mais seule la marque en panne le prouve** : sur un compte déjà
   couvert, rien ne tient son absence pour une marque éteinte ou absente (une mutation l'a laissé passer). Ajouter ces
   deux variantes au test du jaune 1 de V7.
2. **Le journal d'une relecture en panne (`numero_marque_illisible`) n'est vérifié nulle part**, alors que l'alerte y
   renvoie : l'asserter dans le cas déjà capturé.
3. **Le champ de note de « Ne pas poser » et deux JSDoc donnent encore « le partenaire n'attache pas » pour raison** :
   sur un compte déjà couvert sans attache, c'est le geste que la carte dit désormais de ne pas faire. Un exemple neutre
   (« la ligne ne viendra pas »), et la réserve dans la JSDoc de la route et dans celle de `NePasPoser`.
4. **En coexistence, « Il n'est pas dans la liste de /ops » vient de la décision de ne pas marquer, pas d'une
   relecture** : `linkTenant` garde la marque d'une connexion antérieure et réécrit la coexistence, et la liste ignore
   la coexistence. Relire la liste en coexistence, ou dire « cette connexion ne l'a pas marqué ». Lié à la décision de
   Julien sur la place de la coexistence dans la liste.

### V9. Les jaunes de la relecture de V8

- [x] Jaunes 1 à 3 (§ « La relecture du lot V8 ») : « Ne pas poser » n'est promis que dans la liste, marque éteinte et
  absente comprises (1) ; la relecture en panne se vérifie au journal (2) ; l'exemple du champ de note est neutre (« la
  ligne ne viendra pas »), et les JSDoc de la route et de `NePasPoser` portent la réserve du compte couvert sans attache
  (3, tenu par l'e2e de la carte).
- [ ] Jaune 4, après la décision de Julien sur la place de la coexistence dans la liste.

## La relecture du lot V9 (2026-11-10)

Un relecteur indépendant, sur le diff de `6dd4a69f` : **aucun rouge, deux jaunes**. Les jaunes 1 à 3 de V8 sont
corrigés, chacun tenu par un test qui échoue sous trois mutations ; les textes disent vrai au regard de
`abandonnerAttente` (qui n'efface que la marque) et de `ATTEND_LIGNE_SQL`. Le lot part tel quel ; ses jaunes vont à V10.

1. **Deux autres JSDoc de « Ne pas poser » n'ont pas suivi** : `abandonnerAttenteOps` (`web/lib/api/compte.ts`) et
   `abandonnerAttente` (`src/credit-whatsapp/lignes.pg.ts`) donnent encore « le partenaire n'attache pas » sans la
   réserve du compte couvert (la seconde dit même « l'Entreprise relit sur demande », faux pour un compte couvert, qui
   garde sa ligne), et la première ne cite pas les deux 409 ; celle de `NePasPoser` omet « ou Meta refuserait ses
   envois ».
2. **Le journal d'une interruption illisible (`numero_interrompu_illisible`) n'est vérifié nulle part**, alors que son
   alerte renvoie aux journaux ; et le cas « absent » de l'interruption n'est pas capturé, son avertissement s'affiche à
   chaque exécution.

### V10. Les jaunes de la relecture de V9, et le jaune 4 de V8

- [x] Les deux (§ « La relecture du lot V9 ») : les JSDoc de « Ne pas poser » du client d'API de la console (la réserve
  du compte couvert sans attache, les deux 409) et du magasin (il n'efface que la marque, un compte couvert garde sa
  ligne), et « ou Meta refuserait ses envois » dans celle de `NePasPoser` (1) ; les journaux d'une interruption tenus par
  le test, lecture en panne, marque en panne et marque absente, qui ne s'affiche plus à chaque exécution (2, chaque
  assertion vue rouge sous la mutation de son journal, le fichier restauré à l'identique).
- [ ] Le jaune 4 de V8 : décision de Julien du 2026-11-11, les numéros en coexistence n'entrent PAS dans la liste de
  `/ops` (« l'alerte suffit ») ; reste la phrase de l'alerte, qui part avec V11.

## La relecture du lot V10 (2026-11-11)

Un relecteur indépendant, sur le diff de `adcce75a` (coupé par une interruption de session au milieu d'une mutation ; le
fichier muté a été restauré à l'identique avant sa reprise) : **aucun rouge, trois jaunes**. Les deux jaunes de V9 sont
corrigés : les trois JSDoc disent vrai au regard de la route, d'`abandonnerAttente` et de l'état relu
(`etatLigneCredit`) ; les trois journaux d'une interruption sont tenus (chacun rouge sous la mutation de son journal, et
sous un `warn` passé en `error` ou un journal sans `tenantId`). Le lot part tel quel ; ses jaunes vont à V11.

1. **« la route le dit » (`src/credit-whatsapp/lignes.pg.ts`)** : seule la JSDoc de la route le dit. Son code ne voit pas
   l'attache, et sur une ligne active de l'espace il efface la marque (200, tenu par `tests/ops-credit-whatsapp.test.ts`) ;
   ce qui avertit l'exploitant, c'est le texte de la liste de `/ops`. Écrire que ni la route ni le magasin ne peuvent le
   refuser, l'attache ne se voyant pas d'ici.
2. **Les codes des 409 cités par la JSDoc du client (`web/lib/api/compte.ts`)** : `appelOps` ne remonte que le statut et
   `error`, ni `code` ni `ligne`. Dire « codes du serveur, non remontés par ce client », ou ne citer que le 409 et son
   message.
3. **« les journaux portent la panne » (test de l'interruption)** : aucune assertion ne lit la cause (`err`), retirée des
   deux journaux sans rougir le test. Facultatif : la convention du fichier ne la lit pas non plus.

### V11. L'e-mail du paiement refusé de la formule Pro avec l'option (V4), le jaune 4 de V8 et les jaunes de V10

Après le lot 5 de la session de l'aide sur `origin` : il touche `src/emails-produit/` (`aide?` dans `ModeleEmail`,
`LIGNES_AIDE`), et `tests/emails-produit.test.ts` exige de chaque modèle une `aide` ou une place dans `SANS_PAGE_D_AIDE`.

- [x] **L'e-mail** (texte validé par Julien le 2026-11-11) : un espace Pro dont le renouvellement échoue alors qu'il a une
  option Crédit WhatsApp vivante reçoit une variante de `paiement_refuse_pro`, dont le second paragraphe dit « Sans
  paiement, l’espace repassera en offre Free, avec ses limites, et son option Crédit WhatsApp s’arrêtera avec elle : les
  messages WhatsApp des numéros de l’option s’arrêteront, réponses à vos clients comprises. Votre crédit restant est
  conservé. Mettez à jour votre carte depuis la page « Offre » de la console, ou demandez-le à Claude. », et sa version
  anglaise ; les autres espaces gardent le texte actuel. La raison : l'option résiliée d'office avec la formule
  n'envoie pas `option_wa_arretee`, cet e-mail est le seul avertissement. Le modèle entre dans `SANS_PAGE_D_AIDE`.
  Fait (`paiement_refuse_pro_option`) : l'option se lit par `vivante` (en cours ou en retard) ; illisible, l'e-mail
  d'avant part, et le journal le dit ; l'anti-doublon du journal étant compté par modèle, une version déjà partie pour la
  facture fait taire l'autre (`occasionReservee`), sans quoi une option prise ou résiliée entre deux essais de Stripe
  enverrait les deux. Chaque branche vue rouge sous sa mutation ; le manuel, `features.md` et la fiche « Les e-mails que
  Messaging Me vous envoie » suivent (sa nouvelle empreinte : `aide:charger` après le déploiement).
- [x] **Le jaune 4 de V8** : en coexistence, et sans ligne à poser après une interruption, l'alerte dit que cette
  connexion ne l'a pas mis dans la liste, au lieu d'affirmer qu'il n'y est pas (une connexion antérieure a pu l'y mettre) ;
  un test le tient avec un numéro marqué avant (rouge sous chacune des quatre anciennes phrases) ; le manuel suit.
- [x] **Les trois jaunes de V10** (§ « La relecture du lot V10 ») : la JSDoc du magasin dit que ni la route ni lui ne
  peuvent refuser un compte couvert sans attache (1) ; celle du client d'API, que `code` et `ligne` ne remontent pas (2) ;
  le test lit la cause des deux pannes (3, rouge sans elle).

## La relecture du lot V11 (2026-11-11)

Un relecteur indépendant, sur les deux commits du lot (la phrase de coexistence et les jaunes de V10, puis l'e-mail) :
**aucun rouge, six jaunes**. Vérifié vrai : le choix de l'e-mail dans tous les états de l'option (`vivante`, le prédicat
de la fin de droit), l'anti-doublon (une option prise entre deux essais est même quasi impossible, `optionPrenable`
refusant un Pro en retard), le texte français identique au texte validé octet pour octet, les affirmations du texte au
regard du code (la fin du Pro arrête les lignes de l'option, la garde refuse tout envoi d'une ligne arrêtée, réponses
comprises, une fin de droit n'envoie pas `option_wa_arretee`, le crédit reste), le câblage (méthodes appelées sur leur
objet, les workers déployés avant l'API connaissent la clé neuve avant qu'elle soit émise), et la phrase de coexistence
vraie partout où elle s'affiche. Suite unitaire entière verte chez le relecteur. Le lot part tel quel ; ses jaunes vont
à V12.

1. **Aucun test ne tient le câblage de `src/socle.ts`** : `!== null` passé en `=== null`, ou les arguments
   d'`occasionReservee` intervertis, laissent tout vert. Un cas du banc de `tests/socle.test.ts` qui appelle
   `paiementRefuse` d'un Pro, le faux pool rendant une option ou aucune, et qui lit la clé insérée.
2. **Le repli « option illisible » scelle la facture** : le premier essai part en `paiement_refuse_pro`, et aux essais
   suivants la variante, seul avertissement, se tait (`dejaPrevenu`) ; le silence se décide par espace, pas par
   personne. Pas forcément de code : le dire dans le manuel et la JSDoc.
3. **Un espace Entreprise ou Business qui garde un Pro vivant et une option** (`offre_de_l_espace`, 0257) lirait que son
   option s'arrêtera, alors que `aDroit` la garde ; « repassera en offre Free » y était déjà faux avant le lot. Rare.
   Ne choisir la variante, voire l'e-mail, que pour une offre effective `pro`.
4. **Le `quand` de `paiement_refuse_pro` n'a pas suivi** (ce qu'affiche `/ops`) : dire « sans option vivante ». Et
   couper `paiement_refuse_pro` dans `/ops` ne coupe pas sa variante, clé neuve active par défaut.
5. **Un commentaire de `connexionParLaLigne` dit encore « il n'est jamais marqué »**, l'affirmation que le jaune 4 de V8
   réfute.
6. **Hors périmètre** : ni la fiche des e-mails ni `features.md` ne citent l'e-mail du paiement refusé de l'option
   elle-même (`paiement_refuse_option_wa`).

### V12. Les jaunes de la relecture de V11

- [x] Les six (§ « La relecture du lot V11 ») : l'e-mail du Pro ne part qu'à un espace effectivement en Pro
  (`offreEffective`, `offre_de_l_espace` ; une Entreprise ou un Business n'en reçoivent aucun, une offre illisible le
  laisse partir) (3) ; un cas du banc de `tests/socle.test.ts` tient le câblage, rouge sous l'option inversée, les
  arguments d'`occasionReservee` intervertis ou l'offre effective ignorée (1) ; le sceau de la facture et le silence par
  espace, dans la JSDoc et le manuel (2) ; les `quand` des deux modèles, que lit `/ops` : chacun dit son cas et que l'un
  se coupe à part de l'autre (4) ; le commentaire de `connexionParLaLigne` (5).
- [ ] Le 6 (la fiche des e-mails et `features.md` ne citent pas l'e-mail du paiement refusé de l'option elle-même, ni
  l'exclusion de l'Entreprise et du Business) : reporté au prochain lot qui touche cette fiche, pour ne pas demander un
  second `aide:charger` à Julien pour une phrase.

V12 : l'API, sans migration (l'e-mail du Pro et son câblage), après V11 ; aucune fiche d'aide.
