# Constructeur et Inbox : les champs de base, le rangement d'un formulaire, les pastilles de statut

**But :** trois retours de Julien du 2026-11-10 sur le constructeur de scénarios et l'Inbox.

1. Dans le bloc Action, « Mettre à jour un champ » ne propose ni Prénom, ni Nom, ni Email.
2. Le bloc Formulaire doit montrer, dans son panneau, chaque élément capturé par le formulaire et le champ où il
   s'enregistre, et permettre de changer ce champ pour ce scénario. Un formulaire créé en JSON dans le Business
   Manager n'a aujourd'hui aucun rangement : ses réponses ne vont nulle part.
3. Marquer une conversation « Traité » (ou Urgent, Signalé, Archivé) ne montre rien : on croit que rien ne s'est passé.

Le « List button » demandé aussi existe déjà : c'est le bloc Question (liste WhatsApp, 10 choix, une sortie par choix).
Julien l'avait raté, rien à faire.

## Méthode de livraison

En direct, avec UNE relecture indépendante en fin de lot, parce que les points 1 et 3 sont de la console, isolés et
réversibles, et que le point 2 touche un chemin que la production emprunte (l'écriture des réponses de formulaire sur
la fiche) mais en ajoutant un réglage que personne n'a encore posé : tant qu'un bloc n'en porte pas, le chemin d'avant
est inchangé, ce que des tests vérifient dans les deux sens. Pas de migration : le réglage vit dans le graphe du
scénario.

**Essai réel :** sur la SANDBOX, un scénario qui envoie un formulaire créé dans le Business Manager, son panneau qui
liste ses éléments, l'un rangé dans Prénom ; le formulaire rempli depuis un téléphone, Prénom écrit sur la fiche. Puis
une conversation marquée « Traité » depuis « À traiter » : la pastille apparaît dans l'en-tête.

## Décisions de Julien (2026-11-10)

- Le rangement est PROPRE AU SCÉNARIO, élément par élément : changer une ligne remplace, pour cet élément et ce bloc
  seulement, le réglage du formulaire ; les autres éléments gardent celui du formulaire. Pour un formulaire du Business
  Manager, la destination part vide.
- Les pastilles vont dans l'EN-TÊTE de la conversation ouverte ; la liste garde ses deux pastilles (Traité, Urgent).
- Dans l'éditeur de formulaires, la destination de base « Nom » devient le vrai Nom (`nom_de_famille`). Un formulaire
  déjà réglé sur le nom du profil WhatsApp le garde, affiché « Nom WhatsApp ».

## Ce qui change

1. **Les champs de base** (`web/lib/fields.ts`) : `champsEcrivables(fields, t)` rend Prénom, Nom et Email, même jamais
   remplis, puis les champs de l'espace. Tous les sélecteurs du constructeur qui ÉCRIVENT un champ s'en servent :
   Action (mettre à jour, vider), réponse rangée d'une Question, Appel API, Fonction JS, rangement du formulaire. « Nom
   WhatsApp » et le téléphone n'y entrent pas (le premier est réécrit à chaque message reçu).
2. **Les pastilles** (`web/app/inbox/page.tsx`, `web/lib/inbox-rangement.ts`) : l'en-tête montre Traité, Urgent,
   Signalé et Archivé ; après un geste, la conversation ouverte prend tout de suite le nouvel état
   (`apresRangement`), même quand elle quitte le dossier affiché.
3. **Le rangement du formulaire** :
   - `web/lib/partage/rangement-formulaire.ts` : la lecture défensive de `data.rangement` (`{ cle: champ }`, `''` =
     ne pas enregistrer) et la mise en texte d'une valeur reçue ;
   - `src/meta/flow-sorties.ts` : les éléments qu'un flow_json renvoie, lus dans le `payload` de ses actions
     `complete`, avec le libellé du composant qu'ils citent ; `MetaFlowClient.sortiesDuFormulaire` va le lire chez Meta ;
   - `GET /tenants/:tenantId/flows/:flowId/sorties` : les éléments et leur champ. Un formulaire de Messaging Me se lit
     en base, sans appel à Meta ; un formulaire du Business Manager, chez Meta ;
   - quand un formulaire rempli arrive, le job du webhook écrit, AVANT l'avance qui quitte le bloc, les éléments que le
     bloc Formulaire en attente range (`rangerParLesParcours`, `src/webhooks/rangement-par-le-parcours.ts`), sur la
     réponse COMPLÈTE (`InboundMessage.reponseFormulaire`, et non le `buttonPayload` tronqué à 2 000 caractères). Pas
     dans l'exécuteur : une avance gelée (fil tenu par un opérateur) aurait laissé l'élément écrit nulle part ;
   - le bloc ne range que la réponse au formulaire qu'IL a envoyé, que nomme son `flow_token` (`jetonDeFormulaire`) ;
   - le rangement du formulaire (`processFlowCompletions`) saute les éléments que le bloc a rangés : un élément ne
     s'écrit jamais à deux endroits. Le consentement reste au formulaire ;
   - le panneau du bloc (`WorkflowConfigPanel.tsx`) : une ligne par élément, son champ ; changer de formulaire efface
     le rangement. La route absente (console poussée avant l'API) se dit sans casser le panneau ;
   - l'éditeur de formulaires (`web/lib/flow-mapping.ts`) : « Nom » vise `nom_de_famille`.
4. La doc : `features.md` (et l'empreinte des fiches qui citent ses sections), `documentation.md`, le journal.

## Tests attendus

- Les champs de base proposés même absents de l'espace, sans doublon une fois créés.
- `apresRangement` pour chaque geste ; un e2e : « Traité » depuis « À traiter » montre la pastille dans l'en-tête.
- La lecture des sorties d'un flow_json réel du Business Manager (écrans imbriqués, `${form.x}`, `${data.x}`).
- La route : formulaire de Messaging Me sans appel à Meta, formulaire du Business Manager lu chez Meta, refus d'un
  formulaire d'un autre espace.
- L'exécuteur : un bloc qui range écrit ses éléments, un bloc sans rangement n'écrit rien (comme avant).
- `processFlowCompletions` : sans bloc qui range, tout le formulaire s'écrit (comme avant) ; avec, ses éléments sont
  sautés et le consentement reste.
- Un e2e du panneau : les éléments listés, un champ choisi part dans le graphe enregistré.

## La relecture

Une relecture indépendante, sans rouge. Ses jaunes, corrigés dans le même commit sans relecture propre :
- le bloc rangeait N'IMPORTE quel formulaire rempli pendant l'attente, et nos clés sont des mots courants : il ne range
  plus que la réponse au formulaire qu'il a envoyé (son `flow_token`) ;
- le câblage dans `handleWebhookJob` n'avait aucun test : `tests/webhook-rangement-formulaire.test.ts`, muté dans les
  deux sens ;
- une course dans l'Inbox (une autre conversation ouverte avant la réponse prenait l'état) ;
- deux « Nom » identiques dans un sélecteur quand l'espace a un champ `nom` : le socle se dit « (champ de base) » ;
- une borne de 80 caractères sur les clés, plus courte que les vraies : 200 ;
- les textes qui disaient que l'exécuteur écrit (ici et dans le module partagé) ;
- les deux formes d'une case multiple selon le chemin, dites ; le consentement d'un formulaire du Business Manager,
  dit dans le panneau ; « Name » seul ne suggère plus le nom de famille.

Laissés au lot suivant : la fiche publique de l'Inbox (traduction et vitrine) et les fiches non publiques du scénario
et du formulaire (leur corps ne dit pas encore le panneau ni le nouveau « Nom » ; les recharger en production est un
geste de Julien), et un e2e qui exige les champs de base dans les sélecteurs de la Question, de l'Appel API et de la
Fonction JS.

## Ordre de déploiement

API et workers d'abord (`deploy-scaleway.yml`, `migration=aucune`), dans la foulée du push : la console part au push et
tolère la route absente. Rien pour le plugin.
