# La ligne du partenaire attachée par son API (Crédit WhatsApp)

**Le problème.** V3 pose notre ligne à la connexion en tenant l'attache de la ligne du partenaire pour automatique ;
elle ne l'est pas (essai réel 236). Le 2026-11-11, le partenaire a répondu : l'attache se fait À NOTRE DEMANDE, par son
API, « dans le parcours de connexion » : attacher, retirer quand il le faut, vérifier. Nous en payons la consommation,
donc nous seuls décidons quels comptes WhatsApp y sont branchés (décision de Julien du 2026-11-12 : « vas-y »).

**Mesuré le 2026-11-12 sur le compte de test de l'essai 236** (sonde hors dépôt) : vérifier rend
`{"ok":1,"data":{"wabaId","creditLineAdded"}}` ; attacher rend `{"ok":1}` en 2 à 11 s, de nouveau `{"ok":1}` sur un compte
déjà attaché ; retirer rend `{"ok":1}`, puis `500 {"ok":0,"error":"Credit line is not attached to this WABA"}` s'il n'y a
plus rien ; un compte inconnu rend `500` (erreur Graph 100/33). Jeton JWT HS256 (`iss` = notre émetteur, `aud` =
`whatsapp-cloud`). Le compte de test est resté attaché.

## Tâches

- [x] **Le client** (`src/credit-whatsapp/attache.ts`) : `attacher`, `retirer` (« plus rien à retirer » = déjà retirée),
  `verifier`, jeton signé par `jose` (5 minutes), délai de 30 s, réponses lues par Zod (`safeParse`). Trois variables,
  toutes ou aucune, contrôlées au démarrage : `LIGNE_PARTENAIRE_URL` (https), `LIGNE_PARTENAIRE_EMETTEUR`,
  `LIGNE_PARTENAIRE_SECRET` (secrète). L'adresse et le secret ne s'écrivent jamais dans le dépôt, le partenaire n'y est
  jamais nommé. Tests : le jeton vérifié par `jose`, chaque réponse mesurée, chaque panne (statut, corps illisible, délai).
- [x] **La pose** (`poserLaLigne`, `/ops` et la connexion) : configurée, elle attache puis vérifie AVANT de poser notre
  ligne ; une attache non confirmée ne pose rien (422, la cause dite) et se retire ; une pose qui lève après l'attache la retire. Non
  configurée, `/ops` pose comme avant et la pose automatique de la connexion est ÉTEINTE. L'alerte « POSÉE » dit l'attache
  vérifiée ; celle du cas « à poser » dit que la pose de `/ops` attache aussi. Tests : l'ordre, chaque refus, le retrait de
  secours, la pose automatique éteinte sans configuration.
- [x] **Le cycle** : la fin de l'option (fin de droit et webhook Stripe) retire l'attache de chaque compte arrêté, la
  reprise la rattache ; une panne alerte Julien sans faire échouer le geste (notre garde coupe déjà les envois d'une
  ligne arrêtée). Le retrait dans `/ops` retire la sienne AVANT la nôtre, et une panne garde la nôtre (422). Tests :
  chaque chemin, la panne alertée, rien sans configuration.
- [x] **Les deux rouges de la relecture** : une attache non confirmée se retire, après un refus « déjà sur la ligne »
  avancé avant l'attache ; le retrait de `/ops` retire la ligne du partenaire d'abord, lue en base. Un compte que le
  partenaire ne voit pas (Graph 100/33, mesuré au retrait comme à la lecture) laisse retirer la nôtre, alerté, sans quoi
  le retrait resterait bloqué. Chaque test vu rouge, puis vérifié par mutation.
- [x] Le câblage (`src/index.ts`) tenu par `tests/credit-whatsapp-cablage.test.ts` ; le manuel, `.env.example`, le backlog
  (les jaunes que ce lot ferme).

## Ordre de déploiement

L'API seule, sans migration. Déployée sans les trois variables, elle éteint la pose automatique (plus sûr que V3, qui
pose sans attache) ; Julien pose ensuite les variables sur le conteneur de l'API par un script qui lit le fichier reçu
du partenaire, sans afficher le secret ni toucher aux autres variables, puis l'essai réel.

## Méthode de livraison

**Implémenteur par lot, puis une relecture indépendante du diff**, parce que ce chemin décide qui paie Meta (un compte
branché à tort se paie par nous, un compte oublié bloque le client ou le fait payer deux fois) et touche la fin de droit
et le webhook de Stripe. TDD.

**Essai réel** : sur le compte de test de l'essai 236, retirer la ligne dans `/ops` (le partenaire retiré, vérifié par son
API), la reposer (attachée et vérifiée), puis envoyer un modèle payant que Meta accepte, et relire chez Meta le moyen de
paiement du compte : la ligne du partenaire.
