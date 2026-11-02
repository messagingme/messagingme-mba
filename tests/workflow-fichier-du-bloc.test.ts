import { describe, it, expect, vi } from 'vitest';
import { verifierFichierDuBloc } from '../src/meta/template-media';
import { telechargerEntete } from '../src/api/entete-par-url';

/**
 * Le fichier d'un message de scénario créé par l'API : lu une fois à l'écriture, par le MÊME chemin que l'envoi
 * (`prepareFichier`), pour qu'un fichier que l'envoi refuserait soit refusé tout de suite, avec sa raison.
 */
const PDF = Buffer.from('%PDF-1.7\n...');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const HTML = Buffer.from('<!doctype html><html></html>');
/** Un MOV renommé : la boîte `ftyp` porte la marque QuickTime. */
const MOV = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypqt  '), Buffer.alloc(8)]);

const public_ = async () => ({ ok: true as const });
const reponse = (octets: Buffer, statut = 200): Response => new Response(new Uint8Array(octets), { status: statut });

/** Les dépendances, avec le VRAI téléchargement gardé sur un `fetch` simulé. */
function deps(fetch: typeof globalThis.fetch, opts: { verifier?: typeof public_; mediatheque?: Buffer } = {}) {
  return {
    lireFichier: vi.fn(async () => (opts.mediatheque ? { bytes: opts.mediatheque, mime: 'application/pdf', nom: 'tarifs.pdf' } : null)),
    telecharger: (format: 'IMAGE' | 'VIDEO' | 'DOCUMENT', url: string) =>
      telechargerEntete({ fetch, verifier: opts.verifier ?? public_, delaiMs: 200 }, format, url),
  };
}

describe('verifierFichierDuBloc', () => {
  it('un PDF et une image PNG valides : aucun refus', async () => {
    expect(await verifierFichierDuBloc(deps(async () => reponse(PDF)), 't1', 'https://exemple.fr/brochure.pdf')).toBeNull();
    expect(await verifierFichierDuBloc(deps(async () => reponse(PNG)), 't1', 'https://exemple.fr/logo.png')).toBeNull();
  });

  it('une adresse interne : refusée avant tout appel', async () => {
    const fetch = vi.fn(async () => reponse(PDF));
    const d = deps(fetch, { verifier: async () => ({ ok: false, raison: 'adresse interne' }) as never });
    expect(await verifierFichierDuBloc(d, 't1', 'https://interne.exemple/a.pdf')).toMatch(/adresse interne/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('🔴 une redirection n’est pas suivie', async () => {
    const fetch = async (_u: unknown, init?: RequestInit) => {
      expect(init?.redirect).toBe('error');
      throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    };
    expect(await verifierFichierDuBloc(deps(fetch as typeof globalThis.fetch), 't1', 'https://exemple.fr/a.pdf')).not.toBeNull();
  });

  it('un 404, un fichier trop lourd, du HTML servi sous .pdf, un MOV renommé en .mp4 : refusés, avec la raison', async () => {
    expect(await verifierFichierDuBloc(deps(async () => reponse(PDF, 404)), 't1', 'https://exemple.fr/a.pdf')).toMatch(/HTTP 404/);
    const lourd = Buffer.concat([PDF, Buffer.alloc(17 * 1024 * 1024)]);
    expect(await verifierFichierDuBloc(deps(async () => reponse(lourd)), 't1', 'https://exemple.fr/a.pdf')).toMatch(/trop lourd/);
    expect(await verifierFichierDuBloc(deps(async () => reponse(HTML)), 't1', 'https://exemple.fr/a.pdf')).toMatch(/PDF/);
    expect(await verifierFichierDuBloc(deps(async () => reponse(MOV)), 't1', 'https://exemple.fr/a.mp4')).toMatch(/MP4/);
  });

  it('une adresse de la médiathèque de l’espace se lit par sa fiche, sans HTTP ; absente de l’espace, elle se télécharge comme à l’envoi', async () => {
    const fetch = vi.fn(async () => reponse(PDF));
    const url = 'https://api.messagingme.app/m/01h2xcejqtf2nbrexx3vqjhp41.pdf';
    expect(await verifierFichierDuBloc(deps(fetch, { mediatheque: PDF }), 't1', url)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(await verifierFichierDuBloc(deps(fetch), 't1', url)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
