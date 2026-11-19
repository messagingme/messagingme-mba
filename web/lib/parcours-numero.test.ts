import { describe, expect, it } from 'vitest';
import {
  QUESTIONS_NUMERO_INITIALES, repondreAuxQuestionsNumero, reponsesDesQuestionsNumero, type EtatQuestionsNumero,
  type ReponseQuestionNumero,
} from './parcours-numero';

const repondre = (etat: EtatQuestionsNumero, ...actions: ReponseQuestionNumero[]): EtatQuestionsNumero =>
  actions.reduce(repondreAuxQuestionsNumero, etat);

describe('l’arbre des questions du numéro', () => {
  it('construit chacune des trois origines du choix de déploiement', () => {
    const sans = repondre(QUESTIONS_NUMERO_INITIALES,
      { question: 'compte', reponse: 'non' }, { question: 'application', reponse: 'non' });
    expect(reponsesDesQuestionsNumero(sans)).toMatchObject({ variante: 'sans', deploiement: null });

    const vide = repondre(QUESTIONS_NUMERO_INITIALES,
      { question: 'compte', reponse: 'nsp' }, { question: 'application', reponse: 'oui' },
      { question: 'numero_application', reponse: 'non' });
    expect(reponsesDesQuestionsNumero(vide)).toMatchObject({ variante: 'vide', numeroApplication: 'non' });

    const second = repondre(QUESTIONS_NUMERO_INITIALES,
      { question: 'compte', reponse: 'non' }, { question: 'application', reponse: 'oui' },
      { question: 'numero_application', reponse: 'oui' }, { question: 'meme_numero', reponse: 'non' });
    expect(reponsesDesQuestionsNumero(second)).toMatchObject({ variante: 'second', memeNumero: 'non' });
  });

  it('changer une réponse parente retire toute l’ancienne branche', () => {
    const remplie = repondre(QUESTIONS_NUMERO_INITIALES,
      { question: 'compte', reponse: 'non' }, { question: 'application', reponse: 'oui' },
      { question: 'numero_application', reponse: 'oui' }, { question: 'meme_numero', reponse: 'non' },
      { question: 'deploiement', reponse: 'application' }, { question: 'fournir', reponse: 'oui' });
    expect(reponsesDesQuestionsNumero(remplie)).toMatchObject({
      application: 'oui', numeroApplication: 'oui', memeNumero: 'non', deploiement: 'application', fournir: 'oui',
    });

    const changee = repondreAuxQuestionsNumero(remplie, { question: 'application', reponse: 'non' });
    expect(reponsesDesQuestionsNumero(changee)).toEqual({
      compte: 'non', application: 'non', numeroApplication: null, memeNumero: null, variante: 'sans',
      deploiement: null, fournir: null, numero: null,
    });
  });

  it('changer de déploiement retire la réponse propre à l’ancienne voie', () => {
    const application = repondre(QUESTIONS_NUMERO_INITIALES,
      { question: 'compte', reponse: 'non' }, { question: 'application', reponse: 'non' },
      { question: 'deploiement', reponse: 'application' }, { question: 'fournir', reponse: 'non' });
    const api = repondre(application,
      { question: 'deploiement', reponse: 'api' }, { question: 'numero', reponse: 'oui' });
    expect(reponsesDesQuestionsNumero(api)).toMatchObject({ deploiement: 'api', fournir: null, numero: 'oui' });

    const retour = repondreAuxQuestionsNumero(api, { question: 'deploiement', reponse: 'application' });
    expect(reponsesDesQuestionsNumero(retour)).toMatchObject({ deploiement: 'application', fournir: null, numero: null });
  });

  it('ignore une réponse qui ne peut pas appartenir à la branche courante', () => {
    expect(repondreAuxQuestionsNumero(QUESTIONS_NUMERO_INITIALES, { question: 'fournir', reponse: 'oui' }))
      .toBe(QUESTIONS_NUMERO_INITIALES);
  });
});
