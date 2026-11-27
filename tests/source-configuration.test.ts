import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  preparerCreationSource,
  preparerPatchSource,
} from '../src/agent/source-configuration';

describe('contrat commun des sources d outils', () => {
  it.each([
    'http://api.client.fr/v1',
    'https://localhost/v1',
    'https://127.0.0.1/v1',
    'https://169.254.169.254/latest',
    'https://mba-api.internal/v1',
    'pas une url',
  ])('refuse l adresse non publique ou non HTTPS %s', (baseUrl) => {
    expect(preparerCreationSource({ baseUrl, authKind: 'none' })).toMatchObject({
      ok: false,
      motif: 'adresse_refusee',
      erreur: 'adresse refusée : elle doit être publique et en HTTPS',
    });
  });

  it('rend le même contrat d authentification aux connecteurs HTTP et MCP', () => {
    expect(preparerCreationSource({
      baseUrl: 'https://api.client.fr/v1', authKind: 'bearer',
    })).toMatchObject({ ok: false, motif: 'secret_requis' });

    expect(preparerCreationSource({
      baseUrl: 'https://api.client.fr/v1', authKind: 'header', authSecret: 'jeton',
    })).toMatchObject({ ok: false, motif: 'entete_requis' });

    expect(preparerCreationSource({
      baseUrl: 'https://api.client.fr/v1', authKind: 'header',
      authHeaderName: 'X-Api-Key', oauth: null, authSecret: 'jeton',
    })).toEqual({ ok: true, hote: 'api.client.fr' });
  });

  it('calcule le PATCH sur l état effectif sans exiger de renvoyer le secret', () => {
    const actuelle = {
      baseUrl: 'https://api.client.fr/v1',
      authKind: 'none' as const,
      authHeaderName: null, oauth: null,
      aAuthentification: true,
      status: 'active' as const,
    };

    expect(preparerPatchSource(actuelle, { authKind: 'bearer' })).toEqual({
      ok: true,
      authKind: 'bearer',
      adresseChangee: false,
    });

    expect(preparerPatchSource({ ...actuelle, aAuthentification: false }, { authKind: 'bearer' }))
      .toMatchObject({ ok: false, motif: 'secret_requis' });
  });

  it('🔴 la clé peut attendre tant que le système n’est pas actif (déclaré depuis Claude, B10, livraison 4a, 0331)', () => {
    // À la création, seulement quand la route le dit (un connecteur HTTP naît en brouillon) ; sans l'option, exigée.
    expect(preparerCreationSource({ baseUrl: 'https://api.client.fr/v1', authKind: 'bearer' }, { cleDifferee: true }))
      .toEqual({ ok: true, hote: 'api.client.fr' });
    expect(preparerCreationSource({ baseUrl: 'https://api.client.fr/v1', authKind: 'bearer' })).toMatchObject({ ok: false, motif: 'secret_requis' });
    // La structure, elle, ne s'attend pas.
    expect(preparerCreationSource({ baseUrl: 'https://api.client.fr/v1', authKind: 'header' }, { cleDifferee: true }))
      .toMatchObject({ ok: false, motif: 'entete_requis' });
    const brouillon = {
      baseUrl: 'https://api.client.fr/v1', authKind: 'bearer' as const, authHeaderName: null, oauth: null,
      aAuthentification: false, status: 'draft' as const,
    };
    expect(preparerPatchSource(brouillon, {}).ok).toBe(true);
    // S'activer sans sa clé : refusé ; la clé et l'activation dans le même geste : accepté.
    expect(preparerPatchSource(brouillon, { status: 'active' })).toMatchObject({ ok: false, motif: 'secret_requis' });
    expect(preparerPatchSource(brouillon, { status: 'active', authSecret: 'jeton' }).ok).toBe(true);
    // Un système ACTIF garde l'exigence : rien ne change pour la console.
    expect(preparerPatchSource({ ...brouillon, status: 'active' }, {})).toMatchObject({ ok: false, motif: 'secret_requis' });
    // Vers OAuth sans secret enregistré : aucun ne changerait de rôle, rien à ressaisir.
    const oauth = { tokenUrl: 'https://auth.client.fr/token', clientId: 'api', username: 'demo', scope: '' };
    expect(preparerPatchSource(brouillon, { authKind: 'oauth_password', oauth }).ok).toBe(true);
  });

  it('calcule l en-tête effectif et les seuls faits utiles au journal', () => {
    const actuelle = {
      baseUrl: 'https://api.client.fr/v1',
      authKind: 'header' as const,
      authHeaderName: 'X-Api-Key', oauth: null,
      aAuthentification: true,
      status: 'active' as const,
    };

    expect(preparerPatchSource(actuelle, { authHeaderName: null })).toMatchObject({
      ok: false,
      motif: 'entete_requis',
    });
    expect(preparerPatchSource(actuelle, { baseUrl: 'https://erp.client.fr/v2' })).toEqual({
      ok: true,
      authKind: 'header',
      adresseChangee: true,
      hote: 'erp.client.fr',
    });
  });

  it('interdit aux deux adaptateurs HTTP de dépendre l un de l autre', () => {
    const connecteurs = readFileSync('src/http/agent-sources.ts', 'utf8');
    const mcp = readFileSync('src/http/agent-mcp.ts', 'utf8');

    expect(connecteurs).toContain("from '../agent/source-configuration'");
    expect(mcp).toContain("from '../agent/source-configuration'");
    expect(mcp).not.toContain("from './agent-sources'");
  });
});
