---
description: Brancher une boutique Shopify à WhatsApp depuis la console : confirmation de commande, avis d'expédition, relance des paniers abandonnés, et leur suite.
ecran: integrations
source_section: Boutique Shopify : les messages de commande sur WhatsApp (Claude Code ou console, 2026-10-21)
source_empreinte: d2e353
publique: oui
rubrique: parler-aux-clients, demarrer-console
rang: 6, 8
prerequis: connecter-mon-numero-whatsapp
bouton_console: Brancher Shopify dans la console
ancre_console: integration-shopify
---
# Brancher ma boutique Shopify

Vos clients Shopify reçoivent sur WhatsApp la **confirmation de leur commande payée**, l'**avis d'expédition** et une
**relance s'ils abandonnent leur panier** : trois automations, chacune avec la suite que vous voulez. Ce guide suit la
console, avec l'offre Pro.

## Depuis la console, avec l'offre Pro

La console vous guide de bout en bout, en huit gestes.

**1. Ouvrir la carte Shopify.** Dans le menu Tools > Intégrations, la carte Shopify dit ce
qu'elle fait et vous guide en deux étapes, la première chez Shopify, la seconde dans la console.

Elle n'apparaît qu'aux administrateurs de l'espace.

**2. Créer votre app chez Shopify.** Sur le tableau de bord développeur de Shopify, connecté avec le compte qui gère
votre boutique, créez l'app à la main (Create app manually) et collez l'adresse et les droits que la carte vous fait
copier d'un clic. Comptez cinq minutes.

Décochez « Embed app in Shopify admin », laissez le reste tel quel, puis Create app et Release. Installez-la ensuite
sur votre boutique : le message « This app hasn't been reviewed » est normal, c'est votre propre app. Ouvrez enfin
l'app dans Apps : son Client ID et son Client secret sont dans le cadre Credentials, à droite.

**3. Brancher la boutique.** Revenez dans la carte, collez le nom de la boutique, le Client ID et le Client secret,
puis « Brancher la boutique ». Vos messages se règlent ensuite dans Scénario > Automation > Shopify.

**4. Allumer une automation.** Scénario > Automation > Shopify liste vos trois automations : Commande payée, Commande
expédiée et Panier abandonné, chacune avec son état. Allumez-en une : son scénario s'ouvre dans le builder.

Pour le panier, choisissez aussi le délai après sa dernière modification : 15 min, 1 h (par défaut), 3 h ou 24 h.
« Ouvrir le scénario » vous y ramène à tout moment ; éteindre une automation arrête ses parcours en cours.

**5. Choisir le premier message, puis publier.** Le premier bloc, marqué « premier message », est le template que
l'événement envoie. Choisissez-en un, ou « Écrire un nouveau template », puis reliez chacune de ses variables à une
donnée Shopify : le prénom, le numéro de commande, le lien du panier… Enfin, « Publier ».

L'automation s'active quand Meta approuve le template, en général en quelques minutes. Changer de template ne l'arrête
pas : l'ancien part jusqu'à l'approbation du nouveau. Un template écrit depuis une automation lui appartient : ne le
réutilisez pas ailleurs, il est supprimé chez Meta peu après son remplacement. Le premier bloc, lui, ne se supprime pas.

**6. Construire la suite, si vous le voulez.** Après le premier message, ajoutez des blocs comme dans tout scénario : un
bloc Attente puis un rappel, un bouton du template qui mène à une réponse, un message qui cite une donnée de la
commande (« Données Shopify », dans le choix des variables). Sans suite, seul le premier message part.

Tant que le client n'a ni répondu ni cliqué, chaque envoi doit être un template : le builder vous le dit. Chaque bloc a
sa fiche dans l'aide.

**7. Importer vos clients.** « Importer », sur la carte Shopify, ouvre l'import des clients de la boutique abonnés à
votre marketing (e-mail ou SMS) qui ont un téléphone. Ils sont comptés d'abord, avec les places que votre offre laisse ;
vous choisissez combien en importer, les plus récents d'abord.

Les fiches sont étiquetées « Shopify » et arrivent sans consentement WhatsApp : un accord e-mail ou SMS n'en est pas un.

**8. Suivre, mettre en pause ou couper.** La carte Shopify montre la boutique branchée, le dernier événement reçu et les
chiffres des 30 derniers jours : messages partis, clients écartés et pourquoi. L'interrupteur de pause arrête tous les
envois sans rien débrancher ; « Couper » débranche la boutique.

En pause, vos automations gardent leur réglage, mais rien ne part, ni premier message ni suite ; les parcours en cours
s'arrêtent, et un panier abandonné pendant la pause n'est jamais relancé après coup. Après « Couper », l'app reste
installée sur votre boutique : désinstallez-la depuis la page des apps de la boutique, dont le lien est sur la carte.
Vous pourrez la rebrancher depuis la carte.

**Bon à savoir.** Chaque message de la boutique rend la fiche du client consentante partout, campagnes comprises ; un
client qui a répondu STOP le reste et ne reçoit rien.

## La relance des paniers abandonnés

Un client qui remplit le paiement avec son téléphone sans commander reçoit le premier message de l'automation Panier
abandonné, avec le lien qui rouvre son panier, au délai que vous avez choisi après sa dernière modification, puis la
suite de son scénario. Rien ne part si une commande en est née entre-temps, même non payée, et une commande née du
panier arrête son parcours, où qu'il en soit. Un second panier prend la place du premier : sa relance arrête le
parcours du précédent.

Un client qui répond STOP ne reçoit plus rien : dites-le en bas du template de relance (« Répondez STOP pour ne plus
recevoir ces messages »). La carte compte les relances parties, les paniers devenus une commande à temps,
et ceux en attente ; et, selon la date de la relance, les paniers récupérés (relancés puis payés) et leur montant.

**Bon à savoir.** Le prénom est facultatif chez Shopify : beaucoup de clients ne le donnent pas, surtout avant
d'abandonner leur panier. Un message qui contient le prénom part quand même, avec « à vous » à sa place (« Bonjour à
vous » ; « there » pour un template en anglais). Un message de panier gagne donc à commencer simplement par
« Bonjour, ».

## Le téléphone, obligatoire au paiement

Dans Shopify, réglez le numéro de téléphone de l'adresse de livraison sur « Obligatoire » (Paramètres > Paiement). Sans
téléphone, une commande ne reçoit ni confirmation ni relance sur WhatsApp, et seule une visite venue d'un lien de vos
campagnes permet encore de la relier à vos messages.

## Ce que vos envois ont rapporté

Le chiffre d'affaires de vos commandes payées après un message WhatsApp, et ce que vos messages ont coûté.

**9. Ouvrir Performance Lab > Quantitatif > Shopify.** Offre Pro : le chiffre d'affaires, ce que vos
messages ont coûté, et votre ROI, en tout, pour chaque campagne et pour chaque automation Shopify.

**Bon à savoir.** Le chiffre compte les commandes payées dans les 5 jours après un message WhatsApp reçu, attribuées
au dernier envoi. Il est brut (remboursements non déduits) et compté par devise. La part **prouvée** : le panier
relancé lui-même payé, ou une visite venue d'un lien WhatsApp ; le reste est une concordance dans le temps. Les
commandes de test de Shopify sont à part, jamais comptées. Le coût ne compte que ce qui peut amener une vente : jamais
le premier message d'une commande (la confirmation, l'avis d'expédition), seulement la suite de son scénario.

## Cibler vos clients par leurs commandes

Vos clients choisis par leurs commandes payées : combien, pour quel montant, la dernière quand.

**10. Filtrer par « Achats et activité ».** Offre Pro : dans le mini-CRM, ouvrez les filtres ; la même partie
sert aux destinataires d'une campagne. Commandes payées, dépense, dernière commande, sur la période de votre choix.

**Bon à savoir.** Les commandes ne comptent que depuis le branchement de la boutique : l'historique de Shopify n'est
pas repris, et un client importé arrive sans ses commandes passées. Juste après le branchement, « au moins 2 commandes »
ne trouve donc personne ; le panneau dit la date du début du suivi. Seules comptent les commandes d'un numéro déjà dans
vos contacts, commandes de test comprises. Le pays et l'activité, eux, marchent dans tous les espaces, avec ou sans
boutique.

## Les règles des envois

Un client qui a répondu STOP ne reçoit rien, et les modèles du mois et la limite de contacts de votre offre comptent :
la fiche d'un nouveau client compte. Si cette limite est atteinte, les nouveaux clients ne reçoivent plus leurs
messages ; la carte les compte, et vous recevez un e-mail au premier refus du mois. Chaque premier message apparaît
dans Campagnes, une ligne par commande. Il part même quand l'agent ou votre équipe tient la conversation, sans la
couper.

Si le client écrit pendant un bloc Attente, ou clique sur le bouton d'un autre de vos messages : l'agent IA, le
scénario répondeur ou votre application lui répond, et l'automation continue. En mode Équipe ou agent de Meta,
l'automation s'arrête : la demande arrive dans « À traiter », ou l'agent de Meta répond. S'il répond par écrit à un bloc
qui attend sa réponse, l'automation suit la sortie « Toute autre réponse » de ce bloc ; sans elle, elle s'arrête.

## Les demandes de vos clients

Une demande d'effacement d'un client transmise par Shopify efface sa fiche ; une demande d'accès vous est signalée par
e-mail, et c'est à vous de lui répondre. Une boutique branchée depuis la console ne nous transmet pas ces demandes :
quand Shopify vous en transmet une, supprimez vous-même la fiche du client dans Contacts.
