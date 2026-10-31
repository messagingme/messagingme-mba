import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MetaClientFactory } from '../src/meta/factory';
import { MetaCredentialsResolver, type CredentialsResolverDeps, type WabaCredential } from '../src/meta/credentials';
import type { HttpTransport, HttpResponse } from '../src/meta/http';
import { LimiteOffreError } from '../src/offres/refus';
import { RetraitDeLaListeRefuse } from '../src/mba/liste';
import { NumeroDelieError } from '../src/meta/numero-delie';
import { creerGardeCreditWhatsapp, creerLecteurCategorie, FRANCHISE_SERVICE_PAR_NUMERO, type DepsGardeCredit, type GardeCreditWhatsapp } from '../src/credit-whatsapp/garde';
import { CreditWhatsappRefus } from '../src/credit-whatsapp/refus';
import type { GrilleMeta } from '../src/credit-whatsapp/grille';
import type { LigneCredit } from '../src/credit-whatsapp/lignes.pg';
import type { ProvisionDemandee } from '../src/credit-whatsapp/credit';

/**
 * LA GARDE DU CRÉDIT WHATSAPP (plan du Crédit WhatsApp, tâche 4) : avant chaque envoi d'un numéro sur la ligne, la
 * provision du message ; rien ne part sans elle. Deux étages : la garde seule, sur des faux ; la fabrique d'envoi, sur
 * un transport factice qui note chaque appel à Meta.
 */
const GRILLE: GrilleMeta = {
  id: 'g', enVigueurLe: '2026-10-01',
  tarifs: [
    { marche: 'FR', categorie: 'marketing', palier: 0, prixMicroEur: 71_200 },
    { marche: 'FR', categorie: 'utility', palier: 0, prixMicroEur: 24_800 },
    { marche: 'FR', categorie: 'authentication', palier: 0, prixMicroEur: 24_800 },
    { marche: 'FR', categorie: 'service', palier: 0, prixMicroEur: 24_800 },
    { marche: 'DE', categorie: 'marketing', palier: 0, prixMicroEur: 113_100 },
    { marche: 'other', categorie: 'marketing', palier: 0, prixMicroEur: 55_800 },
    { marche: 'other', categorie: 'service', palier: 0, prixMicroEur: 7_100 },
  ],
};
const LIGNE: LigneCredit = { id: 'l1', tenantId: 't1', phoneNumberId: 'pn1', wabaId: 'w1', origine: 'ops', depuis: '2026-10-30T00:00:00Z', arreteeLe: null };

/** Un Crédit WhatsApp en mémoire, avec le même débit conditionnel que la base. */
function creditEnMemoire(solde: number, servicesDuMois = 0) {
  const etat = {
    solde,
    provisions: new Map<string, ProvisionDemandee & { wamid: string | null; rendue: boolean }>(),
    lus: 0,
  };
  let n = 0;
  const credit: DepsGardeCredit['credit'] = {
    provisionner: async (p) => {
      if (!p.openBar && (etat.solde <= 0 || etat.solde - p.montantMicroEur < 0)) return { ok: false, soldeMicroEur: etat.solde };
      etat.solde -= p.montantMicroEur;
      const id = `p${++n}`;
      etat.provisions.set(id, { ...p, wamid: null, rendue: false });
      return { ok: true, provisionId: id, soldeApresMicroEur: etat.solde };
    },
    rattacher: async (id, wamid) => { const p = etat.provisions.get(id); if (p && p.wamid === null) p.wamid = wamid; },
    rendre: async (id) => { const p = etat.provisions.get(id); if (p && !p.rendue) { p.rendue = true; etat.solde += p.montantMicroEur; } },
    serviceDuMois: async (_pn, _mois, plafond) => { etat.lus += 1; return Math.min(servicesDuMois, plafond); },
    solde: async () => etat.solde,
  };
  return { etat, credit };
}

function garde(o: { solde?: number; ligne?: LigneCredit | null; grille?: GrilleMeta | null; openBar?: boolean; services?: number; categorie?: 'utility' | 'marketing' | null } = {}) {
  const c = creditEnMemoire(o.solde ?? 1_000_000, o.services ?? 0);
  const lectures = { categorie: 0, grille: 0 };
  const alertes: string[] = [];
  const g = creerGardeCreditWhatsapp({
    lignes: { ligneDuNumero: async () => (o.ligne === undefined ? LIGNE : o.ligne) },
    grille: async () => { lectures.grille += 1; return o.grille === undefined ? GRILLE : o.grille; },
    conditions: async () => ({ openBar: o.openBar ?? false, commissionPct: 5 }),
    categorieDuModele: async () => { lectures.categorie += 1; return o.categorie === undefined ? 'utility' : o.categorie; },
    credit: c.credit,
    alertes: {
      surDebit: async (t, avant, apres) => { alertes.push(`debit:${t}:${avant}:${apres}`); },
      surEpuise: async (t) => { alertes.push(`epuise:${t}`); },
    },
    maintenant: () => new Date('2026-10-30T12:00:00Z'),
  });
  return { g, ...c, lectures, alertes };
}

const envoi = (nature: Parameters<GardeCreditWhatsapp['avant']>[0]['nature'], destinataire = '+33612345678') =>
  ({ tenantId: 't1', phoneNumberId: 'pn1', destinataire, nature });

describe('la garde seule', () => {
  it('un numéro hors de la ligne : rien, ni grille, ni catégorie, ni provision', async () => {
    const { g, etat, lectures } = garde({ ligne: null });
    expect(await g.avant(envoi({ type: 'modele', name: 'promo', language: 'fr' }))).toEqual({ provisionId: null });
    expect(lectures).toEqual({ categorie: 0, grille: 0 });
    expect(etat.provisions.size).toBe(0);
  });

  it('provisionne au prix de la grille, commission comprise, la catégorie du modèle lue chez Meta', async () => {
    const { g, etat } = garde();
    const r = await g.avant(envoi({ type: 'modele', name: 'rappel', language: 'fr' }));
    expect(etat.provisions.get(r.provisionId!)).toMatchObject({ categorie: 'utility', pays: 'FR', montantMicroEur: 26_040 });
    await g.avant(envoi({ type: 'marketing' }));
    expect([...etat.provisions.values()].map((p) => p.montantMicroEur)).toEqual([26_040, 74_760]);
  });

  it('un message de service dans la franchise du numéro ne coûte rien ; au-delà, son prix', async () => {
    const dedans = garde({ services: FRANCHISE_SERVICE_PAR_NUMERO - 1 });
    const a = await dedans.g.avant(envoi({ type: 'libre' }));
    expect(dedans.etat.provisions.get(a.provisionId!)?.montantMicroEur).toBe(0);
    const dehors = garde({ services: FRANCHISE_SERVICE_PAR_NUMERO });
    const b = await dehors.g.avant(envoi({ type: 'libre' }));
    expect(dehors.etat.provisions.get(b.provisionId!)?.montantMicroEur).toBe(26_040);
  });

  it('🔴 à solde nul, même un message de service dans la franchise est refusé : tout s’arrête à zéro, réponses comprises', async () => {
    for (const solde of [0, -1_000]) {
      const { g, etat } = garde({ solde, services: 0 });
      await expect(g.avant(envoi({ type: 'libre' }))).rejects.toMatchObject({ motif: 'solde', manqueMicroEur: 1 - solde, prixMicroEur: 0 });
      expect(etat.provisions.size).toBe(0);
    }
    const { g, etat } = garde({ solde: 1, services: 0 });
    await g.avant(envoi({ type: 'libre' }));
    expect(etat.solde).toBe(1);
  });

  it('🔴 sans pays ni catégorie : au plus cher, jamais au rabais', async () => {
    const { g, etat } = garde({ categorie: null });
    const bsuid = await g.avant(envoi({ type: 'marketing' }, 'US.13491208655302741918'));
    expect(etat.provisions.get(bsuid.provisionId!)).toMatchObject({ pays: null, montantMicroEur: 118_755 });
    const illisible = await g.avant(envoi({ type: 'modele', name: 'x', language: 'fr' }));
    expect(etat.provisions.get(illisible.provisionId!)).toMatchObject({ categorie: 'marketing', montantMicroEur: 74_760 });
  });

  it('🔴 un solde qui ne couvre pas le message : refus « solde » avec ce qu’il manque, rien de provisionné', async () => {
    const { g, etat } = garde({ solde: 50_000 });
    await expect(g.avant(envoi({ type: 'marketing' }))).rejects.toMatchObject({ motif: 'solde', manqueMicroEur: 24_760, statusCode: 402 });
    expect(etat.provisions.size).toBe(0);
    expect(etat.solde).toBe(50_000);
  });

  it('l’open bar provisionne sans regarder le solde', async () => {
    const { g, etat } = garde({ solde: 0, openBar: true });
    await g.avant(envoi({ type: 'marketing' }));
    expect(etat.solde).toBe(-74_760);
  });

  it('une ligne arrêtée, une ligne d’un autre espace, aucune grille : refus « ligne inactive »', async () => {
    for (const o of [{ ligne: { ...LIGNE, arreteeLe: '2026-10-30T00:00:00Z' } }, { ligne: { ...LIGNE, tenantId: 'autre' } }, { grille: null }]) {
      const { g } = garde(o);
      await expect(g.avant(envoi({ type: 'libre' }))).rejects.toMatchObject({ motif: 'ligne_inactive', statusCode: 409 });
    }
  });

  it('bloque : hors ligne jamais ; ligne arrêtée, sans grille ou solde nul hors open bar, oui', async () => {
    expect(await garde({ ligne: null, solde: 0 }).g.bloque('t1', 'pn1')).toBe(false);
    expect(await garde({ solde: 1 }).g.bloque('t1', 'pn1')).toBe(false);
    expect(await garde({ solde: 0 }).g.bloque('t1', 'pn1')).toBe(true);
    expect(await garde({ solde: 0, openBar: true }).g.bloque('t1', 'pn1')).toBe(false);
    expect(await garde({ ligne: { ...LIGNE, arreteeLe: '2026-10-30T00:00:00Z' } }).g.bloque('t1', 'pn1')).toBe(true);
    expect(await garde({ grille: null }).g.bloque('t1', 'pn1')).toBe(true);
  });

  it('refusAvantEffets : le refus exact, que la vérification d’un parcours lève avant ses effets', async () => {
    expect(await garde({ ligne: null, solde: 0 }).g.refusAvantEffets('t1', 'pn1')).toBeNull();
    expect(await garde({ solde: 1 }).g.refusAvantEffets('t1', 'pn1')).toBeNull();
    expect(await garde({ solde: 0, openBar: true }).g.refusAvantEffets('t1', 'pn1')).toBeNull();
    expect(await garde({ solde: -500 }).g.refusAvantEffets('t1', 'pn1')).toMatchObject({ motif: 'solde', manqueMicroEur: 501, statusCode: 402, prixMicroEur: 1 });
    expect(await garde({ ligne: { ...LIGNE, arreteeLe: '2026-10-30T00:00:00Z' } }).g.refusAvantEffets('t1', 'pn1')).toMatchObject({ motif: 'ligne_inactive' });
    expect(await garde({ ligne: { ...LIGNE, tenantId: 'autre' } }).g.refusAvantEffets('t1', 'pn1')).toMatchObject({ motif: 'ligne_inactive' });
    expect(await garde({ grille: null }).g.refusAvantEffets('t1', 'pn1')).toMatchObject({ motif: 'ligne_inactive', statusCode: 409 });
    // `bloque` détachée de la garde lit la même chose (aucun `this`).
    const { bloque } = garde({ solde: 0 }).g;
    expect(await bloque('t1', 'pn1')).toBe(true);
  });

  it('🔴 les alertes : chaque débit signale son avant et son après, un refus faute de solde signale l’épuisement ; rien en open bar', async () => {
    const m = garde({ solde: 100_000 });
    await m.g.avant(envoi({ type: 'marketing' }));
    expect(m.alertes).toEqual([`debit:t1:100000:${100_000 - 74_760}`]);
    await expect(m.g.avant(envoi({ type: 'marketing' }))).rejects.toBeInstanceOf(CreditWhatsappRefus);
    expect(m.alertes.at(-1)).toBe('epuise:t1');
    // La vérification d'un parcours à solde nul l'annonce aussi.
    const vide = garde({ solde: 0 });
    expect(await vide.g.refusAvantEffets('t1', 'pn1')).not.toBeNull();
    expect(vide.alertes).toEqual(['epuise:t1']);
    // L'open bar ne recharge jamais : ni débit signalé, ni épuisement.
    const ob = garde({ solde: 0, openBar: true });
    await ob.g.avant(envoi({ type: 'marketing' }));
    expect(await ob.g.refusAvantEffets('t1', 'pn1')).toBeNull();
    expect(ob.alertes).toEqual([]);
  });

  it('un refus « solde » porte le prix du message (la pause d’une campagne s’y compare)', async () => {
    const { g } = garde({ solde: 50_000 });
    await expect(g.avant(envoi({ type: 'marketing' }))).rejects.toMatchObject({ prixMicroEur: 74_760 });
  });

  it('après : le wamid se rattache ; un refus net rend la provision, un doute la garde', async () => {
    const { g, etat } = garde();
    const a = await g.avant(envoi({ type: 'marketing' }));
    await g.apres(a.provisionId!, 'wamid.A');
    const b = await g.avant(envoi({ type: 'marketing' }));
    await g.surEchec(b.provisionId!, true);
    const c = await g.avant(envoi({ type: 'marketing' }));
    await g.surEchec(c.provisionId!, false);
    expect(etat.provisions.get(a.provisionId!)).toMatchObject({ wamid: 'wamid.A', rendue: false });
    expect(etat.provisions.get(b.provisionId!)?.rendue).toBe(true);
    expect(etat.provisions.get(c.provisionId!)?.rendue).toBe(false);
  });
});

describe('le lecteur de catégorie', () => {
  it('lit chez Meta une fois par modèle, normalise, et rend null sur une lecture ratée', async () => {
    let lectures = 0;
    const lire = creerLecteurCategorie({
      wabaDeLEspace: async () => 'w1',
      modeles: async () => ({ list: async () => { lectures += 1; return [{ name: 'promo', language: 'fr', category: 'MARKETING' }]; } }),
    });
    expect(await lire('t1', 'promo', 'fr')).toBe('marketing');
    expect(await lire('t1', 'promo', 'fr')).toBe('marketing');
    expect(lectures).toBe(1);
    const casse = creerLecteurCategorie({ wabaDeLEspace: async () => 'w1', modeles: async () => { throw new Error('réseau'); } });
    expect(await casse('t1', 'promo', 'fr')).toBeNull();
  });

  it('une rafale d’envois simultanés ne fait qu’une lecture chez Meta', async () => {
    let lectures = 0;
    let liberer: () => void = () => {};
    const lire = creerLecteurCategorie({
      wabaDeLEspace: async () => 'w1',
      modeles: async () => ({
        list: async () => {
          lectures += 1;
          await new Promise<void>((r) => { liberer = r; });
          return [{ name: 'promo', language: 'fr', category: 'UTILITY' }];
        },
      }),
    });
    const rafale = Promise.all([lire('t1', 'promo', 'fr'), lire('t1', 'promo', 'fr'), lire('t1', 'promo', 'fr')]);
    await new Promise((r) => setTimeout(r, 0));
    liberer();
    expect(await rafale).toEqual(['utility', 'utility', 'utility']);
    expect(lectures).toBe(1);
  });

  it('🔴 une lecture ratée se garde 30 secondes, pas cinq minutes : une panne de Meta ne fait pas relire à chaque envoi', async () => {
    let t = 0;
    let lectures = 0;
    let enPanne = true;
    const lire = creerLecteurCategorie({
      wabaDeLEspace: async () => 'w1',
      modeles: async () => ({
        list: async () => {
          lectures += 1;
          if (enPanne) throw new Error('Meta injoignable');
          return [{ name: 'promo', language: 'fr', category: 'UTILITY' }];
        },
      }),
      maintenant: () => t,
    });
    expect(await lire('t1', 'promo', 'fr')).toBeNull();
    t = 29_000;
    expect(await lire('t1', 'promo', 'fr')).toBeNull();
    expect(lectures).toBe(1);
    enPanne = false;
    t = 31_000;
    expect(await lire('t1', 'promo', 'fr')).toBe('utility');
    expect(lectures).toBe(2);
    // La lecture réussie, elle, vaut cinq minutes.
    t = 31_000 + 4 * 60_000;
    expect(await lire('t1', 'promo', 'fr')).toBe('utility');
    expect(lectures).toBe(2);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// La fabrique d'envoi, sur un transport factice.

class TransportNotant implements HttpTransport {
  readonly appels: string[] = [];
  constructor(private readonly reponses: Array<HttpResponse | Error> = []) {}
  async post(url: string): Promise<HttpResponse> {
    this.appels.push(url);
    const r = this.reponses.shift() ?? { status: 200, json: { messages: [{ id: 'wamid.ok' }] } };
    if (r instanceof Error) throw r;
    return r;
  }
}

function resolveur(fournisseur: 'meta' | '360dialog' = 'meta') {
  const creds: Record<string, WabaCredential> = { w1: { businessTokenEnc: 'enc:TOK', tokenStatus: 'active', fournisseur } };
  const deps: CredentialsResolverDeps = {
    getWabaIdForTenant: async () => 'w1',
    credentials: { getCredentialsByWaba: async (w) => creds[w] ?? null, markTokenInvalid: async () => {} },
    decrypt: (enc) => enc.replace(/^enc:/, ''),
    fallbackToken: 'GLOBAL',
  };
  return new MetaCredentialsResolver(deps);
}

function fabrique(transport: HttpTransport, gardeCredit: GardeCreditWhatsapp, o: { fournisseur?: 'meta' | '360dialog'; quota?: () => Promise<{ ok: true } | { ok: false; max: number }>; lite?: boolean; delie?: boolean } = {}) {
  return new MetaClientFactory({
    resolver: resolveur(o.fournisseur), transport, version: 'v25.0', marketingViaLite: o.lite ?? false,
    numerosDelies: { estDelie: async () => o.delie ?? false },
    numerosSuspendus: { estSuspendu: async () => false },
    listeDeLAgent: { retirerAvantUnModele: async () => {} },
    quotaModeles: { consommer: o.quota ?? (async () => ({ ok: true as const })) },
    creditWhatsapp: gardeCredit,
  });
}

/** Les méthodes d'envoi telles que le client Meta les définit : la liste se lit dans le client, pas ici. */
const METHODES = [...readFileSync(new URL('../src/meta/client.ts', import.meta.url), 'utf8').matchAll(/^\s*async (send[A-Za-z]+)\s*\(/gm)].map((m) => m[1]!);

describe('la fabrique d’envoi', () => {
  it('lit au moins les neuf méthodes d’envoi du client', () => {
    expect(METHODES.length).toBeGreaterThanOrEqual(9);
    expect(METHODES).toEqual(expect.arrayContaining(['sendText', 'sendTemplate', 'sendMarketing', 'sendMessage', 'sendFlowMessage']));
  });

  it('🔴 à crédit refusé, AUCUNE méthode d’envoi n’appelle Meta', async () => {
    const refuse: GardeCreditWhatsapp = { avant: async () => { throw new CreditWhatsappRefus('solde', 1); }, apres: async () => {}, surEchec: async () => {}, refusAvantEffets: async () => new CreditWhatsappRefus('solde', 1), bloque: async () => true };
    const t = new TransportNotant();
    const client = await fabrique(t, refuse).clientForTenant('t1', 'pn1') as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    for (const m of METHODES) {
      await expect(client[m]!('+33612345678', { name: 'promo', language: 'fr', to: '+33612345678', template: { name: 'promo', language: 'fr' } }), m).rejects.toBeInstanceOf(CreditWhatsappRefus);
    }
    expect(t.appels).toEqual([]);
  });

  it('🔴 verifierAvantEffets : le numéro d’abord, puis le refus certain du crédit, sans aucun appel à Meta', async () => {
    const t = new TransportNotant();
    let lectures = 0;
    const aSec: GardeCreditWhatsapp = {
      avant: async () => ({ provisionId: null }), apres: async () => {}, surEchec: async () => {}, bloque: async () => true,
      refusAvantEffets: async () => { lectures += 1; return new CreditWhatsappRefus('solde', 1); },
    };
    await expect(fabrique(t, aSec).verifierAvantEffets('t1', 'pn1')).rejects.toMatchObject({ motif: 'solde', statusCode: 402 });
    // Le numéro délié prime : le crédit n'est même pas lu.
    await expect(fabrique(t, aSec, { delie: true }).verifierAvantEffets('t1', 'pn1')).rejects.toBeInstanceOf(NumeroDelieError);
    expect(lectures).toBe(1);
    const libre: GardeCreditWhatsapp = { ...aSec, refusAvantEffets: async () => null, bloque: async () => false };
    await expect(fabrique(t, libre).verifierAvantEffets('t1', 'pn1')).resolves.toBeUndefined();
    expect(t.appels).toEqual([]);
  });

  it('🔴 le crédit passe AVANT les modèles du mois : un crédit nul ne consomme rien', async () => {
    let consommes = 0;
    const refuse: GardeCreditWhatsapp = { avant: async () => { throw new CreditWhatsappRefus('solde', 1); }, apres: async () => {}, surEchec: async () => {}, refusAvantEffets: async () => new CreditWhatsappRefus('solde', 1), bloque: async () => true };
    const client = await fabrique(new TransportNotant(), refuse, { quota: async () => { consommes += 1; return { ok: true }; } }).clientForTenant('t1', 'pn1');
    await expect(client.sendTemplate('+33612345678', { name: 'promo', language: 'fr' })).rejects.toBeInstanceOf(CreditWhatsappRefus);
    expect(consommes).toBe(0);
  });

  it('un envoi réussi rattache son wamid ; un refus de Meta rend la provision ; une panne réseau la garde', async () => {
    const { g, etat } = garde();
    const t = new TransportNotant([
      { status: 200, json: { messages: [{ id: 'wamid.1' }] } },
      { status: 400, json: { error: { code: 131009, message: 'paramètre refusé' } } },
      new Error('ECONNRESET'), new Error('ECONNRESET'), new Error('ECONNRESET'), new Error('ECONNRESET'), new Error('ECONNRESET'),
    ]);
    const client = await fabrique(t, g).clientForTenant('t1', 'pn1');
    await client.sendText('+33612345678', 'bonjour');
    await expect(client.sendText('+33612345678', 'bonjour')).rejects.toThrow();
    await expect(client.sendText('+33612345678', 'bonjour')).rejects.toThrow();
    const p = [...etat.provisions.values()];
    expect(p.map((x) => [x.wamid, x.rendue])).toEqual([['wamid.1', false], [null, true], [null, false]]);
  }, 30_000);

  it('🔴 un 5xx de Meta garde la provision (le message est peut-être parti) ; un 429 la rend', async () => {
    const { g, etat } = garde();
    const t = new TransportNotant([
      ...Array.from({ length: 6 }, () => ({ status: 500, json: { error: { code: 1, message: 'erreur interne' } } })),
    ]);
    const client = await fabrique(t, g).clientForTenant('t1', 'pn1');
    await expect(client.sendText('+33612345678', 'bonjour')).rejects.toThrow();
    expect([...etat.provisions.values()].map((x) => x.rendue)).toEqual([false]);
    const { g: g2, etat: etat2 } = garde();
    const t2 = new TransportNotant(Array.from({ length: 6 }, () => ({ status: 429, json: { error: { code: 130429, message: 'débit' } } })));
    const client2 = await fabrique(t2, g2).clientForTenant('t1', 'pn1');
    await expect(client2.sendText('+33612345678', 'bonjour')).rejects.toThrow();
    expect([...etat2.provisions.values()].map((x) => x.rendue)).toEqual([true]);
  }, 60_000);

  it('🔴 le retrait de la liste de l’agent refusé (un 503 levé chez nous, avant l’appel) rend la provision', async () => {
    const { g, etat } = garde();
    const t = new TransportNotant();
    const client = await new MetaClientFactory({
      resolver: resolveur(), transport: t, version: 'v25.0', marketingViaLite: false,
      numerosDelies: { estDelie: async () => false },
      numerosSuspendus: { estSuspendu: async () => false },
      listeDeLAgent: { retirerAvantUnModele: async () => { throw new RetraitDeLaListeRefuse(); } },
      quotaModeles: { consommer: async () => ({ ok: true as const }) },
      creditWhatsapp: g,
    }).clientForTenant('t1', 'pn1');
    await expect(client.sendTemplate('+33612345678', { name: 'promo', language: 'fr' })).rejects.toBeInstanceOf(RetraitDeLaListeRefuse);
    expect(t.appels).toEqual([]);
    expect([...etat.provisions.values()].map((x) => x.rendue)).toEqual([true]);
  });

  it('une limite des modèles du mois après la provision la rend : rien n’est parti', async () => {
    const { g, etat } = garde();
    const client = await fabrique(new TransportNotant(), g, { quota: async () => ({ ok: false, max: 1000 }) }).clientForTenant('t1', 'pn1');
    await expect(client.sendTemplate('+33612345678', { name: 'promo', language: 'fr' })).rejects.toBeInstanceOf(LimiteOffreError);
    expect([...etat.provisions.values()].map((x) => x.rendue)).toEqual([true]);
  });

  it('le repli de la MM API sur 134101 ne provisionne qu’une fois, et rattache le wamid parti', async () => {
    const { g, etat } = garde();
    const t = new TransportNotant([
      { status: 400, json: { error: { code: 134101, message: 'synchronisation' } } },
      { status: 200, json: { messages: [{ id: 'wamid.cloud' }] } },
    ]);
    const client = await fabrique(t, g, { lite: true }).clientForTenant('t1', 'pn1');
    await client.sendMarketing({ to: '+33612345678', template: { name: 'promo', language: 'fr' } });
    expect(t.appels).toHaveLength(2);
    expect([...etat.provisions.values()].map((x) => [x.categorie, x.wamid])).toEqual([['marketing', 'wamid.cloud']]);
  });

  it('🔴 un compte 360dialog n’est jamais gardé : sa facturation est ailleurs', async () => {
    let appels = 0;
    const espion: GardeCreditWhatsapp = { avant: async () => { appels += 1; return { provisionId: null }; }, apres: async () => {}, surEchec: async () => {}, refusAvantEffets: async () => null, bloque: async () => false };
    const client = await fabrique(new TransportNotant(), espion, { fournisseur: '360dialog' }).clientForTenant('t1', 'pn1');
    await client.sendText('+33612345678', 'bonjour');
    expect(appels).toBe(0);
  });
});
