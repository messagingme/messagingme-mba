import { describe, it, expect } from 'vitest';
import { filtersToQuery, type ContactFilters } from '../web/lib/contact-filters';
import { parseFilters } from '../src/http/import';
import { parseBulkTarget } from '../src/http/contacts';
import { FiltreContactInvalide } from '../src/crm/contact-filters';
import { NIVEAUX_RISQUE } from '../src/engagement/risque';
import { CLES_SEGMENT, filtreSegment } from '../web/lib/partage/segments';

// Anti-drift : la sérialisation côté web (`filtersToQuery`) et le parse côté serveur (`parseFilters`) doivent
// s'accorder sur le format fil. On sérialise puis on re-parse : le résultat doit être IDENTIQUE à l'entrée.
// Si un opérateur / critère est ajouté d'un seul côté, ce test casse (le filtre serait silencieusement no-op).

function roundTrip(f: ContactFilters): ContactFilters {
  const qs = filtersToQuery(f);
  return parseFilters(Object.fromEntries(qs.entries()));
}

describe('filtersToQuery (web) <-> parseFilters (serveur) — round-trip', () => {
  it('jeu complet (tags, tagsExclude, optIn, phone, name, 3 ops de champ dont empty) survit intact', () => {
    // Required force à compléter ce test si le contrat gagne un nouveau critère.
    const f: Required<ContactFilters> = {
      tags: ['vip'],
      tagMode: 'or',
      tagsExclude: ['spam'],
      optIn: 'opted_in',
      phonePrefix: '+336',
      phoneContains: '4242',
      nameSearch: 'marc',
      joignabiliteWhatsApp: 'connu_injoignable',
      risque: 'eleve',
      fieldFilters: [
        { key: 'email', op: 'not_empty', value: '' },
        { key: 'ville', op: 'not_contains', value: 'paris' },
        { key: 'segment', op: 'eq', value: 'vip' },
      ],
    };
    expect(roundTrip(f)).toEqual(f);
  });

  it('tagsExclude seul est préservé (pas absorbé par tags)', () => {
    expect(roundTrip({ tagsExclude: ['a', 'b'] })).toEqual({ tagsExclude: ['a', 'b'] });
  });

  it('un filtre empty (sans valeur) survit avec value: ""', () => {
    const f: ContactFilters = { fieldFilters: [{ key: 'email', op: 'empty', value: '' }] };
    expect(roundTrip(f)).toEqual(f);
  });

  it('filtres vides -> objet vide des deux côtés', () => {
    expect(roundTrip({})).toEqual({});
  });

  // 🔴 SEUL, il doit survivre. Un critère ajouté d'un seul côté de la chaîne ne casse RIEN de visible : il
  // est simplement perdu en route, et l'écran affiche un filtre coché qui ne filtre pas.
  it('la joignabilité seule survit au round-trip', () => {
    expect(roundTrip({ joignabiliteWhatsApp: 'connu_injoignable' })).toEqual({ joignabiliteWhatsApp: 'connu_injoignable' });
  });

  it('🔴 chaque niveau de risque, SEUL, survit au round-trip', () => {
    for (const risque of NIVEAUX_RISQUE) expect(roundTrip({ risque })).toEqual({ risque });
  });
});

/**
 * 🔴 LE NIVEAU DE RISQUE EST LE SEUL FILTRE QUI SE REFUSE AU LIEU DE S'IGNORER. Ignoré, un niveau mal écrit ne
 * poserait aucune clause : « risque élevé » rendrait tout l'espace, et une campagne construite dessus partirait à
 * tout le monde. Le refus porte un `statusCode` 400, que le gestionnaire d'erreurs du serveur rend tel quel.
 */
describe('parseFilters : le niveau de risque', () => {
  it.each(['élevé', 'high', 'ELEVE', 'eleve,moyen', ' eleve'])('« %s » est REFUSÉ, pas ignoré', (risque) => {
    let erreur: unknown = null;
    try { parseFilters({ risque }); } catch (e) { erreur = e; }
    expect(erreur).toBeInstanceOf(FiltreContactInvalide);
    expect((erreur as FiltreContactInvalide).statusCode).toBe(400);
  });

  it('une valeur répétée dans l’adresse (un tableau) est refusée aussi', () => {
    expect(() => parseFilters({ risque: ['eleve', 'moyen'] })).toThrow(FiltreContactInvalide);
  });

  it('vide ou absent : ce n’est pas un filtre, rien n’est posé', () => {
    expect(parseFilters({ risque: '' })).toEqual({});
    expect(parseFilters({})).toEqual({});
  });
});

/**
 * 🔴 LES FILTRES DE LA DERNIÈRE ANALYSE SE REFUSENT AUSSI (lot 2b « Tout sur la fiche »). Ils voyagent dans
 * `fieldFilters`, dont le reste retombe sur `eq` quand l'opérateur est inconnu : pour eux, rien n'est deviné.
 */
describe('parseFilters et le corps d’une action en masse : les filtres de la dernière analyse', () => {
  const champ = (fieldFilters: unknown[]) => ({ fields: JSON.stringify(fieldFilters) });

  it('chaque opérateur survit au round-trip, sous sa forme canonique', () => {
    const f: ContactFilters = {
      fieldFilters: [
        { key: 'analyse_sentiment', op: 'in', value: 'negatif,neutre' },
        { key: 'analyse_urgence', op: 'gte', value: '7' },
        { key: 'analyse_satisfaction', op: 'lte', value: '0' },
        { key: 'analyse_resolue', op: 'is_false', value: '' },
        { key: 'analyse_le', op: 'newer_than_days', value: '30' },
        { key: 'analyse_action', op: 'empty', value: '' },
        { key: 'ville', op: 'contains', value: 'paris' },
      ],
    };
    expect(roundTrip(f)).toEqual(f);
    expect(parseFilters(champ([{ key: 'analyse_urgence', op: 'gte', value: '07' }]))).toEqual({
      fieldFilters: [{ key: 'analyse_urgence', op: 'gte', value: '7' }],
    });
  });

  it.each([
    [{ key: 'analyse_urgence', op: 'eq', value: '7' }],
    [{ key: 'analyse_urgence', op: 'gte', value: '' }],
    [{ key: 'analyse_urgence', value: '7' }],
    [{ key: 'analyse_sentiment', op: 'in', value: '' }],
    [{ key: 'analyse_sentiment', op: 'in', value: 'furieux' }],
    [{ key: 'analyse_sujet', op: 'contains', value: 'colis' }],
    [{ key: 'ville', op: 'gte', value: '3' }],
  ])('🔴 %j est REFUSÉ en 400, jamais ignoré ni ramené à « égal »', (filtre) => {
    let erreur: unknown = null;
    try { parseFilters(champ([filtre])); } catch (e) { erreur = e; }
    expect(erreur).toBeInstanceOf(FiltreContactInvalide);
    expect((erreur as FiltreContactInvalide).statusCode).toBe(400);
  });

  it('🔴 le refus traverse le décodage de l’adresse : il n’est pas avalé en « aucun filtre »', () => {
    // Le JSON illisible reste ignoré (donnée externe), mais un JSON lisible qui porte un filtre invalide lève : si
    // la normalisation retournait dans le `try` du décodage, ce refus deviendrait tout l'espace.
    expect(parseFilters({ fields: '{pas du json' })).toEqual({});
    expect(() => parseFilters(champ([{ key: 'analyse_sentiment', op: 'in', value: 'furieux' }]))).toThrow(FiltreContactInvalide);
  });

  it('🔴 la cible d’une campagne est refusée de la même façon', () => {
    expect(() => parseBulkTarget({ filters: { fieldFilters: [{ key: 'analyse_urgence', op: 'gte', value: '42' }] } }))
      .toThrow(FiltreContactInvalide);
    expect(parseBulkTarget({ filters: { fieldFilters: [{ key: 'analyse_urgence', op: 'gte', value: '7' }] } })).toEqual({
      filters: { fieldFilters: [{ key: 'analyse_urgence', op: 'gte', value: '7' }] }, excludeIds: [],
    });
  });
});

/**
 * 🔴 LES CRITÈRES DE SEGMENT (spec du 2026-10-31) voyagent dans `fieldFilters`, sous clé réservée et opérateur `segment`,
 * et se REFUSENT au moindre défaut, par les deux portes : le fil GET de la liste et le corps d'une action en masse ou
 * d'une campagne. Ignoré, « au moins deux commandes » ne poserait aucune clause, et une campagne partirait à tout l'espace.
 */
describe('les critères de segment : dans fieldFilters, refusés au moindre défaut', () => {
  const S = CLES_SEGMENT;
  const brut = (key: string, value: unknown, op = 'segment') => ({ key, op, value: typeof value === 'string' ? value : JSON.stringify(value) });
  const parGet = (champs: unknown[]): unknown => parseFilters({ fields: JSON.stringify(champs) });
  const parCorps = (champs: unknown[]): unknown => parseBulkTarget({ filters: { fieldFilters: champs } });

  it('chaque critère, seul ou ensemble, survit au round-trip sous sa forme canonique', () => {
    const tous: ContactFilters = { fieldFilters: [
      filtreSegment(S.commandes, { min: 2, jours: 90 }), filtreSegment(S.depense, { min: 49.9, max: 500 }),
      filtreSegment(S.derniereCommande, { min: 180 }), filtreSegment(S.actif, 30), filtreSegment(S.inactif, 90),
      filtreSegment(S.pays, ['FR', 'BE']),
    ] };
    expect(roundTrip(tous)).toEqual(tous);
    for (const f of tous.fieldFilters!) expect(roundTrip({ fieldFilters: [f] }), f.key).toEqual({ fieldFilters: [f] });
  });

  it('la valeur est ramenée à sa forme : pays en capitales et sans doublon, clés de plage dans l’ordre', () => {
    expect(parGet([brut(S.pays, ['be', 'fr', ' BE'])])).toEqual({ fieldFilters: [filtreSegment(S.pays, ['BE', 'FR'])] });
    expect(parCorps([brut(S.commandes, '{"jours":90,"min":2}')]))
      .toEqual({ filters: { fieldFilters: [filtreSegment(S.commandes, { min: 2, jours: 90 })] }, excludeIds: [] });
  });

  const malformes: Array<[string, unknown]> = [
    ['plage vide', brut(S.commandes, {})],
    ['au moins 0 sans maximum', brut(S.commandes, { min: 0 })],
    ['dépense au moins 0 sans maximum', brut(S.depense, { min: 0, jours: 30 })],
    ['minimum au-dessus du maximum', brut(S.commandes, { min: 3, max: 2 })],
    ['commande non entière', brut(S.commandes, { min: 1.5 })],
    ['commandes au-delà de 1000', brut(S.commandes, { min: 1001 })],
    ['dépense négative', brut(S.depense, { min: -1 })],
    ['dépense au-delà de dix millions', brut(S.depense, { max: 10_000_001 })],
    ['jours à 0', brut(S.commandes, { min: 1, jours: 0 })],
    ['jours au-delà de 3650', brut(S.actif, 3651)],
    ['jours non entiers', brut(S.inactif, 1.5)],
    ['jours en texte', brut(S.inactif, '"90"')],
    ['clé inconnue', brut(S.commandes, { min: 1, depuis: 3 })],
    ['jours dans la dernière commande', brut(S.derniereCommande, { min: 1, jours: 3 })],
    ['pays inconnu', brut(S.pays, ['XX'])],
    ['UK au lieu de GB', brut(S.pays, ['UK'])],
    ['CA, qui partage +1 avec US', brut(S.pays, ['CA'])],
    ['PR, qui partage +1 avec US', brut(S.pays, ['FR', 'PR'])],
    ['JE, qui partage +44 avec GB', brut(S.pays, ['JE'])],
    ['liste de pays vide', brut(S.pays, [])],
    ['21 pays', brut(S.pays, ['FR', 'BE', 'DE', 'ES', 'IT', 'PT', 'NL', 'LU', 'CH', 'AT', 'IE', 'GB', 'US', 'CA', 'MA', 'TN', 'DZ', 'SN', 'CI', 'CM', 'PL'])],
    ['JSON illisible', brut(S.commandes, '{pas du json')],
    ['un autre opérateur sur une clé de segment', brut(S.actif, '30', 'eq')],
    ['l’opérateur segment sur un champ perso', brut('ville', '30')],
  ];
  it.each(malformes)('🔴 refusé par les deux portes : %s', (_nom, champ) => {
    expect(() => parCorps([champ])).toThrow(FiltreContactInvalide);
    expect(() => parGet([champ])).toThrow(FiltreContactInvalide);
  });

  it('🔴 un pays qui partage son indicatif est refusé en nommant celui qui le cible', () => {
    expect(() => parCorps([brut(S.pays, ['PR', 'KZ'])])).toThrow('PR partage son indicatif avec US, KZ partage son indicatif avec RU ; le numéro ne les distingue pas, ciblez US, RU, qui les vise tous');
  });

  it('🔴 au-delà de 20 filtres de champ, une liste qui porte un segment est refusée, jamais tronquée', () => {
    const vingt = Array.from({ length: 20 }, (_, i) => ({ key: `champ${i}`, op: 'eq', value: 'x' }));
    expect(() => parCorps([...vingt, brut(S.actif, 30)])).toThrow(FiltreContactInvalide);
    // Sans segment, la troncature historique ne change pas.
    expect(() => parCorps([...vingt, { key: 'champ20', op: 'eq', value: 'x' }])).not.toThrow();
  });
});
