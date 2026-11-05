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
42035584064, la 0278 seule, relue en base). Reste A5, la console.

### A1. La règle « formule payée »

**Fichiers** : créer `src/offres/formule-payee.ts` ; test `tests/formule-payee.test.ts`.

**Interface produite** : `formulePayee(e: { offre: Offre; pro: ResumePro | null; businessEssaiFinLe: Date | null },
maintenant: number): boolean`.

- [ ] Tests, une ligne par cas : Pro en essai (`essaiFinLe` futur) faux ; Pro dont l'essai est fini et `statut` actif
  vrai ; Pro `en_retard` après l'essai faux ; résiliation programmée PENDANT l'essai faux ; Pro payé dès le départ
  (`essaiFinLe` nul) vrai ; Pro fini faux ; Business confirmé (`businessEssaiFinLe` nul) vrai ; Business en essai faux ;
  Free et Entreprise faux.
- [ ] Les voir échouer, écrire la fonction pure, les voir passer.

### A2. `ouvrirOption` refuse pendant un essai

**Fichiers** : `src/stripe/option-credit-whatsapp.ts` (`ouvrirOption`, `DepsOptionCredit`), son câblage dans
`src/index.ts` ; test `tests/stripe-option-credit-whatsapp.test.ts`.

**Interfaces** : `DepsOptionCredit.formulePayee(tenantId: string): Promise<boolean>` (branchée sur A1, offre relue
sans cache) ; refus `409`, code `option_apres_essai`, message : « L’option Crédit WhatsApp s’ouvre avec la formule
payée : à la fin de votre essai, ou tout de suite si vous démarrez la formule Pro maintenant. »

- [ ] Tests : un Pro en essai reçoit `option_apres_essai` et AUCUNE session Stripe n'est créée ; un Business en essai
  aussi ; une formule payée passe comme avant. Retirer la garde les fait échouer.

### A3. Le Business en essai

**Fichiers** : une migration (`tenants.offre_business_essai_fin_le timestamptz null`), `src/offres/offre.pg.ts` (la
lire et l'écrire), `src/http/ops-offre.ts` (la pose du Business prend `businessEssaiFinLe: string | null`), la fenêtre de
l'offre dans `/ops` (une case « en essai » et sa date) ; tests `tests/ops-offre.test.ts` et
`tests/integration/offres.integration.test.ts`.

- [ ] Tests : la pose d'un Business en essai écrit la date ; la confirmation (date retirée) l'efface ; le retrait du
  Business l'efface. Chercher les `toEqual` des retours du store dans `tests/integration` avant de pousser.
- [ ] Déploiement : la migration en `avant`.

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

- [ ] Tests : en essai, un succès arrête l'essai (un seul appel, la clé d'idempotence fixe) ; carte refusée, rien ne
  change et 402 ; hors essai 409 ; un `updated` actif dont `trial_end` recule réécrit `essaiFinLe`, et `formulePayee`
  devient vrai. Chaque garde retirée fait échouer son test.

### A5. La console pendant l'essai

**Fichiers** : `web/components/OngletCreditWhatsapp.tsx`, `web/components/EncartOffre.tsx` (le bloc de la formule Pro),
`web/lib/offre.ts` (l'appel `demarrerProMaintenant(tenantId)`), `web/lib/api-credit-whatsapp.ts` ; un e2e.

- [ ] Pendant l'essai, l'onglet explique (moment 1 de la spec) et propose « Démarrer la formule Pro maintenant » ; une
  confirmation dit que l'essai gratuit s'arrête aujourd'hui et le prix de la formule ; au succès, enchaîner sur le
  paiement de l'option ; au 402, le message et l'essai intact. Le même bouton dans le bloc de la formule Pro.
- [ ] e2e : un espace en essai voit l'explication et le bouton, jamais « Prendre l'option ».
- [ ] Pousser APRÈS le déploiement de l'API de A2 à A4.

### A6. Le refus d'un envoi sur une ligne arrêtée

**Fichiers** : `src/credit-whatsapp/refus.ts` (`MESSAGE_REFUS_CREDIT.ligne_inactive`), `web/lib/erreurs-gestes.ts`,
`web/lib/api-exemples.ts`, la doc régénérée (`cd web && npm run doc:md`) ; tests `tests/api-exemples.test.ts`.

- [ ] Le message et le geste disent les deux chemins : reprendre l'option, ou connecter le numéro avec sa carte chez
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
- **Ouverts, relus avec A5** :
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

## Lot B : les cartes « Qui règle Meta ? » et le guide

### B1. L'état de la ligne et les cartes

**Fichiers** : créer `src/credit-whatsapp/etat-ligne.ts` ; l'exposer dans la vue de mise en service (la route que lit
Connecter WhatsApp) ; `src/stripe/option-credit-whatsapp.ts` (le retour de Stripe) ; `src/mcp/mise-en-service.ts`
(`carte_meta_a_regler`) ; créer `web/components/QuiRegleMeta.tsx`, l'insérer dans `web/app/connecter-whatsapp` et
`web/app/accueil` ; tests serveur et un e2e.

**Interface produite** : `etatLigneCredit(d, tenantId): Promise<'free' | 'essai' | 'a_prendre' | 'en_attente' |
'active' | 'arretee'>` (`en_attente` : option payée, aucune ligne posée).

- [ ] Tests : chaque état depuis ses données ; `carte_meta_a_regler` absent en `en_attente` ; le retour de Stripe mène à
  `/connecter-whatsapp` quand le paiement part de la carte ; un espace dont tous les numéros gardent l'application voit
  l'avertissement au moment de payer.
- [ ] Deux cartes, chaque bouton sous la sienne : « Ma carte chez Meta » et « Crédit WhatsApp » ; leurs textes selon
  l'état (grisée en Free avec « avec la formule Pro », explication et « Démarrer la formule Pro maintenant » en essai,
  « Votre ligne s'ouvre sous 24 h ouvrées » en attente, les deux chemins une fois arrêtée).
- [ ] L'alerte « Nouvelle option » à Julien dit « ligne à poser sous 24 h ouvrées ».

### B2. Le guide du numéro

**Fichiers** : `web/lib/questions-numero.ts`, `web/components/ParcoursNumero.tsx`, `scripts/vitrine/tunnel-textes.ts`,
la skill du plugin qui porte le guide ; tests de parité existants (`tests/questions-numero-vitrine.test.ts`,
`tests/etapes-meta.test.ts`, `tests/etapes-numero-fourni.test.ts`).

- [ ] Garder l'application dit « vous payez Meta avec votre carte : le Crédit WhatsApp n'est pas possible avec
  l'application » ; la voie du Crédit WhatsApp connecte sans l'application, numéro fourni compris (choix à confirmer par
  Julien, spec décision 8). La parité console, plugin et vitrine reste verte.
- [ ] Textes montrés à Julien avant le push (nouveauté publique) ; la vitrine et son anglais régénérés.

**Fin du lot B** : une relecture indépendante ; l'API avant la console, la vitrine après l'API.

## Lot C : la conversion et l'arrêt dits au client

### C1. La conversion

**Fichiers** : créer `src/credit-whatsapp/conversion.ts` ; l'appeler depuis le webhook de la formule Pro (la formule devient payée)
et depuis la confirmation d'un Business dans `/ops` ; une entrée du catalogue d'e-mails (`ligne_credit_disponible`) ;
créer `web/components/BandeauLigneCredit.tsx`.

**Interface** : `signalerConversion(d, tenantId: string): Promise<void>`, une fois par espace (occasion `conversion`),
ne lève jamais.

- [ ] Tests : une seule émission sur des rejeux et une double confirmation ; jamais pour une formule pas encore payée ;
  le texte (moment 2) distingue un numéro sans l'application d'un numéro qui la garde.

### C2. L'arrêt de l'option

**Fichiers** : `src/stripe/traitement-abonnements.ts` (la première fin d'une option, hors l'option payée sans droit qui a
son e-mail), une entrée du catalogue (`option_wa_arretee`), `web/components/OngletCreditWhatsapp.tsx`.

- [ ] Tests : une première fin émet une fois ; un rejeu non ; l'option payée sans droit garde le sien ; l'onglet dit les
  deux chemins (moment 3).

### C3. La doc et ce que dit Claude

**Fichiers** : `src/mcp/mise-en-service.ts` (`get_setup_state` lit `etatLigneCredit`), la consigne de
`start_whatsapp_connection` (garder l'application, c'est payer Meta avec sa carte), les descriptions de `get_credit` et
`buy_credit`, `scripts/plugin/faq.ts` (puis `npm run plugin:generer` et la version du plugin montée), `features.md` et les
empreintes des fiches qui la citent, `documentation.md`.

- [ ] Tests existants verts (`tests/aide-proposer.test.ts`, la parité du catalogue MCP et de sa doc générée, la FAQ du
  plugin) ; `features.md` retouché vérifié par `tests/aide-proposer.test.ts` AVANT le push.
- [ ] Avant l'ouverture de la vente, pas avant : la fiche publique « Payer ses messages sans carte chez Meta » (une page
  de la vitrine) et la ligne « Crédit WhatsApp, après l'essai » sur les cartes Pro et Business de la vitrine, montrées à
  Julien avant le push.

**Fin du lot C** : une relecture indépendante ; le serveur avant la console.

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

En attente de sa doc : un plan à part quand elle arrive.

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
