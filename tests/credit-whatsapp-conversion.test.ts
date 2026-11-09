import { describe, it, expect } from 'vitest';
import { FENETRE_CONVERSION_JOURS, signalerConversion, signalerConversionDuPro, type DepsConversion } from '../src/credit-whatsapp/conversion';
import type { Emission } from '../src/emails-produit/emission';
import type { Offre } from '../src/offres/offres';
import type { EtatLigne } from '../src/credit-whatsapp/etat-ligne';
import { CATALOGUE } from '../src/emails-produit/catalogue';
import { PRIX_OPTION_WA_HT_CENTIMES } from '../src/stripe/option-credit-whatsapp';
import { readFileSync } from 'node:fs';

/**
 * LA CONVERSION DITE AU CLIENT (révision du Crédit WhatsApp du 2026-11-04, lot C, moment 2) : quand sa formule devient
 * payée (l'essai de la formule Pro fini et payé, ou écourté ; un Business confirmé), les admins de l'espace apprennent
 * qu'ils peuvent payer leurs messages chez Messaging Me. Une fois par espace. Hors vente (décision de Julien du
 * 2026-11-06), le même moment, un texte « sur demande ».
 */
const T = 't1';
const MAINTENANT = Date.parse('2026-12-01T10:00:00Z');
const JOUR = 86_400_000;
function monter(o: {
  offre?: Offre; etat?: EtatLigne; enVente?: boolean; panne?: 'offre' | 'emettre' | 'depuis';
  /** Quand la formule Pro est devenue payée ; `null` : aucun Pro. Par défaut, la veille. */
  depuis?: Date | null;
} = {}) {
  const emissions: Emission[] = [];
  const d: DepsConversion = {
    offre: async () => { if (o.panne === 'offre') throw new Error('base'); return o.offre ?? 'pro'; },
    etat: async () => o.etat ?? 'a_prendre',
    enVente: o.enVente ?? false,
    emettre: async (e) => {
      if (o.panne === 'emettre') throw new Error('file');
      emissions.push(e);
      return { destinataires: 1, reserves: 1 };
    },
    pageNumero: 'https://console.exemple/connecter-whatsapp',
    pageSupport: 'https://console.exemple/support',
    proPayeDepuis: async () => {
      if (o.panne === 'depuis') throw new Error('base');
      return o.depuis === undefined ? new Date(MAINTENANT - JOUR) : o.depuis;
    },
    maintenant: () => MAINTENANT,
  };
  return { d, emissions };
}

describe('signalerConversion', () => {
  it('🔴 la formule payée, l’option en vente : l’e-mail de vente, une occasion « conversion » par espace, vers Connecter WhatsApp', async () => {
    const m = monter({ enVente: true });
    await signalerConversion(m.d, T);
    expect(m.emissions).toEqual([{
      cle: 'ligne_credit_disponible', tenantId: T, occasion: 'conversion', a: 'admins',
      valeurs: { lien_numero: 'https://console.exemple/connecter-whatsapp' },
    }]);
  });

  it('🔴 hors vente (décision de Julien du 2026-11-06) : le texte « sur demande », la même occasion, vers le Support', async () => {
    const m = monter({ enVente: false });
    await signalerConversion(m.d, T);
    expect(m.emissions).toEqual([{
      cle: 'ligne_credit_sur_demande', tenantId: T, occasion: 'conversion', a: 'admins',
      valeurs: { lien_support: 'https://console.exemple/support' },
    }]);
  });

  it('🔴 un Business confirmé aussi ; jamais une formule pas encore payée (un essai), ni une Free, ni une Entreprise, ni un espace qui a déjà son option ou sa ligne', async () => {
    const business = monter({ offre: 'business' });
    await signalerConversion(business.d, T);
    expect(business.emissions.map((e) => e.cle)).toEqual(['ligne_credit_sur_demande']);
    // Une ligne posée à la main (sur demande) ou une option déjà payée : « vous pouvez maintenant » serait faux.
    const deja = (['essai', 'en_attente', 'active', 'arretee'] as const).map((etat) => ({ etat }));
    for (const o of [...deja, { offre: 'base' as const, etat: 'free' as const }, { offre: 'entreprise' as const }]) {
      const m = monter(o);
      await signalerConversion(m.d, T);
      expect(m.emissions, JSON.stringify(o)).toEqual([]);
    }
  });

  it('🔴 ne lève jamais : une lecture ou une émission en panne ne fait pas tomber le webhook ni /ops', async () => {
    for (const panne of ['offre', 'emettre'] as const) {
      await expect(signalerConversion(monter({ panne }).d, T), panne).resolves.toBeUndefined();
    }
  });

  it('🔴 le webhook ne la dit qu’à son moment (jaune 1 du lot C) : dans la fenêtre qui suit la fin de l’essai ou la souscription ; un renouvellement un mois ou treize mois plus tard, jamais', async () => {
    expect(FENETRE_CONVERSION_JOURS).toBe(25);
    const aLaFin = monter({ depuis: new Date(MAINTENANT - JOUR) });
    await signalerConversionDuPro(aLaFin.d, T);
    expect(aLaFin.emissions.map((e) => e.cle)).toEqual(['ligne_credit_sur_demande']);
    // Le premier paiement relancé par Stripe quelques semaines plus tard reste dans la fenêtre.
    const relance = monter({ depuis: new Date(MAINTENANT - 20 * JOUR) });
    await signalerConversionDuPro(relance.d, T);
    expect(relance.emissions).toHaveLength(1);
    // Un admin arrivé depuis, au renouvellement suivant, ou un an plus tard (le journal des e-mails purgé) : rien.
    for (const jours of [31, 400]) {
      const plusTard = monter({ depuis: new Date(MAINTENANT - jours * JOUR) });
      await signalerConversionDuPro(plusTard.d, T);
      expect(plusTard.emissions, `${jours} jours`).toEqual([]);
    }
    const sansPro = monter({ depuis: null });
    await signalerConversionDuPro(sansPro.d, T);
    expect(sansPro.emissions).toEqual([]);
    await expect(signalerConversionDuPro(monter({ panne: 'depuis' }).d, T)).resolves.toBeUndefined();
  });

  it('🔴 les deux e-mails disent ce qu’il advient d’un numéro sans l’application et d’un numéro qui la garde, dans les deux langues (jaune 12 du lot C)', () => {
    for (const cle of ['ligne_credit_disponible', 'ligne_credit_sur_demande']) {
      const m = CATALOGUE.find((x) => x.cle === cle)!;
      expect(m.textes.fr.corps, cle).toContain('Un numéro connecté sans l’application WhatsApp Business garde ses conversations');
      expect(m.textes.fr.corps, cle).toContain('un numéro qui garde l’application reste sur votre carte chez Meta');
      expect(m.textes.en.corps, cle).toContain('A number connected without the WhatsApp Business app keeps its conversations');
      expect(m.textes.en.corps, cle).toContain('a number that keeps the app stays on your card at Meta');
    }
  });

  it('🔴 les deux e-mails sont commerciaux : une proposition payante porte le lien de désinscription (jaune 11 du lot C, décision de Julien du 2026-11-09)', () => {
    for (const cle of ['ligne_credit_disponible', 'ligne_credit_sur_demande']) {
      expect(CATALOGUE.find((x) => x.cle === cle)!.categorie, cle).toBe('commercial');
    }
  });

  it('le prix des deux e-mails et du bandeau de la console est celui de l’option, dans les deux langues', () => {
    const euros = PRIX_OPTION_WA_HT_CENTIMES / 100;
    for (const cle of ['ligne_credit_disponible', 'ligne_credit_sur_demande']) {
      const m = CATALOGUE.find((x) => x.cle === cle)!;
      expect(m.textes.fr.corps, cle).toContain(euros + ' € HT par numéro et par mois');
      expect(m.textes.en.corps, cle).toContain('€' + euros + ' excl. VAT per number per month');
    }
    const bandeau = readFileSync('web/components/BandeauLigneCredit.tsx', 'utf8');
    expect(bandeau).toContain(euros + ' € HT par numéro et par mois');
    expect(bandeau).toContain('€' + euros + ' excl. VAT per number per month');
  });
});
