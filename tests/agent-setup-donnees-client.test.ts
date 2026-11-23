import { describe, it, expect } from 'vitest';
import {
  AGENDA, CODE_DONNEES_CLIENT, CODES_POINTS, INVENTAIRE_VIDE, agendaEffectif, fusionner, manquesDeCouverture,
  pointDonneesClient, type Inventaire,
} from '../src/agent/setup/couverture';
import { consigneDuTour, inventaireDe, type ContexteConstruction } from '../src/agent/setup/conversation';
import { ficheVide } from '../src/agent/fiche';

/**
 * 🔴 LE POINT DES DONNÉES DE LA FICHE (2026-11-23, décisions de Julien). Un agent créé après le branchement de Shopify ou
 * de HubSpot doit pouvoir s'appuyer sur ce que ces intégrations écrivent sur la fiche. L'entretien pose donc une question
 * de plus, SEULEMENT si une intégration est branchée, et elle ne nomme QUE celles qui le sont : « ne pas parler de HubSpot
 * quand le mec a branché Shopify, et l'inverse ».
 */
const avec = (integrations: Inventaire['integrations']): Inventaire => ({ ...INVENTAIRE_VIDE, integrations });
const SHOPIFY = avec({ shopify: true, hubspot: [] });
const HUBSPOT = avec({ shopify: false, hubspot: ['Conseiller', 'Lien du devis'] });
const LES_DEUX = avec({ shopify: true, hubspot: ['Conseiller'] });
const vide = { poses: [], reponses: [], bascules: [] };

describe('la question des données de la fiche', () => {
  it('🔴 aucune intégration qui écrive sur les fiches : aucun point, l’ordre du jour de tous les espaces', () => {
    for (const inv of [INVENTAIRE_VIDE, avec({ shopify: false, hubspot: [] }), avec({ shopify: false, hubspot: ['  '] })]) {
      expect(pointDonneesClient(inv)).toBeNull();
      expect(agendaEffectif(vide, inv).map((p) => p.code)).toEqual(AGENDA.map((p) => p.code));
    }
  });

  it('🔴 Shopify seul : la question parle de ses commandes et du lien de suivi, jamais de HubSpot', () => {
    const p = pointDonneesClient(SHOPIFY)!;
    expect(p.question).toMatch(/Shopify/);
    expect(p.question).toMatch(/lien de suivi/);
    expect(p.question).toMatch(/où en est ma commande/);
    expect(`${p.question} ${p.aObtenir}`).not.toMatch(/HubSpot/);
  });

  it('🔴 HubSpot seul : la question nomme ses champs importés, jamais Shopify', () => {
    const p = pointDonneesClient(HUBSPOT)!;
    expect(p.question).toMatch(/HubSpot : Conseiller et Lien du devis/);
    expect(`${p.question} ${p.aObtenir}`).not.toMatch(/Shopify|commande|suivi/);
  });

  it('les deux branchées : les deux sont nommées ; au-delà de six champs, « et N autres »', () => {
    const p = pointDonneesClient(LES_DEUX)!;
    expect(p.question).toMatch(/Shopify/);
    expect(p.question).toMatch(/HubSpot : Conseiller/);
    const beaucoup = pointDonneesClient(avec({ shopify: false, hubspot: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }))!;
    expect(beaucoup.question).toMatch(/a, b, c, d, e et f et 2 autres/);
  });

  it('🔴 sur un oui, l’assistant propose la lecture de la fiche, avec ses mots ; sur un non, rien', () => {
    const p = pointDonneesClient(SHOPIFY)!;
    expect(p.aObtenir).toMatch(/`lire_contact`/);
    expect(p.aObtenir).toMatch(/S’il dit non, ne le propose pas/);
  });

  it('il se pose juste après l’origine des réponses de fond, et il compte dans la couverture', () => {
    const codes = agendaEffectif(vide, SHOPIFY).map((p) => p.code);
    expect(codes[codes.indexOf('connaissance') + 1]).toBe(CODE_DONNEES_CLIENT);
    expect(codes).toHaveLength(AGENDA.length + 1);
    const jusquALaConnaissance = AGENDA.slice(0, AGENDA.findIndex((p) => p.code === 'connaissance') + 1).map((p) => p.code);
    const etat = { poses: jusquALaConnaissance, reponses: jusquALaConnaissance.map((point) => ({ point, valeur: 'dit' })), bascules: [] };
    expect(manquesDeCouverture(etat, SHOPIFY)[0]).toBe(CODE_DONNEES_CLIENT);
    // Posé et répondu : couvert, comme les autres.
    const couvert = {
      poses: [...etat.poses, CODE_DONNEES_CLIENT],
      reponses: [...etat.reponses, { point: CODE_DONNEES_CLIENT, valeur: 'oui, pour les commandes' }],
      bascules: [],
    };
    expect(manquesDeCouverture(couvert, SHOPIFY)).not.toContain(CODE_DONNEES_CLIENT);
  });

  it('🔴 sa réponse se garde et se range à sa place ; le modèle connaît son code', () => {
    const r = fusionner([{ point: 'ton', valeur: 'vous' }, { point: 'connaissance', valeur: 'le site' }], [{ point: CODE_DONNEES_CLIENT, valeur: 'oui' }]);
    expect(r.map((x) => x.point)).toEqual(['connaissance', CODE_DONNEES_CLIENT, 'ton']);
    expect(CODES_POINTS).toContain(CODE_DONNEES_CLIENT);
  });

  it('🔴 le contexte de construction porte les intégrations jusqu’à la consigne du tour', () => {
    const ctx: ContexteConstruction = {
      label: 'Conseiller', mentionIaFrequence: 'session', inactiviteMinutes: 30, fiche: ficheVide(), outils: [],
      titresConnaissance: [], integrations: { shopify: true, hubspot: [] },
    };
    const inv = inventaireDe(ctx);
    const jusquALaConnaissance = AGENDA.slice(0, AGENDA.findIndex((p) => p.code === 'connaissance') + 1).map((p) => p.code);
    const etat = { poses: jusquALaConnaissance, reponses: jusquALaConnaissance.map((point) => ({ point, valeur: 'dit' })), bascules: [] };
    const consigne = consigneDuTour(etat, inv);
    expect(consigne).toContain(`LE POINT OUVERT : ${CODE_DONNEES_CLIENT}`);
    expect(consigne).toMatch(/Shopify/);
    expect(consigne).not.toMatch(/HubSpot/);
    // Sans intégration dans le contexte, le point n'existe pas.
    expect(consigneDuTour(etat, inventaireDe({ ...ctx, integrations: undefined }))).not.toContain(CODE_DONNEES_CLIENT);
  });
});
