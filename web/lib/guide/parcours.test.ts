import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PARCOURS, avancer, lireEtat, passageAtteint, surLaPage, type EtatGuide } from './parcours';

const WEB = resolve(__dirname, '..', '..');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' || n === '.next' || n === 'e2e' ? [] : sources(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [readFileSync(p, 'utf8')] : [];
  });
}
const CODE = [...sources(join(WEB, 'app')), ...sources(join(WEB, 'components'))].join('\n');

/** La cible est posée telle quelle, ou par un gabarit `prefixe-${...}` dont la suite est une clé écrite en clair. */
function cibleExiste(testid: string): boolean {
  if (CODE.includes(`data-testid="${testid}"`)) return true;
  for (const m of CODE.matchAll(/data-testid=\{`([a-z-]+)\$\{/g)) {
    const prefixe = m[1]!;
    if (testid.startsWith(prefixe) && CODE.includes(`'${testid.slice(prefixe.length)}'`)) return true;
  }
  return false;
}

const etat = (etape: number): EtatGuide => ({ parcours: 'agent', etape, replie: false, fini: false });
const rien = () => false;

describe('les parcours guidés (plan 2026-11-24-guide-demarrage, lot 3)', () => {
  it('🔴 chaque cible et chaque élément attendu existent dans la console : une refonte ne fait pas pointer dans le vide', () => {
    const mortes: string[] = [];
    for (const p of Object.values(PARCOURS)) {
      for (const e of p.etapes) {
        if (!cibleExiste(e.cible)) mortes.push(`${p.cle} : ${e.cible}`);
        if (e.passage.type === 'present' && !cibleExiste(e.passage.testid)) mortes.push(`${p.cle} : ${e.passage.testid}`);
      }
    }
    expect(mortes).toEqual([]);
  });

  it('chaque étape parle les deux langues, vouvoie et n’a pas de tiret long', () => {
    for (const p of Object.values(PARCOURS)) {
      for (const texte of [p.nom.fr, p.nom.en, p.fin.fr, p.fin.en, ...p.etapes.flatMap((e) => [e.titre.fr, e.titre.en, e.texte.fr, e.texte.en])]) {
        expect(texte.length).toBeGreaterThan(3);
        expect(texte).not.toMatch(/[–—]/);
        expect(texte).not.toMatch(/\b(tu|ton|ta|tes)\b/i);
      }
    }
  });

  it('l’agent IA : la liste, puis la fiche ouverte', () => {
    const [liste, fiche] = PARCOURS.agent.etapes;
    expect(surLaPage(liste!, '/agents')).toBe(true);
    expect(surLaPage(liste!, '/agents?id=a1&tab=construction')).toBe(false);
    expect(surLaPage(fiche!, '/agents?id=a1&tab=construction')).toBe(true);
    expect(surLaPage(fiche!, '/agents?tab=x&id=a1')).toBe(true);
    expect(surLaPage(fiche!, '/accueil')).toBe(false);
  });

  it('🔴 un agent déjà créé fait sauter « Créez votre agent », mais une étape qui explique attend « Suivant »', () => {
    expect(avancer(etat(0), '/agents?id=a1&tab=construction', rien).etape).toBe(1);
    expect(avancer(etat(0), '/agents', rien).etape).toBe(0);
    expect(avancer(etat(1), '/agents?id=a1&tab=construction', () => true).etape).toBe(1);
  });

  it('l’entretien fini (la proposition est là) fait passer à « Relisez, puis activez », qui attend le clic', () => {
    const present = (id: string) => id === 'setup-garder-activer';
    expect(avancer(etat(2), '/agents?id=a1', present).etape).toBe(3);
    expect(passageAtteint(PARCOURS.agent.etapes[3]!, '/agents?id=a1', present)).toBe(false);
  });

  it('un état stocké illisible ou d’un parcours inconnu ne lance rien ; une étape hors bornes est ramenée', () => {
    expect(lireEtat(null)).toBeNull();
    expect(lireEtat('pas du json')).toBeNull();
    expect(lireEtat(JSON.stringify({ parcours: 'inconnu', etape: 0 }))).toBeNull();
    expect(lireEtat(JSON.stringify({ parcours: 'agent', etape: 99 }))).toMatchObject({ etape: 3, replie: false, fini: false });
  });
});
