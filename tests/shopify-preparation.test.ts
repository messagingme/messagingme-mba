import { describe, it, expect, vi } from 'vitest';
import {
  DELAI_OUBLI_MS, ESSAIS_OUBLI, estModeleDeLAssistant, oublierPlusTard, reglerMessage, REESSAI_OUBLI_MS, suppressionDesModeles, traiterOubli,
  type JobOubli,
} from '../src/shopify/preparation';
import type { AttenteMessage, MessageBranche, VueBoutique } from '../src/shopify/store.pg';

/**
 * CE QUI RESTE DE L'ANCIEN ASSISTANT DES MESSAGES SHOPIFY (conception 2026-10-22) depuis le menu « Scénario » (lot 5) :
 * le ménage différé de ses modèles, et le délai que l'écran d'avant règle encore.
 */

const T = 't1';
const VUE: VueBoutique = {
  domaine: 'b.myshopify.com', nom: 'Essai', pays: 'FR', devise: 'EUR', etat: 'connectee', motifCoupure: null, coupeeLe: null,
  connecteeLe: '2026-10-22T00:00:00.000Z', dernierEvenementLe: null, delaiPanierMinutes: 60, origine: 'console', pauseLe: null,
};
/** L'heure des tests, après la mise en service de l'assistant : les noms qu'il crée sont alors les siens. */
const MAINTENANT = Date.UTC(2026, 9, 23, 12);
/** Un nom de l'assistant, horodaté à une heure donnée du 22 octobre 2026. */
const nomAssistant = (e: string, heure: number): string => `shopify_${e}_${Date.UTC(2026, 9, 22, heure).toString(36)}`;

function monter(o: { boutique?: VueBoutique | null } = {}) {
  const journal = { delais: [] as number[] };
  const deps = {
    store: {
      lire: async () => (o.boutique === undefined ? VUE : o.boutique),
      reglerDelaiPanier: async (_t: string, m: number) => { journal.delais.push(m); },
    },
  };
  return { deps, journal };
}

describe('le ménage des modèles de l’assistant (2026-10-23)', () => {
  it('🔴 le nom exact de l’assistant ET un horodatage plausible : un nom choisi à la main n’est jamais reconnu', () => {
    expect(estModeleDeLAssistant(nomAssistant('order_paid', 9), MAINTENANT)).toBe(true);
    for (const nom of [
      'commande_payee', 'shopify_order_paid', 'shopify_order_paid_v2', 'shopify_order_paid_confirmation', 'shopify_autre_mviry800',
      'shopify_order_paid_mviry800_copie',
      // Huit caractères dont un chiffre, mais l'horodatage décodé tombe en 1974, 2047, ou avant la mise en service.
      'shopify_order_paid_20261023', 'shopify_order_paid_version2', 'shopify_checkout_abandoned_relance1', 'shopify_order_paid_mh3x9k2a',
    ]) expect(estModeleDeLAssistant(nom, MAINTENANT), nom).toBe(false);
    // Un horodatage dans le futur (au-delà d'un jour de marge) non plus.
    expect(estModeleDeLAssistant(`shopify_order_paid_${(MAINTENANT + 3 * 24 * 3600_000).toString(36)}`, MAINTENANT)).toBe(false);
  });

  it('🔴 l’oubli d’un modèle de l’assistant se programme un quart d’heure plus tard ; jamais un nom choisi à la main, ni celui qu’on garde', async () => {
    const programmes: Array<{ job: JobOubli; quand: Date }> = [];
    const deps = { programmerOubli: async (job: JobOubli, quand: Date) => { programmes.push({ job, quand }); }, maintenant: () => MAINTENANT };
    const ancien = nomAssistant('order_paid', 9);
    await oublierPlusTard(deps, T, ancien, 'commande_payee');
    await oublierPlusTard(deps, T, 'commande_payee_v1', 'autre');
    await oublierPlusTard(deps, T, ancien, ancien);
    await oublierPlusTard(deps, T, null, 'autre');
    expect(programmes).toEqual([{ job: { tenantId: T, modele: ancien, essai: 0 }, quand: new Date(MAINTENANT + DELAI_OUBLI_MS) }]);
    // Un enfilement qui échoue se journalise et ne bloque pas le geste.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(oublierPlusTard({ programmerOubli: async () => { throw new Error('file indisponible'); }, maintenant: () => MAINTENANT }, T, ancien, 'x')).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });
});

describe('le travail du ménage (worker)', () => {
  const modele = nomAssistant('checkout_abandoned', 9);
  const job: JobOubli = { tenantId: T, modele, essai: 0 };
  function monterOubli(o: { messages?: MessageBranche[]; attentes?: AttenteMessage[]; issue?: { ok: true } | { ok: false; message: string } } = {}) {
    const journal = { supprimes: [] as string[], programmes: [] as Array<{ job: JobOubli; quand: Date }> };
    const deps = {
      store: { messages: async () => o.messages ?? [], attentes: async () => o.attentes ?? [] },
      // Le chemin des templates de bloc (lot 5) : jamais lu pour un modèle de l'assistant.
      blocs: { desModeles: async () => { throw new Error('desModeles : hors du chemin de l’assistant'); } },
      scenarios: { nommeLeModele: async () => { throw new Error('nommeLeModele : hors du chemin de l’assistant'); } },
      supprimerModele: async (_t: string, nom: string) => { journal.supprimes.push(nom); return o.issue ?? { ok: true as const }; },
      programmerOubli: async (j: JobOubli, quand: Date) => { journal.programmes.push({ job: j, quand }); },
      maintenant: () => MAINTENANT,
    };
    return { deps, journal };
  }
  const branche = (m: string): MessageBranche => ({ evenement: 'checkout_abandoned', modele: m, texte: null, langue: 'fr', variables: [], actif: true, modifieLe: '' });

  it('🔴 un modèle rebranché, ou attendu, entre le geste et le travail n’est PAS supprimé (la course de la relecture)', async () => {
    const rebranche = monterOubli({ messages: [branche(modele)] });
    expect(await traiterOubli(rebranche.deps, job)).toBe('garde');
    const attendu = monterOubli({ attentes: [{ evenement: 'checkout_abandoned', modele, langue: 'fr', variables: [], delaiMinutes: null, creeLe: '' }] });
    expect(await traiterOubli(attendu.deps, job)).toBe('garde');
    expect([...rebranche.journal.supprimes, ...attendu.journal.supprimes]).toEqual([]);
  });

  it('un modèle qui ne sert plus est supprimé', async () => {
    const { deps, journal } = monterOubli({ messages: [branche(nomAssistant('checkout_abandoned', 11))] });
    expect(await traiterOubli(deps, job)).toBe('supprime');
    expect(journal.supprimes).toEqual([modele]);
  });

  it('🔴 un refus (campagne active) se retente une heure plus tard, puis s’abandonne', async () => {
    const refus = { ok: false as const, message: 'template utilisé par une campagne active' };
    const { deps, journal } = monterOubli({ issue: refus });
    expect(await traiterOubli(deps, job)).toBe('reessai');
    expect(journal.programmes).toEqual([{ job: { ...job, essai: 1 }, quand: new Date(MAINTENANT + REESSAI_OUBLI_MS) }]);
    const dernier = monterOubli({ issue: refus });
    expect(await traiterOubli(dernier.deps, { ...job, essai: ESSAIS_OUBLI - 1 })).toBe('abandon');
    expect(dernier.journal.programmes).toEqual([]);
  });

  it('un travail mal formé, ou un nom qui n’est pas celui de l’assistant, ne supprime rien', async () => {
    const { deps, journal } = monterOubli();
    expect(await traiterOubli(deps, { tenantId: T })).toBe('ignore');
    expect(await traiterOubli(deps, null)).toBe('ignore');
    expect(await traiterOubli(deps, { ...job, modele: 'relance_panier' })).toBe('ignore');
    expect(journal.supprimes).toEqual([]);
  });
});

describe('la suppression liée par le câblage', () => {
  function monterSuppression(o: { campagnes?: number; succes?: boolean; panne?: boolean } = {}) {
    const journal = { removes: [] as string[], indices: [] as string[] };
    const deps = {
      repo: {
        getTenantWabaId: async () => 'waba-1',
        listActiveCampaignsForTemplate: async () => Array.from({ length: o.campagnes ?? 0 }, (_v, i) => ({ id: `c${i}`, name: 'Shopify', status: 'running' as const, templateLanguage: 'fr' })),
      },
      meta: {
        templateClientForTenant: async () => ({
          remove: async (_waba: string, nom: string) => {
            if (o.panne) throw new Error('Graph indisponible');
            journal.removes.push(nom);
            return { success: o.succes ?? true };
          },
        }),
      },
      indices: { removeByName: async (_t: string, nom: string) => { journal.indices.push(nom); } },
    } as unknown as Parameters<typeof suppressionDesModeles>[0];
    return { supprimer: suppressionDesModeles(deps), journal };
  }

  it('🔴 elle passe par la garde des campagnes actives : une campagne s’en sert, Meta n’est pas appelé', async () => {
    const { supprimer, journal } = monterSuppression({ campagnes: 1 });
    expect(await supprimer(T, 'm')).toMatchObject({ ok: false });
    expect(journal.removes).toEqual([]);
  });

  it('un succès, un refus de Meta, une panne', async () => {
    const ok = monterSuppression();
    expect(await ok.supprimer(T, 'm')).toEqual({ ok: true });
    expect(ok.journal.indices).toEqual(['m']);
    expect(await monterSuppression({ succes: false }).supprimer(T, 'm')).toMatchObject({ ok: false });
    expect(await monterSuppression({ panne: true }).supprimer(T, 'm')).toEqual({ ok: false, message: 'Graph indisponible' });
  });
});

describe('régler un message sans repasser par Meta', () => {
  it('le délai seulement pour la relance, dans ses bornes ; sans boutique, refusé', async () => {
    const a = monter();
    expect(await reglerMessage(a.deps, T, { evenement: 'checkout_abandoned', delaiMinutes: 120 })).toEqual({ ok: true, valeur: {} });
    expect(a.journal.delais).toEqual([120]);
    expect(await reglerMessage(a.deps, T, { evenement: 'order_paid', delaiMinutes: 120 })).toMatchObject({ ok: false, statut: 400 });
    expect(await reglerMessage(a.deps, T, { evenement: 'checkout_abandoned', delaiMinutes: 5 })).toMatchObject({ ok: false, statut: 400 });
    expect(a.journal.delais).toEqual([120]);
    expect(await reglerMessage(monter({ boutique: null }).deps, T, { evenement: 'checkout_abandoned', delaiMinutes: 120 })).toMatchObject({ ok: false, statut: 409 });
  });
});
