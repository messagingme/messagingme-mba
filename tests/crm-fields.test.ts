import { describe, it, expect } from 'vitest';
import {
  slugify, ensureField, ensureFieldByKey, isUserFieldType, validateFieldValue, canonicalizeFieldValue, MAX_OCTETS_CHAMP_JSON,
  jsonDeChamp, refusSaisieJson,
} from '../src/crm/fields';
import type { UserFieldStore } from '../src/crm/fields';
import type { UserFieldDef } from '../src/crm/types';

class FakeFieldStore implements UserFieldStore {
  private readonly byTenant = new Map<string, UserFieldDef[]>();
  async list(tenantId: string): Promise<UserFieldDef[]> {
    return this.byTenant.get(tenantId) ?? [];
  }
  async upsert(tenantId: string, def: UserFieldDef): Promise<void> {
    const arr = this.byTenant.get(tenantId) ?? [];
    arr.push(def);
    this.byTenant.set(tenantId, arr);
  }
}

describe('slugify', () => {
  it('minuscule, sans accents, séparateurs -> _', () => {
    expect(slugify('Prénom')).toBe('prenom');
    expect(slugify('Ville de résidence')).toBe('ville_de_residence');
    expect(slugify('N° commande !')).toBe('n_commande');
  });
  it('chaîne sans caractère alphanumérique -> "field"', () => {
    expect(slugify('!!!')).toBe('field');
    expect(slugify('')).toBe('field');
  });
});

describe('isUserFieldType', () => {
  it('valide les types connus', () => {
    expect(isUserFieldType('text')).toBe(true);
    expect(isUserFieldType('number')).toBe(true);
    expect(isUserFieldType('carotte')).toBe(false);
  });
});

describe('ensureField', () => {
  it('crée le champ une seule fois (idempotent sur la key)', async () => {
    const store = new FakeFieldStore();
    const a = await ensureField(store, 't1', 'Prénom');
    const b = await ensureField(store, 't1', 'prénom'); // même slug
    expect(a.key).toBe('prenom');
    expect(b.key).toBe('prenom');
    expect(await store.list('t1')).toHaveLength(1);
  });
  it('rejette un type invalide', async () => {
    const store = new FakeFieldStore();
    // @ts-expect-error test d'un type invalide au runtime
    await expect(ensureField(store, 't1', 'X', 'carotte')).rejects.toThrow(/type de champ invalide/);
  });

  it('COMPORTEMENT ASSUMÉ : deux labels de slug identique partagent la même def (dedup, 1er gagne)', async () => {
    const store = new FakeFieldStore();
    const a = await ensureField(store, 't1', 'Ville!');
    const b = await ensureField(store, 't1', 'Ville?'); // même slug 'ville'
    expect(a.key).toBe('ville');
    expect(b.label).toBe('Ville!'); // renvoie la def existante (pas de disambiguation)
    expect(await store.list('t1')).toHaveLength(1);
  });
});

describe('ensureFieldByKey', () => {
  it('idempotent PAR CLÉ : 2 appels, libellés différents -> 1 seule def (clé stable, 1er gagne)', async () => {
    const store = new FakeFieldStore();
    const a = await ensureFieldByKey(store, 't1', 'whatsapp_optin', 'Consentement WhatsApp', 'boolean');
    const b = await ensureFieldByKey(store, 't1', 'whatsapp_optin', 'Un autre libellé', 'boolean');
    expect(a.key).toBe('whatsapp_optin');
    expect(a.type).toBe('boolean');
    expect(b.label).toBe('Consentement WhatsApp'); // def existante conservée
    expect(await store.list('t1')).toHaveLength(1);
  });
  it('ne réécrit PAS un champ existant à cette clé (type conservé)', async () => {
    const store = new FakeFieldStore();
    await store.upsert('t1', { key: 'whatsapp_optin', label: 'Déjà là', type: 'text' });
    const def = await ensureFieldByKey(store, 't1', 'whatsapp_optin', 'X', 'boolean');
    expect(def.type).toBe('text'); // conservé, pas écrasé
    expect(await store.list('t1')).toHaveLength(1);
  });
  it('rejette un type invalide', async () => {
    const store = new FakeFieldStore();
    // @ts-expect-error type invalide au runtime
    await expect(ensureFieldByKey(store, 't1', 'k', 'L', 'carotte')).rejects.toThrow(/type de champ invalide/);
  });
});

describe('validateFieldValue', () => {
  it('booléen : accepte true/false/oui/non/1/0 (insensible à la casse), rejette le reste', () => {
    for (const v of ['true', 'FALSE', 'oui', 'Non', '1', '0']) expect(validateFieldValue('boolean', v)).toBe(true);
    expect(validateFieldValue('boolean', 'peut-être')).toBe(false);
    expect(validateFieldValue('boolean', '')).toBe(false);
  });
  it('number/date/url/text', () => {
    expect(validateFieldValue('number', '42.5')).toBe(true);
    expect(validateFieldValue('number', 'x')).toBe(false);
    expect(validateFieldValue('date', '2026-07-17')).toBe(true);
    expect(validateFieldValue('date', '17/07/2026')).toBe(false);
    expect(validateFieldValue('url', 'https://a.b')).toBe(true);
    expect(validateFieldValue('url', 'ftp://a')).toBe(false);
    expect(validateFieldValue('text', 'quoi que ce soit')).toBe(true);
    expect(validateFieldValue('text', '')).toBe(false);
  });

  it('datetime : ISO date+heure (murale ou absolue), rejette date nue / format libre', () => {
    expect(validateFieldValue('datetime', '2026-08-03T14:30')).toBe(true);          // datetime-local
    expect(validateFieldValue('datetime', '2026-08-03T14:30:00')).toBe(true);
    expect(validateFieldValue('datetime', '2026-08-03T12:30:00Z')).toBe(true);       // absolu (NOW)
    expect(validateFieldValue('datetime', '2026-08-03T14:30:00+02:00')).toBe(true);
    expect(validateFieldValue('datetime', '2026-08-03')).toBe(false);                // date nue = pas datetime
    expect(validateFieldValue('datetime', '03/08/2026 14:30')).toBe(false);
    expect(validateFieldValue('datetime', 'demain')).toBe(false);
  });
});

describe('canonicalizeFieldValue', () => {
  it('booléen -> true/false STRICT quel que soit le synonyme', () => {
    for (const v of ['true', 'oui', '1', 'OUI', ' True ']) expect(canonicalizeFieldValue('boolean', v)).toBe('true');
    for (const v of ['false', 'non', '0', 'NON', ' False ']) expect(canonicalizeFieldValue('boolean', v)).toBe('false');
  });
  it('booléen non reconnu -> renvoyé trimé tel quel (défensif, pas de throw)', () => {
    expect(canonicalizeFieldValue('boolean', ' bof ')).toBe('bof');
  });
  it('autres types -> identité (trim seulement), aucune régression', () => {
    expect(canonicalizeFieldValue('text', '  Paris ')).toBe('Paris');
    expect(canonicalizeFieldValue('number', ' 42 ')).toBe('42');
    expect(canonicalizeFieldValue('date', '2026-07-17')).toBe('2026-07-17');
    expect(canonicalizeFieldValue('url', ' https://a.b ')).toBe('https://a.b');
  });
});

/**
 * LE TYPE `json` (spec du 2026-11-11) : un JSON valide de 16 Ko au plus, compté en OCTETS UTF-8 de sa forme compacte, à
 * la place des 1 000 caractères des autres types ; stocké compact.
 */
describe('champ JSON : validation et forme stockée', () => {
  it('accepte un objet, une liste, une chaîne JSON, un nombre ; refuse un texte qui n’est pas du JSON', () => {
    for (const v of ['{"a":1}', '[1,2]', '"OK"', '42', 'null', '{ "a" : [ 1 ] }']) expect(validateFieldValue('json', v)).toBe(true);
    for (const v of ['OK', '{a:1}', '{"a":1', '']) expect(validateFieldValue('json', v)).toBe(false);
  });

  it('🔴 le plafond est de 16 384 octets de la forme compacte, pas 1 000 caractères', () => {
    // `"` + n caractères + `"` = n + 2 octets en ASCII.
    const ascii = (n: number): string => JSON.stringify('a'.repeat(n));
    expect(validateFieldValue('json', ascii(MAX_OCTETS_CHAMP_JSON - 2))).toBe(true);
    expect(validateFieldValue('json', ascii(MAX_OCTETS_CHAMP_JSON - 1))).toBe(false);
    // Un texte de 1 001 caractères reste refusé pour un champ texte : la borne des autres types n'a pas bougé.
    expect(validateFieldValue('text', 'a'.repeat(1001))).toBe(false);
  });

  it('🔴 un idéogramme compte pour ses OCTETS (3 en UTF-8), pas pour un caractère', () => {
    const n = Math.floor((MAX_OCTETS_CHAMP_JSON - 2) / 3);
    expect(validateFieldValue('json', JSON.stringify('漢'.repeat(n)))).toBe(true);
    expect(validateFieldValue('json', JSON.stringify('漢'.repeat(n + 1)))).toBe(false);
  });

  it('les espaces d’une forme indentée ne comptent pas : c’est la forme compacte qui se mesure et se stocke', () => {
    expect(canonicalizeFieldValue('json', '{ "a" : [ 1, 2 ] }')).toBe('{"a":[1,2]}');
    expect(jsonDeChamp('{\n  "a": 1\n}')).toBe('{"a":1}');
  });

  it('refusSaisieJson ne refuse que le type json', () => {
    expect(refusSaisieJson('json', 'Réponse')).toContain('Réponse');
    expect(refusSaisieJson('text', 'Ville')).toBeNull();
  });
});
