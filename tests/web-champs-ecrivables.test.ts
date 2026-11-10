import { describe, expect, it } from 'vitest';
import { champsEcrivables } from '../web/lib/fields';

/**
 * Les champs qu'un bloc de scénario peut écrire (Julien, 2026-11-10 : « Mettre à jour un champ » ne proposait ni le
 * prénom ni le nom). Un champ socle n'existe dans `user_fields` qu'après sa première écriture : la liste doit le
 * proposer AVANT.
 */
const fr = (a: string) => a;

describe('champsEcrivables', () => {
  it('propose Prénom, Nom et Email sur un espace qui n’a encore aucun champ', () => {
    expect(champsEcrivables([], fr)).toEqual([
      { key: 'prenom', label: 'Prénom', type: 'text' },
      { key: 'nom_de_famille', label: 'Nom', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
    ]);
  });

  it('met les champs de l’espace après, et ne double pas un socle déjà créé', () => {
    const liste = champsEcrivables([
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'ville', label: 'Ville', type: 'text' },
    ], fr);
    expect(liste.map((f) => f.key)).toEqual(['prenom', 'nom_de_famille', 'email', 'ville']);
  });

  it('ne propose jamais le nom WhatsApp ni le téléphone, que la fiche ne range pas dans ses champs', () => {
    const cles = champsEcrivables([], fr).map((f) => f.key);
    expect(cles).not.toContain('name');
    expect(cles).not.toContain('phone');
  });

  it('un champ de l’espace au même libellé qu’un socle : le socle se distingue, jamais deux options identiques', () => {
    // Un formulaire réglé par défaut crée `nom`, libellé « Nom », à côté du socle `nom_de_famille` (relecture du 2026-11-10).
    const liste = champsEcrivables([{ key: 'nom', label: 'Nom', type: 'text' }], fr);
    expect(liste.map((f) => f.label)).toEqual(['Prénom', 'Nom (champ de base)', 'Email', 'Nom']);
    expect(new Set(liste.map((f) => f.label)).size).toBe(liste.length);
  });

  it('suit la langue de la console', () => {
    const en = (_fr: string, anglais: string) => anglais;
    expect(champsEcrivables([], en).map((f) => f.label)).toEqual(['First name', 'Last name', 'Email']);
  });
});
