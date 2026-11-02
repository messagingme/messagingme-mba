import { describe, it, expect } from 'vitest';
import { empreinteRecette, lireRecette, referencesDe, PROFONDEUR_MAX_RECETTE, type Etape } from '../src/workflow/recette';

const humain: Etape = { humain: {} };
const AGENT = '7f6b1c2e-1d2a-4b3c-8d4e-5f6a7b8c9d0e';

/** Une recette valide de chaque forme, servie aux cas qui n'en cassent qu'un morceau. */
const valide = (): Record<string, unknown> => ({
  nom: 'Relance devis',
  entree: {
    template: { nom: 'relance_devis', langue: 'fr', variables: { 1: { champ: 'prenom' } } },
    boutons: [
      { texte: 'Oui', suite: { agent: { agent_id: AGENT } } },
      {
        texte: 'Plus tard',
        suite: {
          message: { texte: 'Voici la brochure', fichier: { url: 'https://exemple.fr/brochure.pdf' } },
          reponses: [{ texte: 'Merci', suite: humain }],
          autre_reponse: humain,
        },
      },
    ],
    autre_reponse: humain,
  },
});

const refusDe = (brut: unknown) => {
  const r = lireRecette(brut);
  if (r.ok) throw new Error('attendu : un refus');
  return r;
};

describe('lireRecette', () => {
  it('accepte une recette complète, et rend la recette lue', () => {
    const r = lireRecette(valide());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valeur.nom).toBe('Relance devis');
  });

  it('rogne le nom et le refuse vide', () => {
    expect(refusDe({ ...valide(), nom: '   ' })).toMatchObject({ code: 'invalid_body', chemin: 'nom' });
  });

  it('refuse une étape qui porte deux formes, ou aucune', () => {
    expect(refusDe({ nom: 'x', entree: { humain: {}, agent: { agent_id: AGENT } } }))
      .toMatchObject({ code: 'invalid_body', chemin: 'entree' });
    expect(refusDe({ nom: 'x', entree: {} })).toMatchObject({ code: 'invalid_body', chemin: 'entree' });
  });

  it('refuse une clé inconnue, à l’endroit exact', () => {
    const b = valide();
    (b.entree as Record<string, unknown>).boutons = [{ texte: 'Oui', suite: humain, couleur: 'bleu' }];
    expect(refusDe(b)).toMatchObject({ code: 'invalid_body', chemin: 'entree.boutons[0]' });
  });

  it('refuse quatre réponses rapides, une de 21 caractères, et deux identiques', () => {
    const msg = (reponses: unknown) => ({ nom: 'x', entree: { message: { texte: 'Bonjour' }, reponses } });
    const r = (texte: string) => ({ texte, suite: humain });
    expect(refusDe(msg([r('a'), r('b'), r('c'), r('d')]))).toMatchObject({ chemin: 'entree.reponses' });
    expect(refusDe(msg([r('x'.repeat(21))]))).toMatchObject({ chemin: 'entree.reponses[0].texte' });
    expect(refusDe(msg([r('Oui'), r(' Oui ')]))).toMatchObject({ chemin: 'entree.reponses[1].texte' });
  });

  it('borne le texte à 1 024 avec un fichier ou des réponses, à 4 096 sinon', () => {
    const avecFichier = { message: { texte: 'x'.repeat(1025), fichier: { url: 'https://exemple.fr/a.png' } } };
    expect(refusDe({ nom: 'x', entree: avecFichier })).toMatchObject({ chemin: 'entree.message.texte' });
    const avecReponse = { message: { texte: 'x'.repeat(1025) }, reponses: [{ texte: 'Ok', suite: humain }] };
    expect(refusDe({ nom: 'x', entree: avecReponse })).toMatchObject({ chemin: 'entree.message.texte' });
    expect(lireRecette({ nom: 'x', entree: { message: { texte: 'x'.repeat(4096) } } }).ok).toBe(true);
    expect(refusDe({ nom: 'x', entree: { message: { texte: 'x'.repeat(4097) } } })).toMatchObject({ chemin: 'entree.message.texte' });
  });

  it('refuse une adresse de fichier qui n’est pas en https', () => {
    const e = { message: { texte: 'Bonjour', fichier: { url: 'http://exemple.fr/a.png' } } };
    expect(refusDe({ nom: 'x', entree: e })).toMatchObject({ chemin: 'entree.message.fichier.url' });
  });

  it('« suite » seulement sur un message sans réponse rapide', () => {
    const e = { message: { texte: 'Bonjour' }, reponses: [{ texte: 'Ok', suite: humain }], suite: humain };
    expect(refusDe({ nom: 'x', entree: e })).toMatchObject({ chemin: 'entree.suite' });
    expect(lireRecette({ nom: 'x', entree: { message: { texte: 'Bonjour' }, suite: humain } }).ok).toBe(true);
  });

  it('« autre_reponse » refusée sur un message sans réponse rapide (il n’attend pas)', () => {
    expect(refusDe({ nom: 'x', entree: { message: { texte: 'Bonjour' }, autre_reponse: humain } }))
      .toMatchObject({ chemin: 'entree.autre_reponse' });
  });

  it('borne la profondeur', () => {
    let e: Etape = humain;
    for (let i = 0; i < PROFONDEUR_MAX_RECETTE; i++) e = { message: { texte: `m${i}` }, suite: e };
    expect(refusDe({ nom: 'x', entree: e })).toMatchObject({ code: 'invalid_body' });
    let f: Etape = humain;
    for (let i = 0; i < PROFONDEUR_MAX_RECETTE - 1; i++) f = { message: { texte: `m${i}` }, suite: f };
    expect(lireRecette({ nom: 'x', entree: f }).ok).toBe(true);
  });

  it('refuse un agent dont l’identifiant n’est pas un uuid, et une source de variable inconnue', () => {
    expect(refusDe({ nom: 'x', entree: { agent: { agent_id: '12' } } })).toMatchObject({ chemin: 'entree.agent.agent_id' });
    const t = { template: { nom: 'a', langue: 'fr', variables: { 1: { formule: 'x' } } } };
    expect(refusDe({ nom: 'x', entree: t })).toMatchObject({ chemin: 'entree.template.variables.1' });
  });

  it('🔴 un texte de variable que Meta refuserait à chaque envoi (132018) est refusé à l’écriture', () => {
    for (const texte of ['ligne 1\nligne 2', 'col\tonne', 'cinq     espaces']) {
      const t = { template: { nom: 'a', langue: 'fr', variables: { 1: { texte } } } };
      expect(refusDe({ nom: 'x', entree: t }), JSON.stringify(texte)).toMatchObject({ chemin: 'entree.template.variables.1.texte' });
    }
  });

  it('au plus dix fichiers distincts par recette : chacun se télécharge pour être vérifié', () => {
    const msg = (i: number, suite?: Etape): Etape => ({ message: { texte: `m${i}`, fichier: { url: `https://exemple.fr/${i}.pdf` } }, ...(suite ? { suite } : {}) });
    let onze: Etape = humain;
    for (let i = 0; i < 11; i++) onze = msg(i, onze);
    expect(refusDe({ nom: 'x', entree: onze })).toMatchObject({ code: 'invalid_body', chemin: 'entree' });
    let dix: Etape = humain;
    for (let i = 0; i < 10; i++) dix = msg(i, dix);
    expect(lireRecette({ nom: 'x', entree: dix }).ok).toBe(true);
  });

  it('ne lève jamais, même sur un corps qui n’est pas un objet', () => {
    for (const b of [null, 'texte', 42, [], { nom: 'x' }]) expect(lireRecette(b).ok).toBe(false);
  });
});

describe('referencesDe', () => {
  it('rend tout ce que la recette nomme, sans doublon', () => {
    const r = lireRecette(valide());
    if (!r.ok) throw new Error('recette attendue valide');
    expect(referencesDe(r.valeur.entree)).toEqual({
      templates: [{ nom: 'relance_devis', langue: 'fr' }],
      agents: [AGENT],
      champs: ['prenom'],
      fichiers: ['https://exemple.fr/brochure.pdf'],
    });
  });
});

describe('empreinteRecette', () => {
  it('ne dépend pas de l’ordre des clés, mais du contenu', () => {
    const a: Etape = { message: { texte: 'Bonjour', fichier: { url: 'https://exemple.fr/a.png' } } };
    const b: Etape = { message: { fichier: { url: 'https://exemple.fr/a.png' }, texte: 'Bonjour' } };
    expect(empreinteRecette(a)).toBe(empreinteRecette(b));
    expect(empreinteRecette(a)).not.toBe(empreinteRecette({ message: { texte: 'Bonsoir', fichier: { url: 'https://exemple.fr/a.png' } } }));
  });
});
