import { describe, it, expect } from 'vitest';
import { OUTILS, RefusOutil, outilsPour, type DepsMcp } from '../src/mcp/outils';
import { renommerEtiquette } from '../src/http/tags';
import type { UserFieldDef } from '../src/crm/types';

/**
 * LE MENU CONTENU ET LA CRÉATION D'UN CONTACT DEPUIS CLAUDE (lot 1 du CSM virtuel, B10, livraison 1a) : chaque outil
 * appelle la MÊME fonction que la route de la console (`modifierChamp`, `supprimerChamp`, `renommerEtiquette`,
 * `supprimerEtiquette`, `creerContactALaMain`), avec ses gardes. Les faux magasins sont des classes dont les méthodes
 * lisent `this`, comme les vrais (`PgUserFieldStore`, `PgTagStore`) : un appel détaché casserait ici. Chacun note
 * l'espace visé, que chaque écriture vérifie.
 */
const T = 't1';
const MOI = { userId: 'u1', autorisationId: 'aut-1' };
const outil = (nom: string) => {
  const o = OUTILS.find((x) => x.nom === nom);
  if (!o) throw new Error(`outil absent : ${nom}`);
  return o;
};

class FauxChamps {
  readonly modifies: Array<{ tenant: string; key: string; patch: unknown }> = [];
  readonly supprimes: Array<{ tenant: string; key: string }> = [];
  readonly materialises: Array<{ tenant: string; def: UserFieldDef }> = [];
  constructor(private readonly defs: UserFieldDef[]) {}
  async list(tenant: string): Promise<UserFieldDef[]> { return tenant === T ? [...this.defs] : []; }
  async create(): Promise<'created'> { return 'created'; }
  async updateField(tenant: string, key: string, patch: unknown): Promise<boolean> {
    this.modifies.push({ tenant, key, patch });
    return this.defs.some((c) => c.key === key);
  }
  async deleteField(tenant: string, key: string): Promise<boolean> {
    this.supprimes.push({ tenant, key });
    return this.defs.some((c) => c.key === key);
  }
  /** Ce que fait `ensureSocleField` en base : le champ de base absent devient une définition de l'espace. */
  materialiser(tenant: string, def: UserFieldDef): void {
    this.materialises.push({ tenant, def });
    this.defs.push(def);
  }
}

class FauxEtiquettes {
  readonly renommes: Array<{ tenant: string; de: string; vers: string }> = [];
  readonly retires: Array<{ tenant: string; tag: string }> = [];
  async listDistinct(tenant: string) {
    return tenant === T ? [{ tag: 'vip', count: 40, code: null }, { tag: 'salon', count: 0, code: 'tag_x' }] : [];
  }
  async rename(tenant: string, de: string, vers: string): Promise<number> { this.renommes.push({ tenant, de, vers }); return 40; }
  async remove(tenant: string, tag: string): Promise<number> { this.retires.push({ tenant, tag }); return 40; }
}

function monter(o: { creation?: Awaited<ReturnType<DepsMcp['createOneContact']>> } = {}) {
  const champs = new FauxChamps([{ key: 'ville', label: 'Ville', type: 'text' }, { key: 'panier', label: 'Panier', type: 'json' }]);
  const etiquettes = new FauxEtiquettes();
  const crees: Array<{ tenant: string; input: unknown }> = [];
  const audits: Array<{ tenant: string; userId: string | null; action: string; detail: unknown }> = [];
  const deps = {
    contacts: { fieldUsage: async (t: string) => (t === T ? { total: 12, parChamp: { ville: 5 } } : { total: 0, parChamp: {} }) },
    champs,
    socle: champs,
    /**
     * Une méthode qui lit `this`, comme une méthode de magasin : appelée hors de `deps` (détachée, ou recopiée dans
     * l'objet que l'outil passe à la fonction partagée), elle ne trouve plus `socle`, que seul `deps` porte, et casse.
     */
    async ensureSocleField(this: { socle: FauxChamps }, tenant: string, key: string, label: string, type: UserFieldDef['type']) {
      this.socle.materialiser(tenant, { key, label, type });
    },
    referentielEtiquettes: etiquettes,
    createOneContact: async (tenant: string, input: unknown) => {
      crees.push({ tenant, input });
      return o.creation ?? { status: 'created' as const, contactId: 'c-1' };
    },
    journal: async (tenant: string, acteur: { userId: string | null }, action: string, _cible: unknown, detail: unknown) => {
      audits.push({ tenant, userId: acteur.userId, action, detail });
    },
  } as unknown as DepsMcp;
  return { deps, champs, etiquettes, crees, audits };
}

describe('les outils du menu Contenu et la création d’un contact (CSM, B10, livraison 1a)', () => {
  it('🔴 chaque écriture est réservée à une personne : une clé d’API ne les voit pas, les lectures si', () => {
    const cle = outilsPour({ scopes: ['mcp:read', 'mcp:write'], personne: null }).map((o) => o.nom);
    for (const nom of ['update_field', 'delete_field', 'rename_tag', 'delete_tag', 'create_contact']) expect(cle, nom).not.toContain(nom);
    for (const nom of ['get_field_usage', 'list_tags']) expect(cle, nom).toContain(nom);
  });

  it('get_field_usage : combien de fiches ont chaque champ rempli, sur le total de l’espace', async () => {
    const { deps } = monter();
    expect(await outil('get_field_usage').executer(deps, T, {}, MOI)).toEqual({ total: 12, filled: { ville: 5 } });
  });

  it('🔴 update_field : ce qui est omis n’est pas touché ; les gardes de l’écran ; un champ système n’est pas un refus de droits', async () => {
    const { deps, champs } = monter();
    expect(await outil('update_field').executer(deps, T, { key: 'ville', label: 'Commune' }, MOI)).toEqual({ key: 'ville', label: 'Commune' });
    await expect(outil('update_field').executer(deps, T, { key: 'phone', label: 'X' }, MOI))
      .rejects.toMatchObject({ code: 'unsupported', message: expect.stringMatching(/champ système/) });
    await expect(outil('update_field').executer(deps, T, { key: 'ville', label: 'Nom' }, MOI)).rejects.toThrow(/champ de base/);
    await expect(outil('update_field').executer(deps, T, { key: 'panier', type: 'text' }, MOI)).rejects.toThrow(/JSON/);
    await expect(outil('update_field').executer(deps, T, { key: 'ville' }, MOI)).rejects.toThrow(/rien à mettre à jour/);
    await expect(outil('update_field').executer(deps, T, { key: 'inconnu', label: 'Y' }, MOI)).rejects.toMatchObject({ code: 'not_found' });
    // La borne annoncée (80 caractères) est appliquée, avant toute écriture.
    await expect(outil('update_field').executer(deps, T, { key: 'ville', label: 'x'.repeat(81) }, MOI)).rejects.toMatchObject({ code: 'invalid_args' });
    expect(champs.modifies).toEqual([
      { tenant: T, key: 'ville', patch: { label: 'Commune' } },
      { tenant: T, key: 'inconnu', patch: { label: 'Y' } },
    ]);
  });

  it('delete_field : la définition seule, dans l’espace visé ; un champ système est refusé (unsupported), un inconnu introuvable', async () => {
    const { deps, champs } = monter();
    expect(await outil('delete_field').executer(deps, T, { key: 'ville' }, MOI)).toEqual({ key: 'ville', deleted: true });
    await expect(outil('delete_field').executer(deps, T, { key: 'phone' }, MOI)).rejects.toMatchObject({ code: 'unsupported' });
    await expect(outil('delete_field').executer(deps, T, { key: 'inconnu' }, MOI)).rejects.toMatchObject({ code: 'not_found' });
    expect(champs.supprimes).toEqual([{ tenant: T, key: 'ville' }, { tenant: T, key: 'inconnu' }]);
  });

  it('list_tags, rename_tag, delete_tag : la liste avec ses comptes ; renommer vers le même nom est refusé ; l’espace visé', async () => {
    const { deps, etiquettes } = monter();
    expect(await outil('list_tags').executer(deps, T, {}, MOI)).toEqual({ tags: [{ tag: 'vip', contacts: 40 }, { tag: 'salon', contacts: 0 }] });
    expect(await outil('rename_tag').executer(deps, T, { from: ' vip ', to: 'VIP 2026' }, MOI)).toEqual({ renamed: 40 });
    await expect(outil('rename_tag').executer(deps, T, { from: 'vip', to: 'vip' }, MOI)).rejects.toThrow(/identiques/);
    expect(etiquettes.renommes).toEqual([{ tenant: T, de: 'vip', vers: 'VIP 2026' }]);
    expect(await outil('delete_tag').executer(deps, T, { tag: 'salon' }, MOI)).toEqual({ removed: 40 });
    expect(etiquettes.retires).toEqual([{ tenant: T, tag: 'salon' }]);
  });

  it('🔴 la route de renommage borne le nouveau nom à 64 caractères, comme toute pose', async () => {
    const etiquettes = new FauxEtiquettes();
    await renommerEtiquette(etiquettes, T, 'vip', `  ${'x'.repeat(70)}  `);
    expect(etiquettes.renommes).toEqual([{ tenant: T, de: 'vip', vers: 'x'.repeat(64) }]);
  });

  it('🔴 create_contact : les champs validés contre l’espace, l’accord dit, la trace au nom de la personne', async () => {
    const { deps, crees, audits } = monter();
    const r = await outil('create_contact').executer(deps, T, {
      phone: '+33612345678', name: 'Claire', fields: [{ key: 'ville', value: 'Lyon' }], tags: ['vip'], opt_in: true,
    }, MOI);
    expect(r).toEqual({ status: 'created', contact_id: 'c-1' });
    expect(crees).toEqual([{ tenant: T, input: { phone: '+33612345678', name: 'Claire', fields: { ville: 'Lyon' }, tags: ['vip'], optIn: true } }]);
    expect(audits).toEqual([{ tenant: T, userId: 'u1', action: 'contact.created', detail: { status: 'created', optIn: true } }]);
    // opt_in: false ne déclare rien ; un champ inconnu n'est jamais inventé ; une clé deux fois est refusée.
    await outil('create_contact').executer(deps, T, { phone: '+33612345679', opt_in: false }, MOI);
    expect((crees[1]!.input as { optIn: boolean }).optIn).toBe(false);
    await expect(outil('create_contact').executer(deps, T, { phone: '+33612345670', opt_in: true, fields: [{ key: 'inconnu', value: 'x' }] }, MOI))
      .rejects.toThrow(/champ inconnu/);
    await expect(outil('create_contact').executer(deps, T, { phone: '+33612345670', opt_in: true, fields: [{ key: 'ville', value: 'a' }, { key: 'ville', value: 'b' }] }, MOI))
      .rejects.toThrow(/deux fois/);
    expect(crees).toHaveLength(2);
  });

  it('🔴 create_contact : l’accord est obligatoire et booléen, chaque type et chaque borne annoncés sont appliqués', async () => {
    const { deps, crees } = monter();
    for (const args of [
      { phone: '+33612345678' }, // l'accord omis serait déclaré par défaut : refusé
      { phone: '+33612345678', opt_in: 'false' }, // une chaîne « false » vaudrait accord : refusée
      { phone: '0612345678', opt_in: true }, // sans indicatif : le format annoncé
      { phone: '+33612345678', opt_in: true, tags: [null] }, // une étiquette qui n'est pas un texte
      { phone: '+33612345678', opt_in: true, tags: ['x'.repeat(65)] },
      { phone: '+33612345678', opt_in: true, name: 'x'.repeat(121) },
    ]) {
      await expect(outil('create_contact').executer(deps, T, args, MOI), JSON.stringify(args)).rejects.toMatchObject({ code: 'invalid_args' });
    }
    expect(crees).toHaveLength(0);
  });

  it('create_contact : un champ de base absent (prénom) est matérialisé dans l’espace, puis écrit', async () => {
    const { deps, champs, crees } = monter();
    await outil('create_contact').executer(deps, T, { phone: '+33612345678', opt_in: true, fields: [{ key: 'prenom', value: 'Claire' }] }, MOI);
    expect(champs.materialises).toEqual([{ tenant: T, def: { key: 'prenom', label: 'Prénom', type: 'text' } }]);
    expect(crees[0]!.input).toMatchObject({ fields: { prenom: 'Claire' } });
  });

  it('🔴 create_contact : la limite de contacts de l’offre revient avec sa cause et le lien de l’offre', async () => {
    const { deps } = monter({ creation: { status: 'error', reason: 'limite de 100 contacts atteinte', limite: 100 } });
    const e = await outil('create_contact').executer(deps, T, { phone: '+33612345678', opt_in: true }, MOI).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RefusOutil);
    expect(e).toMatchObject({ message: expect.stringMatching(/limite de 100 contacts/), code: 'plan_limit', precisions: { cause: 'plan_limit_reached' } });
    expect((e as RefusOutil).precisions.action).toMatch(/\/offre/);
  });
});
