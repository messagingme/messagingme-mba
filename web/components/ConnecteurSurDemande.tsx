'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n';
import { useFermeture } from '@/lib/use-offre';
import { classesBouton } from '@/components/Bouton';
import { HorsOffre } from '@/components/HorsOffre';

/**
 * UN CONNECTEUR CRM DE TOOLS > INTÉGRATIONS, SELON L'OFFRE (2026-11-20, demande de Julien). Les connecteurs CRM (`crm`)
 * ne sont ouverts qu'à l'offre Entreprise, côté serveur comme ici :
 * - offre qui ne l'ouvre pas (Free, Pro, Business) : la ligne « Inclus dans l'offre Entreprise » (`HorsOffre`) ;
 * - Entreprise, sans `children` : un bouton « Nous contacter », vers le Support avec l'objet prérempli (`sujet`). Ces
 *   connecteurs se branchent avec nous (Salesforce tant que son app n'est pas sur l'instance, Dynamics 365) ;
 * - Entreprise, avec `children` : la carte de réglage elle-même (HubSpot).
 * Rien tant que l'offre n'est pas lue.
 */
export function ConnecteurSurDemande({ tenantId, nom, sujet, children }: {
  tenantId: string;
  nom: string;
  /** La clé que `/support?sujet=` reconnaît (`web/app/support/page.tsx`) ; sans objet quand `children` est la carte. */
  sujet?: 'salesforce' | 'dynamics';
  children?: ReactNode;
}) {
  const t = useT();
  const ferme = useFermeture(tenantId, 'crm');
  if (ferme === undefined) return null;
  if (ferme) return <HorsOffre fonction="crm" vue={ferme} />;
  if (children) return <>{children}</>;
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid={`integration-contact-${sujet ?? 'crm'}`}>
      <p className="text-sm text-ink-500">
        {t(`Nous branchons ${nom} avec vous.`, `We connect ${nom} with you.`)}
      </p>
      <Link href={sujet ? `/support?sujet=${sujet}` : '/support'} className={classesBouton('secondaire', 'petite')}>
        {t('Nous contacter', 'Contact us')}
      </Link>
    </div>
  );
}
