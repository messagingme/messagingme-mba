# Le ROI des messages sur Quantitatif > Shopify : plan

> **Pour l'implémenteur :** exécuter tâche par tâche (superpowers:executing-plans), cases `- [ ]` à cocher. Plan
> COURT par règle du dépôt : tâches, interfaces, tests attendus, ordre de déploiement ; le code est à écrire.

**But :** sur la page Quantitatif > Shopify, deux courbes cumulées (chiffre brut attribué, coût des leviers de vente),
le ROI en pourcentage, et le tableau « Par source » qui part de tout ce qui a coûté.

**Architecture :** une route NEUVE `GET /tenants/:tenantId/stats/ventes/roi` (fonction `statistiques`), qui assemble
trois lectures : la série du chiffre par jour (`PgVentesStore`), les volumes des leviers par jour et par source (store
neuf), le coût de l'IA (`getCoutIa`, existant). Le chiffrage est une fonction PURE. `/stats/ventes` et
`get_revenue_stats` ne changent pas (décision 6 de la conception).

**Pile :** Fastify, Postgres (`pg`), Next.js, SVG maison, vitest, Playwright.

**Conception :** [docs/superpowers/specs/2026-11-06-roi-shopify-design.md](../specs/2026-11-06-roi-shopify-design.md),
à lire avant ce plan : ses décisions 1 à 7 et ses choix « tranché après la relecture » font foi.

## Méthode de livraison

**Implémenteur par lot, puis une relecture humaine du diff en fin de lot**, parce que c'est un CHIFFRE AFFICHÉ qui
fera prendre une décision commerciale (la ligne « chiffre affiché » de la règle globale), et parce que le code touché
porte un invariant invisible : le coût doit compter exactement les messages que l'attribution prend pour des touches,
ce qu'aucun compilateur ne voit. C'est réversible (lecture seule, aucune écriture en base, sans migration sauf si la
tâche 3 en choisit une) : pas de workflow. Une seule relecture, en fin de lot, rouge = chiffre faux ou fuite entre
espaces.

**Essai réel qui clôt la feature** (celui de la conception) : sur l'espace de démonstration branché à
`messaging-me-essai`, une campagne envoyée au téléphone de Julien, une commande payée par son lien, une relance de
panier récupérée ; la page montre les deux courbes, le coût de la campagne et de la relance dans « Par source », un ROI
égal au calcul à la main, aucune confirmation de commande dans le coût. Puis la même page sur un espace au Crédit
WhatsApp. À inscrire dans `docs/prive/ESSAIS-REELS.md`.

## Contraintes communes

- Montants du chiffre : décimaux en TEXTE sommés par Postgres, jamais additionnés en JavaScript (règle de
  `src/shopify/chiffre.ts`). Deux devises ne s'additionnent jamais, ni ne se convertissent.
- Jours de Paris par `BOUNDS_CTE` et `STATS_TZ` (`src/stats/range.ts`) ; chiffre daté de `payee_le`, coût de l'envoi.
- Commandes de test (`ventes_attribuees.test`) hors du chiffre, des courbes et du ROI.
- `tenant_id = $1` sur chaque requête (la RLS est contournée par le rôle de l'application).
- ROI = (brut − coût) / coût × 100, arrondi à l'entier, sur les seuls coûts dans la devise de la boutique ; `null`
  quand le coût vaut zéro (l'écran écrit « aucun coût sur la période »).
- Coût inconnu jamais compté zéro en silence : drapeaux `partiel` et `estime` portés jusqu'à l'écran.
- Console bilingue (`useT`), vouvoiement (`tests/web-vouvoiement.test.ts`), formes et icônes
  (`tests/web-formes.test.ts`, `tests/web-icones.test.ts`). Pas de tiret cadratin.

## Points de vigilance de la relecture

Ce que la conception implique et qu'un test doit tenir, chacun ajouté à sa tâche :

1. Une confirmation ou une expédition Shopify, un envoi `[API]`, une ligne HubSpot : jamais dans le coût (tâche 1).
2. Boutique en USD, IA et Crédit WhatsApp en EUR : ROI sur l'USD seul, l'EUR montré à part et annoncé (tâche 4).
3. Une période qui chevauche deux mois : deux franchises de service, comme `coutMessages` (tâche 4).
4. Une campagne supprimée : sa ligne garde son coût, sans nom, comme le chiffre aujourd'hui (tâche 3).
5. Une période sans aucune vente mais avec des envois : courbe de chiffre à zéro, ROI -100 % (tâches 4 et 6).

---

### Tâche 1 : le périmètre des leviers, une seule définition

**Fichiers :** `src/shopify/ventes.pg.ts` (la requête `TOUCHES`), `src/shopify/attribution.ts` ; test
`tests/shopify-perimetre-leviers.test.ts`.

**Produit :** un module (`src/shopify/perimetre-leviers.ts`) qui exporte les PRÉDICATS SQL du périmètre, importés par
`TOUCHES` ET par la lecture des coûts (tâche 3) :
- `CAMPAGNE_LEVIER` : condition sur `campaigns k` (relance de panier par son nom, ou nom hors des préfixes Shopify,
  `[API]` et HubSpot), paramètres nommés dans l'ordre de `TOUCHES` ;
- `ORIGINES_LEVIER = ['scenario', 'ia', 'mba'] as const` et la correspondance origine vers `SourceVente`.

- [ ] Test d'abord : le texte de `TOUCHES` CONTIENT les deux prédicats exportés (parité par construction), et une
      table de cas nomme chaque préfixe exclu (`PREFIXE_LIGNE_SHOPIFY`, `PREFIXE_ENVOI_API`, `PREFIXE_LIGNE_HUBSPOT`)
      et la relance incluse. Le voir rouge.
- [ ] Extraire, faire passer, puis `npx vitest run tests/shopify-*.test.ts` : l'attribution existante reste verte.
- [ ] Vérifier dans les deux sens : remettre un préfixe en dur dans `TOUCHES`, le test rougit ; restaurer.

### Tâche 2 : la série du chiffre par jour

**Fichiers :** `src/shopify/ventes.pg.ts` ; test d'intégration `tests/integration/shopify-ventes-serie.test.ts`.

**Produit :** `PgVentesStore.lireSerieChiffre(tenantId: string, range: DateRange): Promise<Array<{ jour: string;
devise: string; brut: string; prouve: string }>>`, ventes réelles seulement (`not test`), jour de Paris
`'YYYY-MM-DD'`, trié par jour puis devise, même `BOUNDS_CTE` et même index que `lireChiffre`.

- [ ] Test d'intégration : trois ventes sur deux jours dont une à 23 h 30 heure de Paris (reste sur son jour), une
      vente de test (absente), une vente d'un AUTRE espace (absente) ; la somme des jours égale le `brut` de
      `lireChiffre` sur la même plage.
- [ ] Écrire la requête ; les tests d'intégration ne tournent qu'en CI (jamais contre le `DATABASE_URL` du poste).

### Tâche 3 : les volumes des leviers par jour et par source

**Fichiers :** créer `src/shopify/cout-leviers.pg.ts` ; test `tests/integration/shopify-cout-leviers.test.ts`.

**Consomme :** les prédicats de la tâche 1.

**Produit :** `PgCoutLeviersStore.lireVolumes(tenantId: string, range: DateRange): Promise<VolumesLeviers>` avec

- `envois: Array<{ jour: string; source: SourceVente; campaignId: string | null; nom: string | null; canal:
  'whatsapp' | 'rcs' | 'email'; categorie: string | null; service: boolean; n: number; provisionMicroEur: number }>` :
  `n` messages de ce groupe ; `provisionMicroEur` la somme des provisions NON rendues de
  `credit_whatsapp_provisions` des messages qui en ont une (rattachés par `wamid`), les autres comptés dans
  `nSansProvision: number` du même groupe ;
- `rcs: LotRcs` (forme de `src/stats/chiffrage.ts`) pour la bascule conversationnelle ;
- `serviceAvantPeriode: MoisService[]` (forme de `src/stats/cout-messages.ts`) pour la franchise.

Règles : campagnes et relance par `campaign_recipients` envoyés (même « envoyé » que le coût par campagne existant,
`getCoutParCampagne`) ; scénarios, agent IA et agent de Meta par les messages sortants d'origine `ORIGINES_LEVIER`.
**Un message de scénario lancé par une campagne est rangé sous cette campagne** (conception, choix 1) : la règle de
rattachement est à l'implémenteur (fenêtre de temps reprise de l'attribution, ou lien par une migration qui suit alors
les règles du `CLAUDE.md` et part en `avant`), et le test la fixe.

- [ ] Tests d'intégration : une confirmation Shopify et un envoi `[API]` absents ; la relance de panier sous
      `relance_panier` ; un scénario lancé par une campagne sous la campagne ; un message d'agent IA sous `agent` ; un
      message avec provision non rendue compté en `provisionMicroEur`, un rendu non ; une campagne supprimée gardée
      sans nom ; un autre espace absent.
- [ ] Écrire la lecture ; `EXPLAIN` sur une plage de 366 jours sans balayage complet de `conversation_messages`.

### Tâche 4 : le chiffrage pur

**Fichiers :** créer `src/shopify/roi.ts` ; test `tests/shopify-roi.test.ts`.

**Consomme :** tâches 2 et 3, `coutMessages`, `repartirRcs`, `chiffrer`, `GrillePrix`, `CategoryRates`, `CoutIa`.

**Produit :** `calculerRoi(e: EntreeRoi): RoiVentes`, pur, avec

- `EntreeRoi = { range: DateRange; deviseBoutique: string | null; serieChiffre; volumes: VolumesLeviers; tarifs:
  CategoryRates | null; deviseTarifs: string | null; grille: GrillePrix; coutIaMicroEur: number }` ;
- `RoiVentes = { devise: string | null; serie: Array<{ jour: string; chiffreCumule: string; coutCumule: number }>;
  depense: number; ramene: string; prouve: string; roiPct: number | null; iaMicroEur: number; estime: boolean;
  partiel: boolean; autresDevises: Array<{ devise: string; cout: number }>; sources: Array<{ source: SourceVente;
  campaignId: string | null; nom: string | null; cout: number | null; brut: string; roiPct: number | null; partiel:
  boolean }>; tronque: boolean }`.

Prix par message : la provision si elle existe (EUR), sinon `chiffrer` sur les tarifs (devise du WABA), service au
tarif de service après franchise répartie au prorata, RCS par `repartirRcs`, e-mail sans prix (`partiel`). L'IA en EUR
sous la source `agent`. Sources triées par coût décroissant, 50 au plus (`PLAFOND_CAMPAGNES_SYNTHESE`), le reste
regroupé ; une source qui a vendu sans coût y figure aussi.

- [ ] Tests (valeurs à la main) : 3 campagnes, coût 40 € et brut 920 € donne `roiPct = 2200` ; coût nul donne
      `roiPct = null` ; boutique USD avec IA en EUR donne ROI sur l'USD et `autresDevises` non vide ; une provision
      préférée à l'estimation ; un étage e-mail donne `partiel` ; deux mois traversés, deux franchises ; une source
      sans vente à `-100` ; cumul croissant et dernier point égal aux totaux ; aucune vente, `ramene = '0'`.
- [ ] Les montants du chiffre restent du texte : le cumul du chiffre est fait par la base (tâche 2 rend des jours,
      le cumul se calcule sans flottant, par exemple en centimes entiers ou par une somme fenêtrée en SQL).

### Tâche 5 : la route

**Fichiers :** `src/http/stats.ts`, câblage `src/index.ts` (fichier de CÂBLAGE PARTAGÉ : annonce aux sessions
voisines, commit en plomberie) ; tests `tests/http-stats-roi.test.ts`, et `tests/scope-tenant.test.ts` qui doit la
voir sans retouche.

**Produit :** `GET /tenants/:tenantId/stats/ventes/roi?from=&to=` rend `RoiVentes`, garde de la fonction
`statistiques` (comme `/stats/ventes`), même lecture de plage que `/stats/ventes`.

- [ ] Tests : 200 avec la forme ; 403 sans la fonction `statistiques` ; une session d'un autre espace refusée.
- [ ] `npm run typecheck`, `npx tsx scripts/auto-attaque.mts` en local avant de pousser (la CI `unit` la lance).

### Tâche 6 : l'écran

**Fichiers :** `web/lib/ventes.ts`, `web/lib/api/stats.ts`, créer `web/components/analytics/CourbeRoi.tsx`,
`web/app/dashboard/shopify/page.tsx` ; e2e `web/e2e/shopify-roi.spec.ts`.

**Produit :** au-dessus du tableau, une carte : dépensé, ramené (et « dont prouvé »), ROI en %, puis deux courbes
cumulées sur DEUX échelles (le coût lisible quand le chiffre fait 100 fois plus), la ligne qui explique les dates
(vente datée du paiement, coût de l'envoi, 5 jours) et les avertissements (estimé, partiel, autre devise). Le tableau
« Par source » prend ses lignes de `RoiVentes.sources` avec deux colonnes, coût et ROI.
**La page tolère l'absence de la route** (404 : elle reste comme aujourd'hui, sans la carte) : c'est ce qui permet de
pousser l'écran sans attendre le déploiement.

- [ ] e2e (topologie proxy, serveur démarré soi-même, `CLAUDE.md`) : la carte et le ROI affichés sur une réponse
      fausse ; « aucun coût sur la période » ; l'avertissement d'autre devise ; la route en 404 laisse la page
      d'aujourd'hui.
- [ ] Suite racine ENTIÈRE avant de pousser (des tests de la racine lisent `web/`), puis la suite web.

### Tâche 7 : la doc, puis le déploiement

- [ ] `features.md` (section Shopify ou Performance Lab) : si une fiche d'aide la cite, fiche et empreinte dans le même
      commit, `tests/aide-proposer.test.ts` vert avant le push ; `documentation.md` (la règle du périmètre commun) ;
      journal ; `ESSAIS-REELS.md`.
- [ ] Relecture humaine du diff du lot (une seule) ; rouge = chiffre faux ou fuite entre espaces.
- [ ] CI lue job par job (`gh run view <id> --json jobs`), puis `gh workflow run deploy-scaleway.yml --ref main -f
      migration=aucune` (ou `avant` si la tâche 3 a choisi une migration), approuvé par Julien.
- [ ] Après le déploiement : la route en 401 sans session, puis l'essai réel.
