import { describe, it, expect } from 'vitest';
import { signalerConversion, type DepsConversion } from '../src/credit-whatsapp/conversion';
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
function monter(o: { offre?: Offre; etat?: EtatLigne; enVente?: boolean; panne?: 'offre' | 'emettre' } = {}) {
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
