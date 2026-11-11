# Lot 3v-2c de l'aide à la connexion : qui paie Meta, sur la vitrine, depuis l'ouverture de la vente

**But :** la vente du Crédit WhatsApp ouverte (2026-11-11), la vitrine ne dit plus que Meta facture TOUJOURS votre
entreprise ni que Messaging Me ne touche pas à ces frais : chaque phrase qui le dit nomme l'exception du Crédit WhatsApp
(formule Pro ou Business, prépayé chez Messaging Me). L'onglet Crédit WhatsApp est dit comme il est depuis la vente.

**Spec :** [docs/superpowers/specs/2026-11-08-aide-connexion-numero-design.md](../specs/2026-11-08-aide-connexion-numero-design.md)
(lot 3v-2) ; l'entrée « Meta facture directement » du backlog (lot 4a-2) ; la garde de `tests/etapes-meta.test.ts`, qui
renvoyait les cas d'usage et les tarifs à ce lot.

## Méthode de livraison

En direct, une relecture indépendante du diff, parce que ce sont des phrases de la vitrine, réversibles, que tient une
garde nouvelle sur toutes ses pages : rien que l'API emprunte. La vitrine part par Vercel au push.

**Essai réel :** sur `app.messagingme.fr/tarifs/`, l'accueil et un cas d'usage, en français et en anglais, la phrase sur
ce que Meta facture dit l'exception du Crédit WhatsApp, et la page Tarifs ne dit pas « commission ».

## Ce qui change

1. **Les cas d'usage** (`scripts/vitrine/cas-textes.ts`) : la ligne « qui paie » (sept par langue) et la réponse
   « Combien ça coûte ? » (quatre par langue) nomment l'exception.
2. **Les tarifs, l'accueil, « Pilotage des coûts », les développeurs** (pages écrites à la main, et les dictionnaires
   anglais des trois premières ; la page anglaise des développeurs est écrite à la main) : la même exception. Les tarifs
   perdent « Messaging Me ne touche pas à ces frais » et ne disent toujours pas « commission » (décision du 2026-10-19).
3. **L'onglet Crédit WhatsApp** (la fiche « Recharger le Crédit WhatsApp », `features.md` et son empreinte) : un Pro ou
   un Business le voit pour prendre l'option, une Entreprise dès qu'un numéro est payé ainsi.
4. **La garde** (`tests/etapes-meta.test.ts`) : chaque phrase d'une page de `site/` où Meta facture l'entreprise (ou
   « directement à votre entreprise », ou « ne touche pas à ces frais ») nomme l'exception dans la même phrase.

## Ordre de déploiement

1. Le push : la vitrine par Vercel.
2. Julien : `aide:charger` (la fiche « Recharger le Crédit WhatsApp », qui vit dans la console).
