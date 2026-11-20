# Automation Shopify : les messages standard, l'aperçu au survol, le retour depuis le scénario

Date : 2026-11-20. Demandeur : Julien. Prolonge le menu « Scénario » (spec `2026-11-18-menu-scenario-automations-design.md`,
§ 2.1, qui promettait déjà « un premier bloc template déjà posé : texte proposé, variables Shopify », reporté au lot 5c).

## 1. Intention

Brancher une boutique doit suffire à avoir trois messages WhatsApp prêts : commande payée, commande expédiée, panier
abandonné. Le marchand n'écrit plus rien pour démarrer : il voit le message proposé, l'allume, et peut l'améliorer dans
le scénario s'il le veut. Aujourd'hui, il doit écrire chaque template lui-même dans le premier bloc, relier chaque
variable à une donnée Shopify et attendre Meta : c'est là qu'il décroche.

## 2. Ce qui est décidé (Julien, 2026-11-20)

1. **Au branchement de la boutique, on crée et on soumet à Meta les trois messages standard**, un par cas, avec les
   bonnes données Shopify déjà reliées. Les deux portes de branchement (console et `connect_shopify` de Claude Code)
   passent par `connecterShopify` : même règle pour les deux.
2. **La ligne reste ÉTEINTE.** Rien ne part chez les clients de la boutique sans le geste du marchand. Il peut allumer
   pendant la validation : le message part pour les événements qui arrivent APRÈS l'approbation.
3. **Boutiques déjà branchées : rien.** Seules celles branchées après le déploiement reçoivent les messages standard.
   (Un cas encore vide d'une boutique déjà branchée reçoit son message standard à son premier allumage, voir § 4.2.)
4. **Les textes** (français ; les données entre accolades sont reliées sur le bloc) :
   - **Commande payée** (Utility) : « Bonjour {{prénom}}, merci pour votre commande {{numéro}} de {{montant}}.
     Suivez-la ici : {{lien de la commande}}. À très vite ! »
   - **Commande expédiée** (Utility) : « Bonjour {{prénom}}, votre commande {{numéro}} est en route. Suivez votre
     colis : {{lien de suivi}}. À très vite ! » Le transporteur sort du texte standard (une donnée de moins qui peut
     manquer). Une expédition sans suivi ne part pas, et l'écran le dit.
   - **Panier abandonné** (Marketing) : « Bonjour {{prénom}}, vous avez laissé des articles dans votre panier. Il vous
     attend ici : {{lien du panier}}. À très vite ! », pied « Répondez STOP pour ne plus recevoir ces messages ». Le
     prénom revient (Julien, contre la décision du 2026-10-23) : sans prénom connu, « Bonjour à vous ».
   Ces textes remplacent `TEXTES_PROPOSES` (`web/lib/partage/shopify-messages.ts`), source unique console et serveur.
5. **L'écran Automation > Shopify montre le message au survol** (et au focus clavier) de chaque ligne : une bulle
   WhatsApp avec le texte en vigueur, les données remplacées par leurs exemples (Camille, #1002…). **Un clic ouvre le
   scénario.**
6. **L'éditeur d'un scénario Shopify a un bouton retour vers Automation > Shopify.**

## 3. Non-objectifs

- Aucun allumage automatique, aucune création pour les boutiques déjà branchées au déploiement.
- Pas de texte par langue de boutique : la boutique ne stocke aucune locale. Français, sauf un espace dont la langue est
  l'anglais s'il en existe une lecture fiable (sinon français, appel du constructeur).
- Pas de refonte du premier bloc : il reste verrouillé, toujours un template (décisions 13 et 23).

## 4. Le comportement

### 4.1 Au branchement

Pour chaque cas qui n'a pas encore de message (premier bloc sans template, publié ou programmé) :
- la ligne et son scénario naissent comme aujourd'hui (`assurerLigne` : scénario au rayon `shopify`, ligne éteinte) ;
- le template est créé chez Meta par le chemin des templates de bloc (`creerModeleDuBloc` / `creerUnModele`) : nom
  généré par le serveur (décision 19, JAMAIS le motif `shopify_<evenement>_<8>` de l'ancien assistant, que le ménage
  supprimerait), exemples `EXEMPLES_DONNEES`, catégorie du § 2.4, ligne `modeles_de_bloc` inscrite pour que le ménage le
  supprime le jour où le marchand le remplace ;
- le premier bloc reçoit le template et ses sources `variable` (jamais dans les indices du template) dans le BROUILLON,
  et la mise en ligne est PROGRAMMÉE (décision 18) : tant que Meta n'a pas approuvé, la version publiée reste sans
  template, donc une ligne allumée trop tôt n'envoie rien et ne consomme rien en `modele_refuse`. À l'approbation, le
  mécanisme existant (`trancherModeleDeBloc`, `tenterMiseEnLigne`, filet de dix minutes) met en ligne.

Ce qui saute la création, sans faire échouer le branchement : pas de WABA (numéro pas encore relié), numéro relié par QR
code (filière application, aucun template ne peut partir), refus de Meta à la création. Le branchement réussit, la
raison est journalisée, et le cas reste « à compléter ».

### 4.2 Au premier allumage d'un cas encore vide

Si le marchand allume un cas dont le premier bloc n'a toujours pas de template (création sautée au branchement,
boutique branchée avant le déploiement), le message standard est créé et programmé à ce moment, par la même fonction.
Allumer un cas sur un numéro relié par QR code est refusé (jaune du lot 5c, `todo.md`).

### 4.3 L'écran

Par ligne, en plus de l'existant : la bulle au survol (§ 2.5) et la ligne entière cliquable vers le scénario. L'état dit
« en validation chez Meta » tant que le message attend. Le texte et les exemples viennent de l'état de la ligne
(`EtatLigne`), que le serveur complète : le corps et le pied du template en vigueur (celui de la version programmée s'il
y en a une, sinon celui de la version publiée) et les exemples rangés par position. La console lit ce nouveau champ
défensivement (elle est publiée avant l'API).

### 4.4 Le retour

L'éditeur d'un scénario au rayon `shopify` affiche « ← Retour aux automations Shopify », qui mène à `/automations/shopify`.
Même geste pour le rayon `hubspot` vers `/automations/hubspot` (une ligne, même cause). Le rayon se lit sur le scénario,
aucun paramètre ajouté à l'adresse (les e2e figent `/workflows?open=<id>`).

### 4.5 Améliorer le message dans le scénario

Trois défauts connus empêchent aujourd'hui de retoucher le premier bloc ; ils partent avec ce lot :
- « Modifier ce template » échoue en 400 sur un bloc à données Shopify : écarter les sources `variable` des `paramHints`
  envoyés, elles restent sur le bloc.
- Le lien de test d'un scénario Shopify échoue faute de données : le démarrer avec l'événement d'exemple de sa ligne
  (`EXEMPLES_DONNEES`).
- La touche Retour arrière sur le premier bloc détache sa suite : `deletable: false` sur le bloc marqué.

## 5. Ce qui change ailleurs

- Les e-mails « votre scénario est en ligne » de la mise en ligne programmée ne doivent pas annoncer « en ligne » une
  automation éteinte : leur texte dit que le message est approuvé et qu'il reste à l'allumer (appel du constructeur sur
  la forme).
- `features.md` (§ Boutique Shopify, avec l'empreinte de la fiche), la fiche publique `brancher-ma-boutique-shopify`
  (FR et EN, `vitrine:aide`), la skill `plugin/skills/shopify/SKILL.md` (les messages sont déjà proposés : Claude les
  montre, les allume par `set_shopify_message` une fois approuvés, ou les remplace), la description MCP de
  `set_shopify_message` et `connect_shopify` (catalogue généré), et les pages vitrine qui disent « Claude rédige vos
  messages » (`scripts/vitrine/boutique-textes.ts`, `aide-claude-textes.ts`).

## 6. Approches considérées

- **Retenue : chemin des templates de bloc + publication programmée.** Il existe, il porte déjà l'attente de Meta, le
  filet, le ménage et la mise en ligne à l'approbation. Coût : sortir de la route HTTP la décision « programmer » pour
  l'appeler depuis le branchement.
- Écartée : poser le template directement dans la version publiée (ce que fait `set_shopify_message`). Une ligne allumée
  pendant la validation consommerait chaque événement en `modele_refuse`, sans rejeu.
- Écartée : ressusciter l'ancien `preparerMessage` de l'assistant (retiré au lot 5b) : il vivait hors du scénario, avec
  ses propres tables, vidées par 0302.

## 7. L'essai réel qui clôt

Sur la boutique de dev `messaging-me-essai` rebranchée à un espace de test : les trois messages apparaissent « en
validation », la bulle au survol montre le bon texte, Meta approuve, on allume la commande payée, une vraie commande
reçoit le message avec ses données ; le retour depuis le scénario ramène à Automation > Shopify ; « Modifier ce
template » sur le premier bloc fonctionne.
