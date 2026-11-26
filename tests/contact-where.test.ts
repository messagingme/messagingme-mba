import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildContactWhere, buildBulkSelector } from '../src/crm/contact-store.pg';
import { PEREMPTION_WHATSAPP_MS } from '../web/lib/partage/joignabilite';
import { CLES_SEGMENT, filtreSegment } from '../web/lib/partage/segments';
import { ligneDansLaCollection, ligneVisee } from '../src/crm/segments';

// Fonctions PURES (aucune DB) : on vérifie le SQL + les params générés. C'est le GATE testable de la boucle
// mini-CRM (les nouveaux opérateurs de filtre + le sélecteur d'action en masse), sans toucher Postgres.

describe('buildContactWhere — base', () => {
  it('inclut TOUJOURS tenant_id = $1 ET deleted_at is null (anti-fuite + soft-delete)', () => {
    const { where, params } = buildContactWhere('t1', {});
    expect(where).toBe('tenant_id = $1 and deleted_at is null');
    expect(params).toEqual(['t1']);
  });
});

describe('buildContactWhere — opérateurs de champ', () => {
  it('empty : posé MÊME sans valeur (n\'est pas sauté), placeholder clé réutilisé (1 seul param)', () => {
    const { where, params } = buildContactWhere('t1', { fieldFilters: [{ key: 'email', op: 'empty', value: '' }] });
    expect(where).toContain("(fields ->> $2 is null or fields ->> $2 = '')");
    expect(params).toEqual(['t1', 'email']); // la clé est PARAMÉTRÉE, pas interpolée
  });

  it('not_empty : posé sans valeur', () => {
    const { where, params } = buildContactWhere('t1', { fieldFilters: [{ key: 'email', op: 'not_empty', value: '' }] });
    expect(where).toContain("(fields ->> $2 is not null and fields ->> $2 <> '')");
    expect(params).toEqual(['t1', 'email']);
  });

  it('not_contains : négation du ilike, clé + valeur paramétrées', () => {
    const { where, params } = buildContactWhere('t1', { fieldFilters: [{ key: 'ville', op: 'not_contains', value: 'paris' }] });
    expect(where).toContain("coalesce(fields ->> $2, '') not ilike '%' || $3 || '%'");
    expect(params).toEqual(['t1', 'ville', 'paris']);
  });

  it('contains : ilike positif', () => {
    const { where, params } = buildContactWhere('t1', { fieldFilters: [{ key: 'ville', op: 'contains', value: 'lyon' }] });
    expect(where).toContain("coalesce(fields ->> $2, '') ilike '%' || $3 || '%'");
    expect(params).toEqual(['t1', 'ville', 'lyon']);
  });

  it('eq : égalité stricte', () => {
    const { where, params } = buildContactWhere('t1', { fieldFilters: [{ key: 'segment', op: 'eq', value: 'vip' }] });
    expect(where).toContain('fields ->> $2 = $3');
    expect(params).toEqual(['t1', 'segment', 'vip']);
  });

  it('eq/contains/not_contains SANS valeur -> filtre non posé (sauté)', () => {
    for (const op of ['eq', 'contains', 'not_contains'] as const) {
      const { where, params } = buildContactWhere('t1', { fieldFilters: [{ key: 'x', op, value: '' }] });
      expect(where).toBe('tenant_id = $1 and deleted_at is null');
      expect(params).toEqual(['t1']);
    }
  });

  it('clé vide -> ignorée', () => {
    const { where } = buildContactWhere('t1', { fieldFilters: [{ key: '  ', op: 'not_empty', value: '' }] });
    expect(where).toBe('tenant_id = $1 and deleted_at is null');
  });

  it('la clé n\'est JAMAIS interpolée dans le SQL (injection)', () => {
    const evil = "x'); drop table contacts; --";
    const { where, params } = buildContactWhere('t1', { fieldFilters: [{ key: evil, op: 'not_empty', value: '' }] });
    expect(where).not.toContain('drop table');
    expect(params).toContain(evil); // la clé malveillante finit en paramètre, inoffensive
  });
});

describe('buildContactWhere — tags', () => {
  it('tagsExclude : « ne possède pas » -> not (tags && $)', () => {
    const { where, params } = buildContactWhere('t1', { tagsExclude: ['spam', 'junk'] });
    expect(where).toContain('not (tags && $2::text[])');
    expect(params).toEqual(['t1', ['spam', 'junk']]);
  });

  it('tags (@>) + tagsExclude cohabitent (2 clauses distinctes)', () => {
    const { where, params } = buildContactWhere('t1', { tags: ['vip'], tagsExclude: ['spam'] });
    expect(where).toContain('tags @> $2::text[]');
    expect(where).toContain('not (tags && $3::text[])');
    expect(params).toEqual(['t1', ['vip'], ['spam']]);
  });

  it('tagMode or -> && ; défaut -> @>', () => {
    expect(buildContactWhere('t1', { tags: ['a'], tagMode: 'or' }).where).toContain('tags && $2::text[]');
    expect(buildContactWhere('t1', { tags: ['a'] }).where).toContain('tags @> $2::text[]');
  });
});

describe('buildBulkSelector', () => {
  it('par ids : dédup + scope tenant + actif', () => {
    const { where, params } = buildBulkSelector('t1', { ids: ['a', 'b', 'a'] });
    expect(where).toBe('tenant_id = $1 and deleted_at is null and id = any($2::uuid[])');
    expect(params).toEqual(['t1', ['a', 'b']]);
  });

  it('ids vide -> where « false » (jamais un UPDATE global)', () => {
    const { where, params } = buildBulkSelector('t1', { ids: [] });
    expect(where).toBe('false');
    expect(params).toEqual([]);
  });

  it('par filtres SANS exclusion : identique à buildContactWhere', () => {
    const sel = buildBulkSelector('t1', { filters: { tags: ['vip'] } });
    const base = buildContactWhere('t1', { tags: ['vip'] });
    expect(sel).toEqual(base);
    expect(sel.where).toContain('deleted_at is null');
  });

  it('par filtres AVEC exclusion : ajoute un not (id = any($N))', () => {
    const { where, params } = buildBulkSelector('t1', { filters: { tags: ['vip'] }, excludeIds: ['x', 'y'] });
    expect(where).toContain('deleted_at is null');
    expect(where).toContain('and not (id = any($3::uuid[]))');
    expect(params).toEqual(['t1', ['vip'], ['x', 'y']]);
  });
});

/**
 * LE FILTRE DE JOIGNABILITÉ (migration 0133).
 *
 * 🔴 IL EXCLUT LES INJOIGNABLES **CONNUS**, JAMAIS LES INCONNUS. C'est la transposition en SQL du même
 * piège que `verdictWhatsApp` ferme côté code : traiter `null` comme `false` ferait sortir de l'audience
 * tout le parc jamais sollicité, c'est-à-dire la quasi-totalité des contacts d'un client qui démarre.
 * `is not false` laisse passer `null` ; `is not true` l'exclurait, et rien ne le signalerait.
 */
describe('buildContactWhere — joignabilité WhatsApp', () => {
  it('le filtre exclut les injoignables CONNUS, jamais les inconnus', () => {
    const { where } = buildContactWhere('t1', { joignabiliteWhatsApp: 'connu_injoignable' });
    expect(where).toContain('whatsapp_joignable is not false');
    // ⚠️ LA CLAUSE ENTIÈRE, PAS UN MORCEAU. Un `toContain` sur le seul premier terme laisse passer une
    // altération des deux autres : la clause est un OU à trois branches, et chacune garde une population
    // différente. Un sous-ensemble d'assertions sur un OU ne contraint presque rien.
    expect(where).toContain(
      "(whatsapp_joignable is not false or whatsapp_joignable_le is null"
      + " or whatsapp_joignable_le < now() - ($2::bigint * interval '1 millisecond'))",
    );
  });

  it('une mesure PÉRIMÉE laisse repasser le contact : le SQL dit la même chose que verdictWhatsApp', () => {
    const { where, params } = buildContactWhere('t1', { joignabiliteWhatsApp: 'connu_injoignable' });
    // 🔴 La péremption n'est pas un détail d'affichage : sans elle, le filtre exclurait pour toujours sur un
    // constat vieux de deux ans, alors que la fiche contact du même contact afficherait « Jamais testé ».
    expect(where).toContain('whatsapp_joignable_le is null');
    expect(where).toContain('whatsapp_joignable_le <');
    // Le seuil est PARAMÉTRÉ depuis la constante, jamais écrit « 90 days » en SQL : deux endroits qui portent
    // le même nombre, c'est un endroit qui finira par mentir.
    expect(params).toEqual(['t1', PEREMPTION_WHATSAPP_MS]);
  });

  it('absent -> aucune clause : le filtre ne s\'invite pas dans les requêtes qui ne le demandent pas', () => {
    expect(buildContactWhere('t1', {}).where).not.toContain('whatsapp_joignable');
  });
});

/**
 * LE FILTRE PAR NIVEAU DE RISQUE (lot 7 de l'API publique, spec § 19).
 *
 * 🔴 UN INDEX PARTIEL EST UN CONTRAT AVEC UNE REQUÊTE PRÉCISE. `contacts_tenant_risque_idx` (0178) porte
 * `(tenant_id, risque_niveau) where deleted_at is null` : le WHERE doit porter l'espace, le prédicat EXACT et une
 * égalité nue sur la seconde colonne. En sortir ne produit aucune erreur, seulement un balayage de la table des
 * contacts à chaque ouverture de la liste filtrée. Le second cas RELIT la migration plutôt que de recopier ses
 * colonnes : recopier déplacerait la dérive d'un fichier à l'autre.
 */
describe('buildContactWhere : risque de désengagement', () => {
  it('🔴 une égalité nue sur risque_niveau, PARAMÉTRÉE, derrière l’espace et deleted_at is null', () => {
    const { where, params } = buildContactWhere('t1', { risque: 'eleve' });
    expect(where).toBe('tenant_id = $1 and deleted_at is null and risque_niveau = $2');
    expect(params).toEqual(['t1', 'eleve']);
  });

  it('🔴 le WHERE tient le contrat de l’index de 0178 : ses deux colonnes et son prédicat', () => {
    const sql = readFileSync(new URL('../db/migrations/0178_risque_desengagement.sql', import.meta.url), 'utf8');
    const m = /create index concurrently if not exists contacts_tenant_risque_idx\s+on contacts \(([^)]*)\)\s+where ([^;]+);/.exec(sql);
    expect(m, 'l’index du filtre n’a pas été trouvé dans 0178 : ce test ne garde plus rien').not.toBeNull();
    const [col1, col2] = m![1]!.split(',').map((c) => c.trim());
    const predicat = m![2]!.trim();
    expect([col1, col2, predicat]).toEqual(['tenant_id', 'risque_niveau', 'deleted_at is null']);

    const clauses = buildContactWhere('t1', { risque: 'moyen', tags: ['vip'] }).where.split(' and ');
    expect(clauses).toContain(`${col1} = $1`);
    expect(clauses).toContain(predicat);
    expect(clauses.some((c) => new RegExp(`^${col2} = \\$\\d+$`).test(c)), clauses.join(' | ')).toBe(true);
  });

  it('absent -> aucune clause : une liste sans ce filtre ne lit pas la colonne', () => {
    expect(buildContactWhere('t1', {}).where).not.toContain('risque');
  });
});

describe('buildContactWhere : les filtres de la dernière analyse (lot 2b)', () => {
  it('🔴 une clé d’analyse va à SA colonne, jamais au jsonb, même si un champ perso homonyme existait', () => {
    const { where, params } = buildContactWhere('t1', {
      fieldFilters: [
        { key: 'analyse_sentiment', op: 'in', value: 'negatif' },
        { key: 'analyse_urgence', op: 'gte', value: '7' },
      ],
    });
    expect(where).toBe('tenant_id = $1 and deleted_at is null and analyse_sentiment = any($2::text[]) and analyse_urgence >= $3::int');
    expect(params).toEqual(['t1', ['negatif'], 7]);
    expect(where).not.toContain('fields');
  });

  it('une clé perso reste dans le jsonb, avec ses opérateurs texte', () => {
    const { where } = buildContactWhere('t1', { fieldFilters: [{ key: 'ville', op: 'eq', value: 'Paris' }] });
    expect(where).toContain('fields ->> $2 = $3');
  });

  it('🔴 un filtre qui n’a pas traversé la validation ne s’efface jamais : il vise « personne »', () => {
    // Deux chemins : une clé d'analyse mal formée, un opérateur de colonne sur un champ perso. Sauter la clause
    // rendrait l'espace entier à une campagne.
    for (const ff of [
      { key: 'analyse_urgence', op: 'gte' as const, value: 'beaucoup' },
      { key: 'ville', op: 'gte' as const, value: '3' },
    ]) {
      const { where, params } = buildContactWhere('t1', { fieldFilters: [ff] });
      expect(where, ff.key).toBe('tenant_id = $1 and deleted_at is null and false');
      expect(params).toEqual(['t1']);
    }
  });
});

/**
 * Les critères de segment (spec du 2026-10-31), dans `fieldFilters`. 🔴 Chaque sous-requête nomme `o.tenant_id = $1` :
 * le rôle de l'application contourne la RLS, ce filtre est le seul contrôle d'isolation. Les valeurs voyagent en
 * paramètres, jamais dans le texte, et une valeur qui ne se lit pas vise PERSONNE.
 */
describe('buildContactWhere : les critères de segment', () => {
  const S = CLES_SEGMENT;
  const ou = (...f: ReturnType<typeof filtreSegment>[]) => buildContactWhere('t1', { fieldFilters: f });
  const sousRequetes = (where: string): string[] => where.match(/select o\.contact_id from shopify_commandes o where [^)]*\)/g) ?? [];

  it('🔴 chaque sous-requête de commandes est scopée par l’espace', () => {
    const { where } = ou(filtreSegment(S.commandes, { min: 2, jours: 90 }), filtreSegment(S.depense, { max: 100 }), filtreSegment(S.derniereCommande, { min: 180 }));
    const sr = sousRequetes(where);
    expect(sr).toHaveLength(3);
    for (const s of sr) expect(s).toContain('o.tenant_id = $1');
    expect(where).toContain('b.tenant_id = $1');
    // Jamais le jsonb des champs perso pour une clé réservée.
    expect(where).not.toContain('fields ->>');
  });

  it('un minimum d’au moins une commande passe par « id in », un maximum seul par « id not in »', () => {
    const avec = ou(filtreSegment(S.commandes, { min: 2, max: 5, jours: 90 }));
    expect(avec.where).toContain('id in (select o.contact_id from shopify_commandes o where o.tenant_id = $1 and o.payee_le >= now() - $2::int');
    expect(avec.where).toContain('having count(*) >= $3::int and count(*) <= $4::int');
    expect(avec.params).toEqual(['t1', 90, 2, 5]);
    const sans = ou(filtreSegment(S.commandes, { max: 0 }));
    expect(sans.where).toContain('id not in (select o.contact_id from shopify_commandes o where o.tenant_id = $1 group by o.contact_id having count(*) > $2::int)');
    expect(sans.params).toEqual(['t1', 0]);
  });

  it('la dépense somme la devise de la boutique actuelle, en numérique', () => {
    const { where, params } = ou(filtreSegment(S.depense, { min: 49.9 }));
    expect(where).toContain('o.devise = coalesce((select b.devise from shopify_boutiques b where b.tenant_id = $1), o.devise)');
    expect(where).toContain('having coalesce(sum(o.montant), 0) >= $2::numeric');
    expect(params).toEqual(['t1', 49.9]);
  });

  it('la dernière commande exige une commande, bornée des deux côtés', () => {
    const { where, params } = ou(filtreSegment(S.derniereCommande, { min: 30, max: 180 }));
    expect(where).toContain('having max(o.payee_le) <= now() - $2::int');
    expect(where).toContain('and max(o.payee_le) >= now() - $3::int');
    expect(params).toEqual(['t1', 30, 180]);
  });

  it('actif exclut le jamais actif, inactif l’inclut', () => {
    expect(ou(filtreSegment(S.actif, 7)).where).toContain("derniere_activite_le >= now() - $2::int * interval '1 day'");
    expect(ou(filtreSegment(S.inactif, 90)).where)
      .toContain("(derniere_activite_le is null or derniere_activite_le < now() - $2::int * interval '1 day')");
  });

  it('les pays deviennent des préfixes paramétrés, dédupliqués (US et CA partagent +1)', () => {
    const { where, params } = ou(filtreSegment(S.pays, ['US', 'CA', 'BE']));
    expect(where).toContain('(phone_e164 like $2 or phone_e164 like $3)');
    expect(params).toEqual(['t1', '+1%', '+32%']);
  });

  it('🔴 une valeur qui ne se lit pas ou ne pose rien vise personne, jamais tout l’espace', () => {
    for (const f of [
      { key: S.pays, op: 'segment' as const, value: '["XX"]' }, { key: S.commandes, op: 'segment' as const, value: '{pas du json' },
      { key: S.commandes, op: 'segment' as const, value: '{}' }, { key: S.actif, op: 'segment' as const, value: '"30"' },
      { key: S.commandes, op: 'segment' as const, value: '{"min":0}' }, { key: S.depense, op: 'segment' as const, value: '{"min":-5}' },
    ]) {
      expect(buildContactWhere('t1', { fieldFilters: [f] }).where.split(' and '), f.value).toContain('false');
    }
  });
});

/**
 * LES CRITÈRES PRODUIT EN SQL (segments Shopify enrichis, lot 3). 🔴 Chaque sous-requête nomme l'espace sur les deux
 * tables ; 🔴 le prédicat des index partiels de la migration 0311 est repris mot pour mot ; une carte cadeau n'entre
 * jamais ; une valeur qui ne se lit pas vise PERSONNE.
 */
describe('buildContactWhere : les critères produit', () => {
  const S = CLES_SEGMENT;
  const ou = (...f: ReturnType<typeof filtreSegment>[]) => buildContactWhere('t1', { fieldFilters: f });
  const sousRequetes = (where: string): string[] => where.match(/select o\.contact_id from shopify_commande_lignes l/g) ?? [];

  it('🔴 « a acheté » : TOUS les produits, une sous-requête chacun, jointes par « and », scopées deux fois', () => {
    const { where, params } = ou(filtreSegment(S.achete, { produits: [{ produit: '8801' }, { sku: 'SER-30' }], jours: 90 }));
    const compact = where.replace(/\s+/g, ' ');
    expect(sousRequetes(compact)).toHaveLength(2);
    expect(compact.match(/where l\.tenant_id = \$1 and o\.tenant_id = \$1 and /g)).toHaveLength(2);
    expect(compact).toContain('(l.produit_id = $2 and l.produit_id is not null and not l.carte_cadeau) and o.payee_le >= now() - $3::int');
    expect(compact).toContain('(l.sku = $4 and l.sku is not null and not l.carte_cadeau) and o.payee_le >= now() - $5::int');
    expect(compact).toMatch(/\) and id in \(select o\.contact_id from shopify_commande_lignes/);
    expect(params).toEqual(['t1', '8801', 90, 'SER-30', 90]);
  });

  it('🔴 « n’a pas acheté » : AUCUN des produits, une seule sous-requête « not in », les produits en « or »', () => {
    const { where, params } = ou(filtreSegment(S.achete, { produits: [{ sku: 'A' }] }), filtreSegment(S.pasAchete, { produits: [{ produit: '9' }, { sku: 'B' }] }));
    const compact = where.replace(/\s+/g, ' ');
    expect(compact).toContain('id not in (select o.contact_id from shopify_commande_lignes l');
    expect(compact).toContain('((l.produit_id = $3 and l.produit_id is not null and not l.carte_cadeau) or (l.sku = $4 and l.sku is not null and not l.carte_cadeau))');
    expect(params).toEqual(['t1', 'A', '9', 'B']);
  });

  it('le réassort exige un achat connu de CE produit, son dernier achat borné des deux côtés', () => {
    const { where, params } = ou(filtreSegment(S.reassort, { sku: 'SER-30', min: 60, max: 120 }));
    const compact = where.replace(/\s+/g, ' ');
    expect(compact).toContain('id in (select o.contact_id from shopify_commande_lignes l');
    expect(compact).toContain('group by o.contact_id having max(o.payee_le) <= now() - $3::int');
    expect(compact).toContain('and max(o.payee_le) >= now() - $4::int');
    expect(params).toEqual(['t1', 'SER-30', 60, 120]);
  });

  it('🔴 le prédicat des index partiels de la migration 0311 est repris mot pour mot par chaque requête', () => {
    const sql = readFileSync(new URL('../db/migrations/0311_shopify_commande_lignes.sql', import.meta.url), 'utf8');
    const predicats = [...sql.matchAll(/on shopify_commande_lignes \(tenant_id, (\w+)\)\s+where ([^;]+);/g)].map((m) => [m[1], m[2]!.trim()] as const);
    expect(predicats).toEqual([['produit_id', 'produit_id is not null and not carte_cadeau'], ['sku', 'sku is not null and not carte_cadeau']]);
    let n = 1;
    const add = (): string => `$${++n}`;
    for (const [colonne, predicat] of predicats) {
      const visee = ligneVisee(colonne === 'produit_id' ? { produit: '1' } : { sku: 'A' }, add).replaceAll('l.', '');
      expect(visee, colonne).toContain(predicat);
    }
  });

  it('🔴 une valeur produit qui ne se lit pas vise personne, jamais tout l’espace', () => {
    for (const f of [
      { key: S.achete, op: 'segment' as const, value: '{"produits":[]}' }, { key: S.achete, op: 'segment' as const, value: '{pas du json' },
      { key: S.pasAchete, op: 'segment' as const, value: '{"produits":[{"x":1}]}' }, { key: S.reassort, op: 'segment' as const, value: '{"sku":"A"}' },
      { key: S.reassort, op: 'segment' as const, value: '{"min":3}' },
    ]) {
      expect(buildContactWhere('t1', { fieldFilters: [f] }).where.split(' and '), f.value).toContain('false');
    }
  });
});

/**
 * LE CRITÈRE DE COLLECTION EN SQL (segments Shopify enrichis, lot 6a). 🔴 Chaque sous-requête nomme l'espace sur les TROIS
 * tables (lignes, commandes, collections des produits) ; 🔴 le prédicat de l'index partiel des produits (migration 0311) est
 * repris mot pour mot ; CHACUNE des collections a sa sous-requête, jointes par « and » ; une carte cadeau n'entre jamais ;
 * une valeur qui ne se lit pas vise PERSONNE.
 */
describe('buildContactWhere : le critère de collection', () => {
  const S = CLES_SEGMENT;
  const ou = (...f: ReturnType<typeof filtreSegment>[]) => buildContactWhere('t1', { fieldFilters: f });

  it('🔴 CHACUNE des collections : une sous-requête chacune, jointes par « and », l’espace nommé sur les trois tables', () => {
    const { where, params } = ou(filtreSegment(S.collection, { collections: ['4401', '4402'], jours: 90 }));
    const compact = where.replace(/\s+/g, ' ');
    expect(compact.match(/select o\.contact_id from shopify_commande_lignes l/g)).toHaveLength(2);
    expect(compact.match(/where l\.tenant_id = \$1 and o\.tenant_id = \$1 and /g)).toHaveLength(2);
    expect(compact.match(/from shopify_produit_collections pc where pc\.tenant_id = \$1 and pc\.collection_id = \$\d+/g)).toHaveLength(2);
    expect(compact).toContain('(l.produit_id is not null and not l.carte_cadeau and l.produit_id in (select pc.produit_id from shopify_produit_collections pc where pc.tenant_id = $1 and pc.collection_id = $2)) and o.payee_le >= now() - $3::int');
    expect(compact).toMatch(/\) and id in \(select o\.contact_id from shopify_commande_lignes/);
    expect(params).toEqual(['t1', '4401', 90, '4402', 90]);
  });

  it('🔴 le prédicat de l’index partiel des produits (0311) est repris, l’index (tenant_id, collection_id) de 0314 sert la sous-requête', () => {
    const sql0311 = readFileSync(new URL('../db/migrations/0311_shopify_commande_lignes.sql', import.meta.url), 'utf8');
    const predicat = /on shopify_commande_lignes \(tenant_id, produit_id\)\s+where ([^;]+);/.exec(sql0311)![1]!.trim();
    expect(ligneDansLaCollection('4401', () => '$9').replaceAll('l.', '')).toContain(predicat);
    const sql0314 = readFileSync(new URL('../db/migrations/0314_shopify_collections.sql', import.meta.url), 'utf8');
    expect(sql0314).toContain('on shopify_produit_collections (tenant_id, collection_id);');
    expect(ligneDansLaCollection('4401', () => '$9')).toContain('where pc.tenant_id = $1 and pc.collection_id = $9');
  });

  it('🔴 une valeur de collection qui ne se lit pas vise personne, jamais tout l’espace', () => {
    for (const value of ['{"collections":[]}', '{pas du json', '{"collections":["Été"]}', '{"collections":[4401]}', '["4401"]', '{"jours":3}']) {
      expect(buildContactWhere('t1', { fieldFilters: [{ key: S.collection, op: 'segment', value }] }).where.split(' and '), value).toContain('false');
    }
  });
});

/**
 * LES DEUX BOUTONS PRÊTS EN SQL (segments Shopify enrichis, lot 4) : la date du geste non nulle, et aucune commande
 * enregistrée pour la fiche DANS L'ESPACE (🔴 la sous-requête nomme `$1`), sans fenêtre de jours. Une valeur autre que
 * `true` vise PERSONNE.
 */
describe('buildContactWhere : les boutons « sans commander »', () => {
  const S = CLES_SEGMENT;
  const ou = (...f: ReturnType<typeof filtreSegment>[]) => buildContactWhere('t1', { fieldFilters: f });

  it('🔴 « a écrit sans commander » : une réponse connue, aucune commande de l’espace', () => {
    const { where, params } = ou(filtreSegment(S.ecritSansCommande, true));
    expect(where.replace(/\s+/g, ' '))
      .toContain('(derniere_reponse_le is not null and id not in (select o.contact_id from shopify_commandes o where o.tenant_id = $1))');
    expect(params).toEqual(['t1']);
  });

  it('🔴 « a cliqué sans commander » : un clic attribué connu, aucune commande de l’espace', () => {
    const { where } = ou(filtreSegment(S.clicSansCommande, true));
    expect(where.replace(/\s+/g, ' '))
      .toContain('(dernier_clic_le is not null and id not in (select o.contact_id from shopify_commandes o where o.tenant_id = $1))');
  });

  it('🔴 une valeur autre que true vise personne, jamais tout l’espace', () => {
    for (const value of ['false', '{}', '1', '"true"', '{pas du json']) {
      for (const key of [S.ecritSansCommande, S.clicSansCommande]) {
        expect(buildContactWhere('t1', { fieldFilters: [{ key, op: 'segment', value }] }).where.split(' and '), `${key} ${value}`).toContain('false');
      }
    }
  });
});

/**
 * LE RAPPORT À LA DERNIÈRE ANALYSE (segments Shopify enrichis, lot 7b) : la dernière commande payée face à `analyse_le`.
 * Le comportement est éprouvé sur Postgres (`tests/integration/segments.integration.test.ts`).
 */
describe('buildContactWhere : la commande et la dernière analyse (lot 7b)', () => {
  const S = CLES_SEGMENT;
  const clause = (v: string) => buildContactWhere('t1', { fieldFilters: [filtreSegment(S.commandeVsAnalyse, v as 'aucune_apres')] });
  const fiches = 'join contacts a on a.id = o.contact_id and a.tenant_id = $1 and a.analyse_fenetre_fin is not null';
  const apres = `select o.contact_id from shopify_commandes o ${fiches} where o.tenant_id = $1 and o.payee_le > a.analyse_fenetre_fin`;

  it('🔴 les trois valeurs, au DERNIER MESSAGE analysé (jamais au passage du job), dans l’espace, sans corréler la requête principale', () => {
    expect(clause('aucune_apres').where.replace(/\s+/g, ' ')).toContain(`(analyse_fenetre_fin is not null and id not in (${apres}))`);
    expect(clause('commande_apres').where.replace(/\s+/g, ' ')).toContain(`id in (${apres})`);
    expect(clause('analyse_apres_commande').where.replace(/\s+/g, ' ')).toContain(
      `id in (select o.contact_id from shopify_commandes o ${fiches} where o.tenant_id = $1 group by o.contact_id, a.analyse_fenetre_fin having max(o.payee_le) <= a.analyse_fenetre_fin)`,
    );
    expect(clause('commande_apres').params).toEqual(['t1']);
  });

  it('🔴 une autre valeur vise personne, jamais tout l’espace', () => {
    for (const value of ['"toutes"', '""', 'true', '{}', '{pas du json']) {
      expect(buildContactWhere('t1', { fieldFilters: [{ key: S.commandeVsAnalyse, op: 'segment', value }] }).where.split(' and '), value).toContain('false');
    }
  });
});
