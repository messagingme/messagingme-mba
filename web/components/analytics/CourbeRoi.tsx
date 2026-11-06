'use client';

import { useState } from 'react';
import { useT, useLocale } from '@/lib/i18n';
import { brand, ink, navy } from '@/lib/couleurs';
import { fmtMontant } from '@/lib/ventes';
import type { PointRoiVue } from '@/lib/roi';

/**
 * Quantitatif > Shopify : ce que les messages ont COÛTÉ et ce qu'ils ont RAMENÉ, cumulés depuis le premier jour de la
 * période (plan 2026-11-06, tâche 6). SVG maison, comme `PerformanceCourbe`.
 *
 * 🔴 DEUX ÉCHELLES, une par courbe, et chacune le dit dans la légende. Le chiffre fait souvent cent fois le coût : sur une
 * seule échelle, la courbe du coût serait une ligne plate au fond du graphique, et l'écran perdrait ce qu'il montre.
 * `DailyChart` ne sert donc pas ici : il n'a qu'une échelle et ADDITIONNE ses séries dans son grand chiffre.
 */

const W = 560;
const H = 176;
const PAD = { top: 16, right: 14, bottom: 22, left: 8 };
const jj = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function CourbeRoi({ serie, devise }: { serie: PointRoiVue[]; devise: string }) {
  const t = useT();
  const { locale } = useLocale();
  const [survol, setSurvol] = useState<number | null>(null);
  const montant = (x: number | string) => fmtMontant(String(x), devise, locale);

  const chiffres = serie.map((p) => Number(p.chiffreCumule));
  const couts = serie.map((p) => p.coutCumule);
  const maxChiffre = Math.max(1, ...chiffres);
  const maxCout = Math.max(1, ...couts);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const n = serie.length;
  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number, max: number) => PAD.top + innerH - (v / max) * innerH;
  const courbes = [
    { cle: 'ramene', libelle: t('Ramené (cumul)', 'Brought in (cumulative)'), couleur: brand[500], valeurs: chiffres, max: maxChiffre },
    { cle: 'depense', libelle: t('Dépensé (cumul)', 'Spent (cumulative)'), couleur: navy[400], valeurs: couts, max: maxCout },
  ];

  if (n === 0) return null;
  return (
    <div className="relative" data-testid="roi-courbe">
      <div className="mb-2 flex flex-wrap gap-3 text-xs text-ink-500">
        {courbes.map((c) => (
          <span key={c.cle} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.couleur }} />
            {c.libelle} : {t(`échelle jusqu’à ${montant(c.max)}`, `scale up to ${montant(c.max)}`)}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: 'visible' }} role="img"
        aria-label={t('Dépensé et ramené, cumulés jour par jour', 'Spent and brought in, cumulative by day')}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH * (1 - f)} y2={PAD.top + innerH * (1 - f)}
            stroke={ink[100]} strokeWidth="1" strokeDasharray={f === 0 ? '0' : '2 5'} />
        ))}
        {courbes.map((c) => (
          <polyline key={c.cle} data-testid={`roi-courbe-${c.cle}`} fill="none" stroke={c.couleur} strokeWidth="2.25"
            strokeLinejoin="round" strokeLinecap="round"
            points={c.valeurs.map((v, i) => `${x(i).toFixed(1)},${y(v, c.max).toFixed(1)}`).join(' ')} />
        ))}
        <text x={PAD.left} y={H - 4} textAnchor="start" className="fill-ink-300 text-[10px]">{jj(serie[0]?.jour ?? '')}</text>
        <text x={W - PAD.right} y={H - 4} textAnchor="end" className="fill-ink-300 text-[10px]">{jj(serie[n - 1]?.jour ?? '')}</text>
        {survol !== null && (
          <line x1={x(survol)} x2={x(survol)} y1={PAD.top} y2={PAD.top + innerH} stroke={ink[200]} strokeWidth="1" strokeDasharray="3 3" />
        )}
        <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} fill="transparent"
          onMouseMove={(e) => {
            const r = (e.target as SVGRectElement).getBoundingClientRect();
            setSurvol(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
          }}
          onMouseLeave={() => setSurvol(null)} />
      </svg>
      {survol !== null && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-controle bg-ink-900 px-2.5 py-1.5 text-xs text-white shadow-mm-md"
          style={{ left: `${(x(survol) / W) * 100}%`, top: 0 }}>
          <div className="mb-0.5 font-semibold text-white/70">{jj(serie[survol]?.jour ?? '')}</div>
          {courbes.map((c) => (
            <div key={c.cle} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.couleur }} />
              {c.libelle} <span className="font-semibold tabular-nums">{montant(c.valeurs[survol] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
