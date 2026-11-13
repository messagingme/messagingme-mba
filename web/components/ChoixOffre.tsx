'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bouton, classesBouton } from '@/components/Bouton';
import { Icone } from '@/components/Icone';
import { useT } from '@/lib/i18n';
import { payerPro } from '@/lib/api/offre';
import { ApiError, erreurDeChargement } from '@/lib/http';
import type { VueOffre } from '@/lib/offre';
import { CARTES_OFFRE, QUESTION_OFFRE, type FormuleChoisie } from '@/lib/questions-numero';

/**
 * LA FORMULE, AU PREMIER ÉCRAN D'UN ESPACE NEUF (lot 3b, Julien, 2026-11-09). Les quatre cartes de la vitrine, à ses
 * mots (`CARTES_OFFRE`), chacune avec le geste de la console :
 * - Free : la suite d'aujourd'hui, « Qui paie vos messages à Meta ? » (`surFree`) ;
 * - Pro : la page de Stripe, mensuelle, avec l'essai quand l'espace y a droit (décision de Julien du 2026-11-10 :
 *   « Stripe direct, puis le numéro ») ; le retour de Stripe ramène au numéro (`suiteApresPro`). Un Pro qui n'est pas en
 *   vente (prix non posé, 404 ou 503) se demande au Support, comme sur la page de l'offre ;
 * - Business et Entreprise : le formulaire de contact de la console, son sujet prérempli.
 */
export function ChoixOffre({ tenantId, vue, surFree }: { tenantId: string; vue: VueOffre; surFree: () => void }) {
  const t = useT();
  const [aide, setAide] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [proIndisponible, setProIndisponible] = useState(vue.prixPro === null);
  const essai = vue.essai?.possible === true;

  async function essayerPro(): Promise<void> {
    setEnCours(true);
    setErreur(null);
    try {
      window.location.assign((await payerPro(tenantId, 'mois')).url);
    } catch (err) {
      setEnCours(false);
      if (err instanceof ApiError && (err.status === 404 || err.status === 503)) { setProIndisponible(true); return; }
      setErreur(erreurDeChargement(err, t));
    }
  }

  const geste = (offre: FormuleChoisie) => {
    if (offre === 'free') {
      return <Bouton type="button" variante="secondaire" className="w-full" onClick={surFree} data-testid="offre-choisir-free">{t('Continuer avec Free', 'Continue with Free')}</Bouton>;
    }
    if (offre === 'pro') {
      return proIndisponible ? (
        <Link href="/support?sujet=pro" className={classesBouton('principal', 'normale', 'w-full')} data-testid="offre-choisir-pro-support">{t('Passer en Pro', 'Switch to Pro')}</Link>
      ) : (
        <Bouton type="button" className="w-full" enCours={enCours} disabled={enCours} onClick={() => { void essayerPro(); }} data-testid="offre-choisir-pro">
          {essai ? t('Essayer Pro 14 jours', 'Try Pro for 14 days') : t('Passer en Pro', 'Switch to Pro')}
        </Bouton>
      );
    }
    return (
      <Link href={`/support?sujet=${offre}`} className={classesBouton('secondaire', 'normale', 'w-full')} data-testid={`offre-choisir-${offre}`}>
        {t('Nous contacter', 'Contact us')}
      </Link>
    );
  };

  return (
    <section data-testid="choix-offre" className="mt-6 rounded-carte border border-ink-200 bg-white p-5">
      <h2 className="text-base font-semibold text-ink-900">{t(QUESTION_OFFRE.texte.fr, QUESTION_OFFRE.texte.en)}</h2>
      <p className="mt-1 text-xs text-ink-500">{t(QUESTION_OFFRE.precision.fr, QUESTION_OFFRE.precision.en)}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {CARTES_OFFRE.map((c) => (
          <div key={c.offre} className="grid grid-rows-[1fr_auto] gap-3">
            <div data-testid={`carte-offre-${c.offre}`} className={`rounded-carte border p-4 ${c.offre === 'pro' ? 'border-ink-900' : 'border-ink-200'}`}>
              {/* L'essai, seulement à un espace qui y a droit (jaune 2 de la relecture). */}
              {c.badge && (c.offre !== 'pro' || essai) && (
                <p data-testid="carte-offre-essai" className="mb-2 inline-block rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                  {t(c.badge.fr, c.badge.en)}
                </p>
              )}
              <div className="text-sm font-semibold text-ink-900">{t(c.titre.fr, c.titre.en)}</div>
              <p className="mt-1 text-2xl font-bold text-ink-900">{t(c.prix.fr, c.prix.en)}</p>
              <p className="text-xs text-ink-500">{t(c.unite.fr, c.unite.en)}</p>
              {c.note && <p className="mt-3 border-t border-ink-100 pt-2 text-xs text-ink-700">{t(c.note.fr, c.note.en)}</p>}
              <ul className="mt-2 space-y-1 text-sm text-ink-700">
                {c.plus.map((p) => (
                  <li key={p.fr} className="flex gap-2"><Icone nom="valide" taille="ligne" className="mt-0.5 shrink-0 text-succes" titre={t('Pour', 'For')} />{t(p.fr, p.en)}</li>
                ))}
                {c.moins.map((m) => (
                  <li key={m.fr} className="flex gap-2"><Icone nom="refuse" taille="ligne" className="mt-0.5 shrink-0 text-ink-500" titre={t('Contre', 'Against')} />{t(m.fr, m.en)}</li>
                ))}
              </ul>
            </div>
            <div>{geste(c.offre)}</div>
          </div>
        ))}
      </div>
      {erreur && <p className="mt-3 rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700">{erreur}</p>}
      <button type="button" aria-expanded={aide} onClick={() => setAide((a) => !a)} className="mt-4 text-sm font-semibold text-ink-900 underline" data-testid="offre-nsp">
        {t(QUESTION_OFFRE.nsp.fr, QUESTION_OFFRE.nsp.en)}
      </button>
      {aide && <p data-testid="offre-aide" className="mt-2 text-sm text-ink-700">{t(QUESTION_OFFRE.aide.fr, QUESTION_OFFRE.aide.en)}</p>}
    </section>
  );
}
