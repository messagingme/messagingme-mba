import type { ParamSource } from '../crm/template';

/**
 * L'EN-TÊTE DOCUMENT QUI VIENT DE LA FICHE (lot B2 du plan `docs/superpowers/plans/2026-11-12-pdf-par-contact-hubspot.md`).
 * Un modèle à en-tête DOCUMENT peut dire que son document est celui que porte un champ de la fiche du contact (le PDF
 * recopié de HubSpot, `hs_calc_document`), au lieu du fichier déposé à sa création. La règle vit dans
 * `template_param_hints`, à la POSITION 0, à côté des sources des variables `{{1}}`…`{{n}}` : aucune résolution de
 * variable ne la voit (`resolveHintParams` parcourt 1..n, `parseParamHints` refuse une position inférieure à 1).
 */
export const POSITION_ENTETE = 0;

/** La clé du champ qui porte le document de l'en-tête, ou null quand l'en-tête est le fichier du modèle. */
export function champDEntete(hints: ReadonlyArray<{ position: number; source: ParamSource }>): string | null {
  const h = hints.find((x) => x.position === POSITION_ENTETE);
  return h && h.source.type === 'field' ? h.source.key : null;
}

/**
 * Levée AVANT tout appel à Meta par l'envoi d'un modèle à la main (Inbox, carte HubSpot) quand son en-tête vient de la
 * fiche : ce chemin reçoit l'adresse d'en-tête dans le CORPS de la requête (celle du fichier d'exemple, un devis témoin),
 * et un média non préparé y retomberait sur ce lien (relecture du lot B2). `envoyerModeleDansLeFil` la rend en 422.
 */
export class EnteteDeLaFicheRefusee extends Error {
  constructor() {
    super('Ce modèle envoie le document propre à chaque contact : il ne part que depuis un scénario.');
    this.name = 'EnteteDeLaFicheRefusee';
  }
}
