'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bouton } from '@/components/Bouton';
import { Icone } from '@/components/Icone';
import { useT } from '@/lib/i18n';
import { CLE_STOCKAGE, GUIDE_EVENT, PARCOURS, avancer, lireEtat, surLaPage, type CleParcours, type EtatGuide } from '@/lib/guide/parcours';

/**
 * LA CARTE QUI ACCOMPAGNE (plan 2026-11-24-guide-demarrage, lot 3, maquette validée par Julien le 2026-11-24) : en haut
 * à droite, repliable en pastille, elle dit l'étape en cours, cadre l'élément à toucher et passe seule à la suivante
 * quand le geste est fait (`lib/guide/parcours.ts`). Montée par la coquille ; lancée par `GUIDE_EVENT`.
 *
 * 🔴 AUCUN VOILE : la console reste lisible et cliquable dessous (`tests/web-formes.test.ts`), comme la visite. Le cadre
 * ne capte aucun clic (`pointer-events-none`).
 * L'état vit dans l'onglet (`sessionStorage`, une commodité : illisible ou bloqué, le guide repart de zéro ou ne
 * s'affiche pas, jamais d'erreur). Il survit à la navigation, pas à la fermeture de l'onglet.
 */
function lire(): EtatGuide | null {
  try { return lireEtat(window.sessionStorage.getItem(CLE_STOCKAGE)); } catch { return null; }
}
function ecrire(e: EtatGuide | null): void {
  try {
    if (e) window.sessionStorage.setItem(CLE_STOCKAGE, JSON.stringify(e));
    else window.sessionStorage.removeItem(CLE_STOCKAGE);
  } catch { /* mémoire indisponible : le guide vit le temps de la page */ }
}
const selecteur = (testid: string) => `[data-testid="${testid}"]`;
function affiche(testid: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(selecteur(testid));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

/** Lance un parcours depuis n'importe quel écran (la checklist « Bien démarrer »). */
export function lancerParcours(cle: CleParcours): void {
  ecrire({ parcours: cle, etape: 0, replie: false, fini: false });
  window.dispatchEvent(new CustomEvent(GUIDE_EVENT, { detail: cle }));
}

export function GuideCompagnon() {
  const t = useT();
  // Le chemin relance la relecture à chaque navigation ; l'adresse complète (requête comprise) se lit dans
  // `window.location`, sans `useSearchParams`, qui exigerait une frontière Suspense dans la coquille.
  const chemin = usePathname();
  const [adresse, setAdresse] = useState('');
  const [etat, setEtat] = useState<EtatGuide | null>(null);
  const [boite, setBoite] = useState<DOMRect | null>(null);
  /**
   * 🔴 LA CARTE NE COUVRE JAMAIS SA CIBLE (vu par l'e2e du lot 4 : elle masquait « Créer un scénario », le bouton même
   * qu'elle demandait de toucher). Sa place est en haut à droite ; quand la cible tombe dessous, elle descend en bas à
   * droite, au-dessus du bouton d'aide.
   */
  const carte = useRef<HTMLElement>(null);
  const [enBas, setEnBas] = useState(false);

  const poser = useCallback((e: EtatGuide | null) => { ecrire(e); setEtat(e); }, []);

  // Au montage (une page neuve) et à chaque lancement.
  useEffect(() => {
    setEtat(lire());
    const lancer = () => setEtat(lire());
    window.addEventListener(GUIDE_EVENT, lancer);
    return () => window.removeEventListener(GUIDE_EVENT, lancer);
  }, []);

  const parcours = etat ? PARCOURS[etat.parcours] : null;
  const etape = parcours && etat && !etat.fini ? parcours.etapes[etat.etape] : undefined;
  const ici = etape ? surLaPage(etape, adresse) : false;

  // Ce qui fait avancer sans clic (une page atteinte, un élément apparu), et la mesure du cadre : relus régulièrement,
  // parce que l'écran change sans que la coquille le sache (une réponse de l'assistant, un panneau qui s'ouvre).
  useEffect(() => {
    if (!etat || etat.fini) return;
    const tic = () => {
      const lue = `${window.location.pathname}${window.location.search}`;
      setAdresse(lue);
      const suite = avancer(etat, lue, (id) => affiche(id) !== null);
      if (suite !== etat) { poser(suite); return; }
      const el = etape && surLaPage(etape, lue) && !etat.replie ? affiche(etape.cible) : null;
      const r = el ? el.getBoundingClientRect() : null;
      setBoite((b) => (r === null ? null : b && b.top === r.top && b.left === r.left && b.width === r.width && b.height === r.height ? b : r));
      const largeur = carte.current?.offsetWidth ?? 336;
      const hauteur = carte.current?.offsetHeight ?? 320;
      // La place du haut : `right-5` (20 px), `top-20` (80 px). La cible est élargie de 160 px à droite : son voisin
      // (le bouton à côté d'un champ, relecture du lot 4) ne doit pas finir sous la carte non plus.
      setEnBas(r !== null && r.right + 160 > window.innerWidth - 20 - largeur && r.top < 80 + hauteur && r.bottom > 80);
    };
    tic();
    const minuteur = window.setInterval(tic, 400);
    window.addEventListener('scroll', tic, true);
    window.addEventListener('resize', tic);
    return () => { window.clearInterval(minuteur); window.removeEventListener('scroll', tic, true); window.removeEventListener('resize', tic); };
  }, [etat, etape, chemin, poser]);

  // Une étape `clic` est faite quand la personne touche la cible : écouté en capture, avant que le geste ne navigue.
  useEffect(() => {
    if (!etat || !etape || etape.passage.type !== 'clic') return;
    const auClic = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(selecteur(etape.cible))) return;
      const p = PARCOURS[etat.parcours];
      poser(etat.etape >= p.etapes.length - 1 ? { ...etat, fini: true } : { ...etat, etape: etat.etape + 1 });
    };
    document.addEventListener('click', auClic, true);
    return () => document.removeEventListener('click', auClic, true);
  }, [etat, etape, poser]);

  if (!etat || !parcours) return null;
  const quitter = () => { poser(null); setBoite(null); };

  if (etat.replie) {
    return (
      <button type="button" data-testid="guide-pastille" onClick={() => poser({ ...etat, replie: false })}
        className="fixed right-5 top-20 z-40 flex items-center gap-2 rounded-full bg-navy-800 py-2 pl-2 pr-4 text-sm font-semibold text-white shadow-mm-md hover:bg-navy-700">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 text-xs">
          {etat.fini ? <Icone nom="valide" taille="petite" /> : `${etat.etape + 1}/${parcours.etapes.length}`}
        </span>
        {t(parcours.nom.fr, parcours.nom.en)}
      </button>
    );
  }

  const derniere = etat.etape >= parcours.etapes.length - 1;
  return (
    <>
      {boite && etape && (
        <div aria-hidden="true" data-testid="guide-cadre"
          className="pointer-events-none fixed z-[45] animate-pulse rounded-controle ring-2 ring-brand-500 ring-offset-2"
          style={{ top: boite.top, left: boite.left, width: boite.width, height: boite.height }} />
      )}
      <aside ref={carte} aria-live="polite" aria-label={t('Guide', 'Guide')} data-testid="guide-carte" data-place={enBas ? 'bas' : 'haut'}
        className={`fixed right-5 ${enBas ? 'bottom-20' : 'top-20'} z-40 w-[min(21rem,calc(100vw-2.5rem))] overflow-hidden rounded-carte border border-ink-200 bg-white shadow-mm-lg`}>
        <div className="flex items-center gap-3 bg-navy-800 px-4 py-3 text-white">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500"><Icone nom="localiser" taille="petite" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t(parcours.nom.fr, parcours.nom.en)}</p>
            <p className="text-xs text-navy-200" data-testid="guide-compteur">
              {etat.fini ? t('Terminé', 'Done') : t(`Étape ${etat.etape + 1} sur ${parcours.etapes.length}`, `Step ${etat.etape + 1} of ${parcours.etapes.length}`)}
            </p>
          </div>
          <button type="button" data-testid="guide-replier" aria-label={t('Replier le guide', 'Collapse the guide')}
            onClick={() => poser({ ...etat, replie: true })} className="rounded-controle p-1 text-navy-200 hover:bg-white/10 hover:text-white">
            <Icone nom="stable" />
          </button>
          <button type="button" data-testid="guide-quitter" aria-label={t('Quitter le guide', 'Exit the guide')}
            onClick={quitter} className="rounded-controle p-1 text-navy-200 hover:bg-white/10 hover:text-white">
            <Icone nom="fermer" />
          </button>
        </div>
        <div className="flex gap-1 px-4 pt-3" aria-hidden="true">
          {parcours.etapes.map((_, i) => (
            <span key={i} className={`h-1 flex-1 rounded-full ${etat.fini || i <= etat.etape ? 'bg-brand-500' : 'bg-ink-100'}`} />
          ))}
        </div>
        <div className="px-4 pb-4 pt-3">
          {etat.fini ? (
            <>
              <p className="text-sm font-semibold text-ink-900" data-testid="guide-titre">{t('C’est fait !', 'Done!')}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-700">{t(parcours.fin.fr, parcours.fin.en)}</p>
              <div className="mt-3 flex justify-end">
                <Bouton taille="petite" data-testid="guide-terminer" onClick={quitter}>{t('Fermer', 'Close')}</Bouton>
              </div>
            </>
          ) : etape && (
            <>
              <p className="text-sm font-semibold text-ink-900" data-testid="guide-titre">{t(etape.titre.fr, etape.titre.en)}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-700">{t(etape.texte.fr, etape.texte.en)}</p>
              <div className="mt-3 flex items-center gap-2">
                {etat.etape > 0 && (
                  <button type="button" data-testid="guide-precedent" className="mr-auto text-xs text-ink-500 hover:underline"
                    onClick={() => poser({ ...etat, etape: etat.etape - 1 })}>
                    {t('Précédent', 'Back')}
                  </button>
                )}
                {!ici ? (
                  <Link href={etape.page.href} data-testid="guide-y-aller" className="ml-auto text-sm font-semibold text-brand-600 hover:underline">
                    {t('Y aller', 'Go there')}
                  </Link>
                ) : (
                  <Bouton taille="petite" className="ml-auto" data-testid="guide-suivant"
                    onClick={() => poser(derniere ? { ...etat, fini: true } : { ...etat, etape: etat.etape + 1 })}>
                    {derniere ? t('Terminer', 'Finish') : t('Suivant', 'Next')}
                  </Bouton>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
