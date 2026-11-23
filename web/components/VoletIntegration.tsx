'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Icone } from '@/components/Icone';

/**
 * UN VOLET DE TOOLS > INTÉGRATIONS (2026-11-20, demande de Julien : « un peu le bordel quand tu l'ouvres ») : le logo de
 * l'outil, son nom et ce qu'il fait, replié par défaut ; la carte de réglage de l'outil vit dedans.
 *
 * ⚠️ UNE ANCRE OUVRE SON VOLET : `#integration-<cle>` (l'Accueil, les guides et des liens déjà partis la nomment) déplie le
 * volet et le fait défiler jusqu'à lui. Les cartes gardent leur propre `id` à l'intérieur : le volet porte `volet-<cle>`
 * pour ne pas le dupliquer.
 *
 * ⚠️ LA CARTE INTÉRIEURE PERD SON CADRE ET SON TITRE (le volet les porte déjà) par les sélecteurs de la classe ci-dessous,
 * sans retoucher chaque carte : `[&>section]` vise la `<section>` racine de chaque Reglage*, dont le `<h3>` est le titre.
 * 🔴 SAUF le titre d'une FENÊTRE ouverte depuis la carte (`Modale`, rendue dans la section, `role="dialog"`) : la règle
 * le masquait aussi, et l'import des clients puis le rattrapage des commandes Shopify s'ouvraient sans titre (relevé à la
 * capture d'aide du 2026-11-23).
 */
export function VoletIntegration({ cle, logo, logoLarge = false, nom, resume, children }: {
  cle: string;
  /** Chemin d'un fichier de `web/public/logos/`, ou plusieurs pictogrammes côte à côte (Make, n8n, Zapier). */
  logo: string | readonly string[];
  /** Un logo-mot (Shopify, Batch) plutôt qu'un pictogramme : affiché en largeur. Shopify exige 80 px au moins. */
  logoLarge?: boolean;
  nom: string;
  resume: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const ouvrirSiVise = () => {
      if (window.location.hash !== `#integration-${cle}` || !ref.current) return;
      ref.current.open = true;
      ref.current.scrollIntoView();
    };
    ouvrirSiVise();
    window.addEventListener('hashchange', ouvrirSiVise);
    return () => window.removeEventListener('hashchange', ouvrirSiVise);
  }, [cle]);

  return (
    <details ref={ref} id={`volet-${cle}`} data-testid={`volet-${cle}`} className="group/volet rounded-carte border border-ink-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-4 p-5 [&::-webkit-details-marker]:hidden">
        <span className="flex h-10 w-24 shrink-0 items-center gap-2">
          {(typeof logo === 'string' ? [logo] : logo).map((src) => (
            // eslint-disable-next-line @next/next/no-img-element -- un logo SVG de quelques Ko, sans optimisation à attendre
            <img key={src} src={src} alt="" className={logoLarge ? 'h-auto w-20' : typeof logo === 'string' ? 'h-8 w-8' : 'h-6 w-6'} />
          ))}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink-900">{nom}</span>
          <span className="block text-sm text-ink-500">{resume}</span>
        </span>
        <Icone nom="deplier" className="text-ink-400 transition-transform duration-150 group-open/volet:rotate-180" />
      </summary>
      <div className="border-t border-ink-200 p-5 [&>section]:border-0 [&>section]:p-0 [&>section_h3:not([role=dialog]_h3)]:hidden">
        {children}
      </div>
    </details>
  );
}
