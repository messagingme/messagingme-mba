'use client';

import { useEffect, useState } from 'react';
import { chargerSegments } from './segments';
import type { SuiviSegmentsVue } from './partage/segments';

/**
 * Ce que l'API sait cibler en segments ; `null` tant que ce n'est pas lu, et si la route ne répond pas. À part de
 * `./segments`, qui reste sans React pour que la suite racine le teste.
 */
export function useSegments(tenantId: string | null | undefined): SuiviSegmentsVue | null {
  const [suivi, setSuivi] = useState<SuiviSegmentsVue | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    let vivant = true;
    void chargerSegments(tenantId).then((s) => { if (vivant) setSuivi(s); });
    return () => { vivant = false; };
  }, [tenantId]);
  return suivi;
}
