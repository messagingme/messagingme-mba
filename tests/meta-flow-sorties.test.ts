import { describe, expect, it } from 'vitest';
import { sortiesDuFlowJson } from '../src/meta/flow-sorties';

/**
 * Les éléments qu'un formulaire créé dans le Business Manager renvoie (Julien, 2026-11-10). La réponse porte EXACTEMENT
 * le `payload` de l'action `complete` : c'est lui qui fait la liste, pas les composants de saisie.
 */

/** Un flow à deux écrans comme on en écrit dans WhatsApp Manager : le premier passe ses saisies au second par `navigate`. */
const DEUX_ECRANS = {
  version: '7.2',
  screens: [
    {
      id: 'CIVILITE',
      title: 'Vos coordonnées',
      data: {},
      layout: {
        type: 'SingleColumnLayout',
        children: [{
          type: 'Form',
          name: 'form',
          children: [
            { type: 'TextInput', name: 'prenom_saisi', label: 'Votre prénom', 'input-type': 'text', required: true },
            { type: 'TextInput', name: 'mail', label: 'Adresse e-mail', 'input-type': 'email' },
            { type: 'TextInput', name: 'jamais_envoye', label: 'Pas dans le complete' },
            {
              type: 'Footer', label: 'Suivant',
              'on-click-action': { name: 'navigate', next: { type: 'screen', name: 'RDV' }, payload: { prenom_ecran: '${form.prenom_saisi}', mail_ecran: '${form.mail}' } },
            },
          ],
        }],
      },
    },
    {
      id: 'RDV',
      terminal: true,
      data: { prenom_ecran: { type: 'string', __example__: 'x' }, mail_ecran: { type: 'string', __example__: 'x' } },
      layout: {
        type: 'SingleColumnLayout',
        children: [{
          type: 'Form',
          name: 'form',
          children: [
            { type: 'DatePicker', name: 'date_rdv', label: 'Date souhaitée' },
            { type: 'CheckboxGroup', name: 'creneaux', label: '${data.libelle_dynamique}', 'data-source': [] },
            { type: 'OptIn', name: 'accord', label: 'J’accepte d’être recontacté' },
            {
              type: 'If', condition: '${form.accord}',
              then: [{
                type: 'Footer', label: 'Envoyer',
                'on-click-action': {
                  name: 'complete',
                  payload: {
                    prenom: '${data.prenom_ecran}', email: '${data.mail_ecran}', date: '${form.date_rdv}',
                    creneaux: '${form.creneaux}', accord: '${form.accord}', origine: 'site', flow_token: 'x', _ref: 'y',
                  },
                },
              }],
              else: [{ type: 'Footer', label: 'Envoyer', 'on-click-action': { name: 'complete', payload: { date: '${screen.RDV.form.date_rdv}', refus: '${form.accord}' } } }],
            },
          ],
        }],
      },
    },
  ],
};

describe('sortiesDuFlowJson', () => {
  it('liste les clés du payload `complete`, avec le libellé du composant qu’elles citent, à travers les écrans', () => {
    expect(sortiesDuFlowJson(DEUX_ECRANS)).toEqual([
      { cle: 'prenom', libelle: 'Votre prénom' },
      { cle: 'email', libelle: 'Adresse e-mail' },
      { cle: 'date', libelle: 'Date souhaitée' },
      // Libellé dynamique : on ne l'invente pas, la clé le remplace.
      { cle: 'creneaux', libelle: 'creneaux' },
      { cle: 'accord', libelle: 'J’accepte d’être recontacté' },
      // Une constante arrive aussi dans la réponse : elle se range comme le reste.
      { cle: 'origine', libelle: 'origine' },
      // Le second `complete` (branche `else`) ajoute ce que le premier n'a pas, sans doublon.
      { cle: 'refus', libelle: 'J’accepte d’être recontacté' },
    ]);
  });

  it('un champ que le `complete` ne cite pas n’arrive jamais, il n’est pas proposé', () => {
    expect(sortiesDuFlowJson(DEUX_ECRANS).map((s) => s.cle)).not.toContain('jamais_envoye');
  });

  it('`flow_token` et `_ref` ne sont jamais des éléments', () => {
    const cles = sortiesDuFlowJson(DEUX_ECRANS).map((s) => s.cle);
    expect(cles).not.toContain('flow_token');
    expect(cles).not.toContain('_ref');
  });

  it('un flow_json sans `complete`, vide ou illisible ne rend rien, sans lever', () => {
    expect(sortiesDuFlowJson({ screens: [] })).toEqual([]);
    expect(sortiesDuFlowJson(null)).toEqual([]);
    expect(sortiesDuFlowJson('texte')).toEqual([]);
    expect(sortiesDuFlowJson({ screens: [{ id: 'A', layout: { children: [{ type: 'Footer', 'on-click-action': { name: 'complete' } }] } }] })).toEqual([]);
  });

  it('une donnée qui ne remonte à aucun composant garde sa clé, une boucle de données ne pend pas', () => {
    const boucle = {
      screens: [{
        id: 'A',
        layout: { children: [
          { type: 'Footer', 'on-click-action': { name: 'navigate', payload: { a: '${data.b}', b: '${data.a}' } } },
          { type: 'Footer', 'on-click-action': { name: 'complete', payload: { x: '${data.a}', y: '${data.inconnue}' } } },
        ] },
      }],
    };
    expect(sortiesDuFlowJson(boucle)).toEqual([{ cle: 'x', libelle: 'x' }, { cle: 'y', libelle: 'y' }]);
  });
});
