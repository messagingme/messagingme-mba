import { describe, expect, it } from 'vitest';
import { correspond, grouperParJour, GROUPE_URGENTES } from '../web/lib/inbox-recherche';

const ligne = (o: Partial<Parameters<typeof correspond>[0]> & { id?: string } = {}) => ({
  id: 'c1', waId: '33612345678', profileName: 'Marie Dupont', lastPreview: 'Ma commande est arrivée', lastMessageAt: '2026-11-26T10:00:00Z', ...o,
});

describe('la loupe de l’Inbox (`correspond`)', () => {
  it('trouve par nom, sans casse', () => {
    expect(correspond(ligne(), 'dupont')).toBe(true);
    expect(correspond(ligne(), 'MARIE')).toBe(true);
    expect(correspond(ligne(), 'Durand')).toBe(false);
  });
  it('trouve par numéro tapé avec + et espaces', () => {
    expect(correspond(ligne(), '+33 6 12')).toBe(true);
    expect(correspond(ligne(), '06 99')).toBe(false);
  });
  it('trouve par le dernier message', () => {
    expect(correspond(ligne(), 'commande')).toBe(true);
  });
  it('un contact sans nom ni aperçu ne casse rien', () => {
    expect(correspond(ligne({ profileName: null, lastPreview: null }), 'marie')).toBe(false);
    expect(correspond(ligne({ profileName: null, lastPreview: null }), '345')).toBe(true);
  });
  it('vide ou blanc : tout correspond', () => {
    expect(correspond(ligne(), '   ')).toBe(true);
  });
});

describe('les jours de la liste (`grouperParJour`)', () => {
  it('un groupe par jour Paris, dans l’ordre reçu', () => {
    const g = grouperParJour([
      ligne({ id: 'a', lastMessageAt: '2026-11-26T09:00:00Z' }),
      ligne({ id: 'b', lastMessageAt: '2026-11-26T08:00:00Z' }),
      // 23 h 30 UTC le 25 = 0 h 30 le 26 à Paris : même jour que les deux premières.
      ligne({ id: 'c', lastMessageAt: '2026-11-25T23:30:00Z' }),
      ligne({ id: 'd', lastMessageAt: '2026-11-24T12:00:00Z' }),
    ], false);
    expect(g.map((x) => [x.cle, x.lignes.map((l) => l.id)])).toEqual([
      ['2026-11-26', ['a', 'b', 'c']],
      ['2026-11-24', ['d']],
    ]);
  });
  it('🔴 « À traiter » : les urgentes forment un premier groupe, sans revenir dans leur jour', () => {
    const lignes = [
      ligne({ id: 'u', lastMessageAt: '2026-11-20T12:00:00Z', urgente: true }),
      ligne({ id: 'n', lastMessageAt: '2026-11-26T12:00:00Z' }),
      ligne({ id: 'v', lastMessageAt: '2026-11-20T11:00:00Z' }),
    ];
    expect(grouperParJour(lignes, true).map((x) => [x.cle, x.lignes.map((l) => l.id)])).toEqual([
      [GROUPE_URGENTES, ['u']],
      ['2026-11-26', ['n']],
      ['2026-11-20', ['v']],
    ]);
    // Hors d'« À traiter », une urgente reste dans son jour.
    expect(grouperParJour(lignes, false)[0]!.cle).toBe('2026-11-20');
  });
});
