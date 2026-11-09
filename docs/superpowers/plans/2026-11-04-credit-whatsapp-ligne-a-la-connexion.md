# La ligne de crédit prise à la connexion du numéro : plan d'implémentation

> **Pour un agent :** sous-skill requis, superpowers:executing-plans (un implémenteur par lot, une relecture
> indépendante en fin de lot). Les étapes se cochent (`- [ ]`).

**But** : l'option Crédit WhatsApp ne s'ouvre qu'à une formule payée, s'achète depuis le parcours de connexion du numéro
(Stripe d'abord), et le client sait à chaque moment qui le facture.

**Architecture** : une règle unique, « la formule est-elle payée ? », garde l'option, l'onglet, les cartes et la
conversion ; un geste neuf arrête l'essai de la formule Pro chez Stripe ; un état de la ligne (`etatLigneCredit`) nourrit
les cartes de Connecter WhatsApp et de l'Accueil ; deux e-mails et un bandeau disent les moments ; le passage du numéro
de l'essai attend l'essai réel du partage avec le partenaire.

**Technique** : Fastify et TypeScript (serveur), Next.js (console), Stripe, pg ; vitest, Playwright.

**Spec** : `docs/superpowers/specs/2026-11-04-credit-whatsapp-ligne-a-la-connexion-design.md` (la révision, validée par
Julien le 2026-11-04), qui révise `2026-10-30-credit-whatsapp-design.md`. Toutes deux sont hors du dépôt, sur le poste.

## Contraintes globales

- Textes : vouvoiement dans la console, jamais de tiret long, « formule Pro » et jamais « le Pro », le partenaire
  jamais nommé (ni code, ni doc, ni écran, ni e-mail).
- Prix : 30 € HT par numéro et par mois ; une place est un numéro ; codes promo fermés (inchangé).
- Pas d'option pendant un essai, Pro comme Business ; un numéro qui garde l'application WhatsApp Business ne va jamais
  sur la ligne.
- Le numéro d'une migration se lit par `npm run migrations`, il ne s'écrit nulle part ; une colonne lue par le code part
  en `migration=avant`.
- Un écran qui appelle une route neuve ne se pousse qu'après le déploiement de l'API qui la porte.

## Points à surveiller (aucune tâche ne les teste sans qu'on le dise)

1. Une carte refusée au moment d'arrêter l'essai : l'essai continue tel quel, un message clair, aucun paiement de
   l'option ouvert (test en A4).
2. Un double clic sur « Démarrer la formule Pro maintenant » : un seul prélèvement (clé d'idempotence, test en A4).
3. Un Pro dont le premier prélèvement après l'essai échoue (`en_retard`) : option refusée, aucun bandeau (test en A1).
4. Un espace dont tous les numéros gardent l'application : l'écran de paiement prévient (test en B1).
5. L'e-mail de conversion rejoué (webhook rejoué, Business confirmé deux fois) : un seul par espace (test en C1).

## Lot A : l'option attend une formule payée, et l'essai s'écourte

**Avancement (2026-11-05)** : A1 à A4 et A6, le serveur, écrits et testés ; onze retraits de garde, chacun vu par son
test ; relus (un rouge corrigé, cinq jaunes ouverts, plus bas) ; en production le 2026-11-05 avec `5aca4c54` (run
42035584064, la 0278 seule, relue en base). A5 (la console, et les cinq jaunes du serveur) relu sans rouge (seize
jaunes, plus bas) et en production le 2026-11-06 avec `6bfa5f37` (run 42181871248, sans migration). Le lot A est livré ;
son essai réel est l'essai 219 de `docs/prive/ESSAIS-REELS.md`.

### A1. La règle « formule payée »

**Fichiers** : créer `src/offres/formule-payee.ts` ; test `tests/formule-payee.test.ts`.

**Interface produite** : `formulePayee(e: { offre: Offre; pro: ResumePro | null; businessEssaiFinLe: Date | null },
maintenant: number): boolean`.

- [x] Tests, une ligne par cas : Pro en essai (`essaiFinLe` futur) faux ; Pro dont l'essai est fini et `statut` actif
  vrai ; Pro `en_retard` après l'essai faux ; résiliation programmée PENDANT l'essai faux ; Pro payé dès le départ
  (`essaiFinLe` nul) vrai ; Pro fini faux ; Business confirmé (`businessEssaiFinLe` nul) vrai ; Business en essai faux ;
  Free et Entreprise faux.
- [x] Les voir échouer, écrire la fonction pure, les voir passer.

### A2. `ouvrirOption` refuse pendant un essai

**Fichiers** : `src/stripe/option-credit-whatsapp.ts` (`ouvrirOption`, `DepsOptionCredit`), son câblage dans
`src/index.ts` ; test `tests/stripe-option-credit-whatsapp.test.ts`.

**Interfaces** : `DepsOptionCredit.formulePayee(tenantId: string): Promise<boolean>` (branchée sur A1, offre relue
sans cache) ; refus `409`, code `option_apres_essai`, message : « L’option Crédit WhatsApp s’ouvre avec la formule
payée : à la fin de votre essai, ou tout de suite si vous démarrez la formule Pro maintenant. »

- [x] Tests : un Pro en essai reçoit `option_apres_essai` et AUCUNE session Stripe n'est créée ; un Business en essai
  aussi ; une formule payée passe comme avant. Retirer la garde les fait échouer.

### A3. Le Business en essai

**Fichiers** : une migration (`tenants.offre_business_essai_fin_le timestamptz null`), `src/offres/offre.pg.ts` (la
lire et l'écrire), `src/http/ops-offre.ts` (la pose du Business prend `businessEssaiFinLe: string | null`), la fenêtre de
l'offre dans `/ops` (une case « en essai » et sa date) ; tests `tests/ops-offre.test.ts` et
`tests/integration/offres.integration.test.ts`.

- [x] Tests : la pose d'un Business en essai écrit la date ; la confirmation (date retirée) l'efface ; le retrait du
  Business l'efface. Chercher les `toEqual` des retours du store dans `tests/integration` avant de pousser.
- [x] Déploiement : la migration en `avant`.

### A4. Démarrer la formule Pro maintenant

**Fichiers** : `src/stripe/client.ts`, `src/stripe/gestion-pro.ts`, la route de la gestion de la formule Pro (le module qui sert déjà
`changerResiliationPro`), `src/stripe/traitement-abonnements.ts` ; tests `tests/gestion-pro.test.ts` (ou le fichier de
tests de la gestion de la formule Pro existant) et `tests/traitement-abonnements.test.ts`.

**Interfaces** :
- `terminerEssaiStripe(transport, o: { cle: string; abonnementId: string; idempotence: string }): Promise<void>` :
  `POST /v1/subscriptions/{id}` avec `trial_end=now` et `payment_behavior=error_if_incomplete` (à vérifier contre la doc
  de Stripe avant d'écrire), la clé d'idempotence `essai-fini-<abonnement>`.
- `demarrerProMaintenant(d: DepsGestionPro, tenantId: string, payeur: string): Promise<Issue<{ essaiFini: true }>>` :
  `409 pas_en_essai` hors essai ; `402 carte_refusee` (« Votre carte a été refusée : votre essai continue. ») sur un
  refus de paiement ; une panne passagère lève.
- Route `POST /tenants/:tenantId/offre/pro/demarrer`, admin, plafond des opérations coûteuses.
- Le webhook de la formule Pro écrit la fin d'essai quand `trial_end` RECULE (aujourd'hui il ne l'écrit que pendant `trialing`).

- [x] Tests : en essai, un succès arrête l'essai (un seul appel, la clé d'idempotence fixe) ; carte refusée, rien ne
  change et 402 ; hors essai 409 ; un `updated` actif dont `trial_end` recule réécrit `essaiFinLe`, et `formulePayee`
  devient vrai. Chaque garde retirée fait échouer son test.

### A5. La console pendant l'essai

**Fichiers** : `web/components/OngletCreditWhatsapp.tsx`, `web/components/EncartOffre.tsx` (le bloc de la formule Pro),
`web/lib/offre.ts` (l'appel `demarrerProMaintenant(tenantId)`), `web/lib/api-credit-whatsapp.ts` ; un e2e.

- [x] Pendant l'essai, l'onglet explique (moment 1 de la spec) et propose « Démarrer la formule Pro maintenant » ; une
  confirmation dit que l'essai gratuit s'arrête aujourd'hui et le prix de la formule ; au succès, enchaîner sur le
  paiement de l'option ; au 402, le message et l'essai intact. Le même bouton dans le bloc de la formule Pro
  (`AbonnementPro`, et non `EncartOffre`, qui est l'écran d'une fonction fermée), sans enchaîner sur l'option.
- [x] e2e : un espace en essai voit l'explication et le bouton, jamais « Prendre l'option ».
- [x] Pousser APRÈS le déploiement de l'API de A2 à A4.

### A6. Le refus d'un envoi sur une ligne arrêtée

**Fichiers** : `src/credit-whatsapp/refus.ts` (`MESSAGE_REFUS_CREDIT.ligne_inactive`), `web/lib/erreurs-gestes.ts`,
`web/lib/api-exemples.ts`, la doc régénérée (`cd web && npm run doc:md`) ; tests `tests/api-exemples.test.ts`.

- [x] Le message et le geste disent les deux chemins : reprendre l'option, ou connecter le numéro avec sa carte chez
  Meta (spec, décision 4) ; la place manquante garde son texte. Test : le geste cite les deux chemins dans les deux
  langues.

**Fin du lot A** : une relecture indépendante ; l'ordre : migration `avant`, API, puis la console.

### La relecture du lot A (2026-11-05) : 1 rouge, 7 jaunes

- 🔴 **Corrigé avant le déploiement** : la facture d'un essai écourté est une `subscription_update`, que la règle du
  prorata de siège excluait ; le numéro payé à part restait prélevé et la conversion de nos publicités ne partait pas.
  Une `subscription_update` dont toutes les lignes portent `parent.subscription_item_details.proration = false` compte
  désormais comme période payée (`traitement-abonnements.ts`), deux tests `webhook-pro`, cinq retraits de garde vus.
- Jaune 6 corrigé dans le même envoi (test seul) : le cas « payé dès le départ » du test d'intégration de l'essai
  écourté passe sur un espace à part, son enregistrement vérifié. Jaune 7 (la CI de `horodatage-iso`) : corrigé par
  `0ab36f7f`, qui part avec le lot.
- **Ouverts, relus avec A5, et corrigés par A5** (chacun avec son test et son retrait de garde) :
  1. Le verrou du démarrage est relâché même quand l'issue chez Stripe est inconnue (délai dépassé, 5xx après l'envoi) :
     le laisser échoir dans ce cas.
  2. Un essai avec résiliation programmée peut être démarré : refuser en 409 tant qu'une fin est posée (A5 ne montre
     pas le bouton dans ce cas).
  3. L'essai en base dépend de l'ordre des événements : `enregistrer` réécrit `essai_fin_le` sans la garde de
     `modifier` (un `created` rejoué en retard rouvre l'essai), et un Pro d'essai enregistré par la session ou la facture
     à 0 € garde `essai_fin_le` nul jusqu'au `created` (lu « payé dès le départ »). Poser la garde, porter l'essai dès
     l'enregistrement.
  4. Un prélèvement différé (SEPA, s'il est ouvert au Checkout du Pro) serait tenu pour réussi : n'annoncer le
     démarrage qu'avec la facture relue payée.
  5. `/ops` écrit une date d'essai du Business sur un espace qui n'est pas en Business : 400 dans ce cas.

### La relecture du lot A5 (2026-11-06) : aucun rouge, seize jaunes

Relus avec le lot B (les jaunes ne bloquent pas le déploiement) :

1. **Sans objet tant que seule la carte est acceptée** (Julien, 2026-11-06 : « pas de prélèvement, uniquement CB
   acceptée ») ; à rouvrir si un prélèvement (SEPA) est un jour activé au Checkout du Pro : l'échec d'une facture
   `subscription_update` est acquitté sans rien écrire, et la facture de l'essai écourté en est une. Un démarrage payé
   par SEPA puis refusé par la banque laisserait le Pro actif, l'option ouverte et aucun e-mail.
   Antérieur à A5. Correctif d'une ligne : n'acquitter que la `subscription_update` qui porte une ligne de prorata.
2. Le contrat de la route du démarrage (`src/http/offre-paiement.ts`) déclare `{ essaiFini: true }` sans `paye`, et son
   test répond sans ce champ : ajouter `paye` au type et un cas au test.
3. Le verrou gardé 60 s aussi sur une panne de la relecture ou un 429, quand rien n'est parti (décision écrite).
4. Un 200 illisible après l'envoi relâche le verrou et dit « n'a pas pu être enregistré », alors que le prélèvement a
   sans doute eu lieu (pas de double prélèvement, le webhook note la fin).
5. Le délai du verrou court depuis sa prise : deux appels de 30 s peuvent rendre le 503 à l'échéance ; le prolonger sur
   l'issue inconnue.
6. Après un démarrage SEPA, l'onglet montre « Prendre l'option » sous « paiement en cours » (conforme à la décision).
7. Pour un Pro `en_retard` d'un renouvellement, l'onglet parle du « premier paiement » et de l'essai : faux hors essai.
8. La confirmation de l'onglet dit le prix sans les sièges ni la remise (décision écrite).
9. Tant que le tarif n'est pas lu, la confirmation du bloc Pro ne dit que « Mensuel », sans le prix.
10. « Sa facture est plus bas sur cette page » : la liste des factures ne se relit qu'au rechargement.
11. Si `noterFinEssai` échoue, l'option est refusée (409) juste après le démarrage et « Démarrer » réapparaît (le
    webhook répare, rien n'est prélevé deux fois).
12. La confirmation de l'onglet promet l'option même quand le paiement est différé.
13. Un Checkout d'option abandonné juste après un démarrage affiche « rien n'a été débité » alors que la formule Pro l'a
    été (la phrase vise l'option).
14. `lireTarifPro` appelé pour un membre non administrateur (403 avalé).
15. Le journal et les cases du plan : portés avec le commit de déploiement.
16. Hors du lot, inchangé : une création rejouée en retard réécrit une fin d'essai FUTURE prolongée entre-temps.

## Lot B : les cartes « Qui règle Meta ? » et le guide

### B1. L'état de la ligne et les cartes

**Fichiers** : créer `src/credit-whatsapp/etat-ligne.ts` ; l'exposer dans la vue de mise en service (la route que lit
Connecter WhatsApp) ; `src/stripe/option-credit-whatsapp.ts` (le retour de Stripe) ; `src/mcp/mise-en-service.ts`
(`carte_meta_a_regler`) ; créer `web/components/QuiRegleMeta.tsx`, l'insérer dans `web/app/connecter-whatsapp` et
`web/app/accueil` ; tests serveur et un e2e.

**Interface produite** : `etatLigneCredit(d, tenantId): Promise<'free' | 'essai' | 'a_prendre' | 'en_attente' |
'active' | 'arretee'>` (`en_attente` : option payée, aucune ligne posée).

- [x] Tests : chaque état depuis ses données ; `carte_meta_a_regler` absent en `en_attente` ; le retour de Stripe mène à
  `/connecter-whatsapp` quand le paiement part de la carte ; un espace dont tous les numéros gardent l'application voit
  l'avertissement au moment de payer (`avecApplication`, calculé au serveur, dit par la carte et par l'onglet).
- [x] Deux cartes, chaque bouton sous la sienne : « Ma carte chez Meta » et « Crédit WhatsApp » ; leurs textes selon
  l'état (grisée en Free avec « avec la formule Pro », explication et « Démarrer la formule Pro maintenant » en essai,
  « Votre ligne s'ouvre sous 24 h ouvrées » en attente, les deux chemins une fois arrêtée). Hors vente, la carte est
  grisée « sur demande » dans tous les états, essai compris (décision de Julien du 2026-11-06, rouge de la relecture).
- [x] L'alerte « Nouvelle option » à Julien dit « ligne à poser sous 24 h ouvrées ».

### B2. Le guide du numéro

**Fichiers** : `web/lib/questions-numero.ts`, `web/components/ParcoursNumero.tsx`, `scripts/vitrine/tunnel-textes.ts`,
la skill du plugin qui porte le guide ; tests de parité existants (`tests/questions-numero-vitrine.test.ts`,
`tests/etapes-meta.test.ts`, `tests/etapes-numero-fourni.test.ts`).

- [x] Garder l'application dit « vous payez Meta avec votre carte : le Crédit WhatsApp n'est pas possible avec
  l'application » ; la parité console, plugin et vitrine reste verte. La voie du Crédit WhatsApp sans l'application,
  numéro fourni compris, est CONFIRMÉE par Julien (2026-11-06) mais n'est pas construite : elle arrive avec la vente
  (ci-dessous, ses textes validés).
- [x] Textes montrés à Julien avant le push (nouveauté publique) ; la vitrine et son anglais régénérés.

**Les textes validés par Julien le 2026-11-06** (« Oui, ces textes ») : la question « Qui paie vos messages à Meta ? »,
précision « Meta facture chaque modèle que vous envoyez. », juste après l'offre (Free et Pro ; Business et Entreprise
vont à l'échange). Les cartes : « Ma carte chez Meta », « Vous enregistrez votre carte bancaire chez Meta, qui vous
facture vos modèles. » (console : « Vous connectez votre numéro avec votre carte chez Meta, qui vous facture vos
modèles. ») ; « Crédit WhatsApp », « Vous prépayez vos messages chez Messaging Me, sans carte chez Meta : 30 € HT par
numéro et par mois, avec la formule Pro ou Business. », grisée en Free « Avec la formule Pro. », hors vente « Sur
demande : écrivez-nous. » (console : « … depuis le Support. »). Dans la console, selon l'état : en essai « Il vient avec
la formule Pro payante : à la fin de l'essai, ou tout de suite. » et « Démarrer la formule Pro maintenant » ; en vente
« Prendre l'option » ; en attente « Votre ligne s'ouvre sous 24 h ouvrées. » ; active « Vos messages sont payés par
votre Crédit WhatsApp. » ; arrêtée « Vos envois par le Crédit WhatsApp sont arrêtés, votre crédit restant est
conservé. », « Reprendre l'option » et « Connecter avec ma carte chez Meta ». Les voies qui gardent l'application :
« Vous payez Meta avec votre carte : le Crédit WhatsApp n'est pas possible avec l'application. » **À poser à
l'ouverture de la vente**, la voie du Crédit WhatsApp : « Avez-vous un numéro à brancher ? », précision « Avec le Crédit
WhatsApp, le numéro n'est pas dans l'application WhatsApp Business : vous répondez à vos clients depuis l'Inbox de
Messaging Me. » ; Oui, « Branchez votre numéro » : « La fenêtre de Meta s'ouvre depuis Messaging Me : vous y créez votre
compte Meta Business si vous n'en avez pas, puis le numéro reçoit son code. Un numéro encore dans l'application WhatsApp
Business doit d'abord en être retiré. » ; Non, « Nous vous fournissons le numéro » : « Un numéro fourni, inclus dans
votre formule, branché directement, sans l'application. » Validés aussi le même jour : la phrase de la FAQ du plugin et
des pages Développeurs, « cinq questions » sur Démarrer, l'avertissement des numéros qui gardent l'application, et
« Prendre l'option » d'un seul numéro depuis les cartes.

**Fin du lot B** : une relecture indépendante ; l'API avant la console, la vitrine après l'API.

### La relecture du lot B (2026-11-06) : 1 rouge, 13 jaunes

Le rouge, corrigé avant le push de la console (son commit à part, deux e2e vus rouges au symptôme puis verts) : hors vente,
la carte proposait « Démarrer la formule Pro maintenant » pendant l'essai, un prélèvement sur une promesse que la
production ne tenait pas. Les jaunes, relus avec le lot C ; **1, 3 et 11 se ferment avant l'ouverture de la vente** :

1. Une option reprise (`arretee`) au retour de Stripe avant le webhook remontre « Reprendre l'option » sans relire :
   `optionPayee` doit couvrir tout état hors `en_attente` et `active`.
2. `carte_meta_a_regler` est tu par espace, pas par numéro : un numéro qui garde l'application, ou d'un autre compte,
   bloqué pour sa carte, ne l'entend plus quand la ligne est active ou en attente.
3. Le bandeau de l'Accueil « Ajoutez votre carte chez Meta » ne lit pas l'état de la ligne (la spec le tait en attente).
4. Un numéro connecté payé par sa carte : aucune des deux cartes n'est mise en avant (`metaEnAvant`).
5. `etatLigneCredit` : la ligne d'un numéro délié compte encore ; une ligne forcée sur une Free se lit `free` ; une
   option payée sur un Pro passé en retard se lit `essai` au lieu de `en_attente`.
6. Le guide rouvert sur un numéro connecté (option arrêtée) reçoit `connecte={false}`.
7. `demarrerProMaintenant` marque « issue inconnue » aussi un 200 illisible de la lecture faite AVANT l'envoi.
8. `QUESTION_PAIEMENT.carte.texte` et `.grisee` ne servent qu'à la parité (la console a ses variantes validées) :
   l'écrire dans le module, ou les retirer.
9. Une Entreprise lit le prix de l'option « avec la formule Pro ou Business » puis « sur demande ».
10. Fermé : la phrase de la FAQ, montrée à Julien et validée le 2026-11-06.
11. Deux onglets, ou une carte périmée, ouvrent deux Checkout de l'option avant le webhook (antérieur au lot, deux
    entrées de plus) : refuser une prise quand une session est ouverte, ou un verrou court par espace.
12. Après les quinze relectures, « s'ouvre dans quelques secondes » reste affiché : dire « rechargez la page ».
13. Doc : la fiche publique « Connecter mon numéro WhatsApp » ne dit pas la question (avec C3) ; deux JSDoc empilés sur
    `creditWhatsapp` dans `src/mcp/mise-en-service.ts`.

## Lot C : la conversion et l'arrêt dits au client

### C1. La conversion

**Fichiers** : créer `src/credit-whatsapp/conversion.ts` ; l'appeler depuis le webhook de la formule Pro (la formule devient payée)
et depuis la confirmation d'un Business dans `/ops` ; une entrée du catalogue d'e-mails (`ligne_credit_disponible`) ;
créer `web/components/BandeauLigneCredit.tsx`.

**Interface** : `signalerConversion(d, tenantId: string): Promise<void>`, une fois par espace (occasion `conversion`),
ne lève jamais.

- [x] Tests : une seule émission sur des rejeux et une double confirmation ; jamais pour une formule pas encore payée ;
  le texte (moment 2) distingue un numéro sans l'application d'un numéro qui la garde.

### C2. L'arrêt de l'option

**Fichiers** : `src/stripe/traitement-abonnements.ts` (la première fin d'une option, hors l'option payée sans droit qui a
son e-mail), une entrée du catalogue (`option_wa_arretee`), `web/components/OngletCreditWhatsapp.tsx`.

- [x] Tests : une première fin émet une fois ; un rejeu non ; l'option payée sans droit garde le sien ; l'onglet dit les
  deux chemins (moment 3).

### C3. La doc et ce que dit Claude

**Fichiers** : `src/mcp/mise-en-service.ts` (`get_setup_state` lit `etatLigneCredit`), la consigne de
`start_whatsapp_connection` (garder l'application, c'est payer Meta avec sa carte), les descriptions de `get_credit` et
`buy_credit`, `scripts/plugin/faq.ts` (puis `npm run plugin:generer` et la version du plugin montée), `features.md` et les
empreintes des fiches qui la citent, `documentation.md`.

- [x] Tests existants verts (`tests/aide-proposer.test.ts`, la parité du catalogue MCP et de sa doc générée, la FAQ du
  plugin) ; `features.md` retouché vérifié par `tests/aide-proposer.test.ts` AVANT le push.
- [ ] Avant l'ouverture de la vente, pas avant : la fiche publique « Payer ses messages sans carte chez Meta » (une page
  de la vitrine) et la ligne « Crédit WhatsApp, après l'essai » sur les cartes Pro et Business de la vitrine, montrées à
  Julien avant le push.

**Fin du lot C** : une relecture indépendante ; le serveur avant la console.

### La relecture du lot C (2026-11-06) : aucun rouge, 13 jaunes

Les jaunes du lot B y sont fermés, sauf 5a (la ligne d'un numéro délié compte encore dans l'état) et 6 (le guide rouvert
ne sait pas le numéro connecté), reportés au lot D, qui traite les numéros et leurs lignes. Les treize jaunes du lot C
partent dans un lot de suite, après le déploiement ; **2, 4, 5 et 10 se ferment avant l'ouverture de la vente**, le 11
attend Julien :

1. L'e-mail de la conversion n'est pas « une fois par espace » : le webhook l'appelle à chaque facture de période, et la
   réservation est par PERSONNE et purgée à treize mois. Un admin arrivé plus tard le reçoit à l'échéance suivante, et
   le même e-mail repart treize mois après. Le borner à son moment (la formule devenue payée depuis peu). Mesuré en
   lecture seule le 2026-11-06 : aucun abonnement Pro vivant en production, personne ne le reçoit au déploiement.
2. L'e-mail de l'arrêt peut se perdre : une panne entre la fin écrite et l'e-mail fait rejouer l'événement, qui voit
   `premiereFin` à faux ; deux traitements de la même fin (l'`updated` impayé et le `deleted` qu'il déclenche) peuvent
   se partager `premiereFin` et `n`. Décider sur « des lignes de l'option arrêtées par cette fin », la réservation
   `option:<abonnement>` dédoublonnant déjà.
3. `!illimite` est redondant dans la condition de l'e-mail de l'arrêt (n vaut 0 pour une Entreprise) : le retrait de
   garde le montre, aucun test ne peut le tenir. Le retirer.
4. Un espace mixte (une ligne posée à la main encore active) lit « vos envois par le Crédit WhatsApp sont arrêtés ».
5. `aDroit` est lu trop tôt quand le Pro est lui aussi en retard, ou quand le `deleted` de l'option passe avant celui du
   Pro : « reprenez l'option » alors que la prise sera refusée.
6. Conversion manquée si `noterFinEssai` échoue et que la facture d'écourtement passe au webhook avant l'`updated`, ou
   pour un essai écourté depuis le tableau de bord de Stripe : elle attend l'échéance suivante.
7. Le jaune 11 du lot B n'est fermé qu'à moitié : lister, expirer et créer sans verrou laisse deux clics simultanés
   ouvrir deux sessions payables. Un verrou court par espace, comme pour le démarrage de la formule Pro.
8. Le bandeau lit l'état à chaque page pour tout admin d'un Pro ou d'un Business, même hors vente : le garder par
   `ongletCreditWhatsapp`, déjà lu. Il consomme aussi la file d'états du faux serveur de `qui-regle-meta.spec.ts`.
9. Deux politiques d'échec opposées : `get_setup_state` tait `carte_meta_a_regler` quand les numéros sont illisibles,
   l'Accueil montre le bandeau. En choisir une.
10. À l'ouverture de la vente : « il se prend sur demande » de la fiche publique (FR et EN) et de la FAQ du plugin et des
    pages Développeurs devient faux ; un Business converti hors vente ne reçoit jamais l'e-mail de vente ; l'e-mail « sur
    demande » dit « ses modèles sont recopiés » avant l'essai réel du partage (D0).
11. Catégorie : `ligne_credit_disponible` est une proposition commerciale classée `service`, donc sans lien de
    désinscription. À trancher par Julien.
12. Tests manquants : la distinction de texte entre un numéro avec et sans l'application, « une fois par espace » ailleurs
    que sur un faux `emettre`, le câblage `conversionDeLaConsole`.
13. JSDoc déplacés : celui de `StripeError` coiffe `LECTURE_AVANT_ENVOI`, celui de `firstNameOf` coiffe
    `CarteMetaARegler`, deux JSDoc empilés sur `QUESTION_PAIEMENT` ; `documentation.md` dit `optionEnVente` règle unique,
    alors que `portesCreditWhatsapp.optionEnVente` la recalcule depuis la configuration (équivalentes aujourd'hui).

### C4. Les jaunes de la relecture du lot C (lot de suite, accord de Julien du 2026-11-07)

**Méthode** : en direct, TDD, sans relecture propre : des jaunes se poussent après le déploiement et sont relus avec le
lot D. Les retraits de garde à la fin, serveur et console, comme au lot C.

- [x] Jaunes 1, 6 et 12 : le webhook ne dit la conversion qu'à son moment, dans les `FENETRE_CONVERSION_JOURS` (25)
  qui suivent la fin de l'essai de la formule Pro, ou sa souscription sans essai ; la mise à jour d'un Pro actif la
  rattrape (un essai écourté au tableau de bord de Stripe, une fin d'essai que le démarrage n'a pas pu écrire). Tests :
  une facture un mois plus tard, ou treize mois, ne la dit plus ; l'`updated` d'un Pro actif la dit ; les textes des
  deux e-mails distinguent un numéro avec et sans l'application, dans les deux langues.
- [x] Jaune 3 : la garde redondante de l'e-mail de l'arrêt retirée.
- [x] Jaune 7 : la prise de l'option sous un verrou court par espace ; un second clic pendant la prise reçoit 409.
- [x] Jaune 8 : le bandeau monté seulement quand l'onglet Crédit WhatsApp existe (`ongletCreditWhatsapp`).
- [x] Jaune 9 : une seule politique d'échec : un état ou des numéros illisibles laissent dire « Ajoutez votre carte
  chez Meta », à Claude comme sur l'Accueil.
- [x] Jaune 13 : les JSDoc remis sur leur symbole ; la règle de vente unique lue aussi par l'onglet
  (`portesCreditWhatsapp`).
- Restent pour avant la vente : 2, 4, 5 et 10 ; le 11 attend Julien.

**Essai réel** : l'essai 231 le couvre ; s'y ajoute, au premier Pro payant, l'e-mail à la fin de l'essai et aucun au
renouvellement suivant.

### C5. Les jaunes d'avant la vente (accord de Julien du 2026-11-09)

**Méthode** : implémenteur par lot, puis une relecture indépendante du diff : l'e-mail de l'arrêt, la fin de droit et la
résiliation chez Stripe sont des chemins de la production, et ils portent des invariants invisibles (un seul e-mail, une
seule consigne de remboursement, une résiliation comptée seulement relue). TDD ; les retraits de garde à la fin. Les
jaunes 1 à 3 du plan du lot 4 (§ « La relecture du correctif de l'e-mail sans droit ») s'y ferment aussi, dans le code
qu'ils partagent avec ceux du lot C.

- [x] Lot C, jaune 2 : l'e-mail de l'arrêt se décide sur l'ÉTAT, à chaque passage (un rejeu après une panne, deux
  traitements de la même fin) : des lignes de l'option arrêtées, aucune autre option vivante, une fin par résiliation ou
  impayé (jamais une fin de droit) ; la réservation `option:<abonnement>` le garde unique. Tests : un rejeu l'envoie ;
  deux traitements qui se partagent la fin l'envoient ; une fin de droit, jamais.
- [x] Lot C, jaune 4 (décision de Julien du 2026-11-09) : l'e-mail suit la règle de l'onglet (`arretDesLignes` : toutes
  les lignes arrêtées, l'une de l'option) ; un espace qui garde une ligne posée à la main n'en reçoit aucun, et l'alerte à
  Julien le dit. Test : l'espace mixte.
- [x] Lot C, jaune 5 : « reprenez l'option » seulement quand la prise l'accepterait (`repriseOuverte` : la formule payée,
  et un Pro dont la fin programmée n'est pas passée). Tests : un Pro en retard, un Pro qui se termine, un Business en
  essai : aucun e-mail.
- [x] Lot C, jaune 11 (décision de Julien du 2026-11-09) : les deux e-mails de la conversion passent en `commercial`,
  avec le lien de désinscription. Test du catalogue.
- [x] Lot 4, jaunes 1 à 3 : la résiliation ne se compte que RELUE. Sur toute erreur de Stripe, l'abonnement est relu :
  résilié, la fin de droit suit (l'e-mail et la consigne) ; sinon, ou illisible, « à vérifier » : Julien la résilie et
  prévient les admins à la main, la fin écrite et les lignes arrêtées. Plus de levée, donc plus de rejeu qui retombe sur
  un abonnement déjà résilié ni sur un 500 gardé 24 h par la clé d'idempotence. Une seule fin de droit à la fois par
  espace (verrou court) : la consigne ne part qu'une fois. Tests : réponse perdue, 500 après la résiliation, 409 :
  résiliée, relue ; 500 sans résiliation : à vérifier, une alerte ; une fin de droit déjà en cours : rien de plus. Les
  jaunes 5 et 6 du même passage (la consigne d'un « à vérifier », des commentaires périmés) se ferment avec eux.

**Essai réel** : l'essai 231 s'enrichit (une option résiliée au portail : l'e-mail une fois, même l'événement renvoyé
depuis le tableau de bord de Stripe) ; l'essai 215, après le prix, couvre l'option payée sans droit.

### La relecture du lot C5 (2026-11-09) : aucun rouge, 10 jaunes

Relecture indépendante du commit du lot, sur sa copie : 290 tests des fichiers touchés et voisins, la suite unitaire
entière (seul `tests/mcp-agent.test.ts` a dépassé 5 s sous la charge, vert seul), `tsc`, eslint, l'auto-attaque (2 070
sondes, aucune trouvaille). Les dix jaunes partent dans un lot de suite, avant l'ouverture de la vente :

1. Le verrou par espace avale un cas différent : la fin du Pro (`fin_de_droit`) et la session d'une option payée sans
   droit traitées dans les mêmes millisecondes, l'enregistrement reçoit `en_cours` et l'option est résiliée « sans
   remboursement », sans e-mail ni consigne. Une clé par cas (`option.fin:<cas>:<espace>`) : la session et la facture
   restent sérialisées, deux cas différents tournent comme avant.
2. Le bail de 60 s ne couvre pas le pire cas qu'il protège (la résiliation et sa relecture à 30 s chacune, puis deux
   alertes) : un second appel reprend le verrou et rejoue tout. Un bail de 3 minutes, ou `prolonger` après la relecture.
3. `resilierOptionChezStripe` (l'impayé abandonné) garde la clé `arret-<abonnement>` et lève sur une panne : un vrai 500
   gardé 24 h laisse les lignes d'une option impayée actives, sans alerte. Le même traitement que la fin de droit :
   relire ; sinon alerte « à résilier à la main », et la fin quand même. Défaut antérieur au lot.
4. L'e-mail de l'arrêt n'a plus de borne dans le temps : décidé à chaque passage, un `updated` tardif sur l'abonnement
   résilié (une métadonnée retouchée, un événement renvoyé), le Pro réglé entre-temps, l'envoie des semaines après. Le
   borner à quelques jours après `finiLe`, comme la conversion.
5. `repriseOuverte` ne lit pas `optionEnVente` : la vente suspendue (prix vidé), « reprenez l'option » part quand même.
6. La doc dit plus que le code : seule une fin programmée PASSÉE ferme la reprise, « qui se termine » et « sur sa fin »
   se lisent autrement. L'écrire juste. Question à Julien : fermer la reprise, et la porte de la prise, dès qu'une fin est
   programmée ? Cas résiduel invisible de la base : Pro et option arrêtés ensemble sans fin programmée, l'avis de
   l'option traité le premier.
7. L'onglet ne suit pas la règle de l'e-mail : « Reprendre l'option » se montre à un Pro en retard, et la porte répond
   « pas pendant un essai », une raison fausse. Exposer `repriseOuverte` dans la vue.
8. Deux trous de tests : le cas Entreprise de l'e-mail joué avec `repriseOuverte: false` (la garde `seule` n'y est pas
   tenue pour l'e-mail) ; aucun test du câblage des trois dépendances neuves (`lignes`, `repriseOuverte`, `verrous`).
9. De la doc restée sur l'ancien état : la page de confirmation de désinscription (`src/http/emails-desinscription.ts`)
   et la JSDoc de `web/lib/api/compte.ts` disent « (bienvenue, conseils, récapitulatif) », sans les offres.
10. La lecture des lignes passe entre `finir` et l'alerte de fin : une panne à cet endroit perd l'alerte (défaut
    antérieur, déjà vrai avec `illimite`, `vivante` et `arreterLesLignes`). Alerter avant de lire les lignes.

Constat sans défaut : sans levée, une option payée sans droit dont la résiliation n'a pas atteint Stripe passe à la main
de Julien au lieu d'être rejouée ; la facture suivante réalerte (« finie chez nous, mais Stripe la dit active »).

### C6. Les jaunes de la relecture du lot C5 (accord de Julien du 2026-11-09)

**Méthode** : implémenteur par lot, puis une relecture indépendante du diff : les mêmes chemins de production que C5 (la
fin de droit, la résiliation chez Stripe, l'e-mail de l'arrêt). TDD ; les retraits de garde à la fin. Trois décisions de
Julien le même jour : la prise de l'option reste ouverte jusqu'à la fin programmée d'une formule Pro (la doc se
corrige, pas le code) ; l'option hors vente, l'e-mail de l'arrêt ne part pas et l'alerte à Julien le dit ; une formule
Pro en retard lit partout la vraie raison du refus.

- [x] Jaunes 1 et 2 : le verrou de la fin de droit par cas (`option.fin:<cas>:<espace>`), et un bail de 3 minutes, plus
  long que la résiliation et sa relecture (deux délais HTTP de 30 s) et deux alertes (5 s) : un test tient l'ordre des
  constantes. Tests : un cas tenu ne bloque pas l'autre ; le bail couvre le pire cas.
- [x] Jaune 3 : la résiliation d'un impayé abandonné relue chez Stripe sur toute erreur ; résiliée, rien de plus ;
  sinon une alerte « à vérifier, à résilier à la main », et la fin quand même, sans levée. Tests : 503 puis relue
  `canceled`, résiliée ; 503 puis relue `unpaid`, l'alerte et la fin.
- [x] Jaunes 4, 5 et 10 : l'e-mail de l'arrêt borné aux trois jours qui suivent la fin (la durée des rejeux de Stripe),
  jamais hors vente (l'alerte à Julien le dit), et l'alerte de fin envoyée avant la lecture des lignes (la mention de
  l'espace mixte, après). Tests : une fin de quatre jours, aucun e-mail ; hors vente, aucun e-mail et l'alerte ; une
  panne de la lecture des lignes après l'alerte.
- [x] Jaune 6 (décision de Julien) : la doc dit « une formule Pro dont la fin programmée est passée », plus « qui se
  termine ».
- [x] Jaune 7 (décision de Julien) : la prise refusée à une formule Pro en retard dit « Le paiement de votre formule Pro
  est en retard : réglez-le, puis prenez l'option. » (409 `formule_en_retard`), au lieu de « pas pendant un essai ».
  Tests : un Pro en retard, ce refus ; un Pro en essai, l'ancien.
- [x] Jaunes 8 et 9 : le cas Entreprise rejoué avec la reprise ouverte ; un test du câblage des dépendances neuves ; la
  page de désinscription et la JSDoc de `web/lib/api/compte.ts` citent les offres.

**Essai réel** : l'essai 231 s'enrichit : la page qui confirme une désinscription des e-mails d'information cite les
offres ; après le prix, un événement de fin renvoyé depuis le tableau de bord de Stripe plus de trois jours après la fin
de l'option n'envoie plus l'e-mail de l'arrêt.

### La relecture du lot C6 (2026-11-09) : aucun rouge, 8 jaunes

Commit `f5a6b3cd`, déployé avec le lot E. Les huit jaunes, à relire avec le lot suivant :
1. Un 409 `idempotency_key_in_use` entre deux cas (l'autre cas tient la clé de la résiliation) n'est pas absorbé par la
   relecture de l'abonnement.
2. Le bail de 3 minutes, l'événement acquitté `en_cours` : l'arrêt du worker ne laisse que 25 s.
3. La fenêtre de trois jours de l'e-mail de l'arrêt est au bord exact des rejeux de Stripe, et son refus n'a pas
   d'alerte « sans e-mail ».
4. Les alertes « sans e-mail » (espace mixte, hors vente) ne partent qu'à la première fin.
5. Hors vente, un `updated` sort tôt sans résilier ni finir (`optionChezStripe` nul).
6. Des commentaires périmés (« trois alertes » pour deux) et l'entrée de `todo.md`.
7. `formulePayee` et `formuleEnRetard` sont deux lectures séparées de la formule.
8. Le test du verrou par cas a un angle mort.

## Lot D : le passage du numéro de l'essai sur la ligne

- [ ] **D0, l'essai réel du partage** (spec, « L'essai réel avant toute vente ») : sur un numéro d'essai connecté avec une
  carte, le partager avec le partenaire, recopier ses modèles, envoyer un modèle par le compte de messagerie de la
  ligne, vérifier qu'un entrant n'arrive qu'une fois. Il dit sur quel compte vit la ligne.
- [ ] **D1, seulement si D0 dit « un compte neuf »** : le numéro rattaché au compte de messagerie de la ligne, nommé à
  l'envoi (`messaging_account_id`), modèles, santé et volumes relus sur lui, la pose de `/ops` qui le prend en entrée.
  Un plan à part, écrit après D0.
- [ ] **D2** : le passage fait à la main dans `/ops` par Julien, avec la recopie des modèles, en attendant la fenêtre du
  partenaire.

## Lot E : la fenêtre du partenaire

Plan à part : `2026-11-09-credit-whatsapp-fenetre-du-partenaire.md` (`01cf6682`, relu sans rouge, onze jaunes à ce
plan ; les quatre premiers à fermer avant de laisser `META_SOLUTION_ID` posé pour un vrai client ou d'ouvrir la vente).

## Ordre de livraison

A (A1 à A4 et A6 côté serveur, migration `avant`, puis A5) ; B ; C ; D0 avant toute vente, puis D1 et D2 ; E. La vente
(poser `STRIPE_PRIX_OPTION_WA`) attend A, B, C, D0, et les jaunes « avant la vente » du plan du lot 4.

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff**, parce que la production emprunte ces chemins (un prélèvement Stripe
qui arrête un essai, le webhook de la formule Pro, la garde de l'option, des e-mails aux clients) et qu'ils portent des invariants
invisibles : pas d'option pendant un essai, un seul prélèvement par essai arrêté, une conversion dite une fois. Une
relecture indépendante en fin de chaque lot ; les écrans du lot B et le bandeau (lot C) dans le même lot que leur
serveur, avec leurs e2e, sans feature-loop (l'interface n'y est pas faite pour lui). **Essai réel qui clôt la
feature** : sur un espace d'essai en formule Pro, Julien démarre la formule Pro avant la fin de l'essai, prend l'option
depuis la carte « Crédit WhatsApp », la ligne est posée et un modèle part par elle ; puis l'option résiliée gèle les
envois, l'e-mail de l'arrêt arrive et la console dit les deux chemins.
