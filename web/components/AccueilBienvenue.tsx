'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modale } from '@/components/Modale';
import { Icone } from '@/components/Icone';
import { classesBouton } from '@/components/Bouton';
import { useLocale, useT } from '@/lib/i18n';
import { getDemarrage, marquerAccueil, type EtatDemarrage } from '@/lib/api';
import { VISITE_EVENT } from '@/lib/accueil-console';
import { progression } from '@/lib/bien-demarrer';
import { lancerParcours } from '@/components/GuideCompagnon';

/**
 * LA FENÊTRE DE BIENVENUE (plan 2026-11-24-guide-demarrage, lot 2, maquette validée par Julien le 2026-11-24) : un
 * bandeau, puis la checklist « Bien démarrer » cochée d'après l'état réel de l'espace (`GET /demarrage`), puis la visite.
 * Montée par la coquille quand `/me` rend `accueilAFaire`, ou rouverte par `BIENVENUE_EVENT` (carte de l'Accueil, aide).
 *
 * 🔴 CHAQUE CHOIX MARQUE LE COMPTE AVANT DE PARTIR (un geste, le tour, « Plus tard »), et la fenêtre ne s'ouvre plus
 * d'elle-même : la carte de l'Accueil prend le relais. La croix, Échap ou un clic à côté NE MARQUENT RIEN (décision de
 * Julien, 2026-11-19). Un marquage qui échoue n'empêche pas le geste.
 * La checklist n'est montrée qu'à un administrateur : ses gestes mènent à des écrans d'administrateur, et la route est
 * réservée aux admins. Un autre membre garde le bandeau et la visite.
 */
/**
 * LE FILM DE BIENVENUE (lot 5) : la vraie console, six étapes, sous-titré et MUET (l'atelier `~/engageme-motion`,
 * `engageme-aide`, clé `bienvenue`). Servi par la console elle-même (`web/public/films/`) : la CSP n'ouvre `media-src`
 * qu'à `'self'`. Un film remplacé sous le même nom prend un `?v=` incrémenté, sinon un navigateur garde l'ancien.
 */
const FILM = {
  fr: { src: '/films/bienvenue.mp4?v=1', affiche: '/films/bienvenue.webp?v=1' },
  en: { src: '/films/bienvenue.en.mp4?v=1', affiche: '/films/bienvenue.en.webp?v=1' },
} as const;

export function AccueilBienvenue({ tenantId, admin, fonctionOuverte, onFermer }: {
  tenantId: string;
  admin: boolean;
  fonctionOuverte: (f: 'scenarios') => boolean;
  onFermer: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const film = FILM[locale === 'en' ? 'en' : 'fr'];
  const [enLecture, setEnLecture] = useState(false);
  const router = useRouter();
  // `undefined` : pas encore lu (rien n'est montré, pour ne pas cocher sous les yeux) ; `null` : état inconnu.
  const [etat, setEtat] = useState<EtatDemarrage | null | undefined>(admin ? undefined : null);
  useEffect(() => {
    if (!admin) return;
    let vivant = true;
    void getDemarrage(tenantId).then((e) => { if (vivant) setEtat(e); });
    return () => { vivant = false; };
  }, [tenantId, admin]);

  const choisir = async (suite: () => void) => {
    await marquerAccueil(tenantId).catch(() => { /* la fenêtre reviendra à la prochaine connexion */ });
    onFermer();
    suite();
  };
  const p = progression(etat ?? null, fonctionOuverte);
  const largeur = `${Math.round((p.faites / p.total) * 100)}%`;

  return (
    <Modale titre={t('Bienvenue dans votre console', 'Welcome to your console')} testId="accueil-bienvenue" sansEntete onClose={onFermer}>
      {enLecture ? (
        // Le film à la place du bandeau, le temps de le regarder : la fenêtre ne s'agrandit pas.
        <video data-testid="accueil-film" src={film.src} poster={film.affiche} controls autoPlay playsInline preload="none"
          className="aspect-video w-full bg-navy-800" aria-label={t('Film de bienvenue', 'Welcome film')} />
      ) : (
      <div className="relative bg-navy-800 px-6 pb-6 pt-7 text-white">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-200">{t('Messaging Me', 'Messaging Me')}</p>
        <h2 className="mt-2 text-2xl font-bold leading-tight">{t('Bienvenue dans votre console.', 'Welcome to your console.')}</h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-navy-100">
          {admin
            ? t('Cinq étapes pour que WhatsApp travaille pour vous. Chaque écran vous dit quoi faire.', 'Five steps to put WhatsApp to work for you. Each screen tells you what to do.')
            : t('Un tour rapide de la console, et vous êtes prêt à répondre à vos clients.', 'A quick tour of the console, and you are ready to answer your customers.')}
        </p>
        {/* Dans le flux sur un téléphone (il recouvrirait la fin du texte), à droite du bandeau au-delà. */}
        <button type="button" data-testid="accueil-film-lire" onClick={() => setEnLecture(true)}
          className="mt-4 flex items-center gap-2 rounded-full bg-white py-2 pl-2 pr-4 text-sm font-semibold text-navy-800 shadow-mm-md hover:bg-brand-50 sm:absolute sm:bottom-6 sm:right-6 sm:mt-0">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-white"><Icone nom="ecouter" taille="petite" /></span>
          {t('Le film, 1 min', 'The film, 1 min')}
        </button>
      </div>
      )}

      {admin && etat !== undefined && (
        <div className="px-6 pt-5" data-testid="accueil-checklist">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-ink-900">{t('Bien démarrer', 'Getting started')}</span>
            <span className="text-xs text-ink-500" data-testid="accueil-progression">
              {t(`${p.faites} étape${p.faites > 1 ? 's' : ''} sur ${p.total}`, `${p.faites} of ${p.total} steps`)}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
            <div className="h-full rounded-full bg-brand-500 transition-all duration-300" style={{ width: largeur }} />
          </div>
          <ol className="mt-3 space-y-1">
            {p.etapes.map((e, i) => {
              const prochaine = e.cle === p.prochaine;
              return (
                <li key={e.cle} data-testid={`accueil-etape-${e.cle}`} data-faite={e.faite ? 'oui' : 'non'}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-controle px-3 py-2.5 ${prochaine ? 'bg-brand-50' : ''}`}>
                  {e.faite ? (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-succes-50 text-succes-600">
                      <Icone nom="valide" />
                    </span>
                  ) : (
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold ${prochaine ? 'border-brand-500 text-brand-600' : 'border-ink-200 text-ink-500'}`}>
                      {i + 1}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold ${e.faite ? 'text-ink-500 line-through' : 'text-ink-900'}`}>{t(e.titre.fr, e.titre.en)}</p>
                    <p className="text-xs text-ink-500">{t(e.detail.fr, e.detail.en)}</p>
                  </div>
                  {!e.faite && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ink-500">{t(`${e.minutes} min`, `${e.minutes} min`)}</span>
                      {e.gestes.map((g) => (
                        <button key={g.cle} type="button" data-testid={`accueil-geste-${g.cle}`}
                          className={classesBouton(prochaine ? 'principal' : 'secondaire', 'petite')}
                          onClick={() => { void choisir(() => { if (g.parcours) lancerParcours(g.parcours); router.push(g.href); }); }}>
                          {t(g.fr, g.en)}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {p.complete && (
            <p className="mt-2 text-sm text-succes-700" data-testid="accueil-complet">
              {t('Tout est en place. Votre WhatsApp travaille pour vous.', 'Everything is set up. Your WhatsApp is working for you.')}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-6 py-4">
        <button type="button" data-testid="accueil-tour" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-600 hover:underline"
          onClick={() => { void choisir(() => window.dispatchEvent(new Event(VISITE_EVENT))); }}>
          <Icone nom="localiser" />
          {t('Faire le tour de la console', 'Take the console tour')}
        </button>
        <button type="button" data-testid="accueil-plus-tard" className="text-xs text-ink-500 hover:underline"
          onClick={() => { void choisir(() => {}); }}>
          {admin ? t('Plus tard, depuis l’Accueil', 'Later, from Home') : t('Plus tard', 'Later')}
        </button>
      </div>
    </Modale>
  );
}
