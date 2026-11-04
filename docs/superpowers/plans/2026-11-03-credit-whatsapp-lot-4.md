# Le Crédit WhatsApp, lot 4 : l'option à 30 € par numéro et la recharge automatique

**Demande de Julien (2026-11-03)** : « ferme les jaunes et avance sur le lot 4 ».
Spec : `docs/superpowers/specs/2026-10-30-credit-whatsapp-design.md` (§ « L'option », § « Le Crédit WhatsApp (le
solde) », § « La sortie »). Plan d'ensemble : `2026-10-30-credit-whatsapp-notre-cote.md`, lot 4 (tâches 13 et 14),
repris ici avec ce que les lots D et E ont changé (une ligne couvre tout le compte WhatsApp, la régularisation tranche
ce que l'accusé ne voit pas, `arreter` et `retirer` visent encore le numéro).

## Ce que la spec a décidé (rien à redemander)

- **L'option** : 30 € HT par numéro et par mois, un abonnement Stripe mensuel à part (il doit vivre en Business, qui n'a
  pas d'abonnement Pro), dont la quantité est le nombre de numéros autorisés sur la ligne. Sans essai, même pour un Pro
  en essai. Un ajout se facture au prorata sur le coup et ne compte qu'une fois cette facture payée ; un retrait vaut à
  la fin de la période, sans remboursement. Codes promo fermés. Le Pro et le Business y ont droit, jamais la Free ;
  l'Entreprise sans Stripe, par `/ops` (déjà le cas).
- **La fin** : quand plus aucune offre n'y donne droit (fin du Pro, Business ou Entreprise retirés dans `/ops`, fin de
  l'essai du Business), l'abonnement de l'option se résilie, sans remboursement du mois entamé ; les envois de ses
  numéros s'arrêtent le jour même, la ligne reste attachée 30 jours. Sur impayé, les envois s'arrêtent quand Stripe
  abandonne ses relances, pas au premier échec.
- **La recharge automatique** : un admin l'active avec un seuil (5 € au moins) et un montant (20 à 1 000 € HT). Une
  facture Stripe du montant, réglée hors session sur la carte de l'abonnement de l'option ; une seule en vol par espace ;
  un refus ou une authentification exigée l'éteint et prévient par e-mail avec le lien de la facture. Une campagne plus
  chère que le solde, recharge active, est rechargée avant son départ (ce qui manque, arrondi au multiple supérieur du
  montant) ; un refus la laisse non lancée, avec la raison.

## Ce que le code impose (relevé le 2026-11-03 dans la copie, en lecture seule)

- **Le webhook aiguille par défaut vers le numéro, qui acquitte en silence** (`traitement-abonnements.ts:420,432,440`) :
  une facture sans abonnement (donc une recharge), un `updated` sans métadonnée de numéro, un `deleted` inconnu. L'option
  et la recharge s'aiguillent donc AVANT lui, sur `metadata.produit`, et `factureSchema` doit lire la métadonnée de la
  facture. Une session Checkout d'abonnement d'un produit inconnu tombe aujourd'hui dans la recharge, qui acquitte sur
  `mode !== 'payment'` avant de lire le produit (`traitement-recharge.ts:114`) : à corriger dans le même lot, pour qu'une
  image plus ancienne alerte au lieu d'acquitter. `invoice.payment_action_required` n'est traité nulle part.
- **Les sièges ont déjà fait la moitié de la quantité** : `changerLigneAbonnement` (`always_invoice` et
  `pending_if_incomplete`, client.ts:586) et `lireAbonnementStripe` (557). `creerSessionAbonnement` (298) est fermé à
  `'numero' | 'pro'`, figé à une quantité de 1 et ouvre les codes promo en dur (314) : il prend un produit, une quantité
  et la fermeture des codes.
- **Rien n'écrit de facture chez Stripe aujourd'hui** (ni `/invoices`, ni `invoiceitems`, ni paiement hors session sauf
  `creerAbonnementNumeroSeul`). La carte posée par Checkout vit sur l'ABONNEMENT (`default_payment_method`), pas sur le
  client, et `lireAbonnementStripe` ne la lit pas. La clé restreinte n'a les factures qu'en lecture (`config.ts:598`).
- **Stripe n'est câblé que dans l'API**, alors que le seuil du crédit bas se franchit aussi dans le worker (la garde y
  envoie, la régularisation y débite) et que `tests/queue-names.test.ts` exige le consommateur d'une file dans
  `src/worker.ts`. La recharge au seuil passe donc par une file consommée par le worker, qui reçoit le transport Stripe
  (la configuration exige les deux secrets ensemble).
- **La recharge avant le départ ne peut pas attendre en pause** : `pauserCampagneCredit` ne touche que `running` et
  `scheduled` (un brouillon refusé n'est ni l'un ni l'autre) et `leverPausesCreditWhatsapp` relance dès 1 €, pas quand
  l'estimation est couverte. Choix de Claude : au lancement, l'API règle la recharge TOUT DE SUITE (facture hors
  session, quelques secondes), crédite sur la réponse payée de Stripe (idempotent avec l'avis qui suit, la référence est
  la facture), puis lance ; un refus rend le refus du lancement avec sa raison, et éteint la recharge.
- **Une recharge n'aurait pas de lien « Facture »** : l'historique ne joint `stripe_paiements` que pour un achat
  (`credit.pg.ts:342`), la route de facture exige un `cs_` (`credit-stripe.ts:37`), la console exige `achat`
  (`api-credit-whatsapp.ts:107`). La référence d'une recharge est sa facture `in_`, lue telle quelle.
- **`arreter` n'a aucun appelant et l'origine `'option'` n'est jamais écrite** (`lignes.pg.ts:184-206`) ; et comme
  `retirer`, il vise le numéro, pas la ligne qui couvre son compte (jaune D5 du plan de fiabilité, repris ici).
- **La suppression d'un espace ne résilie rien chez Stripe** : son bilan liste les abonnements à résilier à la main
  (`suppression-espace.ts:53-62`, figé par trois tests et recopié dans `web/lib/api/compte.ts:843`). L'option y entre
  comme troisième produit, au même titre.
- **La fin de l'essai du Business n'existe pas** (le Business ne se pose que dans `/ops`) : la fin de droit vient de la
  fin du Pro (`surFinDuPro`) et du retrait d'une offre dans `/ops` (`quitteLaMain`, `surFinDeLOffreManuelle`).

## Tranché par Julien (2026-11-03)

1. **Une place, c'est un NUMÉRO**, comme la spec, alors qu'une ligne couvre tout le compte WhatsApp (Meta l'attache au
   compte) : les places d'un espace se comparent aux numéros que ses lignes couvrent, et un numéro ajouté au compte chez
   Meta au-delà des places payées voit ses envois refusés (`ligne_inactive`, avec la raison) jusqu'à une place de plus.
2. **Une pose dans `/ops` pour un Pro ou un Business exige une place payée**, sauf geste forcé et signé (un essai),
   comme aujourd'hui ; une Entreprise n'en a pas besoin.

## Ce qui attend Julien (avant la mise en service, pas avant le code)

- Créer dans Stripe le produit de l'option et son prix mensuel de 30 € HT, puis le poser en `STRIPE_PRIX_OPTION_WA`
  (conteneur et `.env.prod` de la machine), comme les quatre prix d'achat. Sans lui, l'option répond 503 et l'onglet dit
  « pas encore disponible ».
- Élargir la clé restreinte de Stripe : factures et lignes de facture en écriture, moyens de paiement en lecture.
- Vérifier que les deux secrets Stripe sont dans l'environnement du worker (`.env.prod` de la machine) : la recharge au
  seuil s'y règle.
- Le texte public (vitrine, aide, FAQ du plugin) reste au lot 5, avec le partenaire.

## Lot 4a : l'option (tâche 13 du plan d'ensemble)

**Données** (une migration, son numéro lu par `npm run migrations` au moment de l'écrire, `migration=avant`, poussée
seule) : `options_credit_whatsapp`, sur le modèle d'`abonnements_offre` (l'abonnement Stripe pour clé, l'espace en
cascade, statut, quantité de 1 à 20, fin de période, fin et sa raison, un vivant par espace par index partiel) ;
`lignes_credit_whatsapp.origine` déjà prête.

**L'écran** : l'onglet Crédit WhatsApp de la page Offre se montre aussi à un Pro ou un Business SANS ligne (aujourd'hui
il ne paraît qu'avec un numéro sur la ligne), avec l'option : « 30 € HT par numéro et par mois », le nombre de places
et le bouton qui ouvre Checkout ; une place de plus ou de moins passe par la même route. En Free, rien (relevé en
écrivant l'écran : la Free n'a aucun onglet dans la page Offre ; son « avec le Pro » vit dans le guide de connexion, au
lot 5) ; en Entreprise, « illimité », sans option. Routes du module `creditWhatsapp` : la lecture de l'option avec celle
du solde (tout membre), `POST …/credit-whatsapp/option` et `PATCH …/option` (admin, plafond des opérations coûteuses).

**Interfaces** : `PgOptionsCreditStore` (`enregistrer`, `majStatut`, `finir`, `vivante(tenantId)`) ;
`placesPayees(tenantId): Promise<number>` (la quantité que Stripe a relue payée, en `active` ou `past_due`, zéro
sinon) ; `placeLibre(tenantId): Promise<boolean>` ; `ouvrirOption(deps, tenantId, quantite, payeur, retour):
Promise<Issue<{ url: string }>>` (Checkout d'abonnement, sans essai, codes fermés, métadonnées `produit =
'option_credit_whatsapp'` et `tenant_id` sur la session et l'abonnement) ; `changerPlaces(deps, tenantId, quantite)`
(sur `changerLigneAbonnement`, payé avant de compter, retrait en fin de période) ; `finDeDroitOption(tenantId, raison)`
(résiliation sans avoir, `arreterAbonnementNumeroSeul` généralisé, puis `arreter` des lignes `'option'` de l'espace) ;
`arreterLaLigneDe(tenantId, phoneNumberId)` qui vise la ligne couvrante (jaune D5). « Une ligne par compte » tenue en
base, plus seulement par la route : un index unique partiel sur le compte des lignes en cours, son conflit traité dans
`poser` (jaune 3 de la relecture des jaunes, la donnée relue en production avant).

**La garde et les places** (décision 1) : une ligne `'option'` couvre au plus autant de numéros de son compte que
l'espace a de places payées ; les numéros couverts se rangent par ancienneté dans l'espace (le numéro de la ligne
d'abord), et ceux au-delà sont refusés (`ligne_inactive`, raison « place manquante »), sans provision. Une ligne
`'ops'` forcée et signée (un essai, décision 2) n'est pas comptée ; une Entreprise non plus.

**Tests** : un numéro ajouté au compte au-delà des places est refusé, celui d'avant non, et une place de plus le
libère ; une pose `/ops` d'un Pro sans place libre rend 409 sauf forcée ; une place n'existe que relue payée (un ajout
dont la facture échoue ne compte pas) ; l'aiguillage de l'option passe avant le numéro, et un produit inconnu alerte au
lieu d'acquitter ; la fin du Pro sans Business ni Entreprise résilie l'option, une Entreprise qui reste ne la résilie
pas ; le retrait d'un Business dans `/ops` l'annonce puis la résilie ; un `deleted` pour impayé arrête les lignes, un
premier `payment_failed` non ; la suppression d'un espace liste l'option à résilier ; codes promo fermés et jamais
d'essai sur la session ; l'onglet d'un Pro sans ligne propose l'option, celui d'une Free la grise (e2e).

**Avancement (2026-11-03 au soir)** : la migration 0276 poussée seule ; le serveur de 4a écrit et testé (magasin, places
dans la garde, webhook, fin de droit, pose `/ops`, routes de l'onglet, e-mail, bilan de suppression), relu, son rouge
corrigé ; les deux écrans (l'onglet, la pose forcée de `/ops`) écrits et testés. Ils ne paraissent que sur les champs
neufs de l'API (l'option de la vue, les places de `/ops`) : ils partent avec elle, sans fenêtre où ils appelleraient une
route absente.

## La relecture du lot 4a (2026-11-03)

**Un rouge, corrigé avant la mise en service** (latent tant que l'option n'est pas vendue) : un espace qui a l'option,
passé en Entreprise, puis dont l'option se termine (résiliée au portail, ou un impayé que Stripe abandonne), voyait ses
lignes arrêtées ; la garde lit l'arrêt d'une ligne AVANT l'illimité, donc tous les envois de l'Entreprise refusés,
réponses comprises. La fin d'une option ne coupe plus les lignes d'une Entreprise (`illimite`, traitement du webhook), et
poser l'Entreprise sur un espace qui a l'option s'annonce dans `/ops` : elle ne sert plus et reste facturée tant que
Julien ne la résilie pas chez Stripe. Test vérifié dans les deux sens.

**Les jaunes** (✅ fermé ; les autres attendent, ceux marqués « avant la vente » à fermer avant de poser le prix) :

1. ✅ Claude lisait l'onglet comme « un numéro sur la ligne » : `get_setup_state` et `get_credit` auraient dit épuisé le
   solde de tout Pro sans ligne dès le prix posé, et poussé un achat refusé. Fermé : `surLaLigne` ; l'onglet, lui, ne
   dit plus « épuisé » à un espace sans numéro sur la ligne.
2. SEPA, si le Checkout d'abonnement l'accepte : une session réglée en différé (`async_payment_succeeded`) d'un Pro, d'un
   numéro ou de l'option lève l'alerte « produit inconnu » ; un `updated` en `active` enregistre l'option avant
   l'encaissement (le Pro l'évite). À fermer avant d'ouvrir SEPA sur ces produits.
3. ✅ (2026-11-04) Trois cas acquittés sans trace. `STRIPE_PRIX_OPTION_WA` absent d'un conteneur (une session payée
   n'est pas enregistrée), une facture payée d'une option déjà finie chez nous, et `unpaid`, qui finit l'option sans la
   résilier chez Stripe (un client qui règle en retard serait prélevé chaque mois, ses lignes arrêtées). Fermé : les deux
   premiers alertent Julien, et un `unpaid` est résilié chez Stripe avant d'être fini (`resilierOptionChezStripe`, une
   panne passagère faisant rejouer l'événement).
4. ✅ (2026-11-04) Une ligne arrêtée ne se relançait jamais ; un client qui reprenait l'option payait et sa ligne restait
   arrêtée. Fermé : une option neuve relance les lignes `'option'` que la fin de la précédente avait arrêtées
   (`relancerLesLignesDeLOption`), une ligne retirée restant retirée.
5. Une ligne posée sous l'Entreprise est `'ops'`, hors des places, et le reste quand l'espace redescend en Business ou en
   Pro : l'origine confond l'essai forcé et l'Entreprise. À signaler à la sortie de l'Entreprise, ou une colonne
   « forcée ».
6. ✅ (2026-11-04) Une campagne en pause `ligne_credit_inactive` n'était jamais reprise quand les places changent, et le
   refus d'une place manquante ne disait pas sa raison, alors que la décision 1 la voulait dite. Fermé : les pauses se
   lèvent à une option prise ou reprise, à des places notées en plus, à une pose dans `/ops` (`leverPausesLigneCredit`,
   seulement si l'espace a une ligne active et un numéro relié) ; le refus garde son motif et son code, et dit « pas de
   place dans l'option » (`detail: 'place_manquante'`).
7. À trancher par Julien : un retrait de place vaut tout de suite (`proration_behavior: none`, comme les sièges du Pro),
   la spec disait « à la fin de la période ». La facture est la même (le mois payé n'est pas remboursé, le suivant compte
   un numéro de moins) ; le client perd tout de suite la place retirée, qui était libre (un retrait ne passe pas sous les
   numéros couverts). La garder jusqu'à la fin de la période demanderait une colonne de plus.
8. Une panne passagère de Stripe (réseau, 5xx, 429) pendant la résiliation de fin de droit devient une résiliation à la
   main au lieu d'un rejeu.
9. ✅ L'e-mail d'un renouvellement impayé renvoyait à l'onglet pour mettre à jour la carte, geste absent : fermé par le
   bouton « Gérer l'option » de l'onglet (le portail de Stripe).
10. Mineurs : `changerPlaces` ne relit pas l'offre (une Entreprise pourrait ajouter des places inutiles) ; `noter` ne
    borne pas les places relues (une quantité posée à la main hors 1 à 20 rendrait 500 au CHECK) ; le cache des places
    n'a pas de lecture partagée en vol ; la requête du bilan de suppression pour l'option n'a pas de test.

## La relecture des écrans du lot 4a-2 (2026-11-04)

**Un rouge, corrigé avant la mise en service** : au retour de Stripe (`?option=recue`), tant que le webhook n'avait pas
écrit l'option, l'onglet proposait encore de la prendre, et le serveur laissait passer une seconde session : le client la
payait deux fois. La prise reste fermée pendant cette attente (le Pro faisait déjà de même), et l'écran dit, au bout des
relectures, que l'option tarde et qu'il ne faut pas la reprendre. Vérifié dans les deux sens par Playwright.

**Les jaunes** (✅ fermé ; « avant la vente » à fermer avant de poser le prix) :

1. ✅ (2026-11-04) Le message du 402 disait « réglez la facture sur sa page, puis recommencez », or régler la facture
   applique la place en attente ; recommencer en ajoutait une seconde, payée une seconde fois. Fermé : il dit que le
   numéro s'ajoute dès la facture payée, et de ne pas recommencer.
2. L'onglet ment pour un espace en essai forcé : `couverts` ne compte que les lignes `'option'`, donc un Pro dont le numéro
   envoie déjà par une ligne forcée (`'ops'`) et qui prend l'option lit « 0 sur le Crédit WhatsApp » et « contactez-nous » ;
   il faut retirer puis reposer sa ligne pour qu'elle compte. Montrer la ligne d'essai, ou la dire « en essai ».
3. Le portail de Stripe devient la porte de gestion de l'option : sa configuration doit rester fermée au changement de
   quantité sur ce produit (à Julien, déjà au backlog) ; le retour du portail mène à `/offre`, pas à l'onglet.
4. Avant de payer, l'écran ne dit ni l'absence d'essai, ni la résiliation sans remboursement si la formule prend fin ;
   « Ajoutez un numéro à l'option » reste affiché quand l'ajout est impossible (paiement en retard, fin programmée).
5. Une Entreprise encore prélevée pour une option devenue inutile ne la voit plus dans l'onglet (l'illimité masque la
   section, donc ni son état ni « Gérer l'option ») ; seul `/ops` l'annonce à Julien.

## Lot 4b : la recharge automatique (tâche 14 du plan d'ensemble)

**Données** (la migration suivante) : `credit_whatsapp_recharge_auto` (l'espace pour clé, active, seuil et montant en
micro-euros, CHECK seuil d'au moins 5 € et montant de 20 à 1 000 €, éteinte le et sa raison, la facture en vol) ; le
verrou à trois pièces (bail, jeton, relance) sur le modèle de `run-lock.ts`.

**Interfaces** : `declencherRecharge(tenantId, cause: 'seuil' | 'campagne', montantMicroEur): Promise<void>` (enfile
`credit-whatsapp-recharge`, entrée dans `BASE_QUEUES`, rôle `principal`) ; `reglerRecharge(deps, tenantId, { active,
seuilMicroEur, montantMicroEur })` (admin) ; `factureHorsSession(transport, { cle, client, carte, montantCentimes,
description, metadata, idempotence })` dans `src/stripe/client.ts` (facture `charge_automatically` sur la carte de
l'abonnement de l'option, payée hors session, clé déterministe `recharge-<espace>-<dernier crédit reçu>`) ;
`rechargerAvantDepart(tenantId, manqueMicroEur)` (synchrone, dans l'API, le manque arrondi au multiple supérieur du
montant choisi). Le webhook traite `invoice.paid`, `invoice.payment_failed` et `invoice.payment_action_required` d'une
facture de recharge (sa métadonnée), AVANT le numéro ; un nouvel e-mail `credit_whatsapp_recharge_refusee` porte le
lien de la facture (`hosted_invoice_url`). L'onglet règle le seuil et le montant, et dit une recharge éteinte et
pourquoi.

**Tests** : une rafale d'envois qui franchit le seuil = une seule facture (verrou et clé) ; bornes refusées (seuil sous
5 €, montant hors 20 à 1 000 €) ; refus ou authentification exigée = recharge éteinte, e-mail avec le lien de la
facture ; avis `invoice.paid` rejoué = un seul crédit, et la réponse payée puis l'avis = un seul crédit ; une campagne
plus chère que le solde, recharge active, part après une facture de ce qui manque ; recharge éteinte, le refus « il vous
manque » reste ; une recharge a son lien « Facture » dans l'historique.

## Ordre de déploiement

1. La migration de 4a seule (`migration=avant`), puis l'API et le worker de 4a ; la console de 4a ensuite (son bouton
   appelle une route neuve, poussé APRÈS l'API).
2. Celle de 4b seule, puis l'API et le worker de 4b, puis sa console.
3. Rien n'est vendu tant que `STRIPE_PRIX_OPTION_WA` manque : l'option répond 503.

## Ce qui ferait échouer le lot même s'il marche

- Une option payée qui ne débloque rien, ou un numéro sans place payée qui envoie par nous.
- Un client qui paie encore une option que plus aucune offre ne permet d'utiliser.
- Une recharge qui débite deux fois pour le même seuil franchi, ou un avis rejoué qui crédite deux fois.
- Une campagne lancée alors que la recharge qui devait la couvrir a été refusée.
- Un événement Stripe de l'option ou d'une recharge acquitté en silence par le chemin du numéro.

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff**, parce que la production emprunte ces chemins (un paiement Stripe, son
webhook, l'arrêt des envois d'un client) et qu'ils portent des invariants invisibles : une place n'existe que payée,
une recharge par seuil franchi et jamais deux, un avis rejoué qui ne crédite pas deux fois. Deux lots, chacun avec sa
relecture indépendante en fin de lot. **Essai réel qui clôt le lot** : sur un espace d'essai passé en Business, Julien
prend l'option pour un numéro avec sa carte, le numéro passe sur la ligne ; la recharge automatique activée avec un
seuil au-dessus du solde déclenche UNE facture, créditée une fois ; puis l'option résiliée arrête les envois du numéro le
jour même.
