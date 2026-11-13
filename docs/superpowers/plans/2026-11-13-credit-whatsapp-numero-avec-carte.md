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

## Lot 2 : ce que dit Claude, et la carte qui reste à régler

**Pourquoi.** Après le lot 1, `watch_whatsapp_connection` disait encore « connecté sans carte… sous 24 h ouvrées » à un
numéro connecté avec sa carte dont l'option est payée (`en_attente`), et ses branches de la reconnexion (`reconnecter`,
`regler`, `support`) étaient mortes. `get_setup_state` et l'Accueil taisaient « Ajoutez votre carte chez Meta » pour ce
même numéro (jaune de la relecture du lot 1) : la même règle, `creditPaieMeta`, les trois fois.

**Méthode de livraison : en direct, puis UNE relecture indépendante du diff.** Peu de fichiers, réversible, des critères
que des tests vérifient ; la relecture tient à l'invariant invisible (une seule règle, trois lecteurs).

**Tâches.**
1. `creditPaieMeta(etat, avecApplication, numeroAvecCarte)` : l'option payée n'attend pas un numéro connecté avec sa
   carte ; une ligne active paie quand même (la précédence de la carte de Connecter WhatsApp). Troisième argument requis.
   Ses lecteurs : `get_setup_state` (lit `numeroAvecCarte`, illisible lu comme oui, comme `avecApplication`), l'Accueil
   (le champ de la route de l'état, en production depuis le lot 1), `watch_whatsapp_connection`.
2. `paiementDuNumero` : `avec_carte` quand la ligne aurait pu prendre le numéro (l'option payée, ou une Entreprise sans
   ligne) et que `numeroAvecCarte` le dit : le texte (1) dit par Claude, le Support pour changer, les étapes de la carte.
   Ailleurs la règle ne se lit pas (aucune attente pour un numéro connecté, comme toujours, avec sa carte).
   `paiementStable` relit tant qu'elle dit `avec_carte` (le numéro relié avant sa marque). Les branches de la reconnexion
   et leurs textes partent ; le JSDoc de `fenetrePartenaire` ne la promet plus.

**Tests attendus.** `creditPaieMeta` avec la carte (`en_attente` faux, `active` vrai) ; `carte_meta_a_regler` dit pour
un numéro avec carte en `en_attente`, ou illisible, tu en `active` ; `get_setup_state` lit la règle pour l'espace
demandé ; la suite `avec_carte` pour l'option à jour, en retard, et une Entreprise, jamais « sous 24 h ouvrées » ni
« aucune carte » ; sans option, la suite de la carte sans lire la règle ; la course (relu jusqu'à la marque) ; un vrai
numéro avec carte relu au moins cinq fois, jamais au-delà de l'attente ; e2e de l'Accueil : le bandeau reste pour un
numéro avec carte en `en_attente`, se tait en `active`.

**Ordre de déploiement.** Sans migration. La console au push (le champ qu'elle lit est déjà en production) ; l'API
ensuite (`migration=aucune`, `-f commit=<sha>`).

**Essai réel qui clôt.** Sur l'espace de l'essai 257 (l'option payée, le numéro connecté avec sa carte), depuis Claude
Code : `watch_whatsapp_connection` dit que la ligne de crédit ne peut pas le prendre en charge et donne les étapes de la
carte ; si Meta bloque sa carte, `get_setup_state` rend `carte_meta_a_regler` et l'Accueil montre le bandeau.
