import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { nomDuDocument, recopierDocumentRecu, type DepsRecopie } from '../src/documents/recopie';
import { PgDocumentsContact } from '../src/documents/store.pg';
import { schemaChampsGroupes } from '../src/hubspot-workflow/champs';
import type { MagasinObjets } from '../src/lib/magasin-objets';

/**
 * LA RECOPIE DU PDF PROPRE AU CONTACT (lot B1 du plan `docs/superpowers/plans/2026-11-12-pdf-par-contact-hubspot.md`).
 * 🔴 L'adresse reçue est SIGNÉE et à courte vie : elle ne s'écrit jamais sur la fiche ni au journal ; la fiche reçoit le
 * code de la copie, ou rien.
 */
const URL_SIGNEE = 'https://f.hubspotusercontent-eu1.net/hubfs/1/Madame%20CORNU%20SOPHIE-MUTAC.pdf?Expires=1&Signature=SECRET';
const PDF = Buffer.from('%PDF-1.7 contenu');
const DECLARES = [{ key: 'hs_calc_document' }, { key: 'hs_contact_firstname' }];
const recus = (document: string) => schemaChampsGroupes.parse({ contact: { firstname: 'Sophie' }, calcules: { document } });

function deps(o: { telecharger?: DepsRecopie['telecharger']; deposer?: DepsRecopie['deposer'] } = {}) {
  const appels: string[] = [];
  const d: DepsRecopie = {
    telecharger: o.telecharger ?? (async (url) => { appels.push(`telecharger:${url}`); return { octets: PDF, mime: 'application/pdf' }; }),
    deposer: o.deposer ?? (async (e) => { appels.push(`deposer:${e.tenantId}/${e.waId}/${e.nom}`); return 'doc_abc'; }),
  };
  return { d, appels };
}

describe('nomDuDocument', () => {
  it('le nom d’origine lu dans l’adresse, décodé, sans la signature ; « document.pdf » sinon', () => {
    expect(nomDuDocument(URL_SIGNEE)).toBe('Madame CORNU SOPHIE-MUTAC.pdf');
    expect(nomDuDocument('https://exemple.fr/devis/42')).toBe('42.pdf');
    expect(nomDuDocument('https://exemple.fr/')).toBe('document.pdf');
    expect(nomDuDocument('pas une adresse')).toBe('document.pdf');
    expect(nomDuDocument('https://exemple.fr/a%2Fb%3A%22c.PDF')).toBe('abc.PDF');
  });
});

describe('recopierDocumentRecu', () => {
  it('🔴 l’adresse devient le CODE de la copie, rangée au numéro, avec le nom d’origine', async () => {
    const { d, appels } = deps();
    const r = await recopierDocumentRecu(d, 't1', '33600000001', recus(URL_SIGNEE), DECLARES);
    expect(r.calcules?.document).toBe('doc_abc');
    expect(r.contact).toEqual({ firstname: 'Sophie' });
    expect(appels).toEqual([`telecharger:${URL_SIGNEE}`, 'deposer:t1/33600000001/Madame CORNU SOPHIE-MUTAC.pdf']);
  });

  it('🔴 champ non déclaré dans l’espace, ou reçu vide : aucun téléchargement', async () => {
    const { d, appels } = deps();
    expect(await recopierDocumentRecu(d, 't1', '336', recus(URL_SIGNEE), [{ key: 'hs_contact_firstname' }])).toEqual(recus(URL_SIGNEE));
    expect(await recopierDocumentRecu(d, 't1', '336', recus(''), DECLARES)).toEqual(recus(''));
    const sans = schemaChampsGroupes.parse({ contact: { firstname: 'Sophie' } });
    expect(await recopierDocumentRecu(d, 't1', '336', sans, DECLARES)).toEqual(sans);
    expect(appels).toEqual([]);
  });

  it('🔴 un refus ou une panne RETIRE le champ (vide), et le journal ne porte jamais l’adresse signée', async () => {
    const lignes: string[] = [];
    const espion = vi.spyOn(console, 'error').mockImplementation((...a) => { lignes.push(a.join(' ')); });
    const espionW = vi.spyOn(console, 'warn').mockImplementation((...a) => { lignes.push(a.join(' ')); });
    const espionL = vi.spyOn(console, 'log').mockImplementation((...a) => { lignes.push(a.join(' ')); });
    try {
      const refus = deps({ telecharger: async () => ({ refus: 'le fichier n’est pas un document PDF' }) });
      expect((await recopierDocumentRecu(refus.d, 't1', '336', recus(URL_SIGNEE), DECLARES)).calcules?.document).toBe('');
      const panne = deps({ deposer: async () => { throw new Error('bucket muet'); } });
      expect((await recopierDocumentRecu(panne.d, 't1', '336', recus(URL_SIGNEE), DECLARES)).calcules?.document).toBe('');
      expect(lignes.length).toBeGreaterThanOrEqual(2);
      expect(lignes.join('\n')).not.toContain('Signature=SECRET');
      expect(lignes.join('\n')).not.toContain('hubspotusercontent');
    } finally {
      espion.mockRestore();
      espionW.mockRestore();
      espionL.mockRestore();
    }
  });
});

describe('PgDocumentsContact.deposer', () => {
  function fauxPool(deja: string | null) {
    const journal: string[] = [];
    const pool = {
      query: async (sql: string, params: unknown[] = []) => {
        const s = sql.replace(/\s+/g, ' ').trim();
        journal.push(s.startsWith('select') ? 'select' : `insert:${String(params[4])}`);
        if (s.startsWith('select')) return { rows: deja ? [{ code: deja }] : [], rowCount: deja ? 1 : 0 };
        return { rows: [], rowCount: 1 };
      },
    };
    return { pool: pool as unknown as Pool, journal };
  }

  it('🔴 l’objet est déposé AVANT la ligne, sous le préfixe de l’espace, et la ligne le nomme', async () => {
    const { pool, journal } = fauxPool(null);
    const magasin = { deposer: async (cle: string) => { journal.push(`objet:${cle}`); } } as unknown as MagasinObjets;
    const code = await new PgDocumentsContact(pool, magasin).deposer({ tenantId: 't1', waId: '336', nom: 'Devis.pdf', octets: PDF });
    expect(code).toMatch(/^doc_[0-9a-f]{32}$/);
    const cle = `tenants/t1/documents/${code}.pdf`;
    expect(journal).toEqual(['select', `objet:${cle}`, `insert:${cle}`]);
  });

  it('🔴 le même fichier déjà rangé (vivant, moins de 30 jours) rend son code sans rien redéposer', async () => {
    const { pool, journal } = fauxPool('doc_deja');
    const magasin = { deposer: async () => { journal.push('objet'); } } as unknown as MagasinObjets;
    expect(await new PgDocumentsContact(pool, magasin).deposer({ tenantId: 't1', waId: '336', nom: 'Devis.pdf', octets: PDF })).toBe('doc_deja');
    expect(journal).toEqual(['select']);
  });

  it('sans stockage d’objets, lève (l’appelant retire le champ)', async () => {
    const { pool } = fauxPool(null);
    await expect(new PgDocumentsContact(pool, null).deposer({ tenantId: 't1', waId: '336', nom: 'x.pdf', octets: PDF })).rejects.toThrow();
  });
});
