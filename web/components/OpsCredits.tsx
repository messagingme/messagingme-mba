'use client';

import { useEffect, useState } from 'react';
import { getOpsCredits, getOpsVercel, type DeuxMoisOps, type JaugeVercel, type LigneCreditsOps, type VueCreditsOps } from '@/lib/api/compte';
import { ApiError } from '@/lib/http';
import { useT, useLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import { Squelette } from '@/components/Squelette';
import { MbaNotice } from '@/components/MbaNotice';

/**
 * L'ONGLET « CRÉDITS » DE `/ops` (Entreprise illimitée, lot C ; décision de Julien du 2026-11-02 : le suivi du crédit
 * « pour le client et pour nous »). Deux choses qu'aucun autre écran ne donne :
 *  - le montant à FACTURER de chaque Entreprise, le mois en cours et le précédent (ses débits IA et ses messages
 *    WhatsApp illimités, au prix client) ;
 *  - la somme des plafonds IA des Entreprises qui ont une clé, face au budget d'équipe de Vercel (rouge de la relecture
 *    du lot B) : au-delà, une seule Entreprise qui s'emballe couperait l'IA de tous les clients.
 * Sa propre route, lue à l'ouverture de l'onglet ; la jauge Vercel est celle de l'onglet Capacité.
 */
export function OpsCredits({ jeton, onPerdue }: { jeton: string; onPerdue: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const [vue, setVue] = useState<VueCreditsOps | null>(null);
  const [jauge, setJauge] = useState<JaugeVercel | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    getOpsCredits(jeton)
      .then((v) => { if (vivant) setVue(v); })
      .catch((e: unknown) => {
        if (!vivant) return;
        if (e instanceof ApiError && e.status === 401) { onPerdue(); return; }
        setErreur(e instanceof ApiError && e.status === 404
          ? t('La vue « Crédits » n’est pas encore disponible sur cette version de l’API.', 'The Credits view is not available on this API version yet.')
          : `${t('Crédits illisibles', 'Credits unreadable')}${e instanceof Error && e.message ? ` : ${e.message}` : ''}`);
      });
    // La jauge ne fait jamais échouer l'onglet : sans elle, la somme des plafonds se lit seule.
    getOpsVercel(jeton).then((j) => { if (vivant && typeof j?.configure === 'boolean') setJauge(j); }).catch(() => undefined);
    return () => { vivant = false; };
  }, [jeton, onPerdue, t]);

  if (erreur) return <MbaNotice kind="error" testid="ops-credits-erreur">{erreur}</MbaNotice>;
  if (!vue) return <Squelette forme="carte" />;

  const budget = jauge?.configure && typeof jauge.limiteDollars === 'number' ? jauge.limiteDollars : null;
  const depasse = budget !== null && vue.plafondsEntreprisesAvecCleDollars > budget;
  return (
    <div className="space-y-4">
      <div className="rounded-carte border border-ink-200 bg-white p-5" data-testid="ops-credits-plafonds">
        <h3 className="text-sm font-semibold text-ink-900">{t('Plafonds IA des Entreprises et budget d’équipe Vercel', 'Enterprise AI caps and Vercel team budget')}</h3>
        <p className="mt-1 text-xs text-ink-500">
          {t(
            `Chaque Entreprise qui a une clé peut consommer son plafond dans le mois (défaut : ${euros(vue.plafondIaParDefautMicroEur, locale)}). À 100 % du budget d’équipe, Vercel coupe toutes les clés.`,
            `Each Enterprise with a key may use up its cap within the month (default: ${euros(vue.plafondIaParDefautMicroEur, locale)}). At 100% of the team budget, Vercel cuts every key.`,
          )}
        </p>
        <p className="mt-3 text-sm text-ink-900" data-testid="ops-credits-somme">
          {t('Somme des plafonds : ', 'Sum of caps: ')}
          <span className="font-semibold tabular-nums">{euros(vue.plafondsEntreprisesAvecCleMicroEur, locale)}</span>
          <span className="text-ink-500"> {t(`(environ ${dollars(vue.plafondsEntreprisesAvecCleDollars, locale)})`, `(about ${dollars(vue.plafondsEntreprisesAvecCleDollars, locale)})`)}</span>
          {' · '}
          {t('budget d’équipe : ', 'team budget: ')}
          <span className="font-semibold tabular-nums">{budget === null ? t('inconnu', 'unknown') : dollars(budget, locale)}</span>
        </p>
        {depasse && (
          <MbaNotice kind="error" testid="ops-credits-depassement">
            {t(
              'Au-delà du budget d’équipe : une seule Entreprise qui s’emballe couperait l’IA de tous les clients. Relever le budget chez Vercel, ou baisser un plafond (Clients, lien « offre »).',
              'Above the team budget: a single runaway Enterprise would cut AI for every client. Raise the budget at Vercel, or lower a cap (Clients, “plan” link).',
            )}
          </MbaNotice>
        )}
      </div>

      <div className="overflow-x-auto rounded-carte border border-ink-200 bg-white">
        <table className="w-full min-w-[820px] text-sm" data-testid="ops-credits-table">
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs text-ink-500">
              <th className="px-4 py-3 font-medium">{t('Espace', 'Workspace')}</th>
              <th className="px-3 py-3 font-medium">{t('Crédit IA', 'AI credit')}</th>
              <th className="px-3 py-3 text-right font-medium">{t('IA, mois / précédent', 'AI, month / previous')}</th>
              <th className="px-3 py-3 font-medium">{t('Ligne de crédit', 'Credit line')}</th>
              <th className="px-3 py-3 text-right font-medium">{t('WhatsApp, mois / précédent', 'WhatsApp, month / previous')}</th>
              <th className="px-3 py-3 text-right font-medium">{t('À facturer, mois / précédent', 'To invoice, month / previous')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {vue.espaces.map((e) => <Ligne key={e.tenantId} e={e} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Ligne({ e }: { e: LigneCreditsOps }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <tr data-testid={`ops-credits-${e.tenantId}`}>
      <td className="px-4 py-3">
        <div className="font-medium text-ink-900">{e.nom}</div>
        <div className="text-xs text-ink-500">{nomOffre(e.offre, t)}</div>
      </td>
      <td className="px-3 py-3 text-xs">
        {e.ia.illimite ? (
          <>
            <span className="text-ink-900">{t('illimité', 'unlimited')}</span>
            <span className="text-ink-500"> · {t('plafond', 'cap')} {euros(e.ia.plafondMicroEur ?? 0, locale)}</span>
            {e.ia.plafondAtteint && <span className="font-medium text-danger" data-testid="ops-credits-plafond-atteint"> · {t('atteint', 'reached')}</span>}
            {!e.ia.cle && <span className="text-ink-500"> · {t('sans clé', 'no key')}</span>}
          </>
        ) : (
          <span className="tabular-nums text-ink-900">{euros(e.ia.soldeMicroEur, locale)}</span>
        )}
      </td>
      <td className="px-3 py-3 text-right text-xs tabular-nums text-ink-700">{deuxMois(e.ia.consommation, locale)}</td>
      <td className="px-3 py-3 text-xs">
        {!e.whatsapp.surLaLigne && e.whatsapp.soldeMicroEur === 0
          ? <span className="text-ink-500">{t('pas sur la ligne', 'not on the line')}</span>
          : e.ia.illimite
            ? <span className="text-ink-900">{t('illimitée', 'unlimited')}</span>
            : <span className="tabular-nums text-ink-900">{euros(e.whatsapp.soldeMicroEur, locale)}</span>}
      </td>
      <td className="px-3 py-3 text-right text-xs tabular-nums text-ink-700">{deuxMois(e.whatsapp.consommation, locale)}</td>
      <td className="px-3 py-3 text-right text-xs tabular-nums font-medium text-ink-900" data-testid="ops-credits-a-facturer">
        {e.aFacturer ? deuxMois(e.aFacturer, locale) : <span className="font-normal text-ink-500">{t('prépayé', 'prepaid')}</span>}
      </td>
    </tr>
  );
}

function euros(microEur: number, locale: Locale): string {
  return (microEur / 1_000_000).toLocaleString(locale === 'en' ? 'en-GB' : 'fr-FR', { style: 'currency', currency: 'EUR' });
}

function dollars(n: number, locale: Locale): string {
  return n.toLocaleString(locale === 'en' ? 'en-GB' : 'fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function deuxMois(d: DeuxMoisOps, locale: Locale): string {
  return `${euros(d.moisMicroEur, locale)} / ${euros(d.moisPrecedentMicroEur, locale)}`;
}

/** L'offre telle que `offre_de_l_espace` la rend : `base` est la Free. */
function nomOffre(o: string, t: (fr: string, en: string) => string): string {
  return o === 'base' ? t('Free', 'Free') : o === 'pro' ? t('Pro', 'Pro') : o === 'business' ? t('Business', 'Business')
    : o === 'entreprise' ? t('Entreprise', 'Enterprise') : o;
}
