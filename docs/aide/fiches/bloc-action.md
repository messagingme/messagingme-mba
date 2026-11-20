---
description: Le bloc Action d'un scénario WhatsApp : poser ou retirer des étiquettes, remplir ou vider des champs, changer le consentement du contact.
ecran: workflows
source_section: Automatisations (menu « Scénario », ex-« Flow »)
source_empreinte: 6ea74e
publique: oui
rubrique: construire-un-scenario
rang: 6
---
# Le bloc Action

Agit sur la fiche du contact sans rien lui envoyer : ses étiquettes, ses champs, son consentement.

**1. Choisir l'action.** Cliquez sur le bloc : son panneau s'ouvre à droite, la liste « Action » en haut.

- Six actions : ajouter une étiquette, retirer des étiquettes, mettre à jour un champ, vider des champs, passer en
  opt-in, passer en opt-out.
- « Ajouter une action » en enchaîne jusqu'à 10 dans le même bloc, jouées dans l'ordre affiché.
- Changer d'action efface ses réglages. Une action incomplète (étiquette vide, champ non choisi) ne fait rien.

**2. Poser ou retirer des étiquettes.** Écrivez l'étiquette ; pour en retirer plusieurs, Entrée après chacune.

- 64 caractères au plus. Les espaces du début et de la fin sont retirés.
- Une nouvelle étiquette entre dans Contenu > Bibliothèque > Étiquettes dès que vous quittez la case. La retirer
  d'un contact ne la supprime pas de la bibliothèque.
- Une étiquette que le contact n'avait pas lance vos automations « une étiquette est posée sur un contact », sauf
  dans une campagne.

**3. Remplir ou vider un champ.** « Mettre à jour un champ » : le champ, puis sa valeur, fixe, « maintenant » ou
« dernier message du contact ».

- Une valeur fixe est écrite telle quelle : aucune variable n'y est remplacée, et son type n'est pas contrôlé.
- « maintenant » pose la date et l'heure, dans le fuseau de votre espace.
- « dernier message du contact » recopie son dernier message écrit ; s'il n'a encore rien écrit, le champ est vidé.
- Un champ venu de HubSpot est écrit d'abord dans HubSpot : s'il refuse, la fiche ne change pas et le Journal des
  erreurs dit pourquoi.
- « Vider des champs » accepte aussi les champs JSON ; « Mettre à jour un champ » non.

**4. Changer le consentement.** « Passer en opt-in » ou « Passer en opt-out ».

- Opt-in : le contact reçoit vos campagnes marketing. À placer après une étape où il a donné son accord : il lève
  aussi un STOP que le contact avait envoyé.
- Opt-out : le contact sort de toutes vos campagnes, même déjà programmées. C'est l'action à mettre derrière un
  mot-clé de désinscription.

**5. Relier la suite.** Le bloc n'a qu'un point, en bas : la suite part tout de suite, sans rien attendre.

- Relié à rien, le parcours s'arrête là.
- Une Condition placée après voit déjà les étiquettes et les champs posés, mais pas le consentement : elle lit encore
  l'ancien.
- Les actions s'appliquent même à un contact qui a répondu STOP.
