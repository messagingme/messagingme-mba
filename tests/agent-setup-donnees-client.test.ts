import { describe, it, expect } from 'vitest';
import {
  AGENDA, CODE_DONNEES_CLIENT, CODES_POINTS, INVENTAIRE_VIDE, accordDonneesClient, agendaEffectif, fusionner,
  manquesDeCouverture, MARQUE_OUI_OU_NON, ouiOuNon, outilLireFiche, questionOuiOuNonMontree,
  pointDonneesClient, reponseOuiOuNon, sansSesQuestions, annonceUneFin, type Inventaire,
} from '../src/agent/setup/couverture';
import { consigneDuTour, inventaireDe, type ContexteConstruction } from '../src/agent/setup/conversation';
import { BORNES_PROPOSITION, differences, type EtatCourant } from '../src/agent/setup/proposition';
import { ficheVide } from '../src/agent/fiche';

/**
 * 🔴 LE POINT DES DONNÉES DE LA FICHE (2026-11-23, décisions de Julien). Un agent créé après le branchement de Shopify ou
 * de HubSpot doit pouvoir s'appuyer sur ce que ces intégrations écrivent sur la fiche. L'entretien pose donc une question
 * de plus, SEULEMENT si une intégration est branchée, et elle ne nomme QUE celles qui le sont : « ne pas parler de HubSpot
 * quand le mec a branché Shopify, et l'inverse ».
 */
const avec = (integrations: Inventaire['integrations']): Inventaire => ({ ...INVENTAIRE_VIDE, integrations });
/** Des champs HubSpot importés, par libellé : la clé suit la règle `cleChampHubspot`. */
const hs = (...libelles: string[]) => libelles.map((libelle, i) => ({ cle: `hs_contact_champ_${i}`, libelle }));
const SHOPIFY = avec({ shopify: true, hubspot: [] });
const HUBSPOT = avec({ shopify: false, hubspot: [{ cle: 'hs_calc_conseiller', libelle: 'Conseiller' }, { cle: 'hs_calc_lien_devis', libelle: 'Lien du devis' }] });
const LES_DEUX = avec({ shopify: true, hubspot: [{ cle: 'hs_calc_conseiller', libelle: 'Conseiller' }] });
const vide = { poses: [], reponses: [], bascules: [] };

describe('la question des données de la fiche', () => {
  it('🔴 aucune intégration qui écrive sur les fiches : aucun point, l’ordre du jour de tous les espaces', () => {
    for (const inv of [INVENTAIRE_VIDE, avec({ shopify: false, hubspot: [] }), avec({ shopify: false, hubspot: hs('  ') })]) {
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
    const beaucoup = pointDonneesClient(avec({ shopify: false, hubspot: hs('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h') }))!;
    expect(beaucoup.question).toMatch(/a, b, c, d, e et f et 2 autres/);
  });

  it('🔴 la question est un oui ou un non, et ce n’est plus le modèle qui pose l’outil', () => {
    const p = pointDonneesClient(SHOPIFY)!;
    expect(p.question).toMatch(/Répondez oui ou non.$/);
    expect(p.aObtenir).toMatch(/ne propose pas `lire_contact`/);
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

/**
 * 🔴 SUR UN OUI, L'OUTIL EST POSÉ PAR LE SERVEUR, AVEC UNE CARTE, ET ACTIVÉ À L'ENREGISTREMENT (2026-11-23). Julien : « poser
 * des questions si ce n'est pas concrètement suivi de la mise en place d'un outil, ça ne sert à rien ». Avant, tout
 * dépendait du modèle : un oui pouvait finir sans outil, ou avec un outil inactif qui ne disait pas où regarder.
 */
describe('le oui se lit sans le modèle', () => {
  it('🔴 la question porte la marque du oui ou non, et la marque se reconnaît dans une reformulation', () => {
    expect(pointDonneesClient(SHOPIFY)!.question.endsWith(MARQUE_OUI_OU_NON)).toBe(true);
    expect(questionOuiOuNonMontree('Je reformule : on s’en sert ? répondez  OUI ou non')).toBe(true);
    expect(questionOuiOuNonMontree('C’est enregistré.')).toBe(false);
  });

  it('🔴 oui, non, ou rien qui ne ressorte', () => {
    for (const t of ['oui', 'Oui, pour les commandes', 'ok', 'd’accord', 'bien sûr', '« oui »', 'Volontiers', '1', '1)', 'pas de souci', 'je veux bien']) expect(ouiOuNon(t), t).toBe('oui');
    for (const t of ['non', 'Non merci', 'pas pour l’instant', 'jamais', 'nope', '2']) expect(ouiOuNon(t), t).toBe('non');
    // Un nombre en tête d'une phrase ne décide rien.
    for (const t of ['je ne sais pas', 'nous verrons', 'okapi', 'peut-être', '', '2 000 commandes par mois, oui']) expect(ouiOuNon(t), t).toBeNull();
  });

  it('🔴 le oui se cherche dans TOUT le message : les réponses réelles de Maison Saint-Honoré (2026-11-24)', () => {
    const question = pointDonneesClient(SHOPIFY)!.question;
    // Le client recopie la question, puis répond : quatre « Oui » jamais lus avant le correctif.
    expect(reponseOuiOuNon('votre agent doit-il utiliser les commandes du client et le lien de suivi de son colis pour répondre à « où en est ma commande ? » par exemple ? Oui')).toBe('oui');
    expect(reponseOuiOuNon(`Conseiller virtuel Maison Saint-Honoré Paris => Courtois, professionnel\n${question} => Oui`)).toBe('oui');
    expect(reponseOuiOuNon(`${question} => Oui`)).toBe('oui');
    expect(reponseOuiOuNon(`Phrases courtes\nNon`)).toBe('non');
    // Une réponse à une AUTRE question ne décide rien.
    for (const t of ['Vouvoiement', 'phrases courtes et directes et emojis oui',
      'Maintenant, parlons de son comportement. Au bout de combien de temps SANS réponse du contact l’agent doit-il arrêter d’attendre, en minutes ? 2 heures',
      '2 000 commandes par mois, oui', 'oui\nnon']) expect(reponseOuiOuNon(t), t).toBeNull();
    // Ce qui précède la DERNIÈRE marque recopiée ne compte pas.
    expect(reponseOuiOuNon(`non, pas d’emoji\n${question} => oui`)).toBe('oui');
  });

  it('🔴 la question du serveur part seule : le modèle garde son accusé de réception, pas ses questions', () => {
    const modele = 'Noté. Pour la demande de contact : l’agent donne l’email.\n\nMaintenant, sur chacun de ces moments, dites-moi ce que l’agent doit FAIRE exactement :\n\n**Pour « demande de contact » :** doit-il simplement répondre avec l’email ?\n\nQuel ton ? Répondez oui ou non.';
    const reste = sansSesQuestions(modele);
    expect(reste).toBe('Noté. Pour la demande de contact : l’agent donne l’email.');
    expect(sansSesQuestions('Quel ton ? Vouvoiement ?')).toBe('');
  });

  it('🔴 une annonce de fin se reconnaît : les messages réels de Maison Saint-Honoré (2026-11-24)', () => {
    for (const t of ['Votre agent est prêt ! 🎉', 'Parfait ! Voici votre agent configuré. ✨', 'Votre agent est maintenant configuré.',
      'C’est tout bon, tout est en place.']) expect(annonceUneFin(t), t).toBe(true);
    for (const t of ['Noté : 2 heures, c’est 120 minutes.', 'Pour que votre agent soit prêt à répondre, j’ai besoin de votre site.',
      'Compris. L’humain reprend à n’importe quel moment.', 'Une dernière question avant de finaliser : vouvoiement ?',
      'Noté : l’agent sera configuré pour vouvoyer.', 'Quand l’agent sera prêt, vous recevrez la proposition.',
      'Tout est réglé de ce côté ?']) expect(annonceUneFin(t), t).toBe(false);
  });

  it('l’accord se relit dans la réponse rangée, quelle que soit sa tournure', () => {
    expect(accordDonneesClient([{ point: CODE_DONNEES_CLIENT, valeur: 'Oui, pour suivre ses colis' }])).toBe('oui');
    expect(accordDonneesClient([{ point: CODE_DONNEES_CLIENT, valeur: 'non' }])).toBe('non');
    expect(accordDonneesClient([{ point: 'ton', valeur: 'oui' }])).toBeNull();
  });
});

describe('l’outil de lecture de la fiche, écrit par le serveur', () => {
  it('🔴 Shopify : la carte nomme le lien de suivi et les dates d’expédition, jamais HubSpot', () => {
    const o = outilLireFiche(SHOPIFY)!;
    expect(o.handler).toBe('lire_contact');
    expect(o.description).toMatch(/AVANT de répondre à une question sur une commande, une livraison ou un colis/);
    expect(o.description).toContain('`shopify_lien_suivi`');
    expect(o.description).toContain('`expediee_le`');
    expect(o.description).not.toMatch(/HubSpot/);
    expect(o.nePasUtiliser).toMatch(/Ne jamais inventer/);
  });

  it('🔴 HubSpot : la carte nomme chaque champ par sa clé de fiche ET son libellé, jamais Shopify', () => {
    const o = outilLireFiche(HUBSPOT)!;
    expect(o.description).toContain('`hs_calc_conseiller` (Conseiller)');
    expect(o.description).toContain('`hs_calc_lien_devis` (Lien du devis)');
    expect(o.description).not.toMatch(/shopify|commande|colis/i);
  });

  it('aucune intégration : aucun outil ; beaucoup de champs : la carte tient dans la borne d’une description', () => {
    expect(outilLireFiche(INVENTAIRE_VIDE)).toBeNull();
    const longs = hs(...Array.from({ length: 20 }, (_, i) => `Une propriété au libellé très long numéro ${i}`));
    const o = outilLireFiche(avec({ shopify: true, hubspot: longs }))!;
    expect(o.description.length).toBeLessThanOrEqual(BORNES_PROPOSITION.description);
    expect(o.description).toMatch(/et 14 autres/);
  });
});

describe('l’activation a sa ligne dans le diff', () => {
  const courant = (outils: EtatCourant['outils']): EtatCourant => ({
    mentionIaFrequence: 'session', inactiviteMinutes: 30, fiche: ficheVide(), outils,
  });
  const lire = outilLireFiche(SHOPIFY)!;
  const proposition = { message: 'Voici.', fiche: {}, outils: [lire] };
  const lignesActif = (c: EtatCourant) => differences(c, proposition, ['lire_contact']).filter((l) => l.champ === 'outil.lire_contact.actif');

  it('🔴 absent ou inactif : une ligne, même quand ses mots sont déjà les bons', () => {
    expect(lignesActif(courant([]))).toEqual([
      { champ: 'outil.lire_contact.actif', label: 'Lire la fiche du contact (à ajouter) : activé dès l’enregistrement', avant: 'absent', apres: 'actif' },
    ]);
    const memesMots = courant([{ handler: 'lire_contact', description: lire.description, nePasUtiliser: lire.nePasUtiliser, actif: false }]);
    expect(differences(memesMots, proposition, ['lire_contact']).map((l) => l.champ)).toEqual(['outil.lire_contact.actif']);
  });

  it('déjà actif : aucune ligne d’activation ; sans demande du serveur, jamais', () => {
    expect(lignesActif(courant([{ handler: 'lire_contact', description: 'x', nePasUtiliser: '', actif: true }]))).toEqual([]);
    expect(differences(courant([]), proposition).filter((l) => l.champ.endsWith('.actif'))).toEqual([]);
  });
});
