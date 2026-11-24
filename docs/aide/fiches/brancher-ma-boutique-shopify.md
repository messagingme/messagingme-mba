---
description: Brancher une boutique Shopify à WhatsApp depuis la console : confirmation de commande, avis d'expédition, relance des paniers abandonnés, et leur suite.
ecran: integrations
source_section: Boutique Shopify : les messages de commande sur WhatsApp (Claude Code ou console, 2026-10-21)
source_empreinte: ae59f8
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
votre boutique, créez l'appli à la main (Applis > Créer une appli > Créer l'appli manuellement) et collez l'adresse et les droits que la carte vous fait
copier d'un clic. Comptez cinq minutes.

Décochez « Intégrer l'appli dans l'interface administrateur Shopify », laissez le reste tel quel, puis Créer une appli
et, dans la fenêtre « Publication de la version », Publier. Installez-la ensuite sur votre boutique : dans Applis,
menu « ⋮ » de sa ligne > Installer l'appli, puis Installer. « Cette appli n'a pas été examinée » est normal, c'est
la vôtre. Ouvrez enfin l'appli dans Applis : son ID client et son secret client sont dans le cadre
Identifiants, à droite. Si Shopify refuse la publication à cause du droit read_all_orders, retirez-le de la liste et
publiez à nouveau : seule la lecture des commandes de plus de 60 jours en aura besoin.

**3. Brancher la boutique.** Revenez dans la carte, collez le nom interne de la boutique (celui en .myshopify.com, pas l'adresse publique de
votre site : la bulle « ? » dit où le lire), l'ID client et le secret client,
cochez l'attestation, puis « Brancher la boutique ». Vos trois messages sont aussitôt écrits et envoyés à Meta pour
validation.

Par cette case, vous attestez que les clients de votre boutique ont accepté de recevoir vos messages WhatsApp, offres
comprises, et vous en assumez la responsabilité : Meta exige leur accord pour tout message que vous leur envoyez en
premier. Sans elle, la boutique ne se branche pas. La phrase, la date et votre adresse sont gardées.

**4. Voir vos messages, puis les allumer.** Scénario > Automation > Shopify liste vos automations : Commande
payée, Commande expédiée, Panier abandonné et Panier abandonné avec agent IA (plus bas). Survolez une ligne pour lire son message, avec des exemples à la place
des données ; cliquez-la pour ouvrir son scénario.

Le prénom, le numéro de commande, les liens de la commande ou du colis sont déjà reliés, et le message du panier a son
bouton « Reprendre mon panier ». Meta valide en
général en quelques minutes : la ligne passe de « éteinte, message en validation chez Meta » à « prête : allumez-la
pour l'envoyer ». Rien ne part chez vos clients tant que vous n'avez pas allumé son interrupteur ; allumée pendant la
validation, elle envoie pour les événements qui arrivent après l'approbation.

Pour le panier, choisissez aussi le délai après sa dernière modification : 15 min, 1 h (par défaut), 3 h ou 24 h.
Éteindre une automation arrête ses parcours en cours.

En tête de la page, la case de l'attestation dit quand et par qui elle a été cochée. Sans elle, aucune automation ne
s'allume. La décocher éteint vos trois automations : la console vous le demande d'abord.

**Bon à savoir.** Sur un numéro relié par QR code, aucun message n'est proposé et une automation ne s'allume pas :
WhatsApp n'y laisse pas écrire en premier à un client. Une automation encore sans message reçoit le message proposé
quand vous l'allumez.

**5. Améliorer le message, si vous le voulez.** Dans le scénario, le premier bloc, marqué « premier message », est le
template que l'événement envoie. « Modifier ce template » le retouche en gardant ses données Shopify ; vous pouvez
aussi en choisir un autre, ou « Écrire un nouveau template » et relier ses variables. Enfin, « Publier ».

Le nouveau texte part dès que Meta l'approuve ; jusque-là, l'ancien continue. Un template écrit depuis une automation
lui appartient : ne le réutilisez pas ailleurs, il est supprimé chez Meta peu après son remplacement. Le premier bloc,
lui, ne se supprime pas. Le scénario s'ouvre sous la liste de vos automations ; « Fermer » le replie.

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

**Bon à savoir.** Chaque message de la boutique rend la fiche du client consentante partout, campagnes comprises,
sur la foi de votre attestation ; un client qui a répondu STOP le reste et ne reçoit rien.

## La relance des paniers abandonnés

Un client qui remplit le paiement avec son téléphone sans commander reçoit le premier message de l'automation Panier
abandonné, avec le bouton qui rouvre son panier, au délai que vous avez choisi après sa dernière modification, puis la
suite de son scénario. Rien ne part si une commande en est née entre-temps, même non payée, et une commande née du
panier arrête son parcours, où qu'il en soit. Un second panier prend la place du premier : sa relance arrête le
parcours du précédent.

Le message proposé ne montre pas l'adresse du panier : son bouton « Reprendre mon panier » y mène. Au clic, le client
arrive sur son propre panier, le dernier noté pour son numéro, ou sur votre boutique s'il n'en a plus ; le clic est
compté comme celui de vos autres liens tracés. Pour mettre ce bouton dans un autre template du scénario, une seconde
relance par exemple : ajoutez un bouton lien, ouvrez le menu de son champ et choisissez « Lien du panier (Shopify) ».
Un message du panier créé avant le 20 novembre 2026 garde son lien dans le texte.

Un client qui répond STOP ne reçoit plus rien : le message proposé le dit en bas (« Répondez STOP pour ne plus
recevoir ces messages »), gardez cette phrase si vous le réécrivez. La carte compte les relances parties, les paniers devenus une commande à temps,
et ceux en attente ; et, selon la date de la relance, les paniers récupérés (relancés puis payés) et leur montant.

## La relance avec un agent IA

L'automation **Panier abandonné avec agent IA** envoie la même relance, avec un bouton de plus : « Vous avez une
question ? ». Le client qui le tape est pris en charge tout de suite par l'agent IA que vous avez choisi.

Il vous faut un agent IA actif : sans lui, l'interrupteur reste grisé. En l'allumant, la console vous demande lequel ;
vous pouvez en changer ensuite sur la même ligne. Son message et son scénario se créent tout seuls, et Meta valide le
message avant le premier envoi.

Les deux relances du panier ne marchent pas ensemble : allumer l'une éteint l'autre, pour qu'un panier ne reçoive
qu'une relance. Un conseiller qui a déjà pris la conversation la garde. Si l'agent ne peut pas répondre (plus de crédit
IA, agent désactivé), la question arrive à votre équipe dans « À traiter ». La ligne vous prévient quand le bouton ne
mène plus à l'agent, quand l'agent n'est plus actif ou quand Meta n'a pas encore validé le message.

**Bon à savoir.** Le prénom est facultatif chez Shopify : beaucoup de clients ne le donnent pas, surtout avant
d'abandonner leur panier. Un message qui contient le prénom part quand même, avec « à vous » à sa place (« Bonjour à
vous » ; « there » pour un template en anglais).

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

Vos clients choisis par leurs commandes payées : combien, pour quel montant, la dernière quand, et ce qu'ils ont acheté.

**10. Filtrer dans le volet « Shopify ».** Offre Pro : dans le mini-CRM, ouvrez les filtres puis le volet Shopify ;
dans une campagne, le bouton Shopify de l'audience l'ouvre. Commandes payées, dépense, dernière commande, sur la
période de votre choix.

Et les produits : ceux qui ont acheté un produit (ou une seule variante, par son SKU), ceux qui ne l'ont pas acheté
(toujours avec un produit acheté, jamais seul), et le réassort, le dernier achat d'un produit il y a tant de jours.
Vous les choisissez parmi les produits déjà commandés dans votre boutique ; les cartes cadeaux ne se ciblent pas.

Et les collections : ceux qui ont acheté au moins un produit de chacune des collections choisies. Elles se lisent chez
Shopify sur vos produits déjà commandés, quand vous ouvrez le volet, et le volet dit « lecture en cours » le temps de
les lire. Une collection compte telle qu'elle est dans votre boutique à cette lecture, dont le volet donne la date, pas
telle qu'elle était le jour de la commande : un produit sorti d'une collection n'y compte plus.

Et deux boutons prêts, sans réglage : « A écrit sans commander » (au moins un message reçu encore connu) et « A cliqué
sans commander » (au moins un clic sur un lien suivi), pour les contacts sans aucune commande enregistrée. Un clic pose
le bouton, un second le retire ; le nombre sur chaque bouton dit combien de contacts il trouve, et un bouton qui ne
trouve personne ne s'affiche pas.

**11. Rattraper les commandes des 60 derniers jours.** Sur la carte Shopify, « Rattraper » compte d'abord, sans rien
écrire, les commandes payées des 60 derniers jours : déjà connues, à rattacher à une fiche, les fiches d'acheteurs à
créer et les places que votre offre laisse, sans fiche ou sans numéro. « Lancer le rattrapage » les relit toutes en
arrière-plan, et la carte dit où il en est.

Chaque commande rejoint la fiche de son numéro, avec son montant et ses produits. L'acheteur qui a un mobile et pas
encore de fiche reçoit la sienne, sur le numéro du client ou de la facturation, jamais sur celui de la livraison (le
destinataire d'un cadeau n'entre pas) : consentante sur la foi de votre attestation, étiquetée « Shopify », dans la
limite de contacts de votre offre ; au-delà, sa commande est comptée, jamais gardée. L'aperçu prévient quand ces fiches
prendraient vos dernières places : un nouveau client qui vous écrirait le premier n'entrerait plus. Aucun message ne
part, et le chiffre rapporté par WhatsApp n'en change pas. Comptez quelques minutes pour la plupart des boutiques, plus
d'une heure pour les très grandes.

**Bon à savoir.** Le rattrapage demande l'attestation du consentement de vos clients, la case en tête de Scénario >
Automation > Shopify : sans elle, l'aperçu le dit et rien ne se lance. Un contact que vous avez supprimé ne revient
jamais par le rattrapage : seule une commande passée après sa suppression lui recrée une fiche. Aucune fiche n'est
créée non plus sans numéro mobile, pour un client qui avait répondu STOP, ni pour un numéro que WhatsApp a déjà refusé.
Une fiche créée par le rattrapage est supprimée si WhatsApp ne trouve pas son numéro au premier envoi : sa place
revient. Relancé, le rattrapage ne crée rien de plus.

**Bon à savoir.** Le rattrapage et les collections demandent à votre app Shopify le droit read_products. Une app créée
avant le 24 novembre 2026 ne l'a pas : ajoutez-le à ses portées sur le tableau de bord développeur de Shopify, publiez
sa nouvelle version, puis réinstallez-la sur votre boutique pour l'accepter. Tant qu'il manque, l'aperçu et le volet le
disent, et rien n'est lu.

**Bon à savoir.** Les commandes comptent depuis le branchement de la boutique ; un rattrapage ajoute celles des 60 jours
qui le précèdent, Shopify ne laissant pas lire plus loin. Sans rattrapage, juste après le branchement, « au moins 2
commandes » ne trouve donc personne ; le volet dit la date du début du suivi, et celle du rattrapage. Au fil de l'eau,
seules comptent les commandes d'un numéro déjà dans vos contacts, ou que son message de confirmation y fait entrer,
commandes de test comprises ; le rattrapage, lui, crée la fiche de l'acheteur. Les produits sont connus pour les
commandes payées depuis le 23 novembre 2026, et pour celles d'un rattrapage. Le pays et l'activité, eux, marchent dans
tous les espaces, avec ou sans boutique.

## Les règles des envois

Un client qui a répondu STOP ne reçoit rien, et les modèles du mois et la limite de contacts de votre offre comptent :
la fiche d'un nouveau client compte. Si cette limite est atteinte, les nouveaux clients ne reçoivent plus leurs
messages ; la carte les compte, et vous recevez un e-mail au premier refus du mois. Un numéro fixe est laissé de côté
au profit d'un mobile de la commande. Et si le numéro d'un nouveau client n'est pas sur WhatsApp, la fiche créée pour
son message est supprimée dès que Meta le dit : sa place revient. Chaque premier message apparaît
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
