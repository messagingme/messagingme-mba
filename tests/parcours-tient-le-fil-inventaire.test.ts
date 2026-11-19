import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parcoursTientLeFilSql, DELAI_PARCOURS_TIENT_LE_FIL_MS } from '../src/inbox/parcours-tient-le-fil';
import { config } from '../src/config';

/**
 * 🔴 L'INVENTAIRE DES PORTES QUI PEUVENT RETIRER LE FIL À UN SCÉNARIO (2026-11-19).
 *
 * La règle « un parcours tient le fil » a existé en trois copies divergentes, et la porte oubliée (un message du contact
 * pendant une Attente) ne se serait découverte qu'en essai client. Ce test énumère chaque geste du module du fil qui
 * écrit un détenteur autre que `app_workflow` (ou une passation de Meta), et exige qu'il soit CLASSÉ : une porte
 * AUTOMATIQUE doit appliquer la règle unique (`./parcours-tient-le-fil.ts`) ; un geste DÉLIBÉRÉ (un humain, le scénario
 * lui-même) ou la parole de Meta (`standby`) en sont exemptés, avec leur raison. Un geste neuf non classé est rouge :
 * c'est la question « doit-il respecter un parcours en cours ? » posée au moment de l'écrire.
 */
const RACINE = join(__dirname, '..');
const lire = (f: string): string => readFileSync(join(RACINE, f), 'utf8');

/** Les gestes du module, découpés sur leurs en-têtes : méthodes de l'objet rendu, et aides `const x = async`. */
function gestes(source: string): Map<string, string> {
  const lignes = source.split('\n');
  const debuts: Array<{ nom: string; ligne: number }> = [];
  lignes.forEach((l, i) => {
    const m = /^ {4}(?:async )?([a-zA-Z]+)\(/.exec(l) ?? /^ {2}const ([a-zA-Z]+) = async/.exec(l);
    if (m) debuts.push({ nom: m[1]!, ligne: i });
  });
  const parNom = new Map<string, string>();
  debuts.forEach((d, k) => parNom.set(d.nom, lignes.slice(d.ligne, debuts[k + 1]?.ligne ?? lignes.length).join('\n')));
  return parNom;
}

/** Les appels `depot.<nom>(...)` d'un geste, chacun en entier (parenthèses équilibrées, ternaires compris). */
function appels(corps: string, nom: string): string[] {
  const out: string[] = [];
  const motif = `depot.${nom}(`;
  for (let i = corps.indexOf(motif); i !== -1; i = corps.indexOf(motif, i + motif.length)) {
    let profondeur = 0;
    let j = i + motif.length - 1;
    for (; j < corps.length; j++) {
      if (corps[j] === '(') profondeur++;
      else if (corps[j] === ')' && --profondeur === 0) break;
    }
    out.push(corps.slice(i, j + 1));
  }
  return out;
}

/**
 * Un geste qui peut retirer le fil à `app_workflow` : il relaie une passation de Meta, ou il écrit un autre détenteur
 * sans qu'AUCUNE de ses gardes `only` ne l'exclue. Les noms des arguments et la forme des options (littéral, ternaire)
 * sont indifférents (relecture du 2026-11-19 : la première version ne voyait pas une écriture en ternaire).
 */
function retireLeFil(corps: string): boolean {
  if (appels(corps, 'marquerEscalade').length > 0) return true;
  for (const appel of appels(corps, 'setControlOwner')) {
    const cible = /^depot\.setControlOwner\(\s*[^,]+,\s*[^,]+,\s*([^,]+),/.exec(appel)?.[1]?.trim();
    if (cible === `'app_workflow'`) continue;
    const gardes = [...appel.matchAll(/only:\s*\[([^\]]*)\]/g)].map((m) => m[1]!);
    const excluTout = gardes.length > 0 && gardes.every((g) => !g.includes(`'app_workflow'`) && g.trim() !== 'detenteur');
    if (excluTout) continue;
    return true;
  }
  return false;
}

/** La classification : chaque geste qui peut retirer le fil, et pourquoi il respecte (ou non) la règle. */
const CLASSEMENT: Record<string, 'automatique' | 'deliberee' | 'parole-de-meta'> = {
  // Portes automatiques : la règle unique, obligatoire.
  remettreSiPersonneNeSuit: 'automatique', // un message que personne ne prend
  prendrePourLEquipe: 'automatique', // la campagne « devenir Inbox », le filet de l'agent de Meta
  rendreApresInactivite: 'automatique', // le balayage
  agentDeMetaPasseLaMain: 'automatique', // le `control_passed` de Meta (la règle vit dans `marquerEscalade`)
  // Gestes délibérés : un humain, ou le scénario lui-même, décide.
  rendre: 'deliberee', // « Rendre la main », par un opérateur ou HubSpot
  prisEnEcrivant: 'deliberee', // un opérateur répond dans l'Inbox
  reprendreLaMain: 'deliberee', // « Reprendre la main »
  rendreApresParcours: 'deliberee', // la fin du parcours lui-même
  passerAUnHumain: 'deliberee', // le bloc « Assigner à un agent », l'agent IA qui passe la main
  envoyerAuMba: 'deliberee', // le bloc « Envoyer au MBA »
  // La parole de Meta : son agent tient le fil chez lui, notre colonne suit la réalité.
  entrantEnStandby: 'parole-de-meta',
};

describe('« un parcours tient le fil » : l’inventaire des portes', () => {
  const fil = gestes(lire('src/inbox/fil.ts'));

  it('🔴 chaque geste qui peut retirer le fil à un scénario est classé, et aucun classement n’est mort', () => {
    const trouves = [...fil].filter(([, corps]) => retireLeFil(corps)).map(([nom]) => nom).sort();
    expect(trouves).toEqual(Object.keys(CLASSEMENT).sort());
  });

  it('🔴 chaque porte automatique du module du fil applique la règle unique', () => {
    for (const [nom, classe] of Object.entries(CLASSEMENT)) {
      if (classe !== 'automatique' || nom === 'agentDeMetaPasseLaMain') continue;
      expect({ nom, applique: /depot\.parcoursTientLeFil\(/.test(fil.get(nom)!) }).toEqual({ nom, applique: true });
    }
    // Les écritures des portes qui confient d'abord (le balayage, la prise par l'équipe) la rejouent aussi en écrivant.
    for (const nom of ['rendreApresInactivite', 'prendrePourLEquipe']) {
      expect({ nom, rejouee: /saufParcours: true/.test(fil.get(nom)!) }).toEqual({ nom, rejouee: true });
    }
  });

  it('🔴 les portes du dépôt (passation de Meta, balayage, écriture gardée, lecture) passent par la règle unique', () => {
    const store = lire('src/inbox/store.pg.ts');
    const corps = (debut: string): string => {
      const i = store.indexOf(debut);
      expect(i).toBeGreaterThan(-1);
      const fin = store.indexOf('\n  async ', i + debut.length);
      return store.slice(i, fin === -1 ? undefined : fin);
    };
    for (const m of ['async marquerEscalade(', 'async listHeldControl(', 'async setControlOwner(', 'async parcoursTientLeFil(']) {
      expect({ m, regle: corps(m).includes('parcoursTientLeFilSql(') }).toEqual({ m, regle: true });
    }
  });

  it('🔴 aucune copie de la règle ne survit hors du module : ni lecture de `workflow_runs` dans l’Inbox, ni `findWaitingByWaId`', () => {
    const dossier = join(RACINE, 'src/inbox');
    for (const f of readdirSync(dossier).filter((x) => x.endsWith('.ts'))) {
      const texte = readFileSync(join(dossier, f), 'utf8');
      if (f === 'parcours-tient-le-fil.ts') continue;
      expect({ f, lit: /from workflow_runs/.test(texte) }).toEqual({ f, lit: false });
      expect({ f, attente: /findWaitingByWaId\(/.test(texte) }).toEqual({ f, attente: false });
    }
  });

  it('le prédicat de statut est celui de l’index partiel `workflow_runs_actif_idx` (0115), écrit tel quel', () => {
    const migration = readdirSync(join(RACINE, 'db/migrations')).find((f) => f.startsWith('0115_'));
    expect(migration).toBeDefined();
    const index = /workflow_runs_actif_idx[\s\S]*?where (status in \([^)]*\))/.exec(lire(`db/migrations/${migration!}`));
    expect(index).not.toBeNull();
    expect(parcoursTientLeFilSql({ tenant: 't', waId: 'w', delaiMs: '1' })).toContain(`pr.${index![1]!}`);
  });

  it('le délai du balayage EST celui de la règle : deux nombres qui doivent rester égaux n’en font qu’un', () => {
    expect(config.CONTROL_WORKFLOW_TIMEOUT_MS).toBe(DELAI_PARCOURS_TIENT_LE_FIL_MS);
    expect(lire('src/config.ts')).toMatch(/CONTROL_WORKFLOW_TIMEOUT_MS: DELAI_PARCOURS_TIENT_LE_FIL_MS,/);
  });

  it('la marge du démarrage ne compte que les envois du scénario et des campagnes, jamais l’écho de l’agent de Meta', () => {
    const sql = parcoursTientLeFilSql({ tenant: 't', waId: 'w', delaiMs: '1' });
    expect(sql).toContain(`pm.origin in ('scenario', 'campagne')`);
    expect(sql).not.toContain('last_direction');
  });
});
