# Lot 3v-2a de l'aide à la connexion : le Crédit WhatsApp se prend dans la console

**But :** la vente de l'option Crédit WhatsApp est ouverte en production depuis le 2026-11-11 (prix posé chez Stripe,
la console le dit par son état) ; ce que lisent les visiteurs et Claude ne dit plus « sur demande, écrivez-nous », mais
où l'option se prend : dans la console, dès l'essai de la formule Pro, sur la carte ou dans Offre, onglet Crédit
WhatsApp.

**Spec :** [docs/superpowers/specs/2026-11-08-aide-connexion-numero-design.md](../specs/2026-11-08-aide-connexion-numero-design.md)
(lot 3v-2, « le jour du prix »).

## Méthode de livraison

En direct, une relecture indépendante du diff, parce que ce sont des textes réversibles, chacun tenu par un test de
parité ou de citation : rien que la production emprunte côté API. La vitrine part par Vercel au push ; le plugin et la
fiche demandent les deux gestes de Julien (`plugin.yml`, `aide:charger`).

**Essai réel :** sur `app.messagingme.fr/demarrer/`, en Pro, la réponse « Crédit WhatsApp » de « Qui paie vos messages
à Meta ? » mène à l'onglet Crédit WhatsApp de la console ; Claude, avec le plugin 0.3.36, répond qu'elle se prend dans
la console et n'ouvre pas la fenêtre de Meta pour elle.

## Ce qui change

1. **Le tunnel de la vitrine** (`scripts/vitrine/tunnel-textes.ts`) : la réponse grisée de la formule Pro mène à
   l'onglet de la console (`OFFRE_CREDIT_WHATSAPP`), et le guide du numéro ne dit plus « sur demande ».
2. **« Payer Meta »** (`aide-sources-textes.ts`) : le lien de la section du Crédit WhatsApp mène à la console, plus à
   la page Contact.
3. **La FAQ du plugin** (`scripts/plugin/faq.ts`) et la skill `mise-en-service` : l'option se prend dans la console ;
   Claude ne l'achète pas et ne lance pas la fenêtre de Meta pour un numéro qui la prend.
4. **La fiche « Connecter mon numéro WhatsApp »** et `features.md` : un administrateur la prend sur la carte, dès
   l'essai de la formule Pro (« pendant un essai, la carte chez Meta » était faux depuis le 2026-11-10).
5. Le plugin passe en 0.3.36.

Reste au lot suivant (3v-2c) : « Meta facture directement à votre entreprise » des cas d'usage, des tarifs, de
l'accueil et de « Pilotage des coûts », à nuancer du Crédit WhatsApp. Puis 3v-2b : `/brancher` et la consigne de
Claude par la fenêtre du partenaire.

## Ordre de déploiement

1. Le push : la vitrine par Vercel.
2. Julien : `aide:charger` (la fiche), puis la publication du plugin (`plugin.yml`).
