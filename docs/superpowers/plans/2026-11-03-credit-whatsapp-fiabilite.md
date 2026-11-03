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
rattaché, un ajustement perdu, un message jamais livré, un rejeu qui envoie deux fois. Aucun client ne passe sur la ligne
avant elle. Lancé par Julien le 2026-11-03 (« Yes, lot E »).

**Mesuré le 2026-11-03** (lecture seule, notre compte et Groupama PJ) : `pricing_analytics` en `HALF_HOUR` rend des
demi-heures exactes en UTC, en `DAILY` des jours de PARIS (fuseau du compte) ; chaque point porte `phone_number`
(chiffres sans « + »), `country`, `pricing_category`, `pricing_type`, `tier` (« 0:100000 », « 0:MAX ») et `volume`, plus
`cost` sur NOTRE compte seulement. Une demi-heure se lit moins d'une heure après sa fin. Sur la demi-heure de l'essai 211,
le coût de Meta égale nos provisions sans commission au centime (0,1456 €).

**Ce que fait la régularisation** (choix de Claude dans la spec du 2026-10-30, étage 3) :
1. Une passe par heure (rôle `principal`), qui recalcule les deux derniers jours de PARIS clos (la veille et l'avant-veille,
   pour les livraisons tardives) de chaque espace couvert par une ligne, en cours ou retirée depuis peu, et REMPLACE leur
   régularisation : idempotente, jamais cumulée. Un jour plus ancien n'est plus recalculé. Le jour en cours ne l'est
   jamais : ses volumes arrivent en retard, une régularisation du jour ferait monter et descendre le solde.
2. Le côté de Meta : les demi-heures ENTIÈRES du jour pendant lesquelles une ligne couvrait le compte (une demi-heure
   entamée par la pose ou le retrait est écartée des deux côtés), les seules `REGULAR`, chacune chiffrée par `prixMessage`
   à la commission de l'espace, au palier lu (`palierDeTier`), avec la grille EN VIGUEUR CE JOUR-LÀ (`grilleAu`).
3. Notre côté : les provisions non rendues de l'espace rangées dans ces mêmes demi-heures par l'instant de leur livraison,
   à défaut de leur création. Une provision en doute ou jamais livrée y reste, et l'écart la rend si Meta ne l'a pas
   facturée ; un message envoyé deux fois sous une provision est débité de l'autre.
4. L'écart du jour (Meta moins nous) s'écrit dans `credit_whatsapp_regularisations` (migration 0274, une ligne par espace
   et par jour, le détail par numéro, pays, catégorie et type), et pour un prépayé en mouvement `regularisation` (le
   solde suit, dans la même transaction, sous un verrou par espace et par jour). Pour une Entreprise, il s'ajoute au
   montant à facturer (`/ops`) et aux messages du mois, sans toucher au solde.
5. Un écart positif au-delà d'une tolérance (plus de 0,50 € et de 2 % du jour : des envois que nous n'avons pas vus, hors
   Messaging Me) prévient Julien par Telegram, une fois par espace et par jour ; un solde prépayé sous -50 € aussi (Julien
   fait retirer la ligne, spec).

**Hors du lot, écrit** : l'e-mail au client sur des envois hors Messaging Me (avant l'ouverture, lot 5) ; les paliers de
volume, tant que seule la grille de base est chargée (un compte au-delà d'un seuil serait chiffré au tarif de base) ; les
réponses de l'agent de Meta (aucune n'est sur la ligne aujourd'hui) ; une livraison plus de deux jours après son jour.

**Tests** : le calcul pur (`tests/credit-whatsapp-regularisation.test.ts` : demi-heures entières, gratuités, palier,
grille du jour, tolérance), le magasin sur une vraie base (intégration : une régularisation remplacée et non cumulée, le
solde égal aux mouvements moins les provisions après elle, deux passes simultanées sans double débit), le câblage du
worker (rôle, câblage). **Déploiement** : `migration=avant` (la table est neuve, l'ancien code l'ignore).

**Relecture indépendante du lot E (2026-11-03) : aucun rouge.** Corrigés avant la poussée, vérifiés dans les deux sens :
les volumes d'un compte filtrés par SES demi-heures couvertes (deux comptes d'un espace se mélangeaient, 2,60 € d'écart
mesuré au lieu de 0) ; un jour régularisé deux heures après sa fin (`MARGE_FRAICHEUR_S`) ; un point facturé de catégorie
inconnue ou sans pays compté « non chiffré », jamais au plus cher ; une lecture vide de Meta alors que nos messages ont été
livrés refusée ; une réponse paginée, en plusieurs séries ou d'une autre durée refusée ; les alertes de la passe une fois
par jour ; une panne sur un espace qui n'arrête plus les suivants ; un mouvement inchangé jamais réécrit ; la passe lancée
dès le démarrage. **Restent, AVANT qu'un prépayé passe sur la ligne** (relus avec le lot suivant) :
1. Une provision qui change de jour après le gel du sien (livraison plus de deux jours après sa création) est comptée
   deux fois en faveur du client, et un `failed` tardif la rend une seconde fois : figer une provision dans le jour où
   la régularisation l'a comptée.
2. L'offre (prépayé ou illimité) et la commission sont lues au moment de la passe, pas sur les provisions du jour : un
   jour recalculé après un changement d'offre ou de commission tombe du côté de la nouvelle. Et la garde choisit la
   grille sur la date UTC, `grilleAu` sur le jour de Paris (une heure d'écart au début d'un trimestre).
3. Aucun e-mail « crédit bas » quand une régularisation fait passer le solde sous le seuil.
4. La consommation WhatsApp de `/ops` et la courbe d'une Entreprise ignorent l'écart (« à facturer » et l'onglet
   l'incluent) ; « à facturer » du mois précédent bouge encore jusqu'au 2 à 2 h : facturer après.
5. `nosDemiHeures` relit 33 jours de provisions par espace et par heure (négligeable aujourd'hui).
6. L'ordre de déploiement : la table est lue par l'onglet, `get_credit` et la vue « Crédits » ; un déploiement de la tête
   de `main` en `migration=aucune` avant elle les ferait tomber en 42P01. Annoncé aux sessions voisines.

## Les jaunes des lots D et E (2026-11-03 au soir, migration 0275)

Demandé par Julien (« ferme les jaunes et avance sur le lot 4 »). Fermés :
- **E1, le gel** : une provision comptée garde sa demi-heure (`tranche_regularisee`) et ne se rend ni ne se corrige plus
  à l'accusé ; l'écriture relit la somme qu'elle vient de figer et n'écrit rien si un accusé l'a changée entre la lecture
  et elle (la passe suivante recalcule).
- **E2, les conditions du jour** : `commission_pct` sur chaque provision ; offre et commission du jour lues sur ses
  provisions (`conditionsDuJour`), celles du moment à défaut ; la garde choisit sa grille au jour de Paris.
- **E3, l'e-mail du crédit bas** après une régularisation qui débite (`alertes.surDebit`, la même occasion).
- **D1 et D8, `/ops`** : la couverture lue comme la garde (`ligneDuNumero`), « autre espace », une ligne couvrante
  arrêtée, la coexistence d'un numéro couvert dite en rouge. **D3** : deux index sur `lignes_credit_whatsapp`, `(waba_id)` et `(phone_number_id)` (un `or` ne s'indexe que si ses deux bras le sont).
  **D4** : un second numéro d'un compte couvert refusé (409).
- **D2, D6 et D7** n'ont plus de correction propre : une provision qu'un accusé ne retrouve pas, un pays de BSUID faux ou
  un 134102 au rejeu restent comptés à leur montant, et l'écart de leur jour les règle sur ce que Meta a facturé.

Restent : **D5** (`arreter` et `retirer` visent le numéro, pas la ligne qui le couvre) avec l'option du lot 4 ; **E4**
(la consommation de `/ops` et la courbe d'une Entreprise ignorent l'écart, « à facturer » l'inclut ; facturer un mois
après le 2 à 2 h) et **E5** (33 jours de provisions relus par espace et par heure, négligeable) au backlog.

**Relecture indépendante (2026-11-03) : aucun rouge, sept jaunes.** Suivis avant la poussée : la 0275 poussée et
appliquée SEULE avant son code (la garde nomme `commission_pct` à chaque envoi, un déploiement de la tête de `main` en
`migration=aucune` casserait sinon tous les envois de la ligne), l'index par numéro ajouté (un `or` ne s'indexe que si
ses deux bras le sont), trois phrases de doc. **Restent, relus avec le lot suivant** :
1. Un jour MIXTE (une offre ou une commission changée dans la journée) se règle tout entier sur la majorité : ventiler
   l'écart par demi-heure (`nosDemiHeures` peut rendre les conditions), et que l'ajustement chiffre avec la commission
   de la provision plutôt qu'avec celle du moment.
2. Une provision figée puis livrée plus tard compte dans les `livres` de son jour : fausse alerte « Meta ne rend aucun
   volume » et jour plus réécrit (le montant écrit reste juste). Ne compter que la livraison tombée dans sa demi-heure.
3. « Une ligne par compte » n'est tenue que par la route, à travers le cache de 5 s de chaque copie : un index unique
   partiel sur le compte des lignes en cours, avec son conflit dans `poser`, avant l'option du lot 4.
4. Deux tests resteraient verts : le jour de Paris de `grilleEnVigueur`, et un gel qui figerait d'autres demi-heures que
   celles du jour (une provision hors tranche, une d'aujourd'hui, qui doivent rester rendables).
5. Perf : chaque espace relit environ 33 jours de provisions sept fois par heure ; borner aussi par `cree_le < fin`.

**Méthode** : en direct, sur les fichiers des lots D et E, avec une relecture indépendante en fin de lot ; la production
emprunte la garde et l'accusé à chaque envoi. **Déploiement** : `migration=avant` (le code neuf écrit les deux colonnes ;
l'ancien code y survit, elles sont nullables). **Essai réel** : la régularisation du 2026-11-03 de la SANDBOX (essai
212), relue en base le 2026-11-04 après 2 h : sa ligne illimitée, Meta égal à nous, et les deux provisions de l'essai
figées dans leur demi-heure.

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
