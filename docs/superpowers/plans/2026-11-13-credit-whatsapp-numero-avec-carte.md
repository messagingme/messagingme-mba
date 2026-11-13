# Le Crédit WhatsApp ne se vend plus à un numéro connecté avec sa carte

**Pourquoi.** Meta refuse qu'un compte que notre application sert déjà en direct repasse par la fenêtre du partenaire
(essai 257, 2026-11-13 : #2494156, puis 2593118). Les deux reconnexions livrées (l'onglet d'une formule Pro, « V4,
suite » ; le lien d'une Entreprise) ne peuvent donc pas marcher. **Décision de Julien (2026-11-13) : ne plus vendre
l'option à un numéro connecté avec sa carte**, le dire avant l'achat, et renvoyer ce cas au Support.

**Textes validés par Julien (version A, 2026-11-13)** :
- (1) à la place de l'achat de l'option (carte de Connecter WhatsApp, onglet, refus du serveur) : « Votre numéro est
  connecté avec votre carte chez Meta : le Crédit WhatsApp ne peut pas le prendre en charge. Pour changer, écrivez au
  Support. »
- (2) avant qu'un espace qui a droit à la ligne ne connecte son numéro avec sa carte : « Connecté avec votre carte chez
  Meta, ce numéro ne pourra plus passer sur le Crédit WhatsApp. »

## Méthode de livraison

**Implémenteur par lot, puis UNE relecture indépendante du diff**, parce que la production emprunte ce chemin (la prise
d'une option payée, l'e-mail de conversion) et qu'il porte un invariant invisible (une seule règle de la prise, lue par
la prise, l'état des cartes, l'onglet et la conversion). L'essai réel qui clôt le lot se fait sur un espace de test en
formule Pro dont le numéro est connecté avec la carte (dernière section).

## Tâches

1. **Serveur.** `numeroAvecCarte(tenantId)` (`src/credit-whatsapp/fenetre-partenaire.ts`) : l'espace a un numéro Meta
   rattaché, délié compris, qu'aucune ligne ne couvre et qui n'attend pas la sienne (coexistence comprise : elle paie aussi
   Meta par sa carte). `solutionDuPartenaire` ne rouvre plus la fenêtre à un espace qui a déjà un numéro (`seReconnecte`
   retiré). `ouvrirOption` refuse avec le texte (1), code `numero_avec_carte`. L'onglet (`prisePossible` faux) et l'état
   des cartes rendent `numeroAvecCarte`. L'e-mail de conversion ne part pas à un tel espace.
2. **Console.** Le bouton de reconnexion d'une Entreprise (`?reconnexion=entreprise`) et celui de `PlaceLibre` sont
   retirés ; à leur place, et à la place de l'achat, le texte (1) quand `numeroAvecCarte` (absent : comme avant, l'écran
   tolère l'API d'avant). Le guide « Ma carte chez Meta » d'un espace qui a droit à la ligne porte le texte (2).
3. **Doc.** features.md (et les empreintes des fiches qui citent la section), la fiche publique « Payer ses messages
   sans carte chez Meta » et sa version anglaise (puis `vitrine:aide`), `recharger-le-credit-whatsapp`, documentation.md.
   Laissés à la session de l'aide à la connexion, qui a ces fichiers en cours : la skill `mise-en-service` du plugin et
   le JSDoc de `src/mcp/outils-numero.ts` (au backlog).

## Tests attendus

- `numeroAvecCarte` : vrai pour un numéro direct sans ligne (coexistence et numéro délié compris) ; faux sans numéro,
  360dialog, couvert par une ligne, ou qui attend la sienne.
- `solutionDuPartenaire` : `null` dès qu'un numéro est rattaché (l'ancien cas « se reconnecte » compris).
- `ouvrirOption` : 409 `numero_avec_carte` avec le texte (1), aucun appel à Stripe.
- Routes : `prisePossible` faux et `numeroAvecCarte` vrai dans l'onglet et l'état ; la conversion ne s'émet pas.
- E2E : plus de bouton de reconnexion ; le texte (1) à sa place ; le texte (2) dans le guide de la carte.

## Ordre de déploiement

Sans migration. L'API d'abord (`migration=aucune`), la console ensuite ou dans le même push (elle tolère l'absence de
`numeroAvecCarte`), puis `aide:charger` pour la fiche publique.

## Essai réel qui clôt

Sur un espace de test en formule Pro (essai) dont le numéro est connecté avec la carte : la carte de Connecter WhatsApp
et l'onglet disent le texte (1), sans bouton d'achat ni de reconnexion ; sur un espace en formule Pro avec l'option prise, sans numéro, le
guide « Ma carte chez Meta » dit le texte (2).
