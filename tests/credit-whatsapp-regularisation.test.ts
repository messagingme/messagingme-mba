import { describe, it, expect } from 'vitest';
import {
  calculerRegularisation, creerRegularisationCreditWhatsapp, demiHeuresCouvertes, horsMessagingMe, DEMI_HEURE_S, MARGE_FRAICHEUR_S,
  type ConditionsDuJour, type DepsRegularisation, type EspaceARegulariser, type JourDeParis, type NosDemiHeures, type PointVolumeMeta,
  type RegularisationAEcrire,
} from '../src/credit-whatsapp/regularisation';
import { lirePointsVolume } from '../src/meta/pricing';
import type { GrilleMeta } from '../src/credit-whatsapp/grille';

/**
 * LA RÉGULARISATION SUR LES VOLUMES DE META (lot E du plan `2026-11-03-credit-whatsapp-fiabilite.md`) : le calcul pur et
 * la passe, sur des faux. Les montants reprennent la vraie grille de France (marketing 0,0712 €, utilitaire 0,0248 €) et
 * le vrai cas de l'essai 211 : sur la demi-heure de 13 h 30 UTC du 2026-11-03, Meta a facturé trois utilitaires et un
 * marketing, et nos quatre provisions valaient la même chose.
 */
const GRILLE: GrilleMeta = {
  id: 'g', enVigueurLe: '2026-10-01',
  tarifs: [
    { marche: 'FR', categorie: 'marketing', palier: 0, prixMicroEur: 71_200 },
    { marche: 'FR', categorie: 'utility', palier: 0, prixMicroEur: 24_800 },
    { marche: 'FR', categorie: 'utility', palier: 100_001, prixMicroEur: 18_600 },
    { marche: 'FR', categorie: 'service', palier: 0, prixMicroEur: 24_800 },
    { marche: 'other', categorie: 'marketing', palier: 0, prixMicroEur: 55_800 },
  ],
};

/** Le 2026-11-03 à Paris : de 23 h UTC la veille à 23 h UTC. */
const JOUR: JourDeParis = { jour: '2026-11-03', debutS: 1_793_660_400, finS: 1_793_746_800 };
/** La demi-heure de l'essai 211 : 13 h 30 à 14 h UTC. */
const ESSAI = 1_793_712_600;
const point = (o: Partial<PointVolumeMeta> = {}): PointVolumeMeta => ({
  debut: ESSAI, numero: '33525680250', pays: 'FR', categorie: 'UTILITY', type: 'REGULAR', palier: '0:100000', volume: 1, ...o,
});
const nos = (debut: number, montantMicroEur: number, messages: number, livres = messages): NosDemiHeures => ({ debut, montantMicroEur, messages, livres });
const utc = (s: number): Date => new Date(s * 1000);
const un = (points: PointVolumeMeta[], demiHeures: number[] = [ESSAI]) => [{ points, demiHeures: new Set(demiHeures) }];

describe('les demi-heures comparées', () => {
  it('🔴 seules les demi-heures ENTIÈRES sous la ligne comptent : celle qu’entame la pose ou le retrait est écartée', () => {
    // Posée à 13 h 51 UTC, retirée à 15 h 10 : 14 h à 14 h 30 et 14 h 30 à 15 h, rien d'autre.
    const couvertes = demiHeuresCouvertes(JOUR.debutS, JOUR.finS, [{ depuis: utc(ESSAI + 21 * 60), jusqua: utc(ESSAI + 100 * 60) }]);
    expect([...couvertes]).toEqual([ESSAI + DEMI_HEURE_S, ESSAI + 2 * DEMI_HEURE_S]);
  });

  it('une ligne encore en cours couvre jusqu’à la fin du jour ; deux périodes s’additionnent', () => {
    const couvertes = demiHeuresCouvertes(JOUR.debutS, JOUR.finS, [
      { depuis: utc(JOUR.debutS), jusqua: utc(JOUR.debutS + DEMI_HEURE_S) },
      { depuis: utc(JOUR.finS - DEMI_HEURE_S), jusqua: null },
    ]);
    expect([...couvertes]).toEqual([JOUR.debutS, JOUR.finS - DEMI_HEURE_S]);
    expect(demiHeuresCouvertes(JOUR.debutS, JOUR.finS, [{ depuis: utc(JOUR.debutS - 86_400), jusqua: null }]).size).toBe(48);
  });
});

describe('le calcul d’un jour', () => {
  it('🔴 le cas réel de l’essai 211 : Meta et nos provisions se rejoignent, aucun écart', () => {
    const c = calculerRegularisation({
      comptes: un([point({ volume: 3 }), point({ categorie: 'MARKETING_LITE', palier: '0:MAX' })]),
      nous: [nos(ESSAI, 3 * 26_040 + 74_760, 4)],
      grille: GRILLE, commissionPct: 5,
    });
    expect(c).toMatchObject({ metaMicroEur: 152_880, nousMicroEur: 152_880, ecartMicroEur: 0, messagesMeta: 4, messagesNous: 4, nonChiffres: 0 });
    expect(horsMessagingMe(c)).toBe(false);
  });

  it('🔴 une provision en doute que Meta n’a pas facturée est rendue par l’écart (négatif)', () => {
    const c = calculerRegularisation({ comptes: un([point()]), nous: [nos(ESSAI, 2 * 26_040, 2, 1)], grille: GRILLE, commissionPct: 5 });
    expect(c.ecartMicroEur).toBe(-26_040);
  });

  it('🔴 un envoi gratuit chez Meta (fenêtre de service, publicité) ne coûte rien ; une demi-heure hors ligne ne compte pas', () => {
    const c = calculerRegularisation({
      comptes: un([
        point({ type: 'FREE_CUSTOMER_SERVICE', categorie: 'SERVICE', palier: null, volume: 9 }),
        point({ type: 'FREE_ENTRY_POINT', categorie: 'SERVICE', palier: null, volume: 2 }),
        point({ debut: ESSAI - DEMI_HEURE_S, volume: 50 }),
      ]),
      nous: [nos(ESSAI - DEMI_HEURE_S, 999_999, 1)],
      grille: GRILLE, commissionPct: 5,
    });
    expect(c).toMatchObject({ metaMicroEur: 0, nousMicroEur: 0, ecartMicroEur: 0, messagesMeta: 0, volumeMeta: 11 });
    expect(c.detail.map((l) => [l.type, l.volume])).toEqual([['FREE_CUSTOMER_SERVICE', 9], ['FREE_ENTRY_POINT', 2]]);
  });

  it('🔴 deux comptes : chacun ne compte que SES demi-heures couvertes (la ligne du second posée plus tard)', () => {
    // Le second compte n'est couvert qu'à partir de la demi-heure suivante : ses 100 utilitaires de la demi-heure de
    // l'essai, payés par la carte du client, ne se comptent pas sous la couverture du premier.
    const c = calculerRegularisation({
      comptes: [
        { points: [point()], demiHeures: new Set([ESSAI, ESSAI + DEMI_HEURE_S]) },
        { points: [point({ numero: '33600000000', volume: 100 }), point({ numero: '33600000000', debut: ESSAI + DEMI_HEURE_S, volume: 2 })], demiHeures: new Set([ESSAI + DEMI_HEURE_S]) },
      ],
      nous: [nos(ESSAI, 26_040, 1), nos(ESSAI + DEMI_HEURE_S, 2 * 26_040, 2)],
      grille: GRILLE, commissionPct: 5,
    });
    expect(c).toMatchObject({ metaMicroEur: 3 * 26_040, nousMicroEur: 3 * 26_040, ecartMicroEur: 0, demiHeures: 2 });
  });

  it('le palier lu est appliqué quand la grille le porte ; sinon le tarif de base', () => {
    const avecPalier = calculerRegularisation({ comptes: un([point({ palier: '100001:500000' })]), nous: [], grille: GRILLE, commissionPct: 0 });
    expect(avecPalier.metaMicroEur).toBe(18_600);
    const sansPalier = calculerRegularisation({ comptes: un([point({ categorie: 'MARKETING', palier: '100001:MAX' })]), nous: [], grille: GRILLE, commissionPct: 0 });
    expect(sansPalier.metaMicroEur).toBe(71_200);
  });

  it('🔴 un message facturé sans tarif, de catégorie inconnue ou sans pays n’est JAMAIS chiffré au plus cher : compté à part', () => {
    const vide: GrilleMeta = { id: 'v', enVigueurLe: '2026-10-01', tarifs: [] };
    expect(calculerRegularisation({ comptes: un([point({ volume: 2 })]), nous: [], grille: vide, commissionPct: 5 }).nonChiffres).toBe(2);
    const inconnu = calculerRegularisation({ comptes: un([point({ categorie: 'MARKETING_DIRECT' }), point({ pays: null, volume: 3 })]), nous: [], grille: GRILLE, commissionPct: 5 });
    expect(inconnu).toMatchObject({ nonChiffres: 4, metaMicroEur: 0 });
  });

  it('des envois que nous n’avons pas vus : au-delà de 0,50 € ET de 2 % du jour', () => {
    expect(horsMessagingMe({ ecartMicroEur: 500_000, metaMicroEur: 1_000_000 })).toBe(false);
    expect(horsMessagingMe({ ecartMicroEur: 500_001, metaMicroEur: 1_000_000 })).toBe(true);
    // Une grosse journée : 2 % de 100 € font 2 €, un écart de 1 € reste dans la tolérance.
    expect(horsMessagingMe({ ecartMicroEur: 1_000_000, metaMicroEur: 100_000_000 })).toBe(false);
    expect(horsMessagingMe({ ecartMicroEur: -5_000_000, metaMicroEur: 0 })).toBe(false);
  });
});

describe('la lecture des volumes de Meta', () => {
  const brut = (o: Record<string, unknown> = {}) => ({ start: ESSAI, end: ESSAI + 1800, phone_number: '33525680250', country: 'FR', tier: '0:100000', pricing_type: 'REGULAR', pricing_category: 'UTILITY', volume: 3, ...o });

  it('🔴 un compte calme rend `{ id }` seul (mesuré) : zéro point, pas une erreur', () => {
    expect(lirePointsVolume({ id: '1917705935858252' })).toEqual([]);
  });

  it('lit la forme mesurée le 2026-11-03, et refuse ce qui n’en est pas une', () => {
    expect(lirePointsVolume({ id: 'w', pricing_analytics: { data: [{ data_points: [brut()] }] } }))
      .toEqual([{ debut: ESSAI, numero: '33525680250', pays: 'FR', categorie: 'UTILITY', type: 'REGULAR', palier: '0:100000', volume: 3 }]);
    expect(lirePointsVolume(null)).toBeNull();
    expect(lirePointsVolume({ error: { code: 10 } })).toBeNull();
    expect(lirePointsVolume({ id: 'w', pricing_analytics: { data: [{ data_points: [brut({ start: 'demain' })] }] } })).toBeNull();
    expect(lirePointsVolume({ id: 'w', pricing_analytics: { data: [{ data_points: [brut({ pricing_type: undefined })] }] } })).toBeNull();
  });

  it('🔴 refuse une réponse paginée, en plusieurs séries, ou d’une autre durée qu’une demi-heure', () => {
    expect(lirePointsVolume({ id: 'w', pricing_analytics: { data: [{ data_points: [brut()] }], paging: { next: 'https://graph.facebook.com/...' } } })).toBeNull();
    expect(lirePointsVolume({ id: 'w', pricing_analytics: { data: [{ data_points: [brut()] }, { data_points: [brut()] }] } })).toBeNull();
    expect(lirePointsVolume({ id: 'w', pricing_analytics: { data: [{ data_points: [brut({ end: ESSAI + 86_400 })] }] } })).toBeNull();
  });
});

/** Une passe sur des faux : un espace, une ligne posée à 13 h 51 le 2026-11-03 et toujours en cours. */
function passe(o: {
  volumes?: PointVolumeMeta[] | null | ((wabaId: string) => PointVolumeMeta[] | null); nous?: NosDemiHeures[]; openBar?: boolean;
  grille?: GrilleMeta | null; alerteDejaPartie?: boolean; soldeAvant?: number; soldeApres?: number; espaces?: EspaceARegulariser[];
  conditionsDuJour?: ConditionsDuJour | null; aBouge?: boolean;
} = {}) {
  const ecrits: RegularisationAEcrire[] = [];
  const alertes: string[] = [];
  const debits: Array<[string, number, number]> = [];
  const marques: string[] = [];
  const lus: string[] = [];
  const marges: number[] = [];
  const deps: DepsRegularisation = {
    store: {
      joursClos: async (margeS) => { marges.push(margeS); return [JOUR, { jour: '2026-11-02', debutS: JOUR.debutS - 86_400, finS: JOUR.debutS }]; },
      espacesARegulariser: async () => o.espaces ?? [{ tenantId: 't1', nom: 'SANDBOX', comptes: [{ wabaId: 'w1', couvertures: [{ depuis: utc(ESSAI + 21 * 60), jusqua: null }] }] }],
      nosDemiHeures: async () => o.nous ?? [],
      conditionsDuJour: async () => o.conditionsDuJour ?? null,
      enregistrer: async (r) => {
        ecrits.push(r);
        if (o.aBouge) return { ecrit: false };
        return { ecrit: true, alerteDejaPartie: o.alerteDejaPartie ?? false, soldeAvantMicroEur: o.soldeAvant ?? 0, soldeMicroEur: o.soldeApres ?? 0 };
      },
      marquerAlerte: async (t, j) => { marques.push(`${t}:${j}`); },
    },
    grilleAu: async () => (o.grille === undefined ? GRILLE : o.grille),
    conditions: async () => ({ openBar: o.openBar ?? true, commissionPct: 5 }),
    volumes: async (_t, wabaId) => {
      lus.push(wabaId);
      if (typeof o.volumes === 'function') return o.volumes(wabaId);
      return o.volumes === undefined ? [] : o.volumes;
    },
    alertes: { surDebit: async (t, avant, apres) => { debits.push([t, avant, apres]); } },
    alerter: (_cle, texte) => { alertes.push(texte); },
  };
  return { r: creerRegularisationCreditWhatsapp(deps), ecrits, alertes, marques, lus, marges, debits };
}

describe('la passe horaire', () => {
  it('🔴 écrit chaque jour clos couvert par la ligne, et seulement lui : la veille de la pose ne s’écrit pas', async () => {
    const { r, ecrits, marges } = passe({ volumes: [point({ debut: ESSAI + DEMI_HEURE_S, volume: 2 })] });
    expect(await r.passe()).toBe(1);
    expect(ecrits.map((e) => [e.jour, e.illimite, e.calcul.metaMicroEur])).toEqual([['2026-11-03', true, 2 * 26_040]]);
    // La veille ne se régularise qu'une fois ses volumes complets chez Meta (deux heures après sa fin).
    expect(marges).toEqual([MARGE_FRAICHEUR_S]);
  });

  it('🔴 des volumes illisibles chez Meta n’écrivent RIEN (jamais une comparaison à une lecture vide) et préviennent Julien', async () => {
    const { r, ecrits, alertes } = passe({ volumes: null });
    expect(await r.passe()).toBe(0);
    expect(ecrits).toEqual([]);
    expect(alertes.join(' ')).toContain('illisibles');
  });

  it('🔴 Meta ne rend rien alors que nos messages ont été livrés : rien n’est rendu au client, Julien prévenu', async () => {
    const { r, ecrits, alertes } = passe({ volumes: [], nous: [nos(ESSAI + DEMI_HEURE_S, 3 * 74_760, 3, 3)] });
    expect(await r.passe()).toBe(0);
    expect(ecrits).toEqual([]);
    expect(alertes.join(' ')).toContain('ne rend aucun volume');
  });

  it('un compte qu’aucune ligne ne couvrait sur les jours clos n’est même pas lu chez Meta', async () => {
    const { r, lus } = passe({ espaces: [{ tenantId: 't1', nom: 'SANDBOX', comptes: [{ wabaId: 'w1', couvertures: [{ depuis: utc(JOUR.finS + 3600), jusqua: null }] }] }] });
    expect(await r.passe()).toBe(0);
    expect(lus).toEqual([]);
  });

  it('sans grille en vigueur ce jour-là : rien n’est écrit, Julien prévenu', async () => {
    const { r, ecrits, alertes } = passe({ grille: null });
    await r.passe();
    expect(ecrits).toEqual([]);
    expect(alertes.join(' ')).toContain('aucune grille');
  });

  it('🔴 une alerte de la passe horaire part UNE fois par jour, pas à chaque heure', async () => {
    const { r, alertes } = passe({ volumes: null });
    await r.passe();
    await r.passe();
    await r.passe();
    expect(alertes).toHaveLength(1);
  });

  it('🔴 une panne sur un espace n’arrête pas la régularisation des suivants', async () => {
    const { r, ecrits, alertes } = passe({
      espaces: [
        { tenantId: 't0', nom: 'EN PANNE', comptes: [{ wabaId: 'w0', couvertures: [{ depuis: utc(JOUR.debutS), jusqua: null }] }] },
        { tenantId: 't1', nom: 'SANDBOX', comptes: [{ wabaId: 'w1', couvertures: [{ depuis: utc(ESSAI + 21 * 60), jusqua: null }] }] },
      ],
      volumes: (wabaId) => { if (wabaId === 'w0') throw new Error('base indisponible'); return [point({ debut: ESSAI + DEMI_HEURE_S })]; },
    });
    expect(await r.passe()).toBe(1);
    expect(ecrits.map((e) => e.tenantId)).toEqual(['t1']);
    expect(alertes.join(' ')).toContain('« EN PANNE » a échoué');
  });

  it('🔴 des envois que nous n’avons pas vus : Julien prévenu UNE fois par jour, et la marque posée', async () => {
    const beaucoup = [point({ debut: ESSAI + DEMI_HEURE_S, categorie: 'MARKETING', palier: '0:MAX', volume: 40 })];
    const premiere = passe({ volumes: beaucoup });
    await premiere.r.passe();
    expect(premiere.alertes.join(' ')).toContain('que nous n\'avons pas vus');
    expect(premiere.marques).toEqual(['t1:2026-11-03']);
    const deja = passe({ volumes: beaucoup, alerteDejaPartie: true });
    await deja.r.passe();
    expect(deja.alertes).toEqual([]);
  });

  it('un prépayé dont le solde passe sous -50 € : Julien fait retirer la ligne', async () => {
    const { r, ecrits, alertes } = passe({ openBar: false, volumes: [point({ debut: ESSAI + DEMI_HEURE_S })], soldeApres: -60_000_000 });
    await r.passe();
    expect(ecrits[0]?.illimite).toBe(false);
    expect(alertes.join(' ')).toContain('faire retirer la ligne');
  });

  it('🔴 l’offre et la commission du JOUR, lues sur ses provisions, l’emportent sur celles du moment', async () => {
    // Prépayé à 0 % ce jour-là, Entreprise à 5 % aujourd'hui : le jour se règle sur le solde, et Meta au prix sans commission.
    const { r, ecrits } = passe({ openBar: true, conditionsDuJour: { openBar: false, commissionPct: 0 }, volumes: [point({ debut: ESSAI + DEMI_HEURE_S, volume: 2 })] });
    await r.passe();
    expect(ecrits.map((e) => [e.illimite, e.calcul.metaMicroEur])).toEqual([[false, 2 * 24_800]]);
  });

  it('🔴 le retrait de la ligne se juge sur l’offre du MOMENT : une Entreprise d’aujourd’hui ne dépend plus de son solde', async () => {
    const entreprise = passe({ openBar: true, conditionsDuJour: { openBar: false, commissionPct: 5 }, volumes: [point({ debut: ESSAI + DEMI_HEURE_S })], soldeApres: -60_000_000 });
    await entreprise.r.passe();
    expect(entreprise.alertes.join(' ')).not.toContain('faire retirer la ligne');
  });

  it('🔴 les demi-heures comparées et le début de la lecture vont à l’écriture, qui y fige les provisions', async () => {
    const { r, ecrits } = passe({ volumes: [point({ debut: ESSAI + DEMI_HEURE_S })] });
    await r.passe();
    // La ligne posée à 13 h 51 UTC : de 14 h à la fin du jour de Paris (23 h UTC), dix-huit demi-heures entières.
    expect(ecrits[0]!.tranches).toEqual(Array.from({ length: 18 }, (_, k) => ESSAI + DEMI_HEURE_S * (k + 1)));
    expect(ecrits[0]!.lectureDepuisS).toBe(JOUR.debutS - 86_400);
  });

  it('🔴 nos provisions ont bougé entre la lecture et l’écriture : rien n’est compté, ni alerte ni e-mail', async () => {
    const { r, alertes, debits } = passe({
      openBar: false, aBouge: true, soldeAvant: 12_000_000, soldeApres: -60_000_000,
      volumes: [point({ debut: ESSAI + DEMI_HEURE_S, categorie: 'MARKETING', palier: '0:MAX', volume: 40 })],
    });
    expect(await r.passe()).toBe(0);
    expect(alertes).toEqual([]);
    expect(debits).toEqual([]);
  });

  it('🔴 une régularisation qui débite un prépayé envoie le même e-mail « crédit bas » qu’un envoi ; jamais un crédit ni une Entreprise', async () => {
    const debite = passe({ openBar: false, volumes: [point({ debut: ESSAI + DEMI_HEURE_S })], soldeAvant: 12_000_000, soldeApres: 8_000_000 });
    await debite.r.passe();
    expect(debite.debits).toEqual([['t1', 12_000_000, 8_000_000]]);
    const rendu = passe({ openBar: false, volumes: [point({ debut: ESSAI + DEMI_HEURE_S })], soldeAvant: 8_000_000, soldeApres: 12_000_000 });
    await rendu.r.passe();
    expect(rendu.debits).toEqual([]);
    const illimite = passe({ openBar: true, volumes: [point({ debut: ESSAI + DEMI_HEURE_S })], soldeAvant: 12_000_000, soldeApres: 8_000_000 });
    await illimite.r.passe();
    expect(illimite.debits).toEqual([]);
  });
});
