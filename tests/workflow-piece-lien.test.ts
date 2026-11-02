import { describe, it, expect } from 'vitest';
import { DUREE_LIEN_PIECE_MS, jetonPiece, lienPiece, lireJetonPiece } from '../src/workflow/piece-lien';

/**
 * LE LIEN VERS UNE PIÈCE REÇUE (spec du 2026-11-02) : un espace, un message de Meta et une échéance, signés. Il ouvre
 * une pièce d'identité à quiconque le tient : il ne doit rien ouvrir d'autre, dans aucun autre espace, et plus rien
 * après son échéance de quinze minutes.
 */
const SECRET = 's'.repeat(40);
const T = '11111111-2222-4333-8444-555555555555';
const WAMID = 'wamid.HBgLMzM2MTIzNDU2NzgVAgASGBQzQTFCMkMzRDRFNUY2QTdCOEM5RAA=';
const ECHEANCE = new Date('2026-11-02T13:47:00.000Z');

describe('le jeton d’une pièce', () => {
  it('quinze minutes', () => {
    expect(DUREE_LIEN_PIECE_MS).toBe(15 * 60_000);
  });

  it('aller-retour : l’espace et le message, tels quels', () => {
    const jeton = jetonPiece(T, WAMID, ECHEANCE, SECRET);
    expect(lireJetonPiece(jeton, SECRET, new Date(ECHEANCE.getTime() - 60_000))).toEqual({ tenantId: T, metaMessageId: WAMID });
  });

  it('🔴 une milliseconde avant l’échéance : valide ; une milliseconde après : refusé', () => {
    const jeton = jetonPiece(T, WAMID, ECHEANCE, SECRET);
    expect(lireJetonPiece(jeton, SECRET, new Date(ECHEANCE.getTime() - 1))).not.toBeNull();
    expect(lireJetonPiece(jeton, SECRET, new Date(ECHEANCE.getTime() + 1))).toBeNull();
  });

  it('🔴 l’espace, le message ou l’échéance modifiés : refusé', () => {
    const [t, w, e, sig] = jetonPiece(T, WAMID, ECHEANCE, SECRET).split('.') as [string, string, string, string];
    const autreEspace = '99999999-2222-4333-8444-555555555555';
    const autreMessage = Buffer.from('wamid.AUTRE', 'utf8').toString('base64url');
    const plusTard = (ECHEANCE.getTime() + 86_400_000).toString(36);
    const maintenant = new Date(ECHEANCE.getTime() - 60_000);
    expect(lireJetonPiece([autreEspace, w, e, sig].join('.'), SECRET, maintenant)).toBeNull();
    expect(lireJetonPiece([t, autreMessage, e, sig].join('.'), SECRET, maintenant)).toBeNull();
    expect(lireJetonPiece([t, w, plusTard, sig].join('.'), SECRET, maintenant)).toBeNull();
  });

  it('🔴 une signature modifiée, ou faite avec un autre secret : refusé', () => {
    const jeton = jetonPiece(T, WAMID, ECHEANCE, SECRET);
    const maintenant = new Date(ECHEANCE.getTime() - 60_000);
    const fin = jeton.slice(-1) === 'A' ? 'B' : 'A';
    expect(lireJetonPiece(jeton.slice(0, -1) + fin, SECRET, maintenant)).toBeNull();
    expect(lireJetonPiece(jetonPiece(T, WAMID, ECHEANCE, 'x'.repeat(40)), SECRET, maintenant)).toBeNull();
  });

  it('secret vide : refus à la fabrication, rien d’ouvert à la lecture', () => {
    expect(() => jetonPiece(T, WAMID, ECHEANCE, '')).toThrow();
    expect(lireJetonPiece(jetonPiece(T, WAMID, ECHEANCE, SECRET), '', new Date(0))).toBeNull();
  });

  it('un jeton mal formé ou trop long ne lève pas', () => {
    const maintenant = new Date(0);
    for (const j of ['', 'a.b.c', 'a.b.c.d.e', `${T}.${'A'.repeat(2000)}.k.sig`, 'pas-un-jeton']) {
      expect(lireJetonPiece(j, SECRET, maintenant)).toBeNull();
    }
  });

  it('un identifiant de message avec « . », « = », « + » ou « / » fait l’aller-retour', () => {
    const w = 'wamid.ab+cd/ef==.gh';
    expect(lireJetonPiece(jetonPiece(T, w, ECHEANCE, SECRET), SECRET, new Date(0))?.metaMessageId).toBe(w);
  });

  it('l’adresse : servie par l’API sous /f/, une barre finale de la base ne double rien', () => {
    expect(lienPiece('https://api.messagingme.app/', 'abc.def')).toBe('https://api.messagingme.app/f/abc.def');
  });
});
