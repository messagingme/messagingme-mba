import { describe, it, expect } from 'vitest';
import { actionChoisie, AGENDA, basculesDuTour, momentDuPoint, type Point } from '../src/agent/setup/couverture';

/**
 * Les moments de l'entretien de construction, tenus par le serveur (agent SMATIS, 2026-10-12) : un moment ne naît
 * qu'au tour qui les recueille, une reformulation se rattache au moment demandé, et la réponse du client à la liste
 * numérotée se lit sans le modèle.
 */
const COLLECTE = AGENDA.find((p) => p.collecteDesMoments)!;
const ACTION_1: Point = { code: 'bascule_1_action', sujet: 's', question: 'q', aObtenir: 'a' };
const AVANT = [{ moment: 'le client veut parler à un conseiller' }, { moment: 'le client veut faire un devis' }];

describe('momentDuPoint', () => {
  it('lit l’index et la nature d’un point engendré, et rien d’autre', () => {
    expect(momentDuPoint('bascule_2_action')).toEqual({ index: 1, quoi: 'action' });
    expect(momentDuPoint('bascule_1_moyen')).toEqual({ index: 0, quoi: 'moyen' });
    expect(momentDuPoint('bascules')).toBeNull();
    expect(momentDuPoint(undefined)).toBeNull();
  });
});

describe('basculesDuTour', () => {
  it('au tour qui recueille les moments, tout passe', () => {
    const p = [{ moment: 'a' }, { moment: 'b' }];
    expect(basculesDuTour([], p, COLLECTE)).toEqual(p);
  });

  it('🔴 ailleurs, une reformulation porteuse d’une action se rattache au moment demandé', () => {
    const r = basculesDuTour(AVANT, [{ moment: 'Le client demande à parler à un conseiller', action: 'humain' }], ACTION_1);
    expect(r).toEqual([{ moment: 'le client veut parler à un conseiller', action: 'humain' }]);
  });

  it('deux orphelines : on ne devine pas laquelle, aucune n’est rattachée', () => {
    const r = basculesDuTour(AVANT, [
      { moment: 'x', action: 'humain' }, { moment: 'y', action: 'scenario' },
    ], ACTION_1);
    expect(r).toEqual([]);
  });

  it('une entrée qui apparie un moment connu passe, quelle que soit la casse', () => {
    const r = basculesDuTour(AVANT, [{ moment: 'Le client veut faire un devis', action: 'scenario' }], ACTION_1);
    expect(r).toEqual([{ moment: 'Le client veut faire un devis', action: 'scenario' }]);
  });

  it('une orpheline sans action ni moyen ne sert à rien : écartée', () => {
    expect(basculesDuTour(AVANT, [{ moment: 'le client veut résilier' }], ACTION_1)).toEqual([]);
  });
});

describe('actionChoisie', () => {
  it('🔴 lit le numéro seul, ou le mot qui distingue un choix', () => {
    expect(actionChoisie('4')).toBe('humain');
    expect(actionChoisie(' 1) ')).toBe('scenario');
    expect(actionChoisie('Il doit passer la main à un humain')).toBe('humain');
    expect(actionChoisie('lancer le scénario SMATIS Devis')).toBe('scenario');
    expect(actionChoisie('appeler notre API')).toBe('outil_api');
    expect(actionChoisie('rien de particulier')).toBe('continuer');
    expect(actionChoisie('autre chose')).toBe('autre');
  });

  it('ne devine pas : rien ne ressort, ou deux choix se disputent le message', () => {
    expect(actionChoisie('je ne sais pas')).toBeNull();
    expect(actionChoisie('une API ou un humain')).toBeNull();
    expect(actionChoisie('9')).toBeNull();
  });

  /**
   * 🔴 Vécu par Julien le 2026-11-23, mot pour mot : le modèle a écrit SA liste, dans SON ordre. « 1 » y désignait
   * l'humain ; le serveur le lisait dans `CHOIX_ACTION`, où 1 est le scénario. Et « 1 aussi » n'était pas lu du tout.
   */
  const LISTE_DU_MODELE = [
    'Noté : quand le client demande un conseiller, l’agent passe la main à un humain.',
    '',
    'Quand le client pose une question sur un sujet que l’agent ne maîtrise pas, que doit faire l’agent ?',
    '',
    '1) **Passer la main à un humain** : votre service client reprend la conversation',
    '2) **Appeler un outil branché par API** : un connecteur vers votre système',
    '3) **Créer et lancer un scénario** : enchaîner sur une séquence automatisée',
    '4) **Continuer à répondre** : l’agent gère quand même',
    '5) **Autre chose**',
    '',
    'Qu’en préférez-vous ?',
  ].join('\n');

  it('🔴 le numéro se lit dans la liste que le client a VUE, pas dans celle du serveur', () => {
    expect(actionChoisie('1', LISTE_DU_MODELE)).toBe('humain');
    expect(actionChoisie('3', LISTE_DU_MODELE)).toBe('scenario');
    expect(actionChoisie('4', LISTE_DU_MODELE)).toBe('continuer');
    expect(actionChoisie('5', LISTE_DU_MODELE)).toBe('autre');
    // Un numéro absent de la liste montrée ne désigne rien ; sans AUCUNE liste dans le message vu, on retombe sur celle
    // du serveur (une relance, un fil d'avant ce correctif).
    expect(actionChoisie('6', LISTE_DU_MODELE)).toBeNull();
    expect(actionChoisie('4', 'Que doit faire l’agent ?')).toBe('humain');
  });

  it('🔴 « 1 aussi » : un chiffre qui OUVRE une courte phrase est lu', () => {
    expect(actionChoisie('1 aussi', LISTE_DU_MODELE)).toBe('humain');
    expect(actionChoisie('1. comme avant', LISTE_DU_MODELE)).toBe('humain');
    // Le chiffre et les mots disent la même chose : retenu.
    expect(actionChoisie('4, il doit transférer à un humain')).toBe('humain');
  });

  it('un chiffre plus loin dans la phrase est un nom, et les mots décident', () => {
    expect(actionChoisie('lancer le scénario Relance J+3')).toBe('scenario');
    expect(actionChoisie('je t’ai déjà répondu 4, il doit transférer à un humain')).toBe('humain');
  });

  it('ne devine pas : chiffre et mots en désaccord, une ligne illisible, un nombre qui n’est pas un choix', () => {
    expect(actionChoisie('1, un scénario', LISTE_DU_MODELE)).toBeNull();
    expect(actionChoisie('2', '1) oui\n2) peut-être')).toBeNull();
    expect(actionChoisie('30min*')).toBeNull();
    expect(actionChoisie('12')).toBeNull();
  });
});
