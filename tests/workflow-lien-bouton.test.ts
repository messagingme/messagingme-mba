import { jamaisDesabonne, toujoursDAccord } from './consentement';
import { avecGardesDEtatInertes, depsInertes } from './executeur-inerte';
import { describe, it, expect, vi } from 'vitest';
import { walk, etapeOffreUnChoix, problemeLienBouton, lienPourLeContact } from '../src/workflow/engine';
import { WorkflowExecutor, type WorkflowExecutorDeps } from '../src/workflow/executor';
import type { WorkflowGraph } from '../src/workflow/graph';

/**
 * LE BOUTON DE LIEN D'UN MESSAGE RAPIDE (WhatsApp `cta_url`).
 *
 * 🔴 CE QUE CES TESTS TIENNENT, ET POURQUOI CE N'EST PAS UN DÉTAIL D'ÉCRAN. Julien a demandé qu'une réponse
 * rapide puisse pointer vers une URL. Chez Meta c'est IMPOSSIBLE : `button` (jusqu'à trois réponses rapides,
 * qui REVIENNENT dans le scénario) et `cta_url` (un bouton, qui OUVRE une page) sont deux TYPES de messages
 * interactifs différents, et un message n'a qu'un type. La contrainte n'est donc pas négociable, elle est
 * seulement déplaçable : soit le client la découvre à l'envoi, soit l'écran la lui dit quand il coche la
 * case. C'est le second qu'on a construit, et ces tests gardent l'exclusivité à chaque étage.
 */
const graphe = (data: Record<string, unknown>): WorkflowGraph => ({
  nodes: [{ id: 'n', type: 'quick_message', data, position: { x: 0, y: 0 } }],
  edges: [],
});

/** L'action produite par le premier bloc du graphe. */
function actionDuBloc(data: Record<string, unknown>) {
  return walk(graphe(data), 'n').actions[0]?.action ?? null;
}

class FakeRuns {
  async closeActiveByWaId(): Promise<string[]> { return []; }
  async start(): Promise<{ id: string }> { return { id: 'r1' }; }
  // Requis par le contrat et absent jusqu'au lot 3 de l'audit ponytail : le transtypage qui suivait le cachait.
  async findWaitingByWaId(): Promise<null> { return null; }
  async setState(): Promise<void> {}
}

function deps(over: Partial<WorkflowExecutorDeps>): WorkflowExecutorDeps {
  return {
    ...depsInertes,
    estDesabonne: jamaisDesabonne,
    aAccordMarketing: toujoursDAccord,
    runs: avecGardesDEtatInertes(new FakeRuns()),
    getGraph: async () => graphe({}),
    applyTag: async () => {},
    setField: async () => {},
    removeTag: async () => {},
    clearField: async () => {},
    sendTemplate: async () => {},
    sendQuickMessage: async () => {},
    sendFlow: async () => {},
    sendQuestion: async () => {},
    ...over,
  };
}

describe('bouton de lien : l’action', () => {
  it('le bloc transporte le libellé et l’adresse saisis', () => {
    const a = actionDuBloc({ body: 'La brochure', lienActif: true, lienTexte: 'Télécharger', lienUrl: 'https://exemple.fr/b.pdf' });
    expect(a).toMatchObject({ kind: 'sendQuickMessage', body: 'La brochure', lien: { texte: 'Télécharger', url: 'https://exemple.fr/b.pdf' } });
  });

  it('🔴 un bloc qui porte un lien part SANS ses réponses rapides, même si le graphe en porte', () => {
    // L'écran vide `quickReplies` quand la case se coche, mais un graphe enregistré AVANT cette case, ou
    // posé par l'API, peut porter les deux. Les transmettre laisserait la couche d'envoi choisir le type du
    // message Meta, c'est-à-dire déplacer la décision là où elle ne se voit plus.
    const a = actionDuBloc({ body: 'x', quickReplies: ['Oui', 'Non'], lienActif: true, lienTexte: 'Voir', lienUrl: 'https://exemple.fr' });
    expect(a).toMatchObject({ kind: 'sendQuickMessage', buttons: [] });
  });

  it('sans la case cochée, RIEN ne change : les réponses rapides restent, et aucun lien n’apparaît', () => {
    const a = actionDuBloc({ body: 'x', quickReplies: ['Oui', 'Non'], lienTexte: 'Voir', lienUrl: 'https://exemple.fr' });
    expect(a).toMatchObject({ kind: 'sendQuickMessage', buttons: [{ text: 'Oui' }, { text: 'Non' }] });
    expect(a && 'lien' in a ? a.lien : undefined).toBeUndefined();
  });

  it('🔴 un bloc à bouton de lien N’OFFRE PAS DE CHOIX, donc le parcours continue juste après', () => {
    // C'est exact et ce n'est pas un raccourci : Meta n'envoie AUCUN webhook quand le contact clique un
    // bouton `cta_url`. Traiter ce bloc comme une question gèlerait le parcours sur une réponse qui ne
    // viendra jamais, et le tag posé juste après ne serait jamais posé (le défaut vécu en prod le
    // 2026-08-15 sur un message rapide sans bouton).
    expect(etapeOffreUnChoix(actionDuBloc({ body: 'x', lienActif: true, lienTexte: 'Voir', lienUrl: 'https://exemple.fr' }))).toBe(false);
    // Le miroir, pour que le test prouve la DIFFÉRENCE et pas seulement le `false` : avec des réponses
    // rapides, le même bloc offre bien un choix.
    expect(etapeOffreUnChoix(actionDuBloc({ body: 'x', quickReplies: ['Oui'] }))).toBe(true);
  });
});

describe('bouton de lien : ce qui le rend inutilisable', () => {
  it('un libellé vide est refusé', () => {
    expect(problemeLienBouton({ texte: '  ', url: 'https://exemple.fr' })).toMatch(/libell/);
  });

  it('une adresse vide est refusée', () => {
    expect(problemeLienBouton({ texte: 'Voir', url: '' })).toMatch(/adresse/);
  });

  it('🔴 une ACCOLADE restée dans l’adresse finale est refusée', () => {
    // `problemeLienBouton` juge l'adresse qui part : celle d'un contact a déjà été remplie par
    // `lienPourLeContact`. Une accolade restée est une variable que rien n'a remplacée (mal écrite, ou table de la
    // fiche absente) : Meta refuserait le message ENTIER.
    expect(problemeLienBouton({ texte: 'Voir', url: 'https://exemple.fr/{{prenom}}' })).toMatch(/variable/);
  });

  it('une adresse qui n’en est pas une est refusée', () => {
    expect(problemeLienBouton({ texte: 'Voir', url: 'exemple.fr' })).toBeTruthy();
  });

  it('⚠️ une adresse SANS variable garde la règle du 2026-09-11 : une espace ou un nom de site sans point passent', () => {
    // Des blocs publiés depuis peuvent porter de telles adresses, et personne n'a mesuré que Meta les refuse : les
    // durcir couperait leurs envois au déploiement. Ce test tient la promesse « rien ne change pour l'existant ».
    expect(problemeLienBouton({ texte: 'Voir', url: 'https://site.fr/Catalogue 2026.pdf' })).toBeNull();
    expect(problemeLienBouton({ texte: 'Voir', url: 'https://intranet/devis' })).toBeNull();
  });

  it('🔴 un schéma autre que http(s) est refusé', () => {
    // `javascript:` et `data:` sont les deux qu'on ne veut jamais poser dans un bouton envoyé à un contact,
    // et Meta refuserait de toute façon le message. Une adresse valide au sens de `new URL` ne suffit donc
    // pas, il faut vérifier le schéma.
    expect(problemeLienBouton({ texte: 'Voir', url: 'javascript:alert(1)' })).toMatch(/http/);
    expect(problemeLienBouton({ texte: 'Voir', url: 'ftp://exemple.fr/b.pdf' })).toMatch(/http/);
  });

  it('un lien complet et bien formé ne pose aucun problème', () => {
    expect(problemeLienBouton({ texte: 'Voir', url: 'https://exemple.fr/b.pdf?a=1' })).toBeNull();
    expect(problemeLienBouton({ texte: 'Voir', url: 'http://exemple.fr' })).toBeNull();
  });
});

/**
 * L'ADRESSE REMPLIE PAR LA FICHE DU CONTACT. Demandé par Julien le 2026-11-06 : le lien d'un devis HubSpot, posé
 * sur la fiche par l'intégration (`hs_calc_lien_devis`), doit pouvoir être l'adresse du bouton. Le champ porte
 * l'adresse ENTIÈRE, d'où une valeur insérée telle quelle.
 */
describe('bouton de lien : l’adresse remplie par la fiche du contact', () => {
  const lien = (url: string) => ({ texte: 'Votre devis', url });

  it('🔴 un champ qui porte l’adresse ENTIÈRE la donne telle quelle', () => {
    const r = lienPourLeContact(lien('{{hs_calc_lien_devis}}'), { hs_calc_lien_devis: 'https://devis.exemple.fr/q/AbC-12' });
    expect(r).toEqual({ lien: { texte: 'Votre devis', url: 'https://devis.exemple.fr/q/AbC-12' } });
  });

  it('🔴 un champ placé PLUS LOIN dans l’adresse est encodé, comme dans un lien de modèle', () => {
    // Inséré brut, « Martin & Fils » couperait la requête (la page lirait « Martin »), « Jean #2 » ferait basculer la
    // suite dans le fragment, et `../admin` remonterait le chemin. Mesuré par la relecture du 2026-11-06.
    expect(lienPourLeContact(lien('https://exemple.fr/rdv?nom={{nom}}&ref={{ref}}'), { nom: 'Martin & Fils', ref: 'Jean #2' }))
      .toEqual({ lien: { texte: 'Votre devis', url: 'https://exemple.fr/rdv?nom=Martin%20%26%20Fils&ref=Jean%20%232' } });
    expect(lienPourLeContact(lien('https://exemple.fr/rdv?nom={{nom}}'), { nom: 'Hervé' }))
      .toEqual({ lien: { texte: 'Votre devis', url: 'https://exemple.fr/rdv?nom=Herv%C3%A9' } });
    expect(lienPourLeContact(lien('https://exemple.fr/devis/{{id}}'), { id: '../admin' }))
      .toEqual({ lien: { texte: 'Votre devis', url: 'https://exemple.fr/devis/..%2Fadmin' } });
  });

  it('un champ qui ouvre l’adresse, suivi d’un autre : le premier tel quel, le second encodé', () => {
    expect(lienPourLeContact(lien('{{base}}/devis/{{id}}'), { base: 'https://exemple.fr', id: 'A 12' }))
      .toEqual({ lien: { texte: 'Votre devis', url: 'https://exemple.fr/devis/A%2012' } });
  });

  it('🔴 une variable SANS VALEUR refuse l’envoi, même au milieu de l’adresse, et la nomme', () => {
    // `https://exemple.fr/devis/` serait une adresse VALIDE qui ouvre la mauvaise page sans que rien ne le dise :
    // c'est ce cas-là, pas l'adresse vide, qui fait de ce refus une règle à part. `.` et `..` seuls comptent pour
    // vides, comme dans un lien de modèle : ils remonteraient le chemin.
    for (const vars of [{}, { id: '' }, { id: '   ' }, { id: null }, { id: '..' }, { id: '.' }]) {
      expect(lienPourLeContact(lien('https://exemple.fr/devis/{{id}}'), vars)).toEqual({
        refus: 'le bouton de lien n’est pas parti : ce contact n’a pas de valeur pour {{id}}',
      });
    }
  });

  it('🔴 une valeur qui n’est pas une adresse http(s) est refusée, avec la raison de `problemeLienBouton`', () => {
    // Un champ peut être écrit par le contact lui-même (réponse à une Question) : rien de ce qu'il y met ne doit
    // devenir un `javascript:` dans un bouton.
    expect(lienPourLeContact(lien('{{site}}'), { site: 'javascript:alert(1)' })).toEqual({ refus: expect.stringMatching(/http/) });
    expect(lienPourLeContact(lien('{{site}}'), { site: 'exemple.fr' })).toEqual({ refus: expect.stringMatching(/adresse valide/) });
  });

  it('sans table de la fiche, l’adresse garde ses accolades et elle est refusée', () => {
    expect(lienPourLeContact(lien('{{hs_calc_lien_devis}}'), undefined)).toEqual({ refus: expect.stringMatching(/variable/) });
  });

  it('⚠️ une adresse SANS variable part octet pour octet comme saisie, sans passer par l’analyseur', () => {
    // L'analyseur ajouterait la barre finale (`https://exemple.fr/`) : un bloc existant ne doit rien voir changer.
    expect(lienPourLeContact(lien('https://exemple.fr'), { id: 'x' })).toEqual({ lien: lien('https://exemple.fr') });
  });
});

describe('bouton de lien : ce qui arrive à la couche d’envoi', () => {
  it('🔴 le lien traverse l’exécuteur jusqu’au SIXIÈME argument', async () => {
    // C'est le paramètre qu'une implémentation trop courte avale en silence (le piège documenté du
    // CLAUDE.md). Ici on prouve qu'il PART ; `tests/workflow-envois-bloc.test.ts` prouve qu'il ARRIVE, dans le
    // module d'envoi et à travers le vrai câblage.
    const sendQuickMessage = vi.fn().mockResolvedValue(undefined);
    const ex = new WorkflowExecutor(deps({ sendQuickMessage }));
    await ex.demarrer('automatisme_ordinaire', 't1', 'wf1', graphe({ body: 'La brochure', lienActif: true, lienTexte: 'Voir', lienUrl: 'https://exemple.fr' }), { waId: '336', contactId: null }, { depuis: 'entree', fenetreOuverte: true });
    expect(sendQuickMessage).toHaveBeenCalledWith('t1', '336', 'La brochure', [], undefined, { texte: 'Voir', url: 'https://exemple.fr' });
  });

  it('⚠️ les variables du corps sont résolues comme sur n’importe quel message rapide', async () => {
    const sendQuickMessage = vi.fn().mockResolvedValue(undefined);
    const ex = new WorkflowExecutor(deps({ sendQuickMessage, varsFor: async () => ({ prenom: 'Camille' }) }));
    await ex.demarrer('automatisme_ordinaire', 't1', 'wf1', graphe({ body: 'Bonjour {{prenom}}', lienActif: true, lienTexte: 'Voir', lienUrl: 'https://exemple.fr' }), { waId: '336', contactId: null }, { depuis: 'entree', fenetreOuverte: true });
    expect(sendQuickMessage).toHaveBeenCalledWith('t1', '336', 'Bonjour Camille', [], undefined, expect.anything());
  });

  it('🔴 l’adresse remplie par la fiche arrive au SIXIÈME argument, plus ses accolades', async () => {
    const sendQuickMessage = vi.fn().mockResolvedValue(undefined);
    const ex = new WorkflowExecutor(deps({ sendQuickMessage, varsFor: async () => ({ hs_calc_lien_devis: 'https://devis.exemple.fr/q/1' }) }));
    await ex.demarrer('automatisme_ordinaire', 't1', 'wf1', graphe({ body: 'Votre devis est prêt', lienActif: true, lienTexte: 'Votre devis', lienUrl: '{{hs_calc_lien_devis}}' }), { waId: '336', contactId: null }, { depuis: 'entree', fenetreOuverte: true });
    expect(sendQuickMessage).toHaveBeenCalledWith('t1', '336', 'Votre devis est prêt', [], undefined, { texte: 'Votre devis', url: 'https://devis.exemple.fr/q/1' });
  });

  it('⚠️ corps ET adresse à variable : la fiche n’est lue qu’UNE fois, et sert aux deux', async () => {
    // Une campagne envoie ce bloc à des milliers de contacts : deux lectures par destinataire doubleraient la charge.
    const sendQuickMessage = vi.fn().mockResolvedValue(undefined);
    const varsFor = vi.fn().mockResolvedValue({ prenom: 'Camille', hs_calc_lien_devis: 'https://devis.exemple.fr/q/1' });
    const ex = new WorkflowExecutor(deps({ sendQuickMessage, varsFor }));
    await ex.demarrer('automatisme_ordinaire', 't1', 'wf1', graphe({ body: 'Bonjour {{prenom}}', lienActif: true, lienTexte: 'Votre devis', lienUrl: '{{hs_calc_lien_devis}}' }), { waId: '336', contactId: null }, { depuis: 'entree', fenetreOuverte: true });
    expect(varsFor).toHaveBeenCalledTimes(1);
    expect(sendQuickMessage).toHaveBeenCalledWith('t1', '336', 'Bonjour Camille', [], undefined, { texte: 'Votre devis', url: 'https://devis.exemple.fr/q/1' });
  });

  it('🔴 un champ vide sur la fiche : RIEN ne part chez Meta, et le démarrage dit pourquoi', async () => {
    // Le devis retiré de la fiche (aucun devis publié sur la transaction) : un message sans son bouton, ou avec
    // un bouton qui n'ouvre rien, serait pire qu'un refus nommé dans l'historique du scénario.
    const sendQuickMessage = vi.fn().mockResolvedValue(undefined);
    const ex = new WorkflowExecutor(deps({ sendQuickMessage, varsFor: async () => ({ prenom: 'Camille' }) }));
    const issue = await ex.demarrer('automatisme_ordinaire', 't1', 'wf1', graphe({ body: 'Votre devis est prêt', lienActif: true, lienTexte: 'Votre devis', lienUrl: '{{hs_calc_lien_devis}}' }), { waId: '336', contactId: null }, { depuis: 'entree', fenetreOuverte: true });
    expect(sendQuickMessage).not.toHaveBeenCalled();
    expect(issue).toBe('le bouton de lien n’est pas parti : ce contact n’a pas de valeur pour {{hs_calc_lien_devis}}');
  });
});
