import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OUTILS, outilsPour, RefusOutil, type DepsMcp } from '../src/mcp/outils';
import { CSM, T, WF, WF2, bloc, graphe, monter } from './mise-en-ligne-fixtures';

/**
 * LES OUTILS DU OUI DE MISE EN LIGNE ET DES VERSIONS (CSM, B2 et B3). `propose_go_live` prépare et rend le lien, au nom
 * d'une personne, sans rien publier ; `get_go_live` et `list_scenario_versions` lisent. 🔴 Et AUCUN outil ne clique :
 * `accepter` n'est appelé que par la route de la console, sous la session d'un admin.
 */
const outil = (nom: string) => OUTILS.find((o) => o.nom === nom)!;

function deps() {
  const m = monter();
  return { m, d: { misesEnLigne: m.deps } as unknown as DepsMcp };
}

describe('propose_go_live', () => {
  it('🔴 exige une personne : une clé d’API ne le voit pas', () => {
    const noms = (personne: typeof CSM | null) => outilsPour({ scopes: ['mcp:read', 'mcp:write'], personne }).map((o) => o.nom);
    expect(noms(null)).not.toContain('propose_go_live');
    expect(noms(CSM)).toContain('propose_go_live');
    expect(outil('propose_go_live').exigePersonne).toBe(true);
  });

  it('🔴 prépare, rend le lien de la page et le libellé, au nom de la personne, et ne publie RIEN', async () => {
    const { m, d } = deps();
    const r = await outil('propose_go_live').executer(d, T, { actions: [{ type: 'repondeur', scenario: WF }, { type: 'publier', scenario: WF }] }, CSM);
    expect(r).toMatchObject({ etat: 'proposee', libelle: 'Activer sur WhatsApp' });
    const { id, lien, consigne } = r as { id: string; lien: string; consigne: string };
    expect(lien).toMatch(new RegExp(`/mise-en-ligne\\?id=${id}$`));
    expect(consigne).toContain(lien);
    expect(outil('propose_go_live').ecran?.({}, r)).toBe(`/mise-en-ligne?id=${id}`);
    const gardee = m.store.lignes.get(id)!;
    expect([gardee.proposeePar, gardee.autorisationId]).toEqual([CSM.userId, CSM.autorisationId]);
    expect(m.publies).toEqual([]);
    expect(m.reglagesEcrits).toEqual([]);
  });

  it('refuse une action mal écrite, avec un code d’arguments', async () => {
    const { d } = deps();
    for (const actions of [
      [],
      [{ type: 'activer', scenario: WF }],
      [{ type: 'publier', scenario: WF, inconnu: 1 }],
      [{ type: 'restaurer', scenario: WF }],
      [{ type: 'repondeur', scenario: WF, delai_heures: 0 }],
      ['publier'],
    ]) {
      const p = outil('propose_go_live').executer(d, T, { actions }, CSM);
      await expect(p, JSON.stringify(actions)).rejects.toBeInstanceOf(RefusOutil);
      await expect(p).rejects.toMatchObject({ code: 'invalid_args' });
    }
  });

  it('le refus du cœur garde son code : un scénario sans brouillon est un conflit', async () => {
    const { d } = deps();
    await expect(outil('propose_go_live').executer(d, T, { actions: [{ type: 'publier', scenario: WF2 }] }, CSM))
      .rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('get_go_live et list_scenario_versions', () => {
  it('get_go_live rend l’état aux noms des outils, sans graphe', async () => {
    const { d } = deps();
    const r = await outil('propose_go_live').executer(d, T, { actions: [{ type: 'publier', scenario: WF }] }, CSM) as { id: string };
    const lu = await outil('get_go_live').executer(d, T, { id: r.id }, CSM);
    expect(lu).toMatchObject({ id: r.id, etat: 'proposee', libelle: 'Publier les modifications', acceptee_le: null });
    expect(JSON.stringify(lu)).not.toContain('graphe');
    await expect(outil('get_go_live').executer(d, T, { id: '99999999-9999-4999-8999-999999999999' }, CSM)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('list_scenario_versions : les plus récentes d’abord, la première en ligne ; un scénario d’ailleurs est inconnu', async () => {
    const { m, d } = deps();
    m.ajouterVersion(WF2, 1, graphe(bloc('x', 'Ancien')));
    m.ajouterVersion(WF2, 2, graphe(bloc('x', 'Salut')));
    const r = await outil('list_scenario_versions').executer(d, T, { scenario: WF2 }, CSM);
    expect(r).toMatchObject({ scenario: WF2, nom: 'Accueil' });
    expect((r as { versions: unknown[] }).versions).toEqual([
      { numero: 2, publiee_le: '2026-11-20T09:00:00.000Z', blocs: 1, en_ligne: true },
      { numero: 1, publiee_le: '2026-11-20T09:00:00.000Z', blocs: 1, en_ligne: false },
    ]);
    await expect(outil('list_scenario_versions').executer(d, 't2', { scenario: WF2 }, CSM)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('🔴 aucun outil ne clique', () => {
  it('`accepter` n’est importé que par la route de la console', () => {
    const fichiers: string[] = [];
    const parcourir = (dossier: string): void => {
      for (const nom of readdirSync(dossier)) {
        const chemin = join(dossier, nom);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (chemin.endsWith('.ts')) fichiers.push(chemin);
      }
    };
    parcourir('src');
    const importeurs = fichiers.filter((f) => {
      const texte = readFileSync(f, 'utf8');
      return /import\s*\{[^}]*\baccepter\b[^}]*\}\s*from\s*'[^']*mise-en-ligne\/mise-en-ligne'/.test(texte);
    }).map((f) => f.split('\\').join('/'));
    expect(importeurs).toEqual(['src/http/mises-en-ligne.ts']);
  });

  it('les outils de la mise en ligne : une proposition et deux lectures, rien d’autre', () => {
    const noms = OUTILS.filter((o) => /go_live|scenario_versions/.test(o.nom)).map((o) => [o.nom, o.scope]);
    expect(noms).toEqual([['list_scenario_versions', 'mcp:read'], ['propose_go_live', 'mcp:write'], ['get_go_live', 'mcp:read']]);
  });
});
