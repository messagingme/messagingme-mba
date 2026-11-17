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
