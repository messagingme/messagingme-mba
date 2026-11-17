# Le numéro fourni : l'application WhatsApp Business, l'essai du Pro, le pont des codes

Constat du 2026-11-17 (espace « Zigi Arjun’s workspace », créé à 00:27 par Google dans la console) : il prend l'essai du
Pro, reçoit un numéro de la réserve **sans rien payer**, le tape dans son application WhatsApp sur son téléphone au lieu
de la fenêtre de Meta, ne reçoit jamais le code, « Remplace » le numéro, recommence, abandonne. Trois défauts :

1. **Le pont des codes ne passe plus le menu de l'application WhatsApp.** Les trois appels disent « To receive your
   WhatsApp verification code, press… » et s'arrêtent sur « press » : notre `SendDTMF(5)`, envoyé à 3 s, coupe la
   phrase (une touche interrompt le message), et le code n'est jamais dicté. Les appels de Meta (fenêtre de Meta)
   dictent leur code dès le décroché et ne sont pas touchés.
2. **Le pont livre tout code, quelle que soit sa source.** Un client qui met NOTRE numéro dans une application WhatsApp
   par erreur recevrait son code, et le numéro finirait hors de la plateforme, puis bloqué (+44 1301 548023, bloqué
   à tort, et la réserve est vide).
3. **L'essai de 14 jours donne un numéro gratuit** : le Pro est `actif` pendant l'essai, il inclut le numéro. Stripe a
   la carte, mais rien n'est encaissé avant le 14e jour.

Décisions de Julien du même jour (rondes de questions) : le numéro se paie 3,50 € pendant l'essai, déduit de la première
facture du Pro (49 − 3,50) ; un nouvel arbre de questions rouvre le numéro fourni DANS l'application WhatsApp Business
puis gardé (`fourni_application`, retiré de la console le 2026-11-12) ; un plan, trois lots.

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff**, une relecture indépendante en fin de chaque lot : les trois lots
touchent des chemins que la production emprunte (le pont des codes, un paiement Stripe et l'attribution d'un numéro,
le parcours de connexion de tout nouveau client) et portent des invariants invisibles (un numéro par espace, l'avoir du
passage en Pro, la parité vitrine, console, plugin tenue par test). L'essai réel qui clôt chaque lot est écrit sous lui.

⚠️ Coordination : la session « Tunnel paiement Pro non-fonctionnel » travaille sur la souscription au Pro dans la
console. Le lot 2 ne commence qu'après son lot, repris depuis `origin`.

## Lot 1 : le pont des codes et sa garde

1. **Asterisk** (`ops/otp-asterisk/extensions.conf`) : aucune touche avant la fin du message (premier `SendDTMF` vers
   8 s au lieu de 3 s), l'enregistrement court toujours depuis la première seconde. `tests/otp-asterisk-config.test.ts`
   garde ses règles (FILTER, aucune variable d'appel dans `System()`).
2. **Source de l'appel** : `src/otp/` reconnaît un appel de l'application (le menu « press » / « appuyez » dans la
   transcription) d'un appel de Meta ; lue à l'affichage, sans migration.
3. **Garde** : un code venu de l'application ne s'affiche (page `/brancher`, `/connecter-whatsapp`, outils MCP) que si
   l'espace a retenu la destination `application` (`tenants.numero_fourni_destination`) ; sinon la page dit « Ce code
   vient de l'application WhatsApp : ce numéro se connecte par la fenêtre de Meta. » Le Remplacer d'un numéro dont seul
   un appel de l'application est arrivé ne le bloque plus : il retourne à la réserve.
4. **Extraction** : un « press 5 » suivi du code ne pollue pas la règle « unanimité ou rien » (`extraire-code`).

Tests : unitaires du classement de la source, de la garde (destination `api`, `application`, nulle) et de l'extraction
sur les transcriptions réelles du 2026-11-17 et des 6, 13 et 16 novembre.

Déploiement : API (`migration=aucune`), puis l'Asterisk sur le VPS (`/home/ubuntu/otp-asterisk`, fichier recopié,
`docker compose up -d --force-recreate`). Puis Julien remet +44 1301 548023 en `libre` (requête fournie, gardée sur
`statut = 'bloque' and tenant_id is null`).

**Essai réel** : un numéro de la réserve tapé dans WhatsApp Business sur le téléphone de Julien, « M'appeler » ; la
transcription doit contenir la phrase ENTIÈRE avec sa touche. Si la touche n'est pas 5 ou varie, le lot 1 bis fait lire
la touche au pont plutôt que de l'écrire en dur.

**Relecture du lot 1** : un rouge, corrigé avant la publication. La garde jugeait « le code a-t-il pu servir ? » sur la
voie COURANTE : un code montré sur la voie de l'application, puis la voie changée pour la fenêtre de Meta, aurait laissé
« Abandonner » et « Remplacer » rendre un numéro qui porte un compte. Elle se juge désormais à l'heure de l'appel
(`APPEL_APPLICATION_CACHE_SQL`), et « le montrer maintenant ? » reste sur la voie courante (`CODE_A_MONTRER_SQL`). Test
prouvé dans les deux sens sur un Postgres en mémoire (PGlite), chaque moitié du défaut remise à part. Jaunes 2 (verrou
de la ligne au remplacement), 4 (langues du menu) et 6 (commentaire de l'Asterisk) faits dans le même geste ; deux
jaunes passent au lot 3 :

- **La console n'écrit jamais la destination** : un espace resté sur la variante `fourni_application` gardée dans
  l'onglet (d'avant le 2026-11-12) ne verrait pas le code de l'application. Le lot 3 retient la destination côté
  console, ce qui le règle.
- **« Remplacer » sur une réserve vide, quand seule l'application avait appelé** : l'espace garde son numéro et la route
  répond 200 avec le même numéro, en consommant le délai d'une heure. Dire `remplace: false`, ou 409 « réserve vide ».

## Lot 2 : le numéro pendant l'essai du Pro

Mécanisme tranché par Julien le 2026-11-17, après lecture du code : une **remise sur la première facture du Pro**. Un
avoir posé à la conversion tomberait sur la facture SUIVANTE (la première est déjà payée quand on l'apprend ; un an plus
tard pour un Pro annuel), et la clé restreinte n'écrit que les abonnements : ni coupon, ni solde de client.

1. **Droit au numéro** (`inclutLeNumero`, `src/offres/numero-inclus.ts`, câblé dans `src/index.ts`) : un Pro en essai
   (`PgAbonnementsOffreStore.enEssai` : vivant, `essai_fin_le` à venir) n'inclut pas le numéro ; il le prend comme un
   Free, par l'abonnement du numéro à 3,50 €, attribué au paiement confirmé. Un Business ou une Entreprise posés dans
   /ops le couvrent toujours. Lecteurs de `numeroInclus` relus : la route du numéro fourni (paiement ouvert au lieu de
   « inclus »), l'état de la connexion (page et Claude), l'alerte de fin de l'abonnement du numéro.
2. **La remise** (`surNumeroPayePendantLEssai`, appelée par le webhook à l'enregistrement de l'abonnement du numéro) :
   si l'espace a un Pro en essai, le coupon `STRIPE_COUPON_NUMERO_ESSAI` (3,50 € « une fois », réservé au Pro, créé par
   Julien) est rattaché à l'abonnement Pro par `poserRemiseUneFois` (relu d'abord, déjà posé = rien ; les remises en
   place, un code promo, sont gardées). Refus de Stripe ou coupon pas configuré : Julien est prévenu de la poser à la main.
3. **Au passage en Pro payant** (`surPassageEnPro`, première facture payée non nulle) : un numéro payé PENDANT l'essai
   (`PgAbonnementsNumeroStore.payePendantLEssai`, la même fenêtre) s'arrête SANS avoir, la remise l'a remboursé ; un
   numéro payé avant l'essai (un Free devenu Pro) garde son avoir au prorata, comme avant.
4. **Essai abandonné** : la remise disparaît avec l'abonnement Pro, l'espace redevient Free, l'abonnement du numéro
   continue à 3,50 € par mois (`surFinDuPro` le trouve vivant), rien à faire.
5. **Écran** : la carte « Fournissez-moi un numéro » et le paiement disent « 3,50 € HT, déduits de votre premier mois
   de formule Pro » pendant l'essai (`essaiPro` dans l'état de la connexion) ; Claude dit la même chose (une seule
   source, `ETAPE_PRIX`, dans `src/mcp/outils-numero.ts`).

Limite connue : un siège acheté PENDANT l'essai, après le numéro, produit une facture de prorata à 0 € qui pourrait
consommer la remise « une fois » avant la fin de l'essai. Cas rare, à vérifier à l'essai réel si on le croise.

Tests : unitaires de la règle (`inclutLeNumero`), de la pose (déjà posée, code promo gardé, refus, coupon absent), du
webhook (déduction demandée à l'enregistrement, jamais pour un doublon), de l'arrêt sans avoir, de l'état et des
consignes de Claude ; intégration des deux lectures en base (`enEssai`, `payePendantLEssai`).

**Geste de Julien avant le déploiement** : créer chez Stripe, en mode test ET en mode live, un coupon de 3,50 € EUR,
durée « une fois », réservé au produit du Pro, sous le même identifiant dans les deux modes (`numero-pendant-essai`) ;
puis poser `STRIPE_COUPON_NUMERO_ESSAI` sur le conteneur de l'API. Sans lui, rien ne casse : chaque numéro payé pendant
un essai le prévient de poser la remise à la main.

Déploiement : API d'abord (`migration=aucune`), puis console. **Essai réel** : un espace de test en essai prend un numéro
(3,50 € en mode test Stripe), la remise apparaît sur son Pro, l'essai est avancé à sa fin (`trial_end=now`), la facture
Pro vaut 45,50 € HT, l'abonnement du numéro est arrêté sans avoir.

**Relecture du lot 2** : aucun rouge, donc déployé tel quel ; ses jaunes partent avec le lot 3.

- **L'arrêt sans avoir se décide sur une date, pas sur la remise appliquée** : remise refusée par Stripe (Julien
  prévenu) et jamais posée à la main, siège pendant l'essai qui consomme la remise, ou variable retirée entre la pose et
  la conversion. Lire les remises de la FACTURE payée (`expand[]=discounts`, la remise « une fois » a quitté
  l'abonnement à ce moment-là) et ne retirer l'avoir que si le coupon y figure.
- **La pose ne revérifie pas la fenêtre** : un rejeu tardif de l'événement d'un numéro payé AVANT l'essai, arrivé
  pendant l'essai, poserait la remise en plus de l'avoir. Appeler `payePendantLEssai` avant de poser (une seule
  définition) ; et borner sa jointure au Pro VIVANT (`o.fini_le is null`).
- **Couverture SQL** : `OFFRES_NUMERO_INCLUS` (libération, suspension) couvre toujours un Pro en essai ; l'alerte de fin
  d'un numéro payé pendant l'essai dit « envois coupés » à tort.
- **Console** : `/offre` cache la carte de l'abonnement du numéro pour tout Pro vivant, essai compris.
- **Textes du plugin** (`scripts/plugin/faq.ts`, `generer.ts`) : « inclus en formule Pro », sans l'essai.
- Les espaces déjà en essai au déploiement, avec un numéro donné sous l'ancienne règle, le gardent sans payer (de fait,
  un droit acquis) : à dire à Julien.

## Lot 3 : le nouvel arbre de questions

Après « Avez-vous déjà l'application WhatsApp Business ? » **Oui** :

- « Avez-vous déjà un numéro qui fonctionne sur cette application ? »
  - **Oui** → « Voulez-vous utiliser ce numéro-là ? » : Oui, on le garde (la fenêtre de Meta, voie existante) ; Non,
    question suivante.
  - **Non** → question suivante.
- « Souhaitez-vous qu'on vous fournisse un numéro ? »
  - **Oui** → une page, deux étapes : le numéro fourni (payé selon le lot 2), mis dans l'application WhatsApp Business
    (le code s'affiche chez nous, `ETAPES_COMPTE_FOURNI`), puis, dès le compte créé, la fenêtre de Meta pour garder
    l'application. La console retient la destination `application` (comme `start_whatsapp_connection`).
  - **Non** → installer un numéro à lui (une ligne mobile) dans l'application, puis la garder par la fenêtre de Meta.

La branche **Non** à l'application ne change pas. Jamais le mot « coexistence » dans une question.

Fichiers : `scripts/vitrine/tunnel-textes.ts` et `tunnel.ts` (vitrine `/demarrer/`, anglais par dictionnaire),
`web/lib/questions-numero.ts`, `web/components/ParcoursNumero.tsx`, la skill `mise-en-service` du plugin (version
montée), une route console qui retient la destination. Tests : `tests/questions-numero-vitrine.test.ts` (parité),
tests du tunnel, `tests/connexion-numero.test.ts`, e2e `connecter-whatsapp.spec.ts` et `brancher.spec.ts`.

Déploiement : API, puis console et vitrine, puis publication du plugin. **Essai réel** : de la console, « Oui / Non /
Oui » jusqu'au numéro relié en gardant l'application, sur le téléphone de Julien.

**Relecture du lot 3** : aucun rouge dans le code. Deux constats corrigés avant le push :

- La route de la voie était montée sous la garde du lien de Claude (`adminOuLien`), que `tests/scope-tenant.test.ts`
  refuse : elle passe à la session d'admin seule (`gardeAdmin`), le lien arrivant avec sa voie déjà retenue.
- 🔴 selon l'ordre de mise en ligne : la console, publiée par Vercel dès le push, envoyait la voie sans l'attendre ; tant
  que l'API n'avait pas la route, un client qui choisissait le numéro mis dans l'application payait, sa voie jamais
  retenue, et la garde du lot 1 lui cachait le code. La console attend désormais la voie avant d'avancer, et dit un refus
  (e2e « la voie de l'application refusée par le serveur »).

Ses jaunes, pour le prochain lot de fonctionnalité :

- **La reprise ignore la voie du serveur** : la variante ne vient que de la mémoire de l'onglet (`varianteGardee`) ; d'un
  autre navigateur, un numéro mis dans l'application s'affiche sur la voie de la fenêtre de Meta. La lire de l'état.
- **La voie de la ligne de crédit ne retient jamais `api`** (`QuiRegleMeta`, « J'ai besoin d'un numéro ») : un espace
  passé par la voie de l'application garde `application`, et un appel de l'application y montrerait son code.
- **Deux clics opposés en rafale** : la route lit puis écrit, et la console n'ordonne pas ses envois. Une seule
  instruction (`where numero_fourni_destination is distinct from $2`) et des envois en file.
- **« Remplacer » sans réserve** garde bien le numéro, mais le verrou d'une heure est pris : tout essai dans l'heure rend
  429, même réapprovisionnée. Relâcher le verrou quand rien n'a été remplacé.
- **`couponSurFacture` lit la présence du coupon, pas son montant** : sur une facture à 0 € (code promo à 100 %), le
  numéro s'arrêterait sans avoir. Exiger un montant non nul (`total_discount_amounts`).
- **Textes de l'essai** : la carte du numéro mis dans l'application dit « inclus en formule Pro » à un Pro en essai, et
  `scripts/plugin/generer.ts` écrit « provided number included » près de l'essai de 14 jours.
- **Une voie posée par un clic coupe un lien neuf de Claude** (`modeDuLienNeuf`) : ignorer la voie retenue quand l'espace
  n'a aucun numéro fourni.
- **« Le code n'arrive pas ? En obtenir un autre »** bloque le numéro même sans aucun appel reçu : le rendre à la réserve
  quand aucun appel n'a été capté depuis l'attribution.

## Lot 4 : l'application ou l'API, et la forme du tunnel (essai de Julien, 2026-11-17)

Décisions de Julien (rondes de questions du 2026-11-17, après son essai de la console) :

- **« Comment voulez-vous utiliser WhatsApp ? »**, deux cartes, une ligne chacune et le détail dans une bulle, posée à
  trois endroits : après « Non » à l'application (choisir l'application, c'est d'abord l'installer : ses magasins), après
  « Non » à « un numéro qui fonctionne sur cette application », après « Non » à « ce numéro-là » (là, « un 2e compte dans
  l'application, deux au plus »). Ensuite : l'application mène à « Souhaitez-vous qu'on vous fournisse un numéro ? »,
  l'API à « Avez-vous déjà un numéro que vous pourriez utiliser ? ». Arguments : sa synthèse des faits de nos fiches (le
  nom et la photo se règlent dans l'application ; avec l'API, le nom affiché se personnalise chez Meta).
- **« Oui » à « un numéro que vous pourriez utiliser »** : plus de « Fournissez-moi un numéro », seulement le sien.
- **La bulle de « WhatsApp Business »** : ce qu'est l'application, son logo (celui de la vitrine) et ses magasins.
- **Les étapes à venir, grisées**, sous le paiement du numéro fourni : payer, le numéro et son code, la fenêtre de Meta.
- **Le défilement** : chaque nouvelle question vient à l'écran, sans défiler à la main.

Méthode : comme le lot 3. L'arbre de la console et de la vitrine en direct, les textes de la skill, des fiches et les e2e
par un agent chacun, puis une relecture. Côté API, seulement des textes lus par Claude (descriptions de
`start_whatsapp_connection`, première étape du compte d'un numéro fourni mis dans l'application) : la console et la
vitrine partent au push, l'API se déploie ensuite (`migration=aucune`), puis le plugin 0.3.50.
**Essai réel** : de la console, « Non » à l'application, « Par l'API », « Oui » au numéro (seulement le sien), et le
chemin du 2e compte dans l'application, sur iPhone et sur Android (faut-il passer sur ce compte avant de confirmer dans
la fenêtre de Meta ?).

**Relecture du lot 4** : aucun rouge, déployé tel quel. Ses jaunes, pour le prochain lot de fonctionnalité :

- **La bulle** : un second toucher ne la referme pas (lire l'état au `pointerdown`) ; Échap sur un lien du magasin perd le
  focus (le rendre au déclencheur) ; ouverte au clavier sur une carte estompée, elle reste à 60 % (`focus-within`) ; au
  téléphone, elle déborde de 25 à 40 px à droite, et celle de l'API recouvre la carte du dessus quand elles s'empilent.
- **Le défilement** : une bulle peut s'ouvrir seule sous une souris immobile (n'ouvrir qu'après un vrai mouvement) ; le
  focus reste sur le bouton cliqué (le donner à la question suivante, comme la vitrine) ; `QuiRegleMeta` vise l'étape par
  son `data-testid` (une `ref`).
- **Les étapes à venir** : barrent « Obtenir » au lieu de « Payer » quand le webhook arrive avant le numéro, et lisent
  `paiementRecu` après « Abandonner » ; la filière QR n'en a pas besoin.
- **Les textes** : « Inbox à plusieurs » promis aussi en Free (la Free n'a ni console ni Inbox) ; « s'ouvre au moins
  toutes les deux semaines » se lit comme si l'application s'ouvrait seule ; la note d'installation a ses magasins dans la
  console, pas sur la vitrine ; les demandes à coller ne disent plus si le visiteur a l'application.
- **Les tests** : « une bulle à la fois » n'ouvre jamais la première.
- **Plus exposés** : la reprise depuis un autre navigateur et la voie de la ligne de crédit qui ne retient jamais `api`
  (jaunes du lot 3), « Avec l'application » étant proposé aussi à qui ne l'a pas.
- **Au déploiement** : `aide:charger` pour les fiches retouchées, et les films des fiches à vidéo montrent l'ancien
  arbre.

## Lot 5 : « Ouvrir la fenêtre de Meta », et le prix du numéro selon la formule (essai de Julien, 2026-11-17)

Demandes de Julien, après l'essai réel du lot 4 :

- **La carte « Mettez un numéro à vous dans l'application »** dit quand appuyer, et sur quoi : « Puis, une fois cette
  opération faite, appuyez sur le bouton « Ouvrir la fenêtre de Meta », qui relie ainsi votre application à Messaging
  Me… » (`RELIER_EN_GARDANT`, partagé avec le numéro fourni mis dans l'application).
- **Le bouton qui garde l'application s'appelle « Ouvrir la fenêtre de Meta »** (`COEXISTENCE_BOUTON`), partout : la
  console, la page du lien de Claude, ce que dit Claude, la FAQ du plugin, les fiches et leur capture (`aide:captures`
  du parcours de la console). Le guide « Garder mon application WhatsApp Business » garde son titre. Les messages du
  serveur à un numéro relié par QR code renvoyaient à un bouton de l'Accueil qui n'existe plus : ils renvoient au lien
  de Claude.
- **En Pro, le numéro fourni ne parle pas de la Free** : son prix s'affiche sous la formule choisie (`prix` des issues de
  la vitrine, `PRIX_NUMERO_FOURNI` dans la console). En Pro, pendant l'essai de 14 jours : 3,50 €, déduits de la
  première facture de 49 €, non remboursés sans formule Pro au bout de l'essai ; en Free, 3,50 € par mois, inclus en
  formule Pro. Claude et la FAQ disent aussi le non-remboursement.

Méthode : en direct (textes et un rendu), une relecture. Côté API, des textes lus par Claude et des messages du
serveur : déploiement `migration=aucune`, puis le plugin 0.3.51 et `aide:charger`. **Essai réel** : la vitrine en Pro
puis en Free jusqu'au numéro fourni, et la carte « Mettez un numéro à vous » de la console.

**Relecture du lot 5** : un rouge, corrigé avant le push. « Déduits de votre première facture de 49 € » était faux pour
un Pro pris à l'année (490 €) : le texte dit « de votre première facture de formule Pro (49 € par mois, ou 490 € à
l'année) », vérifié dans les deux sens par `tests/vitrine-tunnel.test.ts`. Corrigés avec lui, des oublis du renommage
(la skill, `features.md`, des commentaires), « Ce numéro coûte » au lieu de « Il coûte » (qui suivait « votre agent IA
répond »), et « rien n'est prélevé pour la formule » sous le prix de l'essai. Ses jaunes, pour le prochain lot :

- **Deux boutons du même nom** : celui de la fenêtre ordinaire et celui qui garde l'application s'appellent tous deux
  « Ouvrir la fenêtre de Meta », et la 3e condition chez Meta, lue en `apporte`, désigne alors le mauvais. Réaliser le
  point du `todo.md` (en `apporte`, ne garder que le numéro libre), et désigner la voie plutôt que le libellé.
- **Le guide du centre d'aide ne montre aucun prix** du numéro fourni (aucune formule choisie) : assumé, comme sa fin
  sans prix ; sinon montrer les deux en mode guide.
- **Le prix vient avant « Puis, une fois cette opération faite »** dans la carte du numéro mis dans l'application :
  le placer après la suite.
- **Les demandes à coller en Pro** disent encore « (inclus en formule Pro) » sous le prix de l'essai.
- **Pas d'e2e** du prix en essai ni du numéro inclus (`simulerNumeroFourni` avec `essaiPro`, `inclusDansLePro`).
- **Le film du guide** « Garder mon application WhatsApp Business » montre probablement l'ancien libellé du bouton.
