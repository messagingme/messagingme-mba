import { describe, it, expect } from 'vitest';
import { assainirProposition, propositionSchema } from '../src/agent/setup/proposition';
import {
  adresseDansLeMessage, AGENDA, manquesDeCouverture, siteSansAdresse,
  type EtatEntretien,
} from '../src/agent/setup/couverture';
import { etapesDeFin, parleDesHoraires, type EntreeFin } from '../src/agent/setup/fin';

/**
 * L'entretien de construction de l'agent MUTAC bis (Julien, 2026-11-26) : deux tours perdus en « hors format »
 * (journaux de l'API : `bascules` en texte, puis une `connaissanceUrl` qui n'était pas une adresse), un site nommé sans
 * son adresse qui laissait passer au point suivant, et une condition sur les heures d'ouverture que rien ne relevait.
 */

describe('les sorties du modèle mesurées en production se ramènent au lieu de faire perdre le tour', () => {
  const juger = (brut: Record<string, unknown>) => propositionSchema.safeParse(assainirProposition({ message: 'ok', ...brut }));

  it('🔴 des bascules rendues en TEXTE (un tableau JSON) se relisent', () => {
    const r = juger({ bascules: JSON.stringify([{ moment: 'le client veut un conseiller', action: 'humain' }]) });
    expect(r.success).toBe(true);
    expect(r.success && r.data.bascules).toEqual([{ moment: 'le client veut un conseiller', action: 'humain' }]);
  });

  it('🔴 un texte qui ne devient pas une liste part, sans faire échouer le tour', () => {
    const r = juger({ bascules: 'x'.repeat(5000), reponses: 'rien' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.bascules).toEqual([]);
  });

  it('🔴 une adresse sans schéma prend https, une phrase qui n’est pas une adresse part', () => {
    const avec = juger({ connaissanceUrl: 'www.mutac.com' });
    expect(avec.success && avec.data.connaissanceUrl).toBe('https://www.mutac.com');
    const phrase = juger({ connaissanceUrl: 'les pages de notre site' });
    expect(phrase.success).toBe(true);
    expect(phrase.success && phrase.data.connaissanceUrl).toBeUndefined();
    expect(juger({ connaissanceUrl: 'mutac' }).success).toBe(true);
  });
});

describe('🔴 un site nommé sans son adresse fait demander l’adresse (le tour la pose, une fois)', () => {
  const etat = (valeur: string, connaissanceUrl?: string): EtatEntretien => ({
    poses: [], reponses: [{ point: 'connaissance', valeur }], bascules: [],
    ...(connaissanceUrl ? { connaissanceUrl } : {}),
  });

  it('« les pages de notre site » sans adresse la réclame, l’adresse retenue ou écrite non', () => {
    expect(siteSansAdresse(etat('les pages de notre site'))).toBe(true);
    expect(siteSansAdresse(etat('les pages de notre site', 'https://www.mutac.com'))).toBe(false);
    expect(siteSansAdresse(etat('notre site https://www.mutac.com'))).toBe(false);
  });

  it('un document, des fiches, rien, ou « plus tard » ne réclament aucune adresse', () => {
    for (const v of ['un document que je joins', 'je remplirai les fiches à la main', 'rien pour l’instant',
      'notre site, je vous donnerai l’adresse plus tard']) {
      expect(siteSansAdresse(etat(v)), v).toBe(false);
    }
  });

  it('la couverture ne change pas : le point reste couvert, un entretien fini ne se rouvre pas', () => {
    const e: EtatEntretien = { ...etat('les pages de notre site'), poses: AGENDA.map((p) => p.code) };
    expect(manquesDeCouverture(e)).not.toContain('connaissance');
  });

  it('l’adresse se lit dans le message du client, complète ou en nom de domaine nu', () => {
    expect(adresseDansLeMessage('https://www.mutac.com/')).toBe('https://www.mutac.com/');
    expect(adresseDansLeMessage('www.mutac.com')).toBe('https://www.mutac.com');
    expect(adresseDansLeMessage('c’est mutac.fr.')).toBe('https://mutac.fr');
    expect(adresseDansLeMessage('les pages de notre site')).toBeNull();
    expect(adresseDansLeMessage('voici tarifs.pdf')).toBeNull();
  });
});

describe('🔴 une condition sur les heures d’ouverture dit où les régler (décision de Julien, 2026-11-26)', () => {
  const base: EntreeFin = {
    aAppliquer: true, connaissanceUrl: null, fichesDeConnaissance: 3, bascules: [], outilsApi: 0, outilsMcp: 0, modele: null,
  };

  it('repère la condition dans les mots du client', () => {
    expect(parleDesHoraires(['passer la main pendant les heures ouvrées, sinon proposer le lien'])).toBe(true);
    expect(parleDesHoraires(['en dehors des horaires, donner le lien de réservation'])).toBe(true);
    expect(parleDesHoraires(['proposer le lien de réservation', undefined])).toBe(false);
  });

  it('l’étape « Horaires » nomme les deux réglages, et seulement quand la condition existe', () => {
    const avec = etapesDeFin({ ...base, horaires: true }).join('\n');
    expect(avec).toContain('« Fuseau & heures d’ouverture »');
    expect(avec).toContain('« Sécurité » > « IA »');
    expect(avec).toContain('« Seulement aux heures d’ouverture »');
    expect(avec).not.toContain('MBA');
    expect(etapesDeFin(base).join('\n')).not.toContain('Horaires');
  });
});
