import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MAX_REPONSES_RAPIDES, MAX_TEXTE_REPONSE_RAPIDE, TEXTE_MAX_AVEC_FICHIER_OU_BOUTON, TEXTE_MAX_SIMPLE,
} from '../web/lib/partage/message-rapide';

const lire = (chemin: string): string => readFileSync(new URL(chemin, import.meta.url), 'utf8');

describe('les bornes du bloc « message rapide »', () => {
  it('sont celles de WhatsApp', () => {
    expect(MAX_REPONSES_RAPIDES).toBe(3);
    expect(MAX_TEXTE_REPONSE_RAPIDE).toBe(20);
    expect(TEXTE_MAX_AVEC_FICHIER_OU_BOUTON).toBe(1024);
    expect(TEXTE_MAX_SIMPLE).toBe(4096);
  });

  it('🔴 l’éditeur et le moteur les importent au lieu de les recopier', () => {
    // Une borne recopiée dérive : la console, le moteur et le compilateur de l'API doivent refuser la même chose.
    const panneau = lire('../web/components/WorkflowConfigPanel.tsx');
    expect(panneau).toContain("from '@/lib/partage/message-rapide'");
    expect(panneau).not.toMatch(/qr\.length < 3/);
    expect(panneau).not.toMatch(/\? 1024 : 4096/);
    expect(panneau).not.toMatch(/<ChampCompte value=\{r\} max=\{20\}/);
    const moteur = lire('../src/workflow/envois-bloc.ts');
    expect(moteur).not.toMatch(/TEXTE_MAX_AVEC_FICHIER_OU_BOUTON = 1024/);
    expect(moteur).toContain("web/lib/partage/message-rapide'");
  });
});
