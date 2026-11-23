import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { PgShopifyStore, type DetailsCommande } from '../src/shopify/store.pg';
import { PgVentesStore } from '../src/shopify/ventes.pg';

/**
 * LES LIGNES DE COMMANDE, AU MIEUX (segments Shopify enrichis, lot 3). Deux contrats qu'aucune intégration ne peut
 * faire tomber : 🔴 une panne des lignes (la table pas encore créée, migration 0311 non bloquante) ne fait PAS échouer
 * `lierCommande` (sur le chemin de la confirmation, son erreur rendrait 503 à Shopify, qui rejouerait jusqu'au
 * désabonnement) ; 🔴 elle ne fait pas tomber l'onglet Shopify de la fiche, qui existait avant elles.
 */
const T = '5f0c1e2a-8b7d-4c3e-9a1f-2d6b7e8c9f01';
const ABSENTE = new Error('relation "shopify_commande_lignes" does not exist');

/** Un faux pool qui note chaque requête (son début) et répond, ou lève, selon son texte. */
function faux(reponses: Array<[RegExp, unknown[] | Error]>): { pool: Pool; requetes: string[] } {
  const requetes: string[] = [];
  const pool = {
    query: async (sql: string) => {
      requetes.push(sql.replace(/\s+/g, ' ').trim().slice(0, 60));
      for (const [motif, r] of reponses) {
        if (motif.test(sql)) {
          if (r instanceof Error) throw r;
          return { rows: r, rowCount: r.length };
        }
      }
      return { rows: [], rowCount: 1 };
    },
  } as unknown as Pool;
  return { pool, requetes };
}

const details = (o: Partial<DetailsCommande> = {}): DetailsCommande => ({
  payeeLe: new Date('2026-11-23T10:00:00Z'), montant: '30', devise: 'EUR', test: false,
  lignes: { lignes: [{ ligneId: '11', produitId: '8801', varianteId: '4601', sku: 'SER-30', titre: 'Sérum', varianteTitre: '30 ml', quantite: 2, carteCadeau: false }], tronquees: false },
  ...o,
});

describe('lierCommande écrit les lignes après la commande, au mieux', () => {
  it('la commande, puis ses lignes ; une commande tronquée lève son drapeau ; une expédition (sans détail) n’écrit aucune ligne', async () => {
    const f = faux([]);
    await new PgShopifyStore(f.pool, 'cle').lierCommande(T, '5001', null, 'c1', details({ lignes: { ...details().lignes!, tronquees: true } }));
    expect(f.requetes.map((r) => r.split(' ').slice(0, 3).join(' '))).toEqual([
      'insert into shopify_commandes', 'insert into shopify_commande_lignes', 'update shopify_commandes set',
    ]);
    const g = faux([]);
    await new PgShopifyStore(g.pool, 'cle').lierCommande(T, '5001', null, 'c1');
    expect(g.requetes).toHaveLength(1);
  });

  it('🔴 une panne des lignes ne fait pas échouer lierCommande : la commande reste notée', async () => {
    const f = faux([[/shopify_commande_lignes/, ABSENTE]]);
    await expect(new PgShopifyStore(f.pool, 'cle').lierCommande(T, '5001', null, 'c1', details())).resolves.toBeUndefined();
    expect(f.requetes[0]).toMatch(/^insert into shopify_commandes/);
    // Une panne de la commande, elle, remonte toujours : c'est l'appelant qui en décide.
    const g = faux([[/insert into shopify_commandes/, new Error('base indisponible')]]);
    await expect(new PgShopifyStore(g.pool, 'cle').lierCommande(T, '5001', null, 'c1', details())).rejects.toThrow('base indisponible');
  });
});

describe('l’onglet Shopify de la fiche et les lignes', () => {
  const lectures = (lignes: unknown[] | Error): Array<[RegExp, unknown[] | Error]> => [
    [/from contacts c/, [{ telephone: '+33600000001' }]],
    [/from shopify_boutiques/, [{ nom: 'Demo', domaine: 'demo.myshopify.com', devise: 'EUR', commandes_depuis: new Date('2026-11-01T00:00:00Z'), coupee_le: null }]],
    [/as commandes_test/, [{ commandes: 1, commandes_test: 0, depense: '30', derniere_le: new Date('2026-11-23T10:00:00Z') }]],
    [/group by v\.devise/, []],
    [/from shopify_commande_lignes/, lignes],
    [/lignes_tronquees/, []],
    [/left join ventes_attribuees/, [{ commande_id: '5001', payee_le: new Date('2026-11-23T10:00:00Z'), montant: '30', devise: 'EUR', test: false, source: null, campagne: null, preuve: null }]],
    [/from shopify_paniers/, []],
  ];

  it('chaque commande porte ses lignes', async () => {
    const f = faux(lectures([{ commande_id: '5001', titre: 'Sérum', variante_titre: '30 ml', sku: 'SER-30', quantite: 2, carte_cadeau: false }]));
    const a = await new PgVentesStore(f.pool).achatsDuContact(T, 'c1');
    expect(a?.commandes).toEqual([expect.objectContaining({
      commandeId: '5001', lignesTronquees: false, lignes: [{ titre: 'Sérum', varianteTitre: '30 ml', sku: 'SER-30', quantite: 2, carteCadeau: false }],
    })]);
  });

  it('🔴 une panne des lignes laisse l’onglet d’avant, sans lignes, jamais en erreur', async () => {
    const f = faux(lectures(ABSENTE));
    const a = await new PgVentesStore(f.pool).achatsDuContact(T, 'c1');
    expect(a?.commandes).toHaveLength(1);
    expect(a?.commandes[0]).not.toHaveProperty('lignes');
    expect(a?.resume.commandes).toBe(1);
  });
});
