# Le STOP WhatsApp remonte dans HubSpot

**But.** Quand une personne se désabonne dans Messaging Me (elle écrit STOP, ou l'équipe la désabonne), sa fiche
HubSpot le dit, toute seule, sans rien à configurer chez le client. Quand elle est réabonnée, la fiche le dit aussi.
Sans ça, le client continue de lui écrire depuis HubSpot (e-mails, séquences, appels) sans savoir qu'elle a dit non.

**Hors du lot.** Les types d'abonnement officiels de HubSpot (ils obligeraient chaque portail à réautoriser l'app) ;
les STOP reçus avant la mise en service (pas de rattrapage) ; le STOP RCS ; les fiches sans numéro (BSUID seul).

## Décisions de Julien (2026-11-12)

1. **Une case sur la fiche**, pas l'abonnement officiel HubSpot : la propriété « MM - WhatsApp désabonné » et la
   date du désabonnement.
2. **Réabonné dans Messaging Me : la case se décoche** dans HubSpot (la date s'efface).
3. **Numéro absent de HubSpot : on ignore**, on ne crée pas de fiche pour un STOP.
4. **Pas de rattrapage** : seuls les désabonnements et réabonnements d'après la mise en service remontent.

## Mes choix (à relire)

- **Propriétés neuves** `mm_whatsapp_stop` (case Oui/Non) et `mm_whatsapp_stop_date` (date), dans le groupe
  « Conversationnel ». La propriété existante `mm_whatsapp_optin` n'est écrite par personne aujourd'hui et je ne la
  réutilise pas : « Non » y voudrait dire aussi bien « n'a jamais accepté » que « a dit STOP ».
- **Une case de plus dans Tools > Intégrations > HubSpot**, « Désabonnement WhatsApp », **allumée par défaut** comme
  « contact injoignable », y compris pour les espaces déjà connectés.
- **On pousse un ÉTAT, relu au moment de l'envoi, pas un événement.** Le travail relit le consentement de la fiche
  quand il part : un STOP suivi d'un réabonnement rapide, rejoués dans le désordre, finissent quand même sur le bon état.

## Ce qui existe déjà et qu'on réutilise

- **Côté Messaging Me** : `annoncerDesabonnement` (`src/crm/contact-store.pg.ts`) est appelé après CHAQUE écriture
  qui fait passer une fiche à `opted_out`, quel que soit le chemin (STOP reçu, fiche, masse, scénario, API), et met
  en file la poussée vers le connecteur API du client (`src/crm/poussee-optout.ts`). Les transitions sont calculées
  une seule fois dans `src/crm/transition-consentement.ts`.
- **Côté connecteur HubSpot** (`~/mm-hubspot`) : la route signée `POST /service/contact-flag`
  (`src/service/route.ts`) fait déjà exactement le geste voisin pour « WhatsApp injoignable » : retrouver le contact
  par téléphone, s'assurer que la propriété existe, la poser. Messaging Me l'appelle par `flagContactUnreachable`
  (`src/crm/hubspot-service.ts`), gardé par le choix du client (`flagSelonLeChoix`, `src/worker.ts`).

## Tâches

**Lot 1, connecteur HubSpot (`~/mm-hubspot`) : FAIT, commit `f100af8`, PAS déployé.** Personne ne l'appelle encore ;
il part en production avec les lots 2a et 2b, en un seul déploiement du connecteur. Relecture du 2026-11-12 : aucun rouge, ses
jaunes forment le lot 2a.
- `/service/contact-flag` accepte `flag: 'stop'` avec `valeur: true | false` et `date` (ISO, obligatoire si vrai).
  Il pose `mm_whatsapp_stop` et `mm_whatsapp_stop_date` (date vidée si faux), après `ensureProperty` des deux.
- **Contact introuvable : `200 { flagged: false, absent: true }`, aucune création** (décision 3). `unreachable`
  garde son comportement actuel (il crée).
- Les deux propriétés entrent dans `PROPERTY_DEFS`.
- Tests : pose, retrait, contact absent sans création, signature refusée, valeur invalide refusée.

**Lot 2a, connecteur : les jaunes de la relecture du lot 1. FAIT dans `~/mm-hubspot`, PAS déployé.**
- **La mesure, faite le 2026-11-12 sur le portail cobaye** (lecture seule) : les propriétés `hs_searchable_calculated_*`
  ne rendent RIEN avec `+33633921577`, et rendent les fiches avec le numéro national `633921577`. Les quatre fiches du
  numéro d'essai sont toutes écrites exactement `+33633921577` (trois en mobile, une en téléphone). `searchByPhone`, celle
  des autres chemins, garde son défaut : son correctif est au `todo.md` du connecteur, avec l'accord de Julien.
- **La recherche du STOP est juste** (`searchAllByPhone`) : le numéro national aux propriétés normalisées
  (`libphonenumber-js`, ajoutée au connecteur), l'E.164 aux autres, jusqu'à 100 fiches, puis chaque fiche REVÉRIFIÉE :
  avec indicatif, le numéro doit redonner exactement celui cherché ; sans indicatif, il se lit avec le pays de la fiche,
  et sans pays il n'est retenu que sous la forme nationale complète (« 06 … », jamais « 6 … », aussi un mobile
  espagnol). C'est le rouge de la relecture du lot 2a, corrigé avec son test vérifié dans les deux sens.
- **Toutes les fiches du numéro** reçoivent l'état, dans les deux sens, une écriture par fiche (rarement plus de
  quelques-unes ; une fiche supprimée entre-temps est passée).
- La branche `stop` lue par Zod strict : `e164` au format `^\+[1-9]\d{6,14}$`, `date` en ISO ; `valeur` vrai SANS date
  accepté (case cochée, date vidée).
- **Le contrat de réponse** suit `/service/champs/ecrire` : `{ issue: 'ecrit', fiches }`, `{ issue: 'contact_inconnu' }`
  (journalisé avec le seul portail), `{ issue: 'refuse', message }` (4xx de HubSpot, que mba ne rejoue pas) ; 403 en
  re-consentement (409) ; 429 et 5xx restent des pannes (5xx) que mba rejoue. Client court (4 s par appel, une relance).
- Les propriétés s'assurent APRÈS la recherche, une fois par portail et par processus, de nouveau après un refus.
- Les deux propriétés ne sont jamais proposées parmi les champs importables (`PROPRIETES_STOP`) : `/service/champs/poser`
  les refuse, donc `/service/champs/ecrire` ne peut pas les écrire.

**Décision de Julien du 2026-11-12 : l'analyse PORTE la case.** L'événement d'analyse dit si le contact est désabonné,
et le connecteur coche la case sur la fiche qu'il écrit : une fiche que l'analyse crée après un STOP la porte aussi.
Seul « désabonné » voyage par l'analyse, jamais « réabonné » : une analyse construite avant un STOP et écrite après ne
doit pas pouvoir le défaire (le flag `stop` porte les deux sens).

**Lot 2b, connecteur : les jaunes du lot 2a et l'analyse qui porte la case. FAIT dans `~/mm-hubspot`, PAS déployé.**
- L'événement d'analyse accepte `stop: { date? }` (sa présence = désabonné ; une forme illisible fait tomber le champ,
  jamais l'événement). Le writer coche la case dans une écriture À PART, après les propriétés de toujours (un portail
  sans ces propriétés refuserait sinon toute l'analyse) ; un refus de HubSpot est journalisé sans perdre l'analyse.
- Le STOP a son client (4 s par appel, aucune relance : la file de mba rejoue) et une échéance de 20 s vérifiée avant
  chaque écriture (503 au-delà) : un appel dure au plus 36 s environ (la dernière fiche commencée peut encore se
  réécrire après une réassurance).
- Un 400 fait réassurer les propriétés une fois et réécrire la fiche ; une fiche encore refusée n'arrête pas les autres,
  et l'appel rend 502 (`ecriture_refusee`) au lieu d'un `refuse` silencieux. Le contrat n'a plus de `refuse`.
- Un désabonnement sans date n'efface plus une date déjà posée ; `date` accepte un décalage horaire, ou `null`.
- `/service/champs/ecrire` refuse lui-même les propriétés du STOP.
- La recherche lit aussi `hs_whatsapp_phone_number` (mesuré : E.164 sur le cobaye) et journalise, sans le numéro, les
  candidats écartés et une recherche coupée à 100 (journalisée plutôt que suivie : cent fiches pour un numéro ne sont
  plus une personne).
- Reste à MESURER, avec Julien (créer une fiche est une écriture) : qu'une fiche saisie « 06 33 92 15 77 » est trouvée
  par le filtre national. À faire avant l'essai réel.
- Le rouge de sa relecture, corrigé (test vérifié dans les deux sens) : l'analyse ne coche la case que pour un vrai
  numéro (`E164`, partagé avec le flag) ; un contact connu par son seul BSUID n'est pas joignable par le flag, seul à
  décocher, et sa case ne se serait jamais décochée.

**Lot 2c, connecteur : les jaunes de la relecture du lot 2b. FAIT, commit `0d7b15b`, PAS déployé.**
- Le filtre `hs_whatsapp_phone_number` (vérifié sur le cobaye seulement) : sur un 400 de la recherche, elle se refait
  sans lui, au lieu de faire finir en DLQ chaque STOP d'un portail qui n'aurait pas la propriété.
- L'écrivain d'analyse écrit d'abord et ne crée les propriétés que sur un 400, puis réécrit une fois.
- Le contrat `stop` de l'analyse admet le décalage horaire, et un `stop` présent mais illisible est journalisé.
- Les tests manquants sont écrits (date nulle et décalage horaire sur le flag, journal `stop_recherche`, aller-retour
  par `raw_event`, écrivain sur un portail installé avant les propriétés).
- Écarté, avec sa raison : sauter les fiches déjà dans l'état voulu pour qu'un rejeu avance sur une liste trop longue
  pour l'échéance. Un numéro personnel n'a pas vingt fiches, et une liste coupée à 100 est journalisée.
- Mon choix, à relire : une analyse restée en file pendant un réabonnement peut recocher la case. C'est le sens
  restrictif, et le garder évite l'inverse (une garde « ne pas cocher une case décochée » laisserait décochée la fiche
  d'un nouveau STOP dont le flag aurait échoué).

**Lot 2c, Messaging Me. FAIT dans une copie à part (accord de Julien du 2026-11-12), PAS déployé.**
- Migration 0292 : `tenant_settings.hubspot_stop` booléen, défaut vrai, en **`avant`** (le code neuf l'écrit).
- La case « Désabonnement WhatsApp (STOP) » des choix HubSpot : store, route (facultative, absente = gardée, aucune
  offre ne la ferme), réglages lus, et l'écran. 🔴 La console ne la montre ni ne l'envoie tant que l'API ne la rend
  pas (`envoyerStop`) : poussée avant le déploiement de l'API, elle ne fait refuser aucun enregistrement.
- **Le réabonnement s'annonce** : `transition-consentement.ts` rend `leve` à côté de `passe`, et `PgContactStore` appelle
  `annoncerReabonnement` depuis les trois écritures qui lèvent un STOP (`setOptInByWaId`, `applyEdits`, et
  `upsertManyByPhone` pour l'import coché, qui lit avant d'écrire les numéros encore désabonnés). Liste dérivée par
  `tests/optout-poussee.test.ts`.
- La file `hubspot-stop` (`src/crm/hubspot-stop.ts`), alimentée par les deux annonces, enfilée et consommée seulement
  avec `HUBSPOT_SERVICE_URL`. Le job relit l'état et appelle le flag `stop` (`poserStopHubspot`, un essai sous 45 s).
  🔴 **Écart au plan** : pas de verrou par contact. La file est consommée un job à la fois par le seul rôle `principal`,
  et le job relit l'état à l'exécution : le dernier exécuté pose l'état du moment, ce que le verrou cherchait. La même
  concurrence de 1 borne aussi les recherches HubSpot. Reste un cas : mba abandonne à 45 s un appel que le connecteur
  finit plus tard (au plus 36 s prévus).
- L'analyse porte `stop: { date? }` seulement pour un contact désabonné d'un espace qui a la case allumée
  (`stopPourAnalyse`), jamais « réabonné », jamais pour un contact connu par son seul BSUID.
- `features.md` : une puce dans « Sécurité & compliance », à côté de « Prévenir votre propre système » ; la fiche
  `suivre-les-desabonnements` (non publique) la reprend, empreinte posée. 🔴 Après le push : `aide:charger`.
- Limite écrite, non traitée : un portail HubSpot relié à DEUX espaces reçoit l'état du dernier espace qui a bougé.
- 🔴 La poussée vers le connecteur API du client (`poussee-optout`) ne change pas : les deux voyagent côte à côte.
- 🔴 **Relevé par la relecture du lot, corrigé** : le job s'arrêtait au premier numéro en échec, et un numéro qui échoue
  à chaque appel (cent fiches HubSpot, un 400) privait de leur case, à chaque rejeu, tous ceux qui le suivaient dans le
  lot. Il les tente désormais tous et lève à la fin (le modèle de `poussee-optout`), et écarte d'emblée un numéro hors
  E.164. Deux tests, vérifiés dans les deux sens. Les jaunes de la même relecture : `todo.md`.

## Rayon de souffle

- `annoncerDesabonnement` a déjà un consommateur, la poussée du connecteur API : l'ajout d'une seconde file ne doit
  pas changer son appel ni sa garantie « ne lève jamais ».
- Le choix HubSpot est lu par l'écran, la route et le worker : une clé ajoutée d'un côté seulement casse la
  validation de l'autre (Zod sur la réponse).
- Le connecteur est déployé AVANT Messaging Me : sinon chaque appel `flag: 'stop'` prend un 400 et remplit la DLQ.

## Méthode de livraison

**Implémenteur par lot, puis revue humaine du diff**, parce que le chemin touche le consentement, que la production
emprunte à chaque STOP, et porte des invariants invisibles (une transition annoncée une seule fois, une annonce qui
ne fait jamais échouer l'écriture, l'ordre de déploiement entre les deux services). Une relecture indépendante à la
fin de chaque lot. La feature se clôt par l'essai réel décrit plus bas, sur le portail cobaye : un STOP écrit depuis
un vrai téléphone, lu sur la vraie fiche HubSpot.

## Déploiement

1. `mm-hubspot` (lots 1, 2a, 2b et 2c ensemble) : CI verte job par job, puis `deploy-scaleway.yml`
   (`migration=aucune`) après l'accord de Julien. Sans risque seul : rien ne l'appelle, et un ancien mba n'envoie pas
   `stop`.
2. Messaging Me : CI verte, puis `deploy-scaleway.yml` avec `migration=avant` (0292), après les déploiements des
   sessions voisines déjà en file, et relecture de la colonne en base.
3. La console part avec le push : elle ne montre la case qu'une fois l'API déployée.
4. `aide:charger` pour la fiche `suivre-les-desabonnements`, en comparant d'abord `docs/aide` à origin.

## Essai réel

Sur le portail cobaye 139615673, avec le numéro d'essai de Julien relié à une fiche HubSpot : écrire « STOP » au
numéro de l'espace, vérifier que CHAQUE fiche de ce numéro (quatre le 2026-11-06) porte « MM - WhatsApp désabonné »
à Oui avec la date ; le réabonner depuis
sa fiche Messaging Me, vérifier que la case est décochée. Puis éteindre la case dans Tools > Intégrations, refaire un
STOP, vérifier que la fiche HubSpot n'a pas bougé. Avant l'essai, Julien crée sur le cobaye une fiche dont le numéro
est saisi « 06 33 92 15 77 » : elle doit être cochée comme les autres (preuve que le filtre national la trouve).
