# Le Crédit WhatsApp : calculer et débiter juste

**Demande de Julien (2026-11-02)** : « surtout, il faut que tu sois vraiment en mesure de calculer et de défalquer du
Crédit WhatsApp la consommation, il ne faut pas se louper là-dessus » ; et dans `/ops`, voir la grille de Meta prix par
prix, poser un numéro sans « identifiant Meta » à taper, comprendre pourquoi « Enregistrer » reste grisé.
**Décision du même jour** : pas de plafond mensuel pour le WhatsApp d'une Entreprise (open bar facturé au contrat,
suivi dans l'onglet « Crédits » de `/ops`), la spec du 2026-10-30 reste juste sur ce point.

## Ce qui est mesuré (2026-11-03, en lecture seule, par le vrai code de l'image en service)

- **La formule est juste** : sur notre compte (la SANDBOX, le seul dont Meta nous rend le coût), le rejeu d'octobre de
  `prixMessage` sur les volumes de `pricing_analytics` rend 2,3076 € pour 2,3076 € facturés par Meta, ligne par ligne
  (marketing, marketing par la MM API et utilitaire vers la France, marketing vers les Émirats).
- **La franchise de service est lisible dans l'accusé** : les 298 messages de service reçus depuis le 1er octobre sont
  marqués `free_customer_service`, `billable: false` (et `FREE_CUSTOMER_SERVICE` à coût nul chez Meta) ; l'ajustement
  les rend déjà.
- **Meta cache le COÛT des comptes clients** (code 10, avec leur jeton comme avec le nôtre) mais en rend les VOLUMES par
  pays, catégorie et type ; ces volumes égalent nos accusés (15/15 Groupama PJ, 31/31 la demo, 11/11, 4/4). Le compte
  de Spareka ne se lit plus du tout (code 100), à regarder à part.

## Lot D : les rouges qu'une correction locale ferme, et les écrans (ce lot)

La relecture indépendante du 2026-11-02 a trouvé sept rouges ; ceux-ci se ferment sans la régularisation :
1. **Un refus définitif de la MM API rendu en 500** (134100 à 134102) rend la provision (`src/meta/factory.ts`,
   `estTerminalMemeEn5xx` dans `src/meta/errors.ts`) : rien n'est parti.
2. **La ligne couvre tout le compte WhatsApp** de son numéro (`PgLignesCreditStore.lireLigne`) : Meta attache la ligne
   au compte, un numéro ajouté ou remplacé dans le compte est provisionné sans geste. Une écriture vide tout le cache.
3. **Un accusé arrivé après le retrait de la ligne** rend ou corrige encore la provision du message parti avant
   (`ligneDesAccuses`, 35 jours, la fin de vie d'un message chez Meta).
4. **Un destinataire sans numéro (BSUID)** est provisionné au tarif du pays de son préfixe (`paysDuDestinataire`), plus
   au plus cher du monde : Meta préfixe le BSUID du code ISO du pays de la personne et dit sa facturation inchangée.
5. **`/ops`** : la grille en vigueur prix par prix avec le prix client (`GET /ops/credit-whatsapp/grille`, formule
   `prixClient` de la garde), les numéros de l'espace dans la fenêtre de l'offre (couverts, posables, ou la raison qui
   l'empêche), l'Entreprise dite illimitée avec son montant du mois, et ce qui grise « Enregistrer » dit en clair.

Tests : `tests/credit-whatsapp-garde.test.ts` (134102, BSUID), `tests/credit-whatsapp-lignes.test.ts` (cache, ligne
retirée), `tests/integration/credit-whatsapp-lignes.integration.test.ts` (compte entier, 35 jours, numéros de l'espace),
`tests/ops-credit-whatsapp.test.ts` (vue, grille), `web/e2e/ops-credit-whatsapp.spec.ts`. Chaque correction vérifiée
dans les deux sens. Déploiement : l'API (`migration=aucune`), puis la console.

**Relecture indépendante du lot D (2026-11-03) : aucun rouge.** Les jaunes de la console (un territoire au même indicatif
introuvable par la recherche, une erreur de lecture dite « route absente », la grille non relue après une commission, la
note de l'authentification, « n/a ») sont corrigés avant la poussée de la console. Ceux du serveur vont au lot E, relus
avec lui :
1. Un numéro du même compte WhatsApp relié dans un AUTRE espace est refusé (`ligne_inactive`) par la ligne du premier, et
   l'écran du second espace dit « pas sur la ligne » : lire la couverture « autre espace » dans la vue comme la garde.
2. L'accusé tardif d'un numéro couvert par son compte puis effacé, ou passé dans un autre espace qui a sa ligne, ne
   retrouve pas sa provision : la retrouver par son wamid sans passer par la ligne (un index sur `wamid` seul).
3. `lireLigne` sort de l'index partiel (le `or` sur le compte, les lignes retirées) : un balayage de la table à chaque
   lecture hors cache, négligeable aujourd'hui ; un index sur `waba_id`, ou deux branches indexées, avant le lot 2. Le
   commentaire de la 0264 (« c'est aussi la recherche de la garde ») ne vaut plus.
4. Rien n'empêche côté serveur de poser un second numéro d'un compte déjà couvert (deux lignes en cours sur un compte) :
   un 409 quand `ligneDuNumero` rend déjà une ligne du même espace.
5. `arreter` et `retirer` visent le numéro et non la ligne qui le couvre : à reprendre avec l'option du lot 4.
6. Le pays du préfixe d'un BSUID n'est jamais corrigé à l'accusé (qui ne porte pas de pays) : le lot E le recale.
7. Un 134102 reçu au REJEU d'un délai rend la provision d'un message peut-être parti (défaut d'avant le lot, comme un 4xx
   au rejeu) : le lot E le recale.
8. Dans la fenêtre de l'offre, « couvert » cache une ligne couvrante arrêtée et un numéro en coexistence.

## Lot E : la régularisation sur les volumes de Meta (le suivant, lot 3 de la spec du 2026-10-30)

Les autres rouges ne se ferment qu'avec elle : une provision en doute (5xx, délai, panne réseau), un wamid jamais
rattaché, un ajustement perdu, un message jamais livré, un rejeu qui envoie deux fois, les paliers de volume. Elle lit
les VOLUMES de `pricing_analytics` (le coût est illisible sur un compte client, mesuré) par jour, numéro, pays, catégorie
et type, les chiffre par `prixMessage` à la commission de l'espace, compare aux provisions du même jour et écrit l'écart
(un mouvement `regularisation` pour un prépayé, le montant à facturer pour une Entreprise). Aucun client ne passe sur la
ligne avant elle. À cadrer avec Julien : l'heure de passage et le traitement des envois hors Messaging Me.

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff**, parce que la production emprunte ces chemins à chaque envoi et à
chaque accusé de Meta, et qu'ils portent des invariants invisibles : une ligne par compte et non par numéro, une
provision rendue une seule fois, le même calcul du prix dans la garde, l'ajustement et l'écran. Une relecture
indépendante par lot, en fin de lot.

**Lot D en production le 2026-11-03** (l'API `0ad1d4c9`, run 41605295306 ; la console `05cbbac3`). Son essai réel est
fait (211 dans la liste privée) : trois provisions illimitées au prix attendu, confirmées par leur accusé, solde resté à
zéro, le numéro retiré ensuite ; reste le coût de Meta de la demi-heure à relire.

**Essai réel qui clôt le lot D (accord de Julien du 2026-11-02)** : le numéro de la SANDBOX (Entreprise) posé sur la ligne
(par la fenêtre de l'offre de `/ops`, ou par le même magasin), trois vrais modèles envoyés au numéro d'essai de Julien. Chaque envoi a sa
provision illimitée au prix de la grille, son accusé la confirme, la somme des provisions du jour égale le coût que Meta
rend pour notre compte ce jour-là, et le solde WhatsApp reste à zéro. Puis le numéro est retiré de la ligne.
