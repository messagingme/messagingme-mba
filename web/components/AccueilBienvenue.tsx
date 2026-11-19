'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modale } from '@/components/Modale';
import { Bouton } from '@/components/Bouton';
import { useT } from '@/lib/i18n';
import { getAccountStatus, marquerAccueil } from '@/lib/api';
import { raccourcisAccueil, VISITE_EVENT } from '@/lib/accueil-console';

/**
 * LA FENÊTRE DE BIENVENUE D'UN NOUVEAU MEMBRE (plan 2026-11-19-accueil-pro) : « Faire le tour », ou un premier geste
 * tout de suite. Montée par la coquille quand `/me` rend `accueilAFaire`.
 *
 * 🔴 CHAQUE CHOIX MARQUE LE COMPTE AVANT DE PARTIR (le tour, un raccourci, « Ne plus afficher »), et la fenêtre ne
 * revient plus. La croix, Échap ou un clic à côté NE MARQUENT RIEN : décision de Julien, elle revient à la connexion
 * suivante tant que la personne n'a pas choisi. Un marquage qui échoue n'empêche pas le geste : la fenêtre reviendra,
 * ce qui vaut mieux qu'un raccourci qui ne mène nulle part.
 */
export function AccueilBienvenue({ tenantId, admin, onFermer }: { tenantId: string; admin: boolean; onFermer: () => void }) {
  const t = useT();
  const router = useRouter();
  // Le numéro n'est lisible que par un administrateur (`/account-status`) ; tant qu'il n'est pas su, on ne le propose pas.
  const [aNumero, setANumero] = useState<boolean | null>(null);
  useEffect(() => {
    if (!admin) return;
    let vivant = true;
    getAccountStatus(tenantId).then((s) => { if (vivant) setANumero(s.hasNumber); }).catch(() => { /* reste inconnu */ });
    return () => { vivant = false; };
  }, [tenantId, admin]);

  const raccourcis = raccourcisAccueil(admin, aNumero);
  const choisir = async (suite: () => void) => {
    await marquerAccueil(tenantId).catch(() => { /* la fenêtre reviendra à la prochaine connexion */ });
    onFermer();
    suite();
  };

  return (
    <Modale titre={t('Bienvenue dans votre console', 'Welcome to your console')} taille="petite" testId="accueil-bienvenue" onClose={onFermer}>
      <p className="text-sm text-ink-700">
        {t(
          'On fait un tour rapide de la console, ou vous voulez tout de suite faire quelque chose ?',
          'Shall we take a quick tour of the console, or would you rather get straight to something?',
        )}
      </p>
      <Bouton className="mt-4 w-full" data-testid="accueil-tour"
        onClick={() => { void choisir(() => window.dispatchEvent(new Event(VISITE_EVENT))); }}>
        {t('Faire le tour', 'Take the tour')}
      </Bouton>
      {raccourcis.length > 0 && (
        <>
          <p className="mt-5 text-xs font-medium uppercase tracking-wide text-ink-500">{t('Je veux tout de suite…', 'I want to…')}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {raccourcis.map((r) => (
              <Bouton key={r.cle} variante="secondaire" data-testid={`accueil-raccourci-${r.cle}`}
                onClick={() => { void choisir(() => router.push(r.href)); }}>
                {t(r.fr, r.en)}
              </Bouton>
            ))}
          </div>
        </>
      )}
      <button type="button" data-testid="accueil-plus-afficher" className="mt-5 text-xs text-ink-500 hover:underline"
        onClick={() => { void choisir(() => {}); }}>
        {t('Ne plus afficher', 'Don’t show again')}
      </button>
    </Modale>
  );
}
