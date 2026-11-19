'use client';

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Bouton } from '@/components/Bouton';
import { useT } from '@/lib/i18n';
import { ETAPES_VISITE, etapesVisibles, type EtapeVisite } from '@/lib/accueil-console';

/**
 * LA VISITE DE LA CONSOLE (plan 2026-11-19-accueil-pro) : une bulle pointée sur chaque zone, « Suivant », « Précédent »,
 * « Quitter ». Sans dépendance : la bulle se place contre l'élément mesuré, et se recalcule au redimensionnement et au
 * défilement.
 *
 * 🔴 AUCUN VOILE PLEIN ÉCRAN : la console reste lisible et cliquable derrière (`tests/web-formes.test.ts` refuse un voile
 * posé hors de la Modale). L'élément montré est seulement entouré d'un cadre de la taille de sa boîte.
 * ⚠️ Les étapes sont choisies À L'OUVERTURE parmi les éléments affichés : une entrée repliée dans le tiroir du téléphone,
 * ou retirée par l'offre ou le rôle, est sautée plutôt que pointée dans le vide.
 */
const visible = (cible: string): boolean => {
  const el = document.querySelector<HTMLElement>(cible);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
};

const LARGEUR = 288;
const MARGE = 12;

export function VisiteConsole({ onFin }: { onFin: () => void }) {
  const t = useT();
  const [etapes] = useState<EtapeVisite[]>(() => etapesVisibles(ETAPES_VISITE, visible));
  const [i, setI] = useState(0);
  const [boite, setBoite] = useState<DOMRect | null>(null);
  const etape = etapes[i];

  const mesurer = useCallback(() => {
    const el = etape ? document.querySelector<HTMLElement>(etape.cible) : null;
    setBoite(el ? el.getBoundingClientRect() : null);
  }, [etape]);

  useLayoutEffect(() => {
    if (!etape) return;
    document.querySelector<HTMLElement>(etape.cible)?.scrollIntoView({ block: 'nearest' });
    mesurer();
  }, [etape, mesurer]);

  useEffect(() => {
    window.addEventListener('resize', mesurer);
    window.addEventListener('scroll', mesurer, true);
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') onFin(); };
    window.addEventListener('keydown', echap);
    return () => {
      window.removeEventListener('resize', mesurer);
      window.removeEventListener('scroll', mesurer, true);
      window.removeEventListener('keydown', echap);
    };
  }, [mesurer, onFin]);

  // Rien à montrer (aucun élément affiché) : la visite se termine d'elle-même plutôt que de laisser une bulle vide.
  useEffect(() => { if (etapes.length === 0) onFin(); }, [etapes.length, onFin]);
  // L'élément a disparu après l'ouverture (fenêtre passée en largeur de téléphone, menu replié) : la visite se termine
  // plutôt que de rester montée, invisible, avec son écoute d'Échap (relecture du lot).
  useEffect(() => { if (etape && boite === null && !document.querySelector(etape.cible)) onFin(); }, [etape, boite, onFin]);
  if (!etape || !boite) return null;

  // À droite de l'élément s'il y a la place (le menu de gauche), sinon dessous, et toujours dans la fenêtre.
  const aDroite = boite.right + MARGE + LARGEUR <= window.innerWidth;
  const left = aDroite ? boite.right + MARGE : Math.max(MARGE, Math.min(boite.left, window.innerWidth - LARGEUR - MARGE));
  const top = aDroite
    ? Math.max(MARGE, Math.min(boite.top, window.innerHeight - 180))
    : Math.min(boite.bottom + MARGE, window.innerHeight - 180);
  const derniere = i === etapes.length - 1;

  return (
    <>
      <div aria-hidden="true" data-testid="visite-cadre"
        className="pointer-events-none fixed z-[65] rounded-controle ring-2 ring-brand-500 ring-offset-2"
        style={{ top: boite.top, left: boite.left, width: boite.width, height: boite.height }} />
      <div role="dialog" aria-live="polite" aria-label={t('Visite de la console', 'Console tour')} data-testid="visite-bulle"
        className="fixed z-[66] rounded-carte border border-ink-200 bg-white p-4 shadow-mm-lg"
        style={{ top, left, width: LARGEUR }}>
        <p className="text-xs text-ink-500" data-testid="visite-compteur">{`${i + 1} / ${etapes.length}`}</p>
        <p className="mt-1 text-sm text-ink-900" data-testid="visite-texte">{t(etape.fr, etape.en)}</p>
        <div className="mt-3 flex items-center gap-2">
          <button type="button" data-testid="visite-quitter" className="mr-auto text-xs text-ink-500 hover:underline" onClick={onFin}>
            {t('Quitter', 'Exit')}
          </button>
          {i > 0 && (
            <Bouton variante="secondaire" taille="petite" data-testid="visite-precedent" onClick={() => setI(i - 1)}>
              {t('Précédent', 'Back')}
            </Bouton>
          )}
          <Bouton taille="petite" data-testid="visite-suivant" onClick={() => (derniere ? onFin() : setI(i + 1))}>
            {derniere ? t('Terminer', 'Finish') : t('Suivant', 'Next')}
          </Bouton>
        </div>
      </div>
    </>
  );
}
