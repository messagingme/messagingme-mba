# Le menu « Scénario » : Builder et automations Shopify, HubSpot, Autres (cadrage du 2026-11-18)

Cadrage par grill avec Julien le 2026-11-18. Chaque décision ci-dessous est la sienne sauf celles marquées
**(appel du rédacteur)**, à relire.

## 1. Intention

Aujourd'hui, les messages Shopify (commande payée, commande expédiée, panier abandonné) sont trois templates fixes
réglés dans Tools > Intégrations > Shopify : un événement, un message, rien d'autre. Julien veut que ces événements
lancent de **vrais scénarios**, construits dans le builder classique (« message 1, attendre 30 min, message 2 », un
bouton qui mène à un message rapide, un agent IA...), et que le menu les range par source. HubSpot suit le même
modèle. C'est aussi la fondation des automations Shopify à venir (back in stock, temps 2).

## 2. Ce que voit l'utilisateur

```
Scénario                         (remplace « Automation » dans la barre)
├── Builder                      (l'actuel Contenu > Scénario, déplacé)
└── Automation
    ├── Shopify                  (visible seulement si une boutique est branchée)
    ├── HubSpot                  (visible seulement si HubSpot est branché, appel du rédacteur)
    └── Autres                   (les automations d'aujourd'hui, qui pointent vers des scénarios du Builder)

Tools > Intégrations > Shopify   (ne garde que le branchement de la boutique et son interrupteur)
```

### 2.1 Automation > Shopify

Trois lignes fixes : **Panier abandonné**, **Commande payée**, **Commande expédiée**. Chacune a un interrupteur.
Allumer une ligne la première fois crée son scénario et ouvre le **builder classique** (tous les blocs), avec un
**premier bloc template déjà posé** : texte proposé, variables Shopify, modifiable sur place, envoyé chez Meta à
l'enregistrement (voir § 5.1). Le panier abandonné garde son **délai** comme réglage de la ligne (15 min à 72 h après
la dernière modification du panier) : c'est lui qui décide qu'un panier est abandonné, ce n'est pas un bloc
« attendre » **(appel du rédacteur)**.

### 2.2 Automation > HubSpot

Trois familles :

- **Changement d'étape d'un deal** : une ligne par étape réglée (bouton « Ajouter » : pipeline et étape), chacune avec
  son interrupteur et son scénario. La liste est libre, contrairement à Shopify.
- **Rendez-vous** : « avant / après un rendez-vous » : on choisit une propriété date importée de HubSpot (celle du lien
  de réservation) et le délai. Sous le capot, le déclencheur de date d'aujourd'hui (`avant_date`), limité aux champs
  importés de HubSpot. Le cas MUTAC (rappel avant un RDV) vit ici.
- **Lancés par un workflow HubSpot** : les scénarios que l'action « Lancer un scénario Messaging Me » d'un workflow
  HubSpot peut choisir. L'action ne voit plus QUE ceux-là (aujourd'hui elle lit tous les scénarios en ligne,
  `workflowStore.listPublies`, `src/http/hubspot-workflow.ts:62`).

### 2.3 Automation > Autres

Les automations d'aujourd'hui, inchangées : message reçu, étiquette posée, conversation analysée, webhook entrant,
date d'un champ (avant ou après), risque de désengagement, action d'agent. Le changement d'étape HubSpot en sort (il
va sous HubSpot). « Date d'un champ » y reste, pour n'importe quel champ (§ 5.5).

### 2.4 Tools > Intégrations > Shopify

Le branchement de la boutique, et un **interrupteur de pause** : éteint, la boutique reste branchée, les automations
Shopify gardent leur réglage, mais plus rien ne part ; rallumé, tout repart. « Couper » (débrancher pour de bon) reste
un bouton à part. L'import des clients, les chiffres et le mode opératoire de branchement y restent **(appel du
rédacteur)**. Les trois messages en sortent.

## 3. Décisions (Julien, 2026-11-18)

1. **Cloisonnement dans les deux sens.** Un scénario Shopify ou HubSpot n'apparaît pas dans le Builder ni dans la liste
   des Autres ; une automation Shopify ou HubSpot ne pointe jamais vers un scénario du Builder. Corollaires (appel du
   rédacteur, conséquence directe) : l'API, Claude Code (`list_scenarios`, `send_scenario_to_contact`, `create_scenario`),
   les campagnes et les webhooks entrants ne voient que les scénarios du Builder ; un bloc « Aller à » ne traverse
   jamais un rayon ; l'action HubSpot ne voit que les scénarios du rayon HubSpot « lancés par un workflow ».
2. **Le premier message part toujours, la suite seulement si aucun HUMAIN ne tient le fil.** Le premier template part
   même quand quelqu'un tient la conversation, sans couper le fil (comme aujourd'hui). Les blocs suivants ne tournent
   pas si un opérateur (`app_human`) tient la conversation ; un agent IA, le nôtre (`app_workflow`) comme celui de Meta
   (`mba`), est REPRIS par le parcours, comme l'action HubSpot le fait déjà avec l'agent de Meta
   (`reprise: 'sauf_operateur'`). Vaut pour Shopify ET HubSpot (les trois familles). Corollaire assumé : l'action
   HubSpot « Lancer un scénario » cesse de refuser quand un conseiller tient le fil (`conseiller_en_main`, décision 3
   du cadrage du 2026-10-29, remplacée) ; elle envoie le premier message sans couper, et le connecteur mm-hubspot suit.
3. **Un parcours Shopify ou HubSpot garde la main.** Un parcours automatique ordinaire (rayon général) en cours est
   remplacé par un parcours Shopify ou HubSpot, comme aujourd'hui. Mais tant qu'un parcours Shopify ou HubSpot tourne
   pour ce contact :
   - un NOUVEL événement Shopify ou HubSpot envoie quand même son premier message (décision 2), sans suite : il ne
     remplace pas le parcours en cours (« commande expédiée » ne coupe pas la demande d'avis de « commande payée ») ;
   - un message du client ne lance aucune automation Autres : il va au parcours si celui-ci attend une réponse, sinon
     au répondeur ou à l'agent, sans clore le parcours.
4. **Arrêt automatique du panier.** Dès qu'une commande naît du panier (même non payée), le parcours du panier
   abandonné s'arrête, quel que soit le bloc où il en est. Le marchand n'a rien à poser.
5. **Builder classique, fenêtre fermée au départ.** Un scénario Shopify ou HubSpot démarre fenêtre de service FERMÉE.
   Tout envoi atteint sans que le client ait répondu ou cliqué doit être un template, et le builder le dit au moment
   où le marchand pose autre chose (§ 5.2). Après un clic sur un bouton ou une réponse du client, un message rapide est
   permis.
6. **Édition de template sur place, partout** : dans les builders Shopify et HubSpot ET dans le Builder général.
7. **Claude Code (`set_shopify_message`) ne change que le premier template** du scénario, garde la suite, et dit que le
   scénario a d'autres étapes à modifier dans la console. En Free (pas de console), un scénario Shopify n'a qu'un bloc.
8. **Bascule : on repart de zéro.** Les messages Shopify actifs et les automations « changement d'étape HubSpot »
   existants s'éteignent ; le marchand les recrée dans le nouvel écran. Pas de conversion.
9. **Approche A** (§ 6) : le circuit Shopify envoie le premier bloc, le scénario prend la suite.
10. **ROI** : le premier message d'une confirmation ou d'un avis d'expédition reste hors leviers de vente (il suit la
    vente) ; tout bloc qui le suit dans le parcours est un levier, attribué à cette automation. Le parcours du panier
    abandonné est un levier tout entier.
11. **La fenêtre fermée au départ vaut aussi pour les automations Autres qui ne naissent pas d'un message du client**
    (webhook, date d'un champ, étiquette, risque, action d'agent), dans ce chantier (§ 5.2).

Appels du rédacteur pris après la relecture indépendante (2026-11-18), à relire :

12. **Le bloc template gagne une sortie « Pas de réponse après X »**, comme le bloc Question, partout. Aujourd'hui un
    template attend une réponse sans limite (`walk`, `src/workflow/engine.ts`, seul le bloc Question porte une
    échéance) : sans cette sortie, « template, attendre 30 min, second template » ne dépasse jamais le premier. Ajout
    pur : un template sans échéance se comporte exactement comme avant.
13. **Premier bloc verrouillé dans les rayons Shopify et HubSpot** : toujours un template, rien avant lui, non
    supprimable. C'est lui que le circuit envoie (approche A). Précédent : l'action HubSpot exige déjà un scénario qui
    s'ouvre par un template (`jugerScenarioPourWorkflow`).
14. **Un template modifié sur place dans le Builder général** crée un nouveau template pour CE bloc seulement, et
    l'ancien n'est jamais supprimé chez Meta : il peut servir à d'autres scénarios, à l'API, ou à un workflow HubSpot
    « Envoyer un modèle » qui le désigne par son nom, invisible de notre base. La suppression automatique de l'ancien
    reste réservée aux rayons Shopify et HubSpot, où le template est à usage unique.
15. **Pause de la boutique ou ligne éteinte** : les parcours en cours de cette ligne (ou de toute la boutique)
    s'arrêtent, et un panier abandonné pendant la pause n'est jamais relancé après coup.

### 3.1 Décisions après la cartographie des lots 2 à 4 (Julien, 2026-11-18, après le déploiement du lot 1)

Elles **remplacent** ce que les sections suivantes disent de contraire (notamment la préférence « bloquant » du § 5.2).

16. **L'analyse de fenêtre PRÉVIENT, elle ne refuse jamais la publication.** Un message de session atteint fenêtre
    fermée (rayons Shopify et HubSpot, automations qui ne naissent pas d'un message, sortie « Pas de réponse ») est
    signalé dans le builder, sans refus serveur.
17. **Une automation qui ne naît pas d'un message** (date, étiquette, webhook, risque...) et dont le scénario envoie un
    message de session sans réponse du client : **avertissement dans l'écran Automation**, l'enregistrement passe.
18. **Template modifié depuis le builder et en validation chez Meta : publication programmée.** « Publier » pendant la
    validation programme la mise en ligne à l'approbation ; elle est refusée si une campagne active utilise le
    scénario ; un e-mail dit « en ligne » ou « refusé ».
19. **Le nom d'un template créé depuis un bloc est automatique** : le nom du scénario suivi d'un horodatage court,
    généré par le serveur (ce qui marque aussi qu'il vient du builder).
20. **Un opérateur tient le fil au moment de la suite d'un parcours d'événement : le parcours s'arrête** (la règle
    d'aujourd'hui). Conséquence assumée : en mode « Équipe », un client qui écrit passe le fil à l'équipe, donc sa
    relance s'arrête.
21. **Le répondeur et un parcours d'événement endormi coexistent.** Le répondeur (agent IA ou scénario répondeur)
    répond sans fermer le parcours Shopify ou HubSpot qui dort ; au réveil, celui-ci reprend la main et ferme le
    parcours du répondeur. Un seul parcours d'événement actif par contact, garanti par la base. L'invariant « au plus un
    parcours actif par contact » devient « au plus un parcours d'événement, et des parcours ordinaires ».
22. **Une réponse écrite au premier template, sans flèche « Toute autre réponse », arrête le parcours** comme
    aujourd'hui : le message va au répondeur, la relance ne part pas.

Appels du rédacteur pris sur la cartographie (2026-11-18), à relire :

23. **Le premier bloc verrouillé (décision 13) part au lot 5**, avec la création des scénarios Shopify : aucun scénario
    de ces rayons n'existe avant.
24. **Une relance « Pas de réponse » d'un parcours né d'un chemin de masse** (campagne, workflow HubSpot, envoi API à un
    bloc) **n'émet rien tant que le contact n'a pas répondu** : le drapeau est figé à la naissance du parcours (colonne de
    `workflow_runs`, migration « avant »), sinon un réveil simultané de N destinataires publierait N « étiquette ajoutée ».
25. **Un template à délai attend aussi en mode agent de Meta** (aujourd'hui un template sans choix ne retient pas dans ce
    mode) : un délai posé est une intention explicite.
26. **La sortie « Pas de réponse » se règle dans la console seulement au lot 2** : la recette de l'API et de Claude Code
    refuse de décrire un template à délai (« modifié dans la console »).
27. **Lot 3** : tous les templates créés par le builder sont gardés ; pas d'édition sur place d'un carousel ni d'un
    en-tête média (ils se créent dans Contenu > Templates) ; un template en validation est refusé proprement à l'envoi
    (après relecture hors cache) au lieu d'une erreur de Meta inexpliquée.
28. **Lot 4** : le parcours d'un événement naît quand Meta a ACCEPTÉ le premier template (dans le moteur de campagne,
    qui porte alors le scénario et le bloc), jamais avant ; ses variables se lisent dans les templates et, préfixées
    (`{{shopify.lien_panier}}`), dans le texte des messages, suivent un « Aller à », et s'effacent à la fin du parcours.
    Devant un parcours d'événement, les automations « Autres » cèdent, les répondeurs, outils d'agent et sauts
    coexistent, l'Inbox, le lien de test, les campagnes, la chaîne, la publicité et le widget le remplacent.

### 3.2 Décisions après la cartographie du lot 4 (Julien, 2026-11-18)

29. **Un parcours d'événement ne garde jamais la place du contact sans échéance.** Un template sans bouton ni délai n'y
    retient pas : la suite part aussitôt, comme en mode agent de Meta. Toute autre attente sans échéance propre (template à
    boutons sans délai, message à boutons, formulaire, question sans délai) se clôt d'elle-même après 72 h, sans rien
    envoyer et sans suivre de flèche. Sinon, par la place unique (décision 21) et la décision 3, chaque événement suivant de ce client
    n'enverrait plus que son premier message.
30. **Un parcours Shopify est un envoi à UN client**, comme une automation de date : ses étiquettes publient leurs
    événements d'automation, un passage à l'équipe prévient les admins. Il n'est pas « de masse » au sens de la décision 24,
    bien qu'il naisse dans le moteur de campagne.
31. **Un parcours ordinaire qui coexiste (décision 21) et se réveille avant le parcours d'événement continue** : cas rare,
    écrit dans la documentation (deux voix possibles un court moment). Au réveil du parcours d'événement, celui-ci le clôt
    avec sa session, comme prévu.

## 4. Objectifs, non-objectifs, anti-objectifs

**Objectifs** : une séquence Shopify ou HubSpot se construit dans le builder classique ; le premier message reste aussi
fiable qu'aujourd'hui (doublons, consentement, STOP, ligne dans Campagnes, attribution) ; le marchand ne peut pas
construire un parcours que Meta refusera à l'envoi sans que le builder l'ait prévenu ; le rangement prépare l'ajout
d'automations Shopify (back in stock).

**Non-objectifs** : le back in stock et toute nouvelle automation Shopify (temps 2) ; la conversion de l'existant ;
un séquenceur propre à Shopify ; changer les automations « Autres ».

**Anti-objectifs** (échec même si ça marche) :
- une confirmation de commande perdue parce qu'un opérateur tenait la conversation ;
- un client relancé pour un panier qu'il vient de commander ;
- un message rapide posé après une attente, accepté par le builder SANS que le builder l'ait signalé, puis refusé par
  Meta (131047) en production (le builder prévient sans refuser, décision 16) ;
- une variable Shopify (lien de panier ou de commande, qui portent une clé d'accès) écrite sur la fiche du contact ;
- un scénario d'un rayon visible ou lançable depuis un autre.

## 5. Conception

### 5.1 Édition d'un template sur place (partout)

Un bloc template du builder peut, en plus de choisir un template existant, en **créer ou modifier un** sur place :
texte, boutons, catégorie, variables. Les variables proposées dépendent du rayon : champs de fiche partout, plus les
variables Shopify (prénom, numéro de commande, montant, lien de commande, transporteur, suivi, lien du panier) dans le
rayon Shopify, plus les propriétés importées dans le rayon HubSpot. À l'enregistrement, le template part chez Meta et
le builder dit ce qui va se passer (validation chez Meta, activation à l'approbation, refus et sa raison par e-mail),
comme l'assistant de la carte Shopify le fait aujourd'hui (`shopify_messages_attente`, migration 0249). Une automation
dont le premier template n'est pas encore approuvé est « en validation chez Meta » et ne part pas.

Catégorie **(appel du rédacteur)** : le premier template est proposé en UTILITY pour commande payée et expédiée, en
MARKETING pour le panier et pour tout envoi qui suit une attente ; le marchand peut la changer, et le builder rappelle
que Meta peut la reclasser.

Le remplacement d'un template reprend la règle de l'assistant actuel : un nouveau texte crée un NOUVEAU template (pas de
modification chez Meta, donc pas sa limite d'une par 24 h), l'ancien continue de partir jusqu'à l'approbation du
nouveau. Dans les rayons Shopify et HubSpot, l'ancien est ensuite supprimé chez Meta s'il a été créé par le builder et
qu'aucune campagne active ne s'en sert ; dans le Builder général, jamais (décision 14).

### 5.2 L'analyse de fenêtre du builder

Aujourd'hui le builder ne signale qu'un message de session atteint après 24 h d'attente cumulée
(`src/workflow/engine.ts:327`), parce qu'un scénario lancé par un message du client démarre fenêtre ouverte. Elle
gagne un **état de départ** : fenêtre FERMÉE pour les rayons Shopify et HubSpot et pour un scénario du Builder lancé
par une automation qui ne naît pas d'un message du client (décision 11), ouverte sinon. Un scénario du Builder peut
être lancé par plusieurs automations, par l'API ou par une campagne : il est jugé sur le cas le plus strict qui le
lance **(appel du rédacteur)**. Sur chaque chemin, la fenêtre s'ouvre au passage d'une réponse ou d'un clic de bouton
du client, reste fermée sur la sortie « Pas de réponse » d'un template ou d'une question (décision 12), et se referme
après 24 h d'attente cumulée. Un message rapide, un formulaire ou un « Aller à » dont la cible commence par un message de session,
atteint fenêtre fermée, est signalé dans le builder avec une phrase qui dit quoi faire (« ce message part sans que le
client ait répondu : il doit être un template »). C'est un AVERTISSEMENT, jamais un refus de publication (décision 16).


### 5.3 Le rayon

Chaque scénario (`workflows`) et chaque automation (`automations`) porte un **rayon** : `general`, `shopify` ou
`hubspot`. Le rayon d'un scénario est fixé à sa création et ne change jamais. Toute lecture de liste de scénarios
filtre par rayon (Builder, API, MCP, campagnes, webhook entrant, « Aller à », action HubSpot), et le lancement vérifie
le rayon du scénario qu'on lui donne (un identifiant d'un autre rayon est refusé comme inconnu). La colonne
`automations.possede_par` existe déjà (chaînes, widget, publicité) : le constructeur décide si le rayon la réutilise
ou s'ajoute à côté, en gardant en tête qu'elle a des sens existants (`channelsme_link`, `publicite`).

### 5.4 Shopify, approche A

Le circuit Shopify actuel ne change pas dans ce qu'il garantit : réception et signature des webhooks, balayage des
paniers et leur délai (`src/shopify/relance.ts`), clé d'idempotence métier (`shopify:<boutique>:orders/paid:<id>`),
consentement `shopify:<boutique>`, STOP, limites de l'offre, ligne dans Campagnes, attribution « relance de panier ».
Ce qui change :

1. Le template à envoyer n'est plus lu dans `shopify_messages` mais dans le **premier bloc du scénario** de
   l'automation Shopify allumée pour cet événement.
2. L'envoi passe toujours par l'envoi public (`lancerEnvoiPublic`, `src/shopify/envoi.ts`), donc il part même quand le
   fil est tenu et ne le coupe pas (décision 2).
3. Au même moment, un **parcours** est créé pour ce contact, positionné sur ce premier bloc déjà envoyé, avec les
   **variables du parcours** (les données Shopify de l'événement). C'est lui qui reçoit un clic sur un bouton du
   premier template et route vers la branche du builder ; c'est lui qui continue au bloc suivant. Si un opérateur tient
   le fil, la suite ne tourne pas (décision 2) ; le constructeur décide si le parcours attend que le fil se libère ou
   s'arrête, en le disant dans le plan. Si un parcours Shopify ou HubSpot tourne déjà pour ce contact, aucun parcours
   n'est créé : seul le premier message part (décision 3).
4. Les variables du parcours vivent sur le parcours, JAMAIS sur la fiche (le lien de commande et le lien du panier
   portent une clé d'accès). Les blocs suivants les lisent comme une source de variable de plus.
5. Une commande née du panier arrête le parcours du panier (décision 4) : la même lecture qui empêche aujourd'hui la
   relance de partir (`panierOuvert`) s'applique à chaque reprise du parcours.
6. Interrupteur de pause de la boutique éteint, ou ligne éteinte : rien ne part, ni premier message ni suite ; les
   parcours en cours s'arrêtent ; un panier abandonné pendant la pause n'est jamais relancé après le rallumage
   (décision 15).
7. Attribution : le parcours du panier abandonné compte tout entier comme le levier « relance de panier » ; dans un
   parcours « commande payée » ou « commande expédiée », le premier message reste hors leviers et chaque bloc suivant
   est un levier attribué à cette automation (décision 10).
8. `shopify_messages` et `shopify_messages_attente` sont remplacés ; leur sort (supprimées après la bascule ou
   gardées en lecture) est laissé au constructeur, avec la règle des migrations du dépôt (`CLAUDE.md`).

### 5.5 HubSpot

Les trois familles du § 2.2 suivent le même schéma que Shopify : premier bloc template envoyé par le chemin d'envoi
qui ne coupe pas le fil, parcours créé sur ce bloc, suite si le fil est libre.

- **Changement d'étape** : la route `POST /hubspot/deal-stage` résout déjà le contact et crée la fiche d'un lead
  inconnu (`src/automation/match.ts:160`). Elle cesse de passer par le runner ordinaire pour suivre le schéma ci-dessus.
- **Rendez-vous** : le balayage de dates (`src/automation/date-sweep.ts`) sert les deux rayons ; une automation de rayon
  HubSpot n'accepte qu'un champ date importé de HubSpot.
- **Lancés par un workflow HubSpot** : les deux actions qui lancent un scénario, « Lancer un scénario » et « Lancer un
  scénario (transaction) » (`/hubspot/workflow/transaction`, le flux du devis PDF), gardent leurs gardes et plafonds
  (`src/hubspot-workflow/`) ; leur liste et leur lancement lisent le rayon HubSpot **(appel du rédacteur)**. Elles ne
  refusent plus quand un conseiller tient le fil (décision 2). Un scénario du Builder choisi dans un workflow HubSpot
  existant cesse d'être lançable par lui (bascule, décision 8) : à dire dans la fiche d'aide et dans le message de
  refus de l'action.
- **Date d'un champ dans Autres** accepte toujours n'importe quel champ, y compris un champ importé de HubSpot ; le
  rangement conseillé pour un rendez-vous HubSpot est « Rendez-vous » **(appel du rédacteur)**.

### 5.6 Offres

- Builder et automations dans la console : la fonction `scenarios` (Pro et Entreprise), comme le Builder aujourd'hui.
- Free (Claude Code seulement) : un scénario Shopify d'UN bloc, réglé par `set_shopify_message`. Le moteur doit donc
  exécuter ce scénario d'un bloc sans exiger la fonction `scenarios`. Un espace qui passe de Pro à Free avec un
  scénario de plusieurs blocs : laissé au constructeur (piste : seul le premier bloc part).

### 5.7 Claude Code et le plugin

`set_shopify_message` écrit le premier bloc du scénario de l'événement (création du scénario si absent) et répond
qu'il reste d'autres étapes quand il y en a. `get_shopify_state` décrit chaque événement par son scénario (allumé,
premier template et son état chez Meta, nombre de blocs). Les outils de scénario du MCP ne voient que le rayon général.
Le catalogue MCP et sa documentation générée suivent (règle du dépôt sur `web/public` et la vitrine).

### 5.8 Bascule

Le jour du déploiement : les messages Shopify et les automations « changement d'étape HubSpot » s'éteignent, et les
scénarios existants restent dans le Builder. ⚠️ **À vérifier en base avant** : qu'aucun espace réel (Groupama PJ est le
seul client) n'a de message Shopify actif, d'automation de changement d'étape allumée, ni de workflow HubSpot qui
lance un scénario du Builder (lignes « HubSpot · workflow » récentes) ; sinon, revenir vers Julien.
Les espaces Free réglés par Claude Code perdent aussi leurs messages : prévenir leurs admins par e-mail **(appel du
rédacteur)**.

### 5.9 Aide, vitrine, features.md

Les fiches d'aide touchées (Shopify, automations, scénarios, HubSpot) se réécrivent, avec leurs captures et leur
empreinte dans `features.md` dans le même commit ; les fiches publiques passent par la vitrine (règles du dépôt). La
barre change (`web/lib/nav.ts`) : `npm run aide:carte`. La page vitrine Shopify décrit le scénario du panier en cinq
temps : à relire contre ce qui est vrai après la bascule.

## 6. Approches

- **A, retenue : le circuit Shopify envoie le premier bloc, le scénario prend la suite.** Le chemin des confirmations,
  en production, garde ses garanties et ses tests ; « premier message toujours » est déjà son comportement. Coût : un
  parcours qui démarre sur un bloc déjà envoyé, une entrée de plus dans le moteur.
- **B : tout dans le moteur d'automation.** Les événements Shopify deviennent des déclencheurs ordinaires et le moteur
  réapprend l'idempotence, le consentement, Campagnes et l'attribution. Un seul moteur, mais on réécrit le chemin des
  confirmations en production. Écartée par Julien.
- **Écartée d'emblée : un séquenceur propre à Shopify.** Ce serait un second builder, l'inverse de la demande.

## 7. L'essai réel qui clôt la feature

Sur une boutique de développement branchée à la SANDBOX : un panier abandonné en deux temps (template, sortie « Pas de
réponse après 30 min », second template) dont le premier template porte un bouton menant à un message rapide ; puis
(a) un client qui ne répond pas reçoit les deux messages, (b) un client qui clique reçoit le message rapide, (c) un
client qui commande entre les deux ne reçoit pas le second, (d) une commande payée pendant qu'un opérateur tient la
conversation reçoit sa confirmation sans que le fil soit coupé. Côté HubSpot : un changement d'étape réel sur le
portail de test. Chaque essai prend son numéro libre dans `docs/prive/ESSAIS-REELS.md`.

## 8. Laissé au constructeur

Le découpage en lots (piste : rayon, cloisonnement et menu ; édition de template sur place et analyse de fenêtre ;
Shopify ; HubSpot ; Claude Code et aide), le schéma exact (colonnes, migrations et leur ordre avant ou après le code),
le stockage des variables de parcours, le sort des anciennes tables, le comportement d'un parcours dont le fil est
tenu (attendre ou s'arrêter), et la méthode de livraison de chaque lot (elle s'écrit dans le plan). Le chemin des
confirmations de commande est un chemin de production : la méthode « implémenteur par lot et revue humaine du diff »
s'impose au moins pour le lot Shopify.

## 9. Temps 2

Back in stock et autres automations Shopify : une ligne de plus dans Automation > Shopify, sur le même modèle.
