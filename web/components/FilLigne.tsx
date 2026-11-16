'use client';

import { Icone } from '@/components/Icone';
import { useT } from '@/lib/i18n';

/**
 * LE TUNNEL DE LA LIGNE DE CRÉDIT, VISIBLE DU DÉBUT À LA FIN (essai 263, Julien, 2026-11-16 : « dans l'idéal tu vois tout
 * le chemin : étape 1 option payée, étape 2 numéro API onboardé chez Meta, étape 3 crédit chargé ; le côté tunnel in app,
 * pour ne pas perdre le client »). Trois étapes, chacune faite (coche), en cours (mise en avant) ou à venir.
 */
export interface EtatFilLigne {
  /** L'option payée ; une Entreprise, sa ligne comprise dans le contrat. */
  entreprise: boolean;
  /** Le numéro connecté chez Meta. */
  numeroConnecte: boolean;
  /** Le solde en euros, une fois lu ; `null` : pas encore lu (ou illisible) ; `'illimite'` : une Entreprise. */
  solde: number | null | 'illimite';
  /** Le solde formaté pour l'affichage. */
  soldeTexte: string;
}

type Statut = 'fait' | 'en_cours' | 'a_venir';

export function FilLigne({ etat }: { etat: EtatFilLigne }) {
  const t = useT();
  const charge = etat.solde === 'illimite' || (typeof etat.solde === 'number' && etat.solde > 0);
  const etapes: Array<{ cle: string; titre: string; detail: string | null; statut: Statut }> = [
    {
      cle: 'option',
      titre: etat.entreprise ? t('Ligne de crédit comprise dans votre contrat', 'Credit line included in your contract') : t('Option ligne de crédit payée', 'Credit line option paid'),
      detail: null,
      statut: 'fait',
    },
    {
      cle: 'numero',
      titre: t('Numéro API connecté chez Meta', 'API number connected at Meta'),
      detail: etat.numeroConnecte ? null : t('Votre numéro, ou un numéro de chez nous', 'Your number, or one of ours'),
      statut: etat.numeroConnecte ? 'fait' : 'en_cours',
    },
    {
      cle: 'credit',
      titre: etat.solde === 'illimite'
        ? t('Ligne de crédit illimitée', 'Unlimited credit line')
        : charge ? t(`Ligne de crédit chargée : ${etat.soldeTexte}`, `Credit line topped up: ${etat.soldeTexte}`) : t('Ligne de crédit rechargée', 'Credit line topped up'),
      detail: charge || !etat.numeroConnecte ? null : t('Avant vos premiers modèles', 'Before your first templates'),
      statut: charge && etat.numeroConnecte ? 'fait' : etat.numeroConnecte ? 'en_cours' : 'a_venir',
    },
  ];
  return (
    <ol data-testid="fil-ligne" className="mt-4 grid gap-2 sm:grid-cols-3">
      {etapes.map((e, i) => (
        <li
          key={e.cle}
          data-testid={`fil-ligne-${e.cle}`}
          data-statut={e.statut}
          className={`rounded-carte border p-3 ${e.statut === 'fait' ? 'border-succes-200 bg-succes-50' : e.statut === 'en_cours' ? 'border-2 border-brand-500 bg-brand-50' : 'border-ink-200 bg-white'}`}
        >
          <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${e.statut === 'fait' ? 'text-succes-800' : e.statut === 'en_cours' ? 'text-brand-600' : 'text-ink-500'}`}>
            {e.statut === 'fait' ? <Icone nom="valide" /> : null}
            {t(`Étape ${i + 1}`, `Step ${i + 1}`)}
          </div>
          <div className={`mt-1 text-sm font-semibold ${e.statut === 'a_venir' ? 'text-ink-500' : 'text-ink-900'}`}>{e.titre}</div>
          {e.detail && <div className="mt-0.5 text-xs text-ink-500">{e.detail}</div>}
        </li>
      ))}
    </ol>
  );
}
