'use client';

import { Fragment, type ReactNode } from 'react';
import { Icone } from '@/components/Icone';
import { useT } from '@/lib/i18n';

/**
 * LE TUNNEL DE LA LIGNE DE CRÉDIT, VISIBLE DU DÉBUT À LA FIN (essai 263, Julien, 2026-11-16 : « dans l'idéal tu vois tout
 * le chemin : étape 1 option payée, étape 2 numéro API onboardé chez Meta, étape 3 crédit chargé ; le côté tunnel in app,
 * pour ne pas perdre le client »). Les étapes l'une sous l'autre, une flèche de l'une à l'autre (Julien, même jour), et
 * le geste de chaque étape DANS l'étape : plus de bandeau de confirmation à côté, qui redisait l'étape 1.
 */
export interface EtatFilLigne {
  /** Une Entreprise : sa ligne comprise dans le contrat, à la place de l'option payée. */
  entreprise: boolean;
  /** Le numéro connecté chez Meta. */
  numeroConnecte: boolean;
  /** Le solde en euros, une fois lu ; `null` : pas encore lu (ou illisible) ; `'illimite'` : une Entreprise. */
  solde: number | null | 'illimite';
  /** Le solde formaté pour l'affichage. */
  soldeTexte: string;
}

type Statut = 'fait' | 'en_cours' | 'a_venir';

export function FilLigne({ etat, detailNumero, contenuNumero, contenuCredit }: {
  etat: EtatFilLigne;
  /** Ce que l'étape du numéro dit de plus (qui paie, le délai de la ligne). */
  detailNumero?: ReactNode;
  /** Le geste de l'étape du numéro (« quel numéro ? ») et celui de la recharge, chacun sous son étape. */
  contenuNumero?: ReactNode;
  contenuCredit?: ReactNode;
}) {
  const t = useT();
  const charge = etat.solde === 'illimite' || (typeof etat.solde === 'number' && etat.solde > 0);
  const etapes: Array<{ cle: string; titre: string; detail: ReactNode; contenu: ReactNode; statut: Statut }> = [
    {
      cle: 'option',
      titre: etat.entreprise ? t('Ligne de crédit comprise dans votre contrat', 'Credit line included in your contract') : t('Option ligne de crédit payée', 'Credit line option paid'),
      detail: null,
      contenu: null,
      statut: 'fait',
    },
    {
      cle: 'numero',
      titre: t('Numéro API connecté chez Meta', 'API number connected at Meta'),
      detail: detailNumero ?? null,
      contenu: contenuNumero ?? null,
      statut: etat.numeroConnecte ? 'fait' : 'en_cours',
    },
    {
      cle: 'credit',
      titre: etat.solde === 'illimite'
        ? t('Ligne de crédit illimitée', 'Unlimited credit line')
        : charge ? t(`Ligne de crédit chargée : ${etat.soldeTexte}`, `Credit line topped up: ${etat.soldeTexte}`) : t('Ligne de crédit rechargée', 'Credit line topped up'),
      detail: charge || !etat.numeroConnecte ? null : t('Avant vos premiers modèles : à zéro, plus aucun message ne part, réponses comprises.', 'Before your first templates: at zero, no message goes out, replies included.'),
      contenu: contenuCredit ?? null,
      statut: charge && etat.numeroConnecte ? 'fait' : etat.numeroConnecte ? 'en_cours' : 'a_venir',
    },
  ];
  return (
    <ol data-testid="fil-ligne" className="mt-4">
      {etapes.map((e, i) => (
        <Fragment key={e.cle}>
          {i > 0 && (
            <li aria-hidden className="flex justify-center py-1.5 text-ink-500">
              <Icone nom="deplier" taille="grande" />
            </li>
          )}
          <li
            data-testid={`fil-ligne-${e.cle}`}
            data-statut={e.statut}
            className={`rounded-carte p-4 ${e.statut === 'fait' ? 'border border-succes-200 bg-succes-50' : e.statut === 'en_cours' ? 'border-2 border-brand-500 bg-white' : 'border border-ink-200 bg-white'}`}
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${e.statut === 'fait' ? 'bg-succes-600 text-white' : e.statut === 'en_cours' ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-500'}`}
              >
                {e.statut === 'fait' ? <Icone nom="valide" /> : i + 1}
              </span>
              <div className="min-w-0">
                <div className={`text-xs font-semibold uppercase tracking-wide ${e.statut === 'fait' ? 'text-succes-800' : e.statut === 'en_cours' ? 'text-brand-600' : 'text-ink-500'}`}>
                  {t(`Étape ${i + 1}`, `Step ${i + 1}`)}
                </div>
                <div className={`text-sm font-semibold ${e.statut === 'a_venir' ? 'text-ink-500' : 'text-ink-900'}`}>{e.titre}</div>
              </div>
            </div>
            {e.detail && <div className="mt-2 pl-10 text-sm text-ink-700">{e.detail}</div>}
            {e.contenu && <div className="mt-3 pl-10">{e.contenu}</div>}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
