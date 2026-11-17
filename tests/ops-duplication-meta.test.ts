import { describe, it, expect } from 'vitest';
import type { TemplateSummary } from '../src/meta/templates';
import type { FlowScreenDef } from '../src/meta/flow-json';
import {
  PLAFOND_META, avecHandles, planifierMeta, pourquoiNonRecreable, signatureModele, versDemandeDeCreation,
  type EtatMeta, type FlowSource,
} from '../src/ops/duplication/meta';

/**
 * LES TEMPLATES ET LES FLOWS D'UN SCÉNARIO DUPLIQUÉ (lot 3, tâches 1 et 2 du plan
 * `docs/superpowers/plans/2026-11-17-duplication-scenario-lot-3.md`) : leur sort, la traduction d'un template lu en
 * demande de création, et l'empreinte qui ignore l'adresse signée des médias.
 */

const modele = (over: Partial<TemplateSummary> = {}): TemplateSummary => ({
  id: 'm1', name: 'accueil', status: 'APPROVED', category: 'MARKETING', language: 'fr', body: 'Bonjour {{1}}',
  headerFormat: null, isCarousel: false, editable: true, ...over,
});

const ECRAN = { id: 'FORM', title: 'Formulaire', elements: [] } as unknown as FlowScreenDef;
const flow = (over: Partial<FlowSource> = {}): FlowSource => ({
  id: '111', nom: 'Inscription', publie: true, ecrans: [ECRAN], mapping: { email: 'email_pro' }, cta: null, ...over,
});

const LIEN_TRACE = 'https://api.messagingme.app/r/abcdefghjkmn/{{1}}';

describe('pourquoiNonRecreable', () => {
  const flows = new Map([['111', flow()], ['222', flow({ id: '222', ecrans: null })]]);
  it('un template simple se recrée ; un template introuvable dans la source, non', () => {
    expect(pourquoiNonRecreable(modele(), flows)).toBeNull();
    expect(pourquoiNonRecreable(undefined, flows)).toBe('introuvable');
  });
  it('ce que la création ne sait pas soumettre : authentification, boutons non relus, en-tête de lieu', () => {
    expect(pourquoiNonRecreable(modele({ category: 'AUTHENTICATION' }), flows)).toBe('categorie');
    expect(pourquoiNonRecreable(modele({ boutonsNonRelus: true }), flows)).toBe('boutons');
    expect(pourquoiNonRecreable(modele({ headerFormat: 'LOCATION' }), flows)).toBe('entete');
  });
  it('un média sans adresse relue, en-tête ou carte de carrousel', () => {
    expect(pourquoiNonRecreable(modele({ headerFormat: 'IMAGE' }), flows)).toBe('media');
    expect(pourquoiNonRecreable(modele({ headerFormat: 'IMAGE', headerMediaUrl: 'https://cdn/x.jpg' }), flows)).toBeNull();
    expect(pourquoiNonRecreable(modele({ isCarousel: true, carousel: { cards: [{ mediaUrl: 'https://cdn/a.jpg', mediaFormat: 'IMAGE' }, { mediaFormat: 'IMAGE' }] } }), flows)).toBe('media');
  });
  it('🔴 un bouton qui porte encore NOTRE lien de redirection ne se recopie pas : ses clics iraient à la source', () => {
    expect(pourquoiNonRecreable(modele({ buttons: [{ type: 'URL', text: 'Voir', url: LIEN_TRACE }] }), flows)).toBe('liens');
    expect(pourquoiNonRecreable(modele({ buttons: [{ type: 'URL', text: 'Voir', url: 'https://site.fr/commande/{numero}' }] }), flows)).toBeNull();
  });
  it('un bouton Flow : son Flow doit exister dans la source, avec ses écrans', () => {
    expect(pourquoiNonRecreable(modele({ buttons: [{ type: 'FLOW', text: 'Remplir', flowId: '111' }] }), flows)).toBeNull();
    expect(pourquoiNonRecreable(modele({ buttons: [{ type: 'FLOW', text: 'Remplir', flowId: '222' }] }), flows)).toBe('flow');
    expect(pourquoiNonRecreable(modele({ buttons: [{ type: 'FLOW', text: 'Remplir', flowId: '999' }] }), flows)).toBe('flow');
  });
});

describe('versDemandeDeCreation et avecHandles', () => {
  it('le même nom, la même langue, la même catégorie, le corps, ses exemples, le pied, la durée, les boutons dans l’ordre', () => {
    const { input, medias } = versDemandeDeCreation(modele({
      category: 'UTILITY', example: ['Julie'], footer: 'À bientôt', ttlSecondes: 3600, headerFormat: 'TEXT', headerText: 'Votre commande',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Oui' },
        { type: 'URL', text: 'Suivre', url: 'https://site.fr/commande/{numero}' },
        { type: 'FLOW', text: 'Remplir', flowId: '111' },
      ],
    }), (id) => (id === '111' ? '555' : null));
    expect(medias).toEqual([]);
    expect(input).toEqual({
      name: 'accueil', category: 'UTILITY', language: 'fr', body: 'Bonjour {{1}}', example: ['Julie'], footer: 'À bientôt', ttlSecondes: 3600,
      header: { format: 'TEXT', text: 'Votre commande' },
      buttons: [
        { type: 'QUICK_REPLY', text: 'Oui' },
        { type: 'URL', text: 'Suivre', url: 'https://site.fr/commande/{numero}' },
        { type: 'FLOW', text: 'Remplir', flowId: '555' },
      ],
    });
  });
  it('un en-tête image et un carrousel : les médias à redéposer, puis leurs handles posés à leur place', () => {
    const entete = versDemandeDeCreation(modele({ headerFormat: 'IMAGE', headerMediaUrl: 'https://cdn/h.jpg' }), () => null);
    expect(entete.medias).toEqual([{ place: 'entete', url: 'https://cdn/h.jpg', format: 'IMAGE' }]);
    expect(avecHandles(entete.input, [{ place: 'entete', handle: 'H-1' }]).header).toEqual({ format: 'IMAGE', handle: 'H-1' });

    const carrousel = versDemandeDeCreation(modele({
      isCarousel: true,
      carousel: { cards: [
        { mediaUrl: 'https://cdn/a.jpg', mediaFormat: 'IMAGE', body: 'Carte A', buttons: [{ type: 'URL', text: 'Voir', url: 'https://site.fr/a' }] },
        { mediaUrl: 'https://cdn/b.mp4', mediaFormat: 'VIDEO' },
      ] },
    }), () => null);
    expect(carrousel.medias).toEqual([{ place: 0, url: 'https://cdn/a.jpg', format: 'IMAGE' }, { place: 1, url: 'https://cdn/b.mp4', format: 'VIDEO' }]);
    expect(carrousel.input.buttons).toBeUndefined();
    expect(avecHandles(carrousel.input, [{ place: 0, handle: 'C-0' }, { place: 1, handle: 'C-1' }]).carousel).toEqual({ cards: [
      { headerHandle: 'C-0', body: 'Carte A', buttons: [{ type: 'URL', text: 'Voir', url: 'https://site.fr/a' }] },
      { headerHandle: 'C-1' },
    ] });
  });
});

describe('signatureModele', () => {
  it('l’adresse d’un média, que Meta signe à chaque lecture, n’entre pas dans l’empreinte ; son contenu, si', () => {
    const a = modele({ headerFormat: 'IMAGE', headerMediaUrl: 'https://cdn/h.jpg?oh=1&oe=2' });
    const b = modele({ headerFormat: 'IMAGE', headerMediaUrl: 'https://cdn/h.jpg?oh=9&oe=8' });
    expect(JSON.stringify(signatureModele(a))).toBe(JSON.stringify(signatureModele(b)));
    expect(JSON.stringify(signatureModele(modele({ body: 'Autre' })))).not.toBe(JSON.stringify(signatureModele(modele())));
  });
});

describe('planifierMeta', () => {
  const etat = (over: Partial<EtatMeta> = {}): EtatMeta => ({
    templates: [
      { nom: 'deja', langue: 'fr', blocs: [{ nodeId: 't1', nom: 'Bienvenue' }] },
      { nom: 'accueil', langue: 'fr', blocs: [{ nodeId: 't2', nom: 'Accueil' }] },
      { nom: 'otp', langue: 'fr', blocs: [{ nodeId: 't3', nom: 'Code' }] },
    ],
    blocsFlow: [{ nodeId: 'f1', nom: 'Formulaire', flowId: '333', flowNom: 'Avis' }],
    destination: [{ nom: 'deja', langue: 'fr', statut: 'APPROVED', boutons: [] }],
    source: [
      modele({ name: 'accueil', buttons: [{ type: 'URL', text: 'Suivre', url: 'https://site.fr/{ville}' }, { type: 'FLOW', text: 'Remplir', flowId: '111' }] }),
      modele({ name: 'otp', category: 'AUTHENTICATION' }),
    ],
    flowsSource: [flow(), flow({ id: '333', nom: 'Avis', publie: false, mapping: { note: 'note_avis' } })],
    indicesSource: [{ nom: 'accueil', langue: 'fr', indices: [{ position: 1, source: { type: 'field', key: 'prenom_client' } }] }],
    nomsFlowsPris: ['inscription'],
    champsSource: [
      { key: 'ville', label: 'Ville', type: 'text' }, { key: 'email_pro', label: 'E-mail pro', type: 'text' },
      { key: 'note_avis', label: 'Note', type: 'number' }, { key: 'prenom_client', label: 'Prénom', type: 'text' },
    ],
    champsDestination: [{ key: 'email_pro', label: 'E-mail pro', type: 'text' }],
    ...over,
  });

  it('sans choix : chaque template et chaque Flow avec son sort ; tout ce qui n’est pas réutilisé arrive débranché', () => {
    const p = planifierMeta(etat());
    expect(p.apercu.templates.map((t) => [t.nom, t.etat, t.raison])).toEqual([
      ['deja', 'reutilise', null], ['accueil', 'a_recreer', null], ['otp', 'non_recreable', 'categorie'],
    ]);
    expect(p.apercu.templates[1]!.flows).toEqual(['111']);
    // Le Flow du bloc d'abord, puis celui du bouton ; « Inscription » est pris (casse ignorée) dans la destination.
    expect(p.apercu.flows.map((f) => [f.id, f.nomCopie, f.publie, f.recreable])).toEqual([
      ['333', 'Avis', false, true], ['111', 'Inscription (copie)', true, true],
    ]);
    expect(p.templatesADebrancher).toEqual(['t2', 't3']);
    expect(p.copies).toEqual({ flows: [], templates: [] });
  });

  it('un template coché part avec le Flow de son bouton, publié comme à la source ; son bloc n’est plus débranché', () => {
    const p = planifierMeta(etat(), { templates: [{ nom: 'accueil', langue: 'fr' }], flows: [] });
    expect(p.choixInvalides).toEqual([]);
    expect(p.copies.templates).toEqual([{ nom: 'accueil', langue: 'fr', flows: ['111'] }]);
    expect(p.copies.flows.map((f) => [f.id, f.nomCopie, f.publier])).toEqual([['111', 'Inscription (copie)', true]]);
    expect(p.templatesADebrancher).toEqual(['t3']);
  });

  it('les champs : ceux des adresses se créent AVANT la soumission ; ceux d’un Flow, absents de la destination, avec lui', () => {
    const p = planifierMeta(etat(), { templates: [{ nom: 'accueil', langue: 'fr' }], flows: ['333'] });
    expect(p.champsAvantMeta).toEqual([{ key: 'ville', label: 'Ville', type: 'text' }]);
    expect(p.copies.flows.find((f) => f.id === '333')!.champsAAssurer).toEqual([{ key: 'note_avis', label: 'Note', type: 'number' }]);
    // `email_pro` existe déjà dans la destination : jamais réécrit (le `upsert` de la persistance des Flows le changerait).
    expect(p.copies.flows.find((f) => f.id === '111')!.champsAAssurer).toEqual([]);
    expect([...p.clesDeChamp].sort()).toEqual(['email_pro', 'note_avis', 'prenom_client', 'ville']);
  });

  it('🔴 une case qui ne désigne rien de recréable : choixInvalides, et AUCUNE copie', () => {
    const p = planifierMeta(etat(), { templates: [{ nom: 'otp', langue: 'fr' }, { nom: 'deja', langue: 'fr' }], flows: ['999'] });
    expect(p.choixInvalides).toEqual(['otp (fr)', 'deja (fr)', '999']);
    expect(p.copies).toEqual({ flows: [], templates: [] });
  });

  it('la source illisible : un template absent n’a pas de case, et son bloc arrive débranché', () => {
    const p = planifierMeta(etat({ source: null }));
    expect(p.apercu.templates.find((t) => t.nom === 'accueil')).toMatchObject({ etat: 'non_recreable', raison: 'lecture' });
  });

  it('un Flow sans écrans ne se recrée pas : pas de case', () => {
    const p = planifierMeta(etat({ flowsSource: [flow(), flow({ id: '333', nom: 'Avis', ecrans: null })] }), { templates: [], flows: ['333'] });
    expect(p.apercu.flows.find((f) => f.id === '333')!.recreable).toBe(false);
    expect(p.choixInvalides).toEqual(['333']);
  });

  it(`au-delà de ${PLAFOND_META} objets cochés à recréer : depasse`, () => {
    const nombreux = Array.from({ length: PLAFOND_META + 1 }, (_, i) => `m${i}`);
    const p = planifierMeta(etat({
      templates: nombreux.map((n, i) => ({ nom: n, langue: 'fr', blocs: [{ nodeId: `n${i}`, nom: n }] })),
      blocsFlow: [],
      source: nombreux.map((n) => modele({ name: n })),
    }), { templates: nombreux.map((n) => ({ nom: n, langue: 'fr' })), flows: [] });
    expect(p.depasse).toBe(true);
  });
});
