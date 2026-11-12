import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { champDEntete, POSITION_ENTETE } from '../src/documents/entete';
import { modelesPourLeContact } from '../src/http/hubspot-modeles';
import { parseParamHints, resolveHintParams } from '../src/crm/template';
import type { TemplateSummary } from '../src/meta/templates';

/**
 * L'EN-TÊTE DOCUMENT QUI VIENT DE LA FICHE (lot B2 du plan `docs/superpowers/plans/2026-11-12-pdf-par-contact-hubspot.md`).
 * 🔴 L'invariant : seul un SCÉNARIO envoie ce document. Partout ailleurs, le modèle partirait avec son fichier d'exemple,
 * un devis témoin : la carte HubSpot ne le propose pas, et la campagne directe et l'Inbox ne préparent pas son en-tête.
 */
const ZERO = { position: POSITION_ENTETE, source: { type: 'field' as const, key: 'hs_calc_document' } };
const PRENOM = { position: 1, source: { type: 'field' as const, key: 'prenom' } };

describe('la position 0', () => {
  it('lit le champ de l’en-tête, et seulement une source « champ »', () => {
    expect(champDEntete([PRENOM, ZERO])).toBe('hs_calc_document');
    expect(champDEntete([PRENOM])).toBeNull();
    expect(champDEntete([{ position: 0, source: { type: 'literal', value: 'x' } }])).toBeNull();
  });

  it('🔴 aucune résolution de variable ne la voit, et aucun lecteur qui revalide ne la rend', () => {
    expect(resolveHintParams([PRENOM, ZERO], 1, { fields: { prenom: 'Sophie', hs_calc_document: 'doc_x' } })).toEqual({ values: ['Sophie'], missing: [] });
    // `v1-catalogues` et `scenarios-api` revalident chaque source par `parseParamHints`, qui refuse la position 0.
    expect(parseParamHints([ZERO])).toBeNull();
  });
});

describe('la carte HubSpot', () => {
  const modele = (name: string): TemplateSummary => ({
    id: name, name, status: 'APPROVED', category: 'UTILITY', language: 'fr', body: 'Votre devis', headerFormat: 'DOCUMENT', headerMediaUrl: 'https://cdn.meta/devis-temoin.pdf', isCarousel: false, editable: true,
  });
  it('🔴 ne propose pas un modèle dont l’en-tête vient de la fiche ; les autres restent', () => {
    const proposes = modelesPourLeContact(
      [modele('devis_du_contact'), modele('plaquette')],
      [{ name: 'devis_du_contact', language: 'fr', ...ZERO }],
      { optIn: 'opted_in', fiche: { fields: {} } },
      new Date('2026-11-12T10:00:00Z'),
    );
    expect(proposes.map((m) => m.name)).toEqual(['plaquette']);
  });
});

describe('les câblages qui ne sont pas un scénario', () => {
  const texte = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  it('🔴 la campagne directe (worker) et l’Inbox (index) ne préparent pas un en-tête tiré de la fiche', () => {
    expect(texte('worker.ts')).toContain('if (champDEntete(await indicesDesModeles.get(tenant, name, language)) !== null) return { headerFormat: info.headerFormat, mediaId: null };');
    expect(texte('index.ts')).toContain('enteteDeLaFiche: async (tenant, name, language) => champDEntete(await templateHintStore.get(tenant, name, language)) !== null,');
  });
  it('🔴 l’envoi direct par la carte HubSpot refuse (422) un tel modèle', () => {
    expect(texte('http/hubspot-conversation.ts')).toContain("code: 'header_from_contact'");
  });
});
