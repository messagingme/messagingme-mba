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

1. **Droit au numéro** (`src/numero/reserve.ts`, `numeroInclus` dans `src/index.ts`) : un Pro en essai
   (`essai_fin_le > now()`) n'inclut pas le numéro ; il le prend comme un Free, par l'abonnement du numéro à 3,50 €,
   attribué au paiement confirmé. Inventorier chaque lecteur de `numeroInclus` (Business, fin d'offre, MCP) avant de
   changer sa réponse.
2. **Fin de l'essai payée** (`src/stripe/traitement-abonnements.ts`, `src/offres/numero-inclus.ts`) : à la première
   facture du Pro PAYÉE, l'abonnement du numéro seul s'arrête SANS avoir au prorata, et 3,50 € sont crédités au solde du
   client Stripe, imputés sur cette facture ou la suivante. `surPassageEnPro` n'arrête plus le numéro seul au DÉBUT de
   l'essai. Vérifier que le Pro et le numéro partagent le même client Stripe, sinon le crédit tombe à côté.
3. **Essai abandonné** : l'espace redevient Free, l'abonnement du numéro continue à 3,50 € par mois, rien à faire.
4. **Écran** : la carte « Un numéro de chez nous » dit « 3,50 € aujourd'hui, déduits de votre premier mois de Pro »
   pendant l'essai ; Claude dit la même chose (`src/mcp/outils-numero.ts`).

Tests : unitaires du droit (essai, Pro payé, Free), du traitement de la première facture (arrêt, crédit, idempotence
sur un webhook rejoué), intégration du store ; e2e de la carte en essai.

Déploiement : API d'abord, puis console. **Essai réel** : un espace de test en essai prend un numéro (3,50 € débités en
mode test Stripe), l'essai est avancé à sa fin (`trial_end=now`), la facture Pro vaut 45,50 €, l'abonnement du numéro
est arrêté.

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
