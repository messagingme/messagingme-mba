import { describe, it, expect } from 'vitest';
import { classerPiece, mentionDePiece, reglagesQuestion, refusFichierSansSuite } from '../src/workflow/question-piece';
import { GENRES_PAR_DEFAUT, SORTIE_FICHIER } from '../web/lib/partage/question-piece';
import type { WorkflowGraph, WorkflowNode } from '../src/workflow/graph';

/**
 * LA PIÈCE REÇUE PAR UN BLOC QUESTION (spec du 2026-11-02) : ce qui est pur.
 *
 * 🔴 Le classement se fait par le type RÉEL du fichier (MIME), pas par la catégorie de WhatsApp (décision de Julien) :
 * une pièce d'identité photographiée et envoyée « en fichier » arrive comme `document`, et doit rester une photo, sinon
 * le cas même qui motive la fonction prendrait « Toute autre réponse » avec les réglages par défaut. Un sticker n'est
 * jamais une pièce, bien que son type soit une image.
 */
const q = (data: Record<string, unknown>): WorkflowNode => ({ id: 'q', type: 'question', position: { x: 0, y: 0 }, data });

describe('classerPiece : par le type réel du fichier', () => {
  it.each([
    ['image', 'image/jpeg', 'photo'],
    ['document', 'image/jpeg', 'photo'],
    ['document', 'image/heic', 'photo'],
    ['document', 'application/pdf', 'pdf'],
    ['document', 'application/msword', 'document'],
    ['video', 'video/mp4', 'video'],
    ['audio', 'audio/ogg; codecs=opus', 'vocal'],
    ['document', 'Application/PDF', 'pdf'],
  ] as const)('%s + %s -> %s', (type, mime, attendu) => {
    expect(classerPiece(type, mime)).toBe(attendu);
  });

  it('🔴 un sticker n’est jamais une pièce, même en image/webp', () => {
    expect(classerPiece('sticker', 'image/webp')).toBeNull();
  });

  it('sans type MIME lisible, ou sur un message qui n’est pas un fichier : aucune case', () => {
    expect(classerPiece('image', null)).toBeNull();
    expect(classerPiece('document', '')).toBeNull();
    expect(classerPiece('text', 'image/jpeg')).toBeNull();
    expect(classerPiece('location', null)).toBeNull();
  });
});

describe('mentionDePiece : lisible, dans le fuseau de l’espace, sans aucun moyen d’ouvrir le fichier', () => {
  it('l’heure de Paris d’un instant UTC, et le genre du fichier', () => {
    expect(mentionDePiece(new Date('2026-11-02T13:32:00Z'), 'Europe/Paris', 'photo')).toBe('Pièce reçue le 02/11/2026 à 14 h 32 (photo)');
    expect(mentionDePiece(new Date('2026-07-01T08:05:00Z'), 'Europe/Paris', 'pdf')).toBe('Pièce reçue le 01/07/2026 à 10 h 05 (PDF)');
    expect(mentionDePiece(new Date('2026-11-02T13:32:00Z'), 'UTC', 'video')).toBe('Pièce reçue le 02/11/2026 à 13 h 32 (vidéo)');
  });

  it('un fuseau illisible ne lève pas : l’heure UTC', () => {
    expect(mentionDePiece(new Date('2026-11-02T13:32:00Z'), 'Pas/Un_Fuseau', 'vocal')).toBe('Pièce reçue le 02/11/2026 à 13 h 32 (vocal)');
  });
});

describe('reglagesQuestion : lus défensivement, un bloc ancien ne range rien', () => {
  it('🔴 un bloc enregistré avant ce lot : aucun champ, aucune ligne, aucune attente', () => {
    expect(reglagesQuestion(q({ body: 'Ça vous convient ?', rows: [{ title: 'Oui' }] }))).toEqual({ champ: null, rangerLigne: false, genres: null });
  });

  it('le champ choisi, la case de la ligne, et les types cochés', () => {
    expect(reglagesQuestion(q({ champReponse: ' piece_identite ', rangerLigne: true, attendreFichier: true, genresFichier: ['pdf', 'video'] })))
      .toEqual({ champ: 'piece_identite', rangerLigne: true, genres: ['pdf', 'video'] });
  });

  it('attente cochée sans type lisible : photo et PDF ; un type inconnu ou en double est écarté', () => {
    expect(reglagesQuestion(q({ attendreFichier: true })).genres).toEqual([...GENRES_PAR_DEFAUT]);
    expect(reglagesQuestion(q({ attendreFichier: true, genresFichier: [] })).genres).toEqual([...GENRES_PAR_DEFAUT]);
    expect(reglagesQuestion(q({ attendreFichier: true, genresFichier: ['sticker', 'photo', 'photo', 3] })).genres).toEqual(['photo']);
    expect(reglagesQuestion(q({ attendreFichier: 'true', genresFichier: ['photo'] })).genres).toBeNull();
  });
});

describe('refusFichierSansSuite : un bloc qui attend un fichier doit relier « Fichier reçu »', () => {
  const graphe = (data: Record<string, unknown>, aretes: WorkflowGraph['edges']): WorkflowGraph => ({
    nodes: [q(data), { id: 'suite', type: 'inbox', position: { x: 0, y: 0 }, data: {} }],
    edges: aretes,
  });

  it('sans attente, ou avec la sortie reliée : aucun refus', () => {
    expect(refusFichierSansSuite(graphe({ body: 'Votre pièce ?' }, []))).toBeNull();
    expect(refusFichierSansSuite(graphe({ body: 'Votre pièce ?', attendreFichier: true }, [
      { id: 'e', source: 'q', target: 'suite', sourceHandle: SORTIE_FICHIER },
    ]))).toBeNull();
  });

  it('🔴 attente cochée, sortie reliée à rien : une raison qui nomme le bloc', () => {
    const refus = refusFichierSansSuite(graphe({ body: 'Envoyez une photo de votre pièce d’identité', attendreFichier: true }, [
      { id: 'e', source: 'q', target: 'suite' },
    ]));
    expect(refus).toContain('Envoyez une photo de votre pièce');
    expect(refus).toContain('Fichier reçu');
  });

  it('une Question sans texte est un passe-plat : elle n’attend rien, donc rien à relier', () => {
    expect(refusFichierSansSuite(graphe({ body: '  ', attendreFichier: true }, []))).toBeNull();
  });
});
