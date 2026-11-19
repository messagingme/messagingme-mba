/**
 * L'ARBRE DES QUESTIONS DU PARCOURS NUMÉRO.
 *
 * Une réponse parente reconstruit la branche qui lui appartient : aucune ancienne réponse descendante ne peut survivre.
 * Le composant React ne possède plus sept états indépendants ni la connaissance de l'ordre des remises à zéro.
 */

export type ReponseCompteNumero = 'oui' | 'non' | 'nsp';
export type ReponseOuiNon = 'oui' | 'non';
export type DeploiementNumero = 'application' | 'api';
export type VarianteDeploiementNumero = 'sans' | 'vide' | 'second';

type CompteSansMeta = Exclude<ReponseCompteNumero, 'oui'>;

type OrigineDeploiement =
  | { compte: CompteSansMeta; application: 'non'; variante: 'sans' }
  | { compte: CompteSansMeta; application: 'oui'; numeroApplication: 'non'; variante: 'vide' }
  | { compte: CompteSansMeta; application: 'oui'; numeroApplication: 'oui'; memeNumero: 'non'; variante: 'second' };

export type EtatQuestionsNumero =
  | { etape: 'compte'; compte: null }
  | { etape: 'issue_api'; compte: 'oui' }
  | { etape: 'application'; compte: CompteSansMeta; application: null }
  | { etape: 'numero_application'; compte: CompteSansMeta; application: 'oui'; numeroApplication: null }
  | { etape: 'meme_numero'; compte: CompteSansMeta; application: 'oui'; numeroApplication: 'oui'; memeNumero: null }
  | { etape: 'coexistence'; compte: CompteSansMeta; application: 'oui'; numeroApplication: 'oui'; memeNumero: 'oui' }
  | (OrigineDeploiement & { etape: 'deploiement'; deploiement: null })
  | (OrigineDeploiement & { etape: 'fournir'; deploiement: 'application'; fournir: ReponseOuiNon | null })
  | (OrigineDeploiement & { etape: 'numero_api'; deploiement: 'api'; numero: ReponseOuiNon | null });

export const QUESTIONS_NUMERO_INITIALES: EtatQuestionsNumero = { etape: 'compte', compte: null };

export type ReponseQuestionNumero =
  | { question: 'compte'; reponse: ReponseCompteNumero }
  | { question: 'application'; reponse: ReponseOuiNon }
  | { question: 'numero_application'; reponse: ReponseOuiNon }
  | { question: 'meme_numero'; reponse: ReponseOuiNon }
  | { question: 'deploiement'; reponse: DeploiementNumero }
  | { question: 'fournir'; reponse: ReponseOuiNon }
  | { question: 'numero'; reponse: ReponseOuiNon };

export interface ReponsesQuestionsNumero {
  compte: ReponseCompteNumero | null;
  application: ReponseOuiNon | null;
  numeroApplication: ReponseOuiNon | null;
  memeNumero: ReponseOuiNon | null;
  variante: VarianteDeploiementNumero | null;
  deploiement: DeploiementNumero | null;
  fournir: ReponseOuiNon | null;
  numero: ReponseOuiNon | null;
}

function origineDe(e: EtatQuestionsNumero): OrigineDeploiement | null {
  if (!('variante' in e)) return null;
  if (e.variante === 'sans') return { compte: e.compte, application: 'non', variante: 'sans' };
  if (e.variante === 'vide') {
    return { compte: e.compte, application: 'oui', numeroApplication: 'non', variante: 'vide' };
  }
  return {
    compte: e.compte, application: 'oui', numeroApplication: 'oui', memeNumero: 'non', variante: 'second',
  };
}

/** La projection que le rendu lit. Elle ne peut provenir que d'un état valide construit par le réducteur. */
export function reponsesDesQuestionsNumero(e: EtatQuestionsNumero): ReponsesQuestionsNumero {
  return {
    compte: e.compte,
    application: 'application' in e ? e.application : null,
    numeroApplication: 'numeroApplication' in e ? e.numeroApplication : null,
    memeNumero: 'memeNumero' in e ? e.memeNumero : null,
    variante: 'variante' in e ? e.variante : null,
    deploiement: 'deploiement' in e ? e.deploiement : null,
    fournir: 'fournir' in e ? e.fournir : null,
    numero: 'numero' in e ? e.numero : null,
  };
}

/** Une réponse hors de la branche courante est ignorée ; une réponse parente remplace toute sa descendance. */
export function repondreAuxQuestionsNumero(e: EtatQuestionsNumero, action: ReponseQuestionNumero): EtatQuestionsNumero {
  switch (action.question) {
    case 'compte':
      return action.reponse === 'oui'
        ? { etape: 'issue_api', compte: 'oui' }
        : { etape: 'application', compte: action.reponse, application: null };
    case 'application':
      if (e.compte === null || e.compte === 'oui') return e;
      return action.reponse === 'oui'
        ? { etape: 'numero_application', compte: e.compte, application: 'oui', numeroApplication: null }
        : { etape: 'deploiement', compte: e.compte, application: 'non', variante: 'sans', deploiement: null };
    case 'numero_application':
      if (!('application' in e) || e.application !== 'oui') return e;
      return action.reponse === 'oui'
        ? { etape: 'meme_numero', compte: e.compte, application: 'oui', numeroApplication: 'oui', memeNumero: null }
        : { etape: 'deploiement', compte: e.compte, application: 'oui', numeroApplication: 'non', variante: 'vide', deploiement: null };
    case 'meme_numero':
      if (!('numeroApplication' in e) || e.numeroApplication !== 'oui') return e;
      return action.reponse === 'oui'
        ? { etape: 'coexistence', compte: e.compte, application: 'oui', numeroApplication: 'oui', memeNumero: 'oui' }
        : {
          etape: 'deploiement', compte: e.compte, application: 'oui', numeroApplication: 'oui', memeNumero: 'non',
          variante: 'second', deploiement: null,
        };
    case 'deploiement': {
      const origine = origineDe(e);
      if (origine === null) return e;
      return action.reponse === 'application'
        ? { ...origine, etape: 'fournir', deploiement: 'application', fournir: null }
        : { ...origine, etape: 'numero_api', deploiement: 'api', numero: null };
    }
    case 'fournir':
      return e.etape === 'fournir' ? { ...e, fournir: action.reponse } : e;
    case 'numero':
      return e.etape === 'numero_api' ? { ...e, numero: action.reponse } : e;
  }
}
