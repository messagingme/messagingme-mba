'use client';

import { DailyChart } from '@/components/DailyChart';
import type { PointCredit } from '@/lib/api-credit';
import { brand } from '@/lib/couleurs';
import { useT, useLocale } from '@/lib/i18n';

/**
 * LA COURBE DE 90 JOURS D'UN CRÉDIT (lot C ; décision de Julien du 2026-11-02 : « un endroit où suivre l'évolution du
 * crédit »), commune aux onglets Crédit IA et Crédit WhatsApp.
 *
 * Un prépayé suit son SOLDE de fin de jour (le grand chiffre est le solde d'aujourd'hui). Une Entreprise, dont le solde ne
 * bouge pas (illimité, facturé au contrat), suit ce qu'elle CONSOMME chaque jour (le grand chiffre est le total des 90
 * jours) : sa courbe de solde ne serait qu'une ligne plate. Sans points (une API plus ancienne), rien ne s'affiche.
 */
export function CourbeCredit({ serie, illimite, testid }: { serie: readonly PointCredit[]; illimite: boolean; testid: string }) {
  const t = useT();
  const { locale } = useLocale();
  if (serie.length === 0) return null;
  const formatEuros = (n: number): string =>
    n.toLocaleString(locale === 'en' ? 'en-GB' : 'fr-FR', { style: 'currency', currency: 'EUR' });
  // En euros EXACTS, arrondis au seul affichage : arrondir chaque jour au centime avant de les sommer ferait dériver le
  // total des 90 jours d'un demi-centime par jour (vu en e2e : 1,27 € pour 1,2765 €).
  const points = serie.map((p) => ({ date: p.jour, count: (illimite ? p.consommationMicroEur : p.soldeMicroEur) / 1_000_000 }));
  return (
    <div data-testid={testid} data-genre={illimite ? 'consommation' : 'solde'}>
      <DailyChart
        title={illimite ? t('Consommation par jour', 'Usage per day') : t('Solde en fin de journée', 'End-of-day balance')}
        subtitle={illimite
          ? t('90 derniers jours, hors taxe, facturés selon votre contrat', 'last 90 days, excluding VAT, billed under your contract')
          : t('90 derniers jours, hors taxe', 'last 90 days, excluding VAT')}
        from={serie[0]!.jour}
        to={serie[serie.length - 1]!.jour}
        summary={illimite ? 'sum' : 'last'}
        series={[{ label: illimite ? t('Consommé', 'Used') : t('Solde', 'Balance'), color: brand[400], points }]}
        formatValeur={formatEuros}
      />
    </div>
  );
}
