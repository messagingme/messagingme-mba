# Les segments sur les commandes, le pays et l'activité : plan

**But** : `find_contacts` (et la cible commune de `tag_contacts`, `set_contact_field`, `prepare_campaign`) et le panneau
de filtres de la console ciblent par commandes Shopify, dépense, dernière commande, pays et activité.

**Spec** : `docs/superpowers/specs/2026-10-31-segments-commandes-pays-activite-design.md` (décisions de Julien du
2026-10-31, et mes choix marqués).

**Architecture** : six critères de plus dans `ContactFilters`, validés par refus (jamais ignorés), traduits en
sous-requêtes portant chacune `tenant_id = $1` dans `buildContactWhere`. Deux écritures nouvelles sur des chemins
chauds : la commande payée (`orders/paid`) et la date de dernière activité (message reçu, clic attribué). Une route de
lecture dit à la console ce que l'API sait cibler (boutique, devise, dates de suivi) : elle sert aussi de garde, un
écran ne propose un critère qu'à une API qui l'a annoncé.

## Méthode de livraison

**Implémenteur par lot (moi, dans cette session) puis UNE relecture indépendante du lot entier avant le premier push,
puis revue du diff par Julien à l'approbation du déploiement.** Parce que la production emprunte trois de ces chemins
(le webhook `orders/paid`, chaque message reçu, l'audience d'une campagne), qu'une migration touche `contacts`, et que le
code porte des invariants invisibles au compilateur : l'isolation par `tenant_id` dans chaque sous-requête, le refus d'un
critère malformé (ignoré, il élargirait une audience), et l'ordre API puis console. feature-loop ne convient pas : les
critères les plus graves (isolation, ordre de déploiement) ne se voient pas dans un test d'interface.

**Essai réel qui clôt** : après le déploiement, Julien paie une commande de test sur la boutique de développement de
l'espace de démonstration ; par le vrai MCP, `find_contacts` trouve le contact par « au moins 1 commande dans les 7
derniers jours », par son pays (`countries: ["FR"]`) et par « actif dans les 7 derniers jours », `tag_contacts` l'étiquette,
puis la console montre le même compte avec les mêmes critères (liste des contacts et choix des destinataires).

## Contraintes globales

- Chaque sous-requête nomme `tenant_id = $1` (le rôle de l'application contourne la RLS).
- Un critère malformé lève `FiltreContactInvalide` (400) côté HTTP, `RefusOutil` côté MCP ; jamais ignoré.
- Bornes : jours 1 à 3 650 ; commandes 0 à 1 000 (entiers) ; montant 0 à 10 000 000 ; 20 pays au plus ; toutes
  annoncées dans le schéma MCP.
- Les commandes de test comptent ; les remboursements ne sont pas déduits ; la dépense ne somme que la devise de la
  boutique actuelle.
- Pas de tiret cadratin ni demi-cadratin, vouvoiement dans la console, i18n FR et EN.

## Points à surveiller (non couverts par la seule logique des tâches)

1. **Une console qui envoie un critère à une API qui ne le connaît pas** : l'ancien analyseur le jette, l'audience
   s'élargit. Parade : le panneau ne montre les critères que si `GET .../contacts/segments` a répondu (tâche 6,
   test e2e avec la route en 404), et le commit console part après le déploiement.
2. **Les commandes, les clics ou les messages d'un AUTRE espace** ne comptent jamais : test d'intégration à deux espaces
   (tâche 2).
3. **`orders/paid` reçu deux fois** (Shopify réessaie) ne compte qu'une commande ; une expédition reçue avant ou après le
   paiement n'écrase ni la date ni le montant : test d'intégration de `lierCommande` (tâche 3).
4. **« Au plus 0 commande » dans un espace sans boutique** viserait tout l'espace : refus MCP (tâche 5), critère absent du
   panneau (tâche 6).
5. **Inactif inclut le jamais actif, actif exclut le jamais actif** : cas d'intégration (tâche 2).

## Écarts pendant la construction (2026-11-03)

- **Les critères ne sont PAS des membres neufs de `ContactFilters`** (tâche 2) : ils voyagent dans `fieldFilters`, clés
  réservées `segment_*` et opérateur `segment` (`web/lib/partage/segments.ts`), validés par `lireSegment`, traduits par
  `clauseSegment`. Raison : la règle des filtres d'analyse (amendement 6, `documentation.md`) ; un serveur ancien
  ignorerait un membre neuf, et un brouillon de campagne repris pendant un retour arrière partirait à tout l'espace,
  alors qu'il ne trouve personne sous une clé de champ inconnue. Les interfaces de la tâche 2 qui nomment
  `commandes`, `depense`, `derniereCommandeJours`, `actifJours`, `inactifJours`, `pays` dans `ContactFilters` sont
  remplacées par ces clés.
- **Un seul commit au lieu de deux** (tâche 7) : la garde de la console (rien n'est proposé sans la route
  `contacts/segments`) et la forme `fieldFilters` rendent l'ordre console/API sans danger.
- La page « Shopify » de la vitrine liste le résumé de `find_contacts` : elle est régénérée (`npm run vitrine:cas`), et la
  fiche d'aide publique des contacts aussi (`npm run vitrine:aide`).
- **Relecture du lot : un rouge, l'ordre de mise en production.** La migration 0273 est nommée par `purgeMany`,
  `connecter` et `lierCommande` : elle part SEULE (commit, CI, `migration=avant`, relecture en base), puis le code dans
  un second push (`migration=aucune`). Les jaunes du code pas encore livré sont corrigés dans le même lot (saisie
  invalide qui garde le dernier critère valide, clause `false` au lieu de `true`, clic sur une fiche supprimée, message
  redélivré, rebranchement sans coupure, ordre des verrous de la migration, pays principal d'un indicatif) ; les
  autres vont au `todo.md`.

---

### Tâche 1 : la migration `0273_segments.sql`

Numéro à relire par `npm run migrations` et sur `origin` juste avant le push (d'autres sessions migrent). Invoquer la
skill `migrations-postgres` avant de l'écrire.

- `shopify_commandes` : `payee_le timestamptz` (rempli puis `not null default now()`), `montant numeric(18,3)` (nul ou
  >= 0), `devise text` (nul ou `^[A-Z]{3}$`), `test boolean not null default false`. Remplissage : depuis
  `ventes_attribuees` par `(tenant_id, commande_id)` (date, montant, devise, test), sinon `payee_le = cree_le`.
- `shopify_boutiques.commandes_depuis timestamptz not null default now()`.
- `contacts.derniere_activite_le timestamptz` (nullable, sans défaut : métadonnée seule). Remplissage : le plus grand de
  `max(created_at)` des messages `direction = 'in'` des conversations de la fiche (`conversations.contact_id`) et de
  `max(at)` de ses clics attribués, par espace.
- `set local lock_timeout = '5s'`. Part en `migration=avant` : le code neuf écrit ces colonnes sur deux chemins chauds.
- Test : `tests/migration-0273.test.ts` relit le fichier (colonnes, contraintes, `lock_timeout`, pas d'accent grave dans
  un commentaire), comme les tests de migration voisins.

### Tâche 2 : le contrat, les analyseurs et le SQL

**Fichiers** : créer `web/lib/partage/segments.ts` et `src/crm/segments.ts` ; modifier
`web/lib/partage/contact-filters.ts`, `web/lib/contact-filters.ts`, `src/crm/contact-filters.ts`, `src/http/contacts.ts`,
`src/http/import.ts`, `src/crm/contact-store.pg.ts`.

**Interfaces produites** :
- `web/lib/partage/segments.ts` : `interface Plage { min?: number; max?: number }`, `interface PlageSurJours extends Plage
  { jours?: number }`, `BORNES_SEGMENTS = { joursMax: 3650, commandesMax: 1000, depenseMax: 10_000_000, paysMax: 20 }`,
  `CLES_COMMANDES = ['commandes', 'depense', 'derniereCommandeJours'] as const`.
- `ContactFilters` gagne `commandes?: PlageSurJours`, `depense?: PlageSurJours`, `derniereCommandeJours?: Plage`,
  `actifJours?: number`, `inactifJours?: number`, `pays?: string[]` (ISO alpha-2 en capitales). Clés GET :
  `commandes`, `depense`, `derniereCommande` (JSON), `actifJours`, `inactifJours`, `pays` (CSV). `filtersActive` les
  compte.
- `src/crm/segments.ts` : `lirePlage(v: unknown, nom: string, o: { max: number; entier: boolean; avecJours: boolean }):
  Plage | PlageSurJours | undefined`, `lireJours(v: unknown, nom: string): number | undefined`, `lirePays(v: unknown):
  string[] | undefined` (tous lèvent `FiltreContactInvalide` : objet vide, min > max, hors bornes, pays inconnu de
  `libphonenumber-js`), `prefixesDesPays(pays: string[]): string[]` (`+<indicatif>`, dédupliqués),
  `paysDuNumero(e164: string | null): string | null`, `clausesSegments(f: ContactFilters, add: (v: unknown) => string):
  string[]`, `ACTIVITE_COMPLETE_DEPUIS: string` (la date du déploiement, posée au moment du push).
- `PgContactStore.suiviSegments(tenantId): Promise<SuiviSegments>` avec `SuiviSegments = { boutique: { devise: string |
  null; commandesDepuis: Date; coupeeLe: Date | null } | null }`.

**SQL** (dans `clausesSegments`, appelé par `buildContactWhere`) : commandes et dépense par `id in (select o.contact_id
from shopify_commandes o where o.tenant_id = $1 ... group by o.contact_id having ...)` quand un minimum >= 1 (ou > 0) est
posé, sinon `id not in (... having count(*) > max)` ; la dépense filtre `o.devise is not distinct from` la devise de la
boutique de l'espace ; dernière commande par `having max(o.payee_le)` ; actif `derniere_activite_le >= now() - N jours` ;
inactif `(derniere_activite_le is null or derniere_activite_le < now() - N jours)` ; pays par `(phone_e164 like $a or ...)`.

**Tests attendus** :
- `tests/contact-where.test.ts` : chaque critère produit sa clause, chaque sous-requête porte `o.tenant_id = $1`, les
  valeurs voyagent en paramètres (jamais dans le texte), `max: 0` seul passe par `not in`.
- `tests/contact-filters-roundtrip.test.ts` : aller-retour `filtersToQuery` puis `parseFilters` des six critères ; refus
  de `{}`, `min > max`, `jours: 0`, `jours: 3651`, `commandes: { min: 1.5 }`, `pays: ['XX']`, 21 pays ; `pays: ['be']`
  devient `['BE']`. Même refus par le corps d'une action en masse (`parseBulkTarget`).
- `web/lib/contact-filters.test.ts` : `filtresRepris` garde les six critères bien formés et jette les autres.
- `tests/crm-segments.test.ts` : `prefixesDesPays(['US', 'CA'])` rend `['+1']`, `paysDuNumero('+32470123456')` rend
  `'BE'`.
- `tests/integration/segments.integration.test.ts` (Postgres de la CI) : deux espaces ; commandes, clics, messages et
  dates dans les deux ; chaque critère compte ce qu'il faut dans le premier espace et rien de l'autre ; actif exclut et
  inactif inclut une fiche jamais active ; la dépense ignore une commande dans une autre devise et une commande sans
  montant ; une fiche supprimée n'est jamais rendue.

### Tâche 3 : chaque commande payée enregistrée

**Fichiers** : `src/shopify/store.pg.ts`, `src/shopify/attribution.ts`, `src/shopify/traitement.ts`.

- `lierCommande(tenantId, commandeId, clientId, contactId, details?: DetailsCommande)` avec `DetailsCommande = { payeeLe:
  Date; montant: number | null; devise: string | null; test: boolean }` : l'upsert pose les détails quand ils sont
  fournis et garde ceux qui existent sinon (une expédition n'écrase rien).
- `detailsDeCommande(c: CommandeShopify, b: Pick<BoutiqueRecue, 'devise'>, maintenant: () => number): DetailsCommande`
  dans `attribution.ts` : la date de `processed_at` sinon la réception (comme l'attribution), `montantBoutique`, `c.test`.
- `attribuerCommande` écrit la commande dès que la fiche est connue, AVANT de chercher une source, et même si le montant
  est illisible (montant nul) ; ses deps prennent `store` (`lierCommande`). Toujours sous le budget de
  `attribuerSansFreiner`.
- `servir` passe les détails à `lierCommande` pour `order_paid` (la fiche née de la confirmation reçoit date et montant).
- `connecter` remet `commandes_depuis = now()` à chaque (re)branchement.
- `suiviSegments` lit `commandes_depuis`, `devise`, `coupee_le`.
- **Tests** : `tests/shopify-traitement.test.ts` (ou le fichier voisin qui teste `orders/paid`) : commande écrite sans
  message branché ; rien sans fiche ; commande de test écrite avec `test: true` ; fiche née de la confirmation complétée.
  `tests/integration/shopify-store.integration.test.ts` : upsert idempotent, paiement puis expédition et l'inverse,
  `connecter` remet la date, `suiviSegments` d'une boutique coupée rend sa date de coupure.

### Tâche 4 : la date de dernière activité

**Fichiers** : `src/inbox/store.pg.ts` (`recordInbound`), `src/links/tracked-links.pg.ts` (`recordClick`),
`src/crm/contact-store.pg.ts` (`purgeMany`).

- Message reçu : la fiche de la conversation (`conversations.contact_id`, même espace) prend `derniere_activite_le =
  now()`, dans la même instruction que l'insertion du message si la forme le permet (chemin de chaque message reçu). Une
  réaction compte.
- Clic avec un contact : même écriture, scopée par l'espace du lien. Sans contact, rien.
- La date ne recule jamais (`greatest`).
- `purgeMany` la remet à `null`.
- **Tests** : `tests/integration/` voisin de l'inbox : un message reçu date la bonne fiche et pas celle de l'autre
  espace au même numéro ; un clic aussi ; `tests/integration/purge-rgpd.integration.test.ts` vérifie la remise à nul.

### Tâche 5 : l'outil MCP

**Fichiers** : `src/mcp/cible.ts`, `src/mcp/outils-campagnes.ts`, `web/lib/mcp-outils.ts` (résumé FR et EN), puis
`cd web && npm run doc:md`.

- `CHAMPS_CIBLE_FILTRES` gagne `orders` et `spent` (`{ min, max, within_days }`), `days_since_last_order`
  (`{ min, max }`), `active_within_days`, `inactive_for_days` (entiers), `countries` (ISO alpha-2), bornes tirées de
  `BORNES_SEGMENTS`, `additionalProperties: false` sur les objets.
- `lireCibleMcp` les traduit en `ContactFilters` (refus `RefusOutil` avec la phrase de `FiltreContactInvalide`) ; un
  critère de commande sans boutique (`suiviSegments(...).boutique === null`) est refusé avec le renvoi vers
  `get_shopify_state`. `DepsCibleMcp.contacts` gagne `suiviSegments`.
- `find_contacts` : description réécrite (exemples, devise, commandes payées et de test, remboursements non déduits,
  ce qu'est une activité) ; chaque contact rendu porte `country` ; la réponse porte `orders_recorded_since` (et
  `shop_cut_at` d'une boutique coupée) si un critère de commande est posé, `activity_complete_since` si un critère
  d'activité l'est.
- Les outils de suppression ne changent pas (ils refusent toute clé inconnue).
- **Tests** : `tests/mcp-campagnes-cible.test.ts` : traduction des six paramètres, refus (bornes, min > max, pays
  inconnu, objet vide, commande sans boutique), `prepare_contacts_deletion` refuse `inactive_for_days`. Un test de
  schéma : chaque borne appliquée figure dans `CHAMPS_CIBLE_FILTRES`.

### Tâche 6 : la console

**Fichiers** : route `GET /tenants/:tenantId/contacts/segments` dans `src/http/import.ts` (garde du module, rend
`{ boutique: { devise, commandesDepuis, coupeeLe } | null, activiteCompleteDepuis }`) ; `web/lib/api.ts`
(`lireSegmentsContacts`) ; créer `web/components/FiltresAchatsActivite.tsx` ; brancher dans `ContactFilterPanel.tsx`.

- Partie « Achats et activité » : activité (tous / actif dans les N derniers jours / inactif depuis N jours) ; si une
  boutique est connue : commandes (au moins, au plus, sur N jours), dépense (au moins, au plus, devise de la boutique,
  sur N jours), dernière commande (il y a au moins, au plus N jours). Un critère déjà posé reste visible.
- **Rien n'est proposé si la route ne répond pas** (API plus ancienne) : c'est la garde contre l'audience élargie.
- **Tests** : `web/e2e/contact-filtre-achats.spec.ts` (route simulée : avec boutique, sans boutique, route en 404) ;
  suite web entière, `tests/web-vouvoiement.test.ts`, `tests/web-formes.test.ts`, `tests/scope-tenant.test.ts` (la route
  neuve y entre d'elle-même).

### Tâche 7 : la doc et la mise en production

- `features.md` (section des filtres de contacts et celle des campagnes depuis Claude) avec la fiche d'aide qui la cite
  et son empreinte dans le même commit ; `documentation.md` (les critères, les deux écritures nouvelles, ce que la purge
  efface) ; journal ; `todo.md` (point 1 retiré, suites : rattrapage Shopify, remboursements, inactivité des outils de
  suppression) ; `docs/prive/ESSAIS-REELS.md`.
- **Ordre** :
  1. Relecture indépendante du lot entier (tâches 1 à 6), correction des rouges.
  2. Commit A par plomberie sur `origin/main` : tâches 1 à 5, la route de la tâche 6, la doc. Annoncé aux sessions
     voisines ; CI lue job par job (`gh run view --json jobs`).
  3. `gh workflow run deploy-scaleway.yml --ref main -f migration=avant`, approuvé par Julien ; relecture en base point
     par point ; sonde du vrai code en lecture seule (`suiviSegments`, un `count` par critère sur l'espace de
     démonstration).
  4. Commit B : le panneau de la console (Vercel au push).
  5. `aide:charger` si la fiche a changé ; essai réel.
