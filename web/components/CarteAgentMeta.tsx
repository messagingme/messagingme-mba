'use client';

import { useEffect, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n';
import { fmtCost, fmtNum } from '@/lib/format';
import { getInsightsMba, type InsightsMba } from '@/lib/api-mba';
import { Nd } from '@/components/Nd';
import { estimationMbaUsd } from '@/lib/partage/agent-meta';

const CARD = 'rounded-carte border border-ink-200 bg-white p-5';
const TH = 'px-2 py-1.5 text-left text-xs font-medium text-ink-500';
const TD = 'px-2 py-1.5 text-sm text-ink-900';

/**
 * LA CARTE « MBA » DE PERFORMANCE LAB (2026-10-02, renommée le 2026-11-10) : ce que le Meta Business Agent a fait sur les
 * 30 derniers jours, d'après Meta (conversations, outils, événements), et ses messages comptés chez nous avec un coût
 * ESTIMÉ au prix public.
 *
 * 🔴 LE COÛT EST UNE ESTIMATION, ET LA CARTE LE DIT. Le coût réel ne nous est lisible qu'avec la permission
 * `business_management` (mesuré le 2026-11-10, plan `2026-11-10-cout-ia-et-mba.md`, lot B) : la facture du Billing Hub
 * fait foi.
 *
 * ⚠️ ELLE SE TAIT SANS NUMÉRO, et aussi quand la route ne répond pas (API d'avant cette route, compte qui n'est pas
 * administrateur) : c'est une carte de plus sur la page, pas un chiffre que le reste attend. Une absence de valeur
 * dans une réponse valide s'écrit « n/d », jamais zéro.
 *
 * ⚠️ PÉRIODE FIXE de 30 jours, dite dans le titre : Meta borne ses statistiques d'outils et d'événements à 30 jours, la
 * carte ne suit donc pas la période choisie en haut de la page.
 */
export function CarteAgentMeta({ tenantId }: { tenantId: string }) {
  const t = useT();
  const { locale } = useLocale();
  const [d, setD] = useState<InsightsMba | null>(null);

  useEffect(() => {
    let vivant = true;
    setD(null);
    getInsightsMba(tenantId)
      .then((r) => { if (vivant && r && r.numero === true) setD(r); })
      .catch(() => { /* la carte se tait : voir l'en-tête */ });
    return () => { vivant = false; };
  }, [tenantId]);

  if (d === null || d.numero !== true) return null;

  const nombre = (v: number | null | undefined) => (v === null || v === undefined ? <Nd /> : fmtNum(v, locale));
  const pourcent = (v: number | null) => (v === null ? <Nd /> : `${Math.round(v * 100)} %`);
  const secondes = (ms: number | null) => (ms === null ? <Nd /> : `${(ms / 1000).toFixed(1)} s`);
  // La même base que la part « MBA estimé » de « Coût de l'IA » (`estimationMbaUsd`), ici dans la devise du prix public.
  const usd = d.messages === null || d.messages === undefined ? null : estimationMbaUsd(d.messages);
  const cout = usd === null
    ? null
    : t(
      `${fmtCost(usd.min, locale, 'USD')} à ${fmtCost(usd.max, locale, 'USD')}`,
      `${fmtCost(usd.min, locale, 'USD')} to ${fmtCost(usd.max, locale, 'USD')}`,
    );

  return (
    <section className={CARD} data-testid="carte-agent-meta">
      <header className="mb-4">
        {/* « MBA » et « Meta Business Agent » restent tels quels partout (CLAUDE.md) : c'est le nom du produit de Meta. */}
        <h2 className="text-sm font-semibold text-ink-900">MBA</h2>
        <p className="mt-0.5 text-xs text-ink-500">{t('Meta Business Agent, les 30 derniers jours.', 'Meta Business Agent, the last 30 days.')}</p>
      </header>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Chiffre libelle={t('Conversations tenues', 'Conversations handled')} testId="agent-meta-conversations">
          {nombre(d.conversations?.traitees)}
        </Chiffre>
        <Chiffre libelle={t('En attente de votre équipe', 'Waiting for your team')} testId="agent-meta-attente" detail={t('en ce moment', 'right now')}>
          {nombre(d.conversations?.enAttenteEquipe)}
        </Chiffre>
        <Chiffre libelle={t('Messages écrits', 'Messages written')} testId="agent-meta-messages">
          {nombre(d.messages)}
        </Chiffre>
        <Chiffre libelle={t('Coût estimé', 'Estimated cost')} testId="agent-meta-cout" detail={t('au prix public, la facture de Meta fait foi', 'at public price, Meta’s invoice prevails')}>
          {cout ?? <Nd />}
        </Chiffre>
      </dl>

      {d.outils !== null && d.outils.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <h3 className="mb-1 text-xs font-medium text-ink-500">{t('Outils appelés par l’agent', 'Tools called by the agent')}</h3>
          <table className="w-full min-w-[24rem] border-collapse" data-testid="agent-meta-outils">
            <thead>
              <tr className="border-b border-ink-100">
                <th className={TH}>{t('Outil', 'Tool')}</th>
                <th className={`${TH} text-right`}>{t('Conversations', 'Conversations')}</th>
                <th className={`${TH} text-right`}>{t('Réussite', 'Success')}</th>
                <th className={`${TH} text-right`}>{t('Temps moyen', 'Average time')}</th>
              </tr>
            </thead>
            <tbody>
              {d.outils.map((o) => (
                <tr key={o.brut} className="border-b border-ink-50">
                  <td className={`${TD} max-w-[14rem] truncate`} title={o.brut}>{o.nom}</td>
                  <td className={`${TD} text-right tabular-nums`}>{nombre(o.conversations)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{pourcent(o.succes)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{secondes(o.latenceMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {d.evenements !== null && d.evenements.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <h3 className="mb-1 text-xs font-medium text-ink-500">{t('Événements envoyés à l’agent', 'Events sent to the agent')}</h3>
          <table className="w-full min-w-[24rem] border-collapse" data-testid="agent-meta-evenements">
            <thead>
              <tr className="border-b border-ink-100">
                <th className={TH}>{t('Événement', 'Event')}</th>
                <th className={`${TH} text-right`}>{t('Reçus', 'Received')}</th>
                <th className={`${TH} text-right`}>{t('Traités', 'Processed')}</th>
                <th className={`${TH} text-right`}>{t('Temps moyen', 'Average time')}</th>
              </tr>
            </thead>
            <tbody>
              {d.evenements.map((e) => (
                <tr key={e.type} className="border-b border-ink-50">
                  <td className={TD}>{e.type}</td>
                  <td className={`${TD} text-right tabular-nums`}>{nombre(e.recus)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{nombre(e.traites)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{secondes(e.latenceMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Chiffre({ libelle, detail, testId, children }: { libelle: string; detail?: string; testId: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{libelle}</dt>
      <dd className="mt-0.5 text-xl font-semibold tabular-nums text-ink-900" data-testid={testId}>{children}</dd>
      {detail && <dd className="text-xs text-ink-500">{detail}</dd>}
    </div>
  );
}
