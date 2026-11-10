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
  production ; le numéro d'essai déjà connecté a sa réponse (le lot D, ou une décision de Julien) ; le texte de l'e-mail
  du paiement refusé de la formule Pro, qui doit parler de l'option, soumis à Julien.

### V5. Les jaunes des relectures du lot E7 et de V1

- [ ] Les sept du lot E7, au plan `2026-11-09-credit-whatsapp-fenetre-du-partenaire.md` (§ « La relecture du lot E7 »).
- [x] Les jaunes 1, 5 et 6 de V1 (§ « La relecture du lot V1 »), avec V2 : la conversion du webhook se tait tant que la
  fin de l'essai est à venir ; la vue de l'onglet lit la formule en une lecture (`formuleEtPrise`) ; les commentaires et
  la doc d'avant V1 remis à jour, dont la JSDoc de `prisePossible`.
- [ ] Les jaunes 1, 2, 5, 6 et 7 de la relecture de V2 (§ « La relecture du lot V2 »).

## Ordre de déploiement

V1 : l'API seule, sans migration. Tant que le prix n'est pas posé (`enVente` faux), rien ne se voit ; la console de
l'arbre lit `prisePossible` quand l'API le rend, et le lit comme `formulePayee` avant.

V2 et les jaunes de V1 : l'API seule, sans migration, le contrat HTTP inchangé, rien pour la console.

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
