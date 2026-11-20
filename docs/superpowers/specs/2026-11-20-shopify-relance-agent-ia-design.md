# Relance de panier avec agent IA (Shopify) : conception

Date : 2026-11-20. Statut : approche revue le même jour (voir § 4), à réapprouver par Julien.

## 1. Intention

Une quatrième automation Shopify, « Relance de panier avec agent IA » : le même message que la relance de panier
abandonné, avec un bouton de plus, « Vous avez une question ? ». Un client qui hésite (taille, délai, livraison) tape le
bouton et un agent IA de la console lui répond tout de suite, au lieu d'abandonner ou d'attendre l'équipe. Le marchand
choisit QUEL agent au moment où il allume l'automation, donc il lui faut au moins un agent IA actif.

## 2. Ce qui existe (lu sur `origin/main` le 2026-11-20)

- **Une automation Shopify est une LIGNE et un SCÉNARIO** (menu « Scénario », lot 5, migration 0299) : `shopify_lignes`
  (une ligne par événement et par espace, son `workflow_id` du rayon `shopify`, son interrupteur `actif`). Le scénario
  s'ouvre sur un premier bloc template VERROUILLÉ (`MARQUE_PREMIER_BLOC`, `src/shopify/premier-bloc.ts`) : quand
  l'événement arrive, le circuit l'envoie et un parcours d'événement naît dessus (lancement `evenement_shopify`,
  `reprise: 'sauf_operateur'` : il reprend le contact à l'agent de Meta, jamais à un opérateur).
- **L'allumage** (`reglerLigne`, `src/shopify/lignes-gestion.ts`) : refus sur un numéro relié par QR code et sans
  attestation du consentement, création de la ligne et de son scénario s'ils manquent (`assurerLigne`), message standard
  proposé à un cas vide (`proposerMessageStandard`), puis `allumerLigne`. Éteindre arrête les parcours de la ligne.
- **Le message standard du panier** (`corpsStandard`, `src/shopify/messages-standard.ts`) : MARKETING, pied STOP,
  bouton URL « Reprendre mon panier » (`{panier_shopify}`).
- **La réclamation des paniers dus** (`src/shopify/store.pg.ts`, `src/shopify/relance.ts`) lit la ligne
  `checkout_abandoned` active.
- **Le bloc Agent IA d'un scénario** porte l'agent et ses sorties (`web/lib/partage/sorties-agent.ts`) : `humain`
  (escalade), `echec` (modèle en échec, fiche introuvable), `plafond`, `timeout`, `sans_source`, et les règles d'arrêt.

## 3. Décisions de Julien (2026-11-20)

1. **Exclusives** : la relance normale et la relance avec agent IA ne sont jamais allumées ensemble sur une boutique.
   Allumer l'une éteint l'autre (et arrête ses parcours), et l'écran le dit. Un panier ne reçoit jamais deux relances.
2. **L'humain garde la main** : un opérateur qui tient la conversation la garde ; l'agent ne la lui prend pas.
3. **Template créé à l'allumage** : le texte de la relance standard, le bouton « Reprendre mon panier » et le bouton
   « Vous avez une question ? », soumis à Meta. Le marchand peut le modifier.
4. **Une quatrième ligne Shopify** (approche revue, § 4).
5. **La relance normale s'éteint TOUT DE SUITE** à l'allumage de la relance avec agent, même si son template attend
   encore Meta. Pas d'état « en bascule ». L'écran dit, pendant l'attente, que les paniers ne sont pas relancés, et dit
   le refus de Meta s'il arrive.
6. **L'agent IA choisi passe avant l'agent de Meta** : un contact que l'agent de Meta suivait est repris par le parcours.
7. **Si l'agent ne peut pas répondre** (Crédit IA épuisé, plafond, agent inactif ou supprimé), la conversation va à
   l'ÉQUIPE (« À traiter »).
8. **Bouton retiré ou déplacé par le marchand : on avertit seulement**, sur la ligne.

## 4. Approches

La première version de cette conception (approuvée le matin même) retenait un aiguillage dans la réception des messages,
parce qu'elle avait été écrite depuis une copie de travail en retard de 465 commits, où la relance partait encore par
l'envoi public. Sur `origin`, les automations Shopify sont des scénarios : Julien a retenu la quatrième ligne.

- **Retenue : une quatrième ligne Shopify.** Son scénario standard : le template verrouillé, puis, sur le bouton
  « Vous avez une question ? », un bloc Agent IA réglé sur l'agent choisi, dont les sorties d'échec mènent à l'équipe. Le
  clic avance le parcours d'événement, le bloc Agent IA répond. Aucun chemin neuf dans la réception des messages : la
  reprise à l'agent de Meta (décision 6) et le respect de l'opérateur (décision 2) sont ceux du lancement
  `evenement_shopify`.
- **Écartée : l'aiguillage au clic dans la réception des messages.** Il doublait ce que le scénario sait faire et
  touchait le chemin chaud des entrants (`standby` de l'agent de Meta).

## 5. Conception

### 5.1 La ligne

Une valeur neuve dans `shopify_lignes.evenement` : `checkout_abandoned_agent`. Ce n'est pas un nouvel événement de
Shopify : elle part sur le MÊME webhook et la MÊME réclamation que `checkout_abandoned` (le délai de la boutique, les
données `first_name` et `checkout_url`, la catégorie, l'attestation, le refus QR code). La réclamation lit la ligne du
panier active, l'une OU l'autre ; l'exclusivité est tenue à l'allumage (§ 5.2) et la lecture n'en suppose jamais deux.

L'agent choisi n'a pas de colonne : il vit dans le bloc Agent IA du scénario de la ligne. Le choisir à l'allumage, c'est
écrire ce bloc ; en changer se fait au même endroit (l'écran de la ligne, ou le builder).

🔴 Rayon de souffle à énumérer au plan : chaque endroit qui suppose « le panier = `checkout_abandoned` » (la réclamation et
son index, l'origine et le préfixe des parcours `prefixeShopify`, `NOM_DU_SCENARIO`, `SUJET_DE_L_EVENEMENT`, les
compteurs de la carte, la source `relance_panier` du retour sur investissement, le périmètre des leviers, la purge,
`parcours-voulu.ts`, le MCP, l'assistant et la carte de la console, les fiches d'aide, la vitrine).

### 5.2 L'allumage

- La console demande l'agent AVANT d'allumer : une liste des agents IA actifs de l'espace. Sans agent actif,
  l'interrupteur reste grisé, avec « Créer un agent IA ».
- `reglerLigne` reçoit l'agent pour cette ligne (refus sans lui, ou avec un agent inconnu, inactif ou d'un autre espace),
  éteint la relance normale si elle est allumée (et arrête ses parcours, décision 5), crée la ligne et son scénario
  standard s'ils manquent, puis allume.
- Le scénario standard est créé à la première fois : template (corps du panier, bouton URL, bouton « Vous avez une
  question ? »), bloc Agent IA sur ce bouton, sorties `humain`, `echec`, `plafond` et `sans_source` vers le passage à
  l'équipe. Un scénario existant n'est jamais réécrit, sauf l'agent de son bloc quand le marchand en choisit un autre.
- L'inverse est vrai aussi : allumer la relance normale éteint la relance avec agent.

### 5.3 Les avertissements de la ligne

La ligne avec agent affiche un avertissement, sans rien bloquer, quand :
- le template du premier bloc n'a plus de bouton de réponse rapide relié au bloc Agent IA (décision 8) ;
- l'agent du bloc est inactif ou supprimé (le clic finira à l'équipe, décision 7) ;
- le template attend Meta ou a été refusé (décision 5 : aucun panier relancé pendant ce temps).

### 5.4 Ce que l'agent sait

L'historique de la conversation, donc la relance et son lien. Pas le détail des produits, que le connecteur ne stocke
pas. Ses règles d'arrêt et son escalade sont celles de sa fiche.

### 5.5 Les autres portes

- **MCP** : `set_shopify_message` (ou l'outil des lignes) accepte la nouvelle automation et l'agent, avec les mêmes refus
  que la console ; `get_shopify_state` montre l'agent et les avertissements. Plugin à republier après l'API.
- **Aide** : la fiche Shopify décrit l'automation, ses conditions (un agent IA actif, du Crédit IA) et l'exclusivité,
  sans redite de la fiche de l'agent IA.

## 6. Non-objectifs

- Pas de détail des produits du panier donné à l'agent.
- Pas de second déclenchement (une relance par panier).
- Pas de rattrapage des boutiques déjà branchées : le scénario naît au premier allumage.

## 7. Anti-objectifs

- Deux relances pour un même panier.
- Un agent qui prend la parole à la place d'un opérateur.
- Un clic qui reste sans réponse : si l'agent ne peut pas répondre, un humain le voit dans « À traiter ».
- Un aiguillage qui casse sans le dire (décision 8).

## 8. Ce qui reste au plan

Le découpage en lots et la méthode de livraison ; vérifier sur le vrai code que les sorties du bloc Agent IA couvrent le
crédit épuisé et l'agent supprimé (décision 7), et que le clic d'un contact tenu par un opérateur n'avance pas le
parcours (décision 2) ; l'essai réel de clôture (boutique `messaging-me-essai`, un vrai panier abandonné, le clic depuis
un téléphone, sur un espace en mode MBA).
