import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { DuplicateEmailError, PgUserStore, type EspaceNe } from '../src/user/store.pg';

/**
 * L'annonce d'un espace qui naît (Telegram en production) : après le COMMIT de sa transaction, jamais pour une
 * transaction annulée, et jamais au prix de l'inscription qu'elle suit.
 */
function fausseBase(o: { doublon?: boolean } = {}) {
  const journal: string[] = [];
  const pool = {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => ({
      query: async (sql: string) => {
        journal.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
        if (/from inscriptions_attente/i.test(sql)) {
          return { rows: [{ email: 'lien@b.fr', langue: 'fr', offre_pro: false, application: false, pub_fbc: null, pub_fbp: null }], rowCount: 1 };
        }
        // Le clic d'un lien relit, verrouillée, l'identité de l'adresse (lot identité C) : aucune ici, elle y naît.
        if (/from identities[\s\S]*for update/i.test(sql)) return { rows: [], rowCount: 0 };
        if (/from identities/i.test(sql)) return { rows: [{ id: 'ident-1' }], rowCount: 1 };
        if (/insert into tenants/i.test(sql)) return { rows: [{ id: 'tenant-neuf' }], rowCount: 1 };
        if (/insert into users/i.test(sql) && o.doublon) throw Object.assign(new Error('doublon'), { code: '23505' });
        if (/returning/i.test(sql)) return { rows: [{ id: 'u1' }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      },
      release: () => {},
    }),
  } as unknown as Pool;
  return { pool, journal };
}

/** Laisse partir l'annonce, posée hors du chemin de l'inscription. */
const apresLInscription = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('l’annonce d’un espace qui naît', () => {
  it('🔴 par Google ou par e-mail : annoncée une fois, après le commit, avec son nom, son adresse et son chemin', async () => {
    const b = fausseBase();
    const annonces: Array<{ espace: EspaceNe; apres: string[] }> = [];
    const store = new PgUserStore(b.pool, undefined, (espace) => { annonces.push({ espace, apres: [...b.journal] }); });

    await store.createTenantWithAdmin('Boulangerie', { email: 'a@b.fr', name: null, passwordHash: null }, 'claude_code');
    await apresLInscription();
    expect(annonces.map((a) => a.espace)).toEqual([
      { tenantId: 'tenant-neuf', nom: 'Boulangerie', email: 'a@b.fr', origine: 'claude_code', parGoogle: true },
    ]);
    expect(annonces[0]!.apres.at(-1)).toBe('commit');

    await store.createTenantWithAdmin('Fleuriste', { email: 'c@d.fr', name: null, passwordHash: 'h' });
    await apresLInscription();
    expect(annonces[1]!.espace).toMatchObject({ nom: 'Fleuriste', origine: 'console', parGoogle: false });
  });

  it('🔴 par le lien de l’e-mail : annoncée avec l’adresse de la demande', async () => {
    const b = fausseBase();
    const annonces: EspaceNe[] = [];
    const store = new PgUserStore(b.pool, undefined, (espace) => { annonces.push(espace); });
    const r = await store.confirmerInscription('jeton', { workspaceName: 'Garage', name: null, passwordHash: 'h' });
    await apresLInscription();
    expect(r.statut).toBe('cree');
    expect(annonces).toEqual([{ tenantId: 'tenant-neuf', nom: 'Garage', email: 'lien@b.fr', origine: 'console', parGoogle: false }]);
  });

  it('🔴 une transaction annulée (adresse déjà prise) n’annonce rien', async () => {
    const b = fausseBase({ doublon: true });
    const annonces: EspaceNe[] = [];
    const store = new PgUserStore(b.pool, undefined, (espace) => { annonces.push(espace); });
    await expect(store.createTenantWithAdmin('X', { email: 'a@b.fr', name: null, passwordHash: null })).rejects.toBeInstanceOf(DuplicateEmailError);
    expect((await store.confirmerInscription('jeton', { workspaceName: 'Y', name: null, passwordHash: 'h' })).statut).toBe('adresse_connue');
    await apresLInscription();
    expect(annonces).toEqual([]);
  });

  it('🔴 une annonce qui lève ou qui rejette ne fait pas échouer l’inscription', async () => {
    const leve = new PgUserStore(fausseBase().pool, undefined, () => { throw new Error('Telegram en panne'); });
    await expect(leve.createTenantWithAdmin('X', { email: 'a@b.fr', name: null, passwordHash: null })).resolves.toEqual({ tenantId: 'tenant-neuf', userId: 'u1' });
    const rejette = new PgUserStore(fausseBase().pool, undefined, async () => { throw new Error('Telegram en panne'); });
    expect((await rejette.confirmerInscription('jeton', { workspaceName: 'Y', name: null, passwordHash: 'h' })).statut).toBe('cree');
    await apresLInscription();
  });
});
