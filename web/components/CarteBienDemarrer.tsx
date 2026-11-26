'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { getDemarrage, type EtatDemarrage } from '@/lib/api';
import { BIENVENUE_EVENT } from '@/lib/accueil-console';
import { ETAPES, progression } from '@/lib/bien-demarrer';
import { classesBouton } from '@/components/Bouton';
import { useOffre } from '@/lib/use-offre';
import { Icone } from '@/components/Icone';

/** La carte masquée d'un clic sur sa croix, sur ce navigateur et pour cet espace (certains n'iront jamais au bout). */
const cleMasquee = (tenantId: string): string => `mba.carte-bien-demarrer.${tenantId}`;

/**
 * LA CARTE « BIEN DÉMARRER » DE L'ACCUEIL (plan 2026-11-24-guide-demarrage, lot 2) : elle porte la checklist une fois la
 * fenêtre de bienvenue fermée, jusqu'à 5 sur 5, puis disparaît. « Continuer » rouvre la fenêtre (`BIENVENUE_EVENT`).
 * Jamais en Free ni pour une session d'observation, où la fenêtre ne s'ouvre pas : « Continuer » serait un bouton mort.
 * Rien tant que l'état se lit, rien s'il est inconnu (route absente, panne) : une carte à zéro coche sur un espace qui a
 * tout fait serait fausse. L'Accueil est réservé aux administrateurs, comme la route. Sa croix la masque pour de bon
 * (`cleMasquee`) ; la checklist reste ouvrable depuis l'aide.
 */
export function CarteBienDemarrer({ tenantId, observation }: { tenantId: string; observation: boolean }) {
  const t = useT();
  // La même règle que la fenêtre qu'elle rouvre (`bienDemarrerOuvert`, AppShell) : ni Free, ni observation, offre lue.
  const vue = useOffre(tenantId);
  const ouverte = !observation && !!vue && vue.offre !== 'free';
  const [etat, setEtat] = useState<EtatDemarrage | null>(null);
  const [masquee, setMasquee] = useState(false);
  useEffect(() => {
    if (!ouverte) return;
    let dejaMasquee = false;
    try { dejaMasquee = window.localStorage.getItem(cleMasquee(tenantId)) === '1'; } catch { /* stockage indisponible : elle paraît */ }
    if (dejaMasquee) { setMasquee(true); return; }
    let vivant = true;
    const lire = () => { void getDemarrage(tenantId).then((e) => { if (vivant) setEtat(e); }); };
    lire();
    // Rouverte puis refermée, la fenêtre a pu mener à un geste : la carte se relit au retour sur l'onglet.
    const auRetour = () => { if (document.visibilityState === 'visible') lire(); };
    document.addEventListener('visibilitychange', auRetour);
    return () => { vivant = false; document.removeEventListener('visibilitychange', auRetour); };
  }, [tenantId, ouverte]);

  if (!ouverte || masquee || etat === null) return null;
  const p = progression(etat, () => true);
  if (p.complete) return null;
  const prochaine = ETAPES.find((e) => e.cle === p.prochaine);
  const masquer = (): void => {
    setMasquee(true);
    try { window.localStorage.setItem(cleMasquee(tenantId), '1'); } catch { /* stockage indisponible : elle revient au prochain chargement */ }
  };
  return (
    <section data-testid="carte-bien-demarrer" className="flex flex-wrap items-center gap-4 rounded-carte border border-brand-200 bg-brand-50 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-900">
          {t('Bien démarrer', 'Getting started')}
          <span className="ml-2 font-normal text-ink-500" data-testid="carte-bien-demarrer-compte">
            {t(`${p.faites} étape${p.faites > 1 ? 's' : ''} sur ${p.total}`, `${p.faites} of ${p.total} steps`)}
          </span>
        </p>
        {prochaine && (
          <p className="mt-0.5 text-xs text-ink-500">
            {t('Prochaine étape : ', 'Next step: ')}{t(prochaine.titre.fr, prochaine.titre.en)}
          </p>
        )}
        <div className="mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-white" aria-hidden="true">
          <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.round((p.faites / p.total) * 100)}%` }} />
        </div>
      </div>
      <button type="button" data-testid="carte-bien-demarrer-continuer" className={classesBouton('principal')}
        onClick={() => window.dispatchEvent(new Event(BIENVENUE_EVENT))}>
        {t('Continuer', 'Continue')}
      </button>
      <button type="button" onClick={masquer} data-testid="carte-bien-demarrer-masquer" title={t('Ne plus afficher', 'Don’t show again')}
        className="-mr-2 self-start rounded-controle px-2 py-1 text-ink-500 hover:bg-white">
        <Icone nom="fermer" taille="petite" titre={t('Ne plus afficher', 'Don’t show again')} />
      </button>
    </section>
  );
}
