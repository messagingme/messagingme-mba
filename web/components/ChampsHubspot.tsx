'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getHubspotChamps, putHubspotChamps, type ChampsHubspotDuPortail } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { inputCls } from '@/lib/ui';
import { Bouton } from '@/components/Bouton';
import { Icone } from '@/components/Icone';
import { useInstallationHubspot } from '@/lib/hubspot-installation';
import {
  CHAMPS_HUBSPOT_MAX, accesAAutoriser, basculerChamp, caseGrisee, champsSelectionnes, corpsDesChamps, groupesDeChamps, idChamp, portailLisible, selectionDe, selectionModifiee,
} from '@/lib/hubspot-champs';

/**
 * LE BLOC « CHAMPS HUBSPOT À IMPORTER » de Tools > Intégrations > HubSpot (lot 2 du plan du 2026-11-02, décisions 1 à 4
 * du cadrage du même jour) : le client choisit les propriétés du contact et de la transaction, et des champs calculés
 * (le conseiller, son lien de réservation, le lien et le PDF du devis), que ses workflows HubSpot écrivent sur la fiche.
 * Chaque champ choisi devient un champ de fiche « (HubSpot) ». Un calculé dont l'accès manque (agenda, devis) est grisé,
 * avec sa raison et le bouton qui redemande les portées facultatives.
 *
 * La liste est lue et posée chez le connecteur, par l'API : un connecteur qui se réveille se relit comme la carte (toutes
 * les 10 s, trois fois au plus), un connecteur pas encore à jour le dit, jamais « aucun champ ». Un enregistrement
 * explicite (bouton), pas un par case : chaque enregistrement déclare des champs et appelle le connecteur.
 *
 * ⚠️ ADMIN SEULEMENT, comme la carte qui le porte.
 */
export function ChampsHubspot({ tenantId }: { tenantId: string }) {
  const t = useT();
  const [etat, setEtat] = useState<'lecture' | 'ok' | 'reveil' | 'echec'>('lecture');
  const [portail, setPortail] = useState<ChampsHubspotDuPortail | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [enregistree, setEnregistree] = useState<Set<string>>(new Set());
  const [recherche, setRecherche] = useState('');
  const [statut, setStatut] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [erreur, setErreur] = useState<string | null>(null);
  const [relectures, setRelectures] = useState(0);
  const vivant = useRef(true);
  // Le re-consentement des portées facultatives (devis et agenda), par le lien d'installation signé.
  const { ouvrir, enCours } = useInstallationHubspot(tenantId, true);

  const lire = useCallback(() => {
    getHubspotChamps(tenantId)
      .then((p) => {
        if (!vivant.current) return;
        if (!portailLisible(p)) throw new Error(t('Réponse illisible : rechargez la page.', 'Unreadable response: reload the page.'));
        setPortail(p);
        const s = selectionDe(p.choisis);
        setSelection(s);
        setEnregistree(s);
        setErreur(null);
        setEtat('ok');
      })
      .catch((e: unknown) => {
        if (!vivant.current) return;
        const code = e instanceof ApiError ? (e.corps as { code?: unknown } | null | undefined)?.code : undefined;
        if (code === 'connecteur_en_reveil') { setEtat('reveil'); return; }
        // Un 404 : l'API n'a pas encore la route (mise à jour en cours), jamais « aucun champ ».
        setErreur(e instanceof ApiError && e.status === 404
          ? t('La mise à jour de l’intégration HubSpot est en cours : réessayez dans quelques minutes.', 'The HubSpot integration is being updated: try again in a few minutes.')
          : e instanceof Error ? e.message : t('Lecture impossible', 'Unable to load'));
        setEtat('echec');
      });
  }, [tenantId, t]);

  useEffect(() => {
    vivant.current = true;
    lire();
    return () => { vivant.current = false; };
  }, [lire]);

  // Le connecteur met une quinzaine de secondes à se réveiller : la relecture le trouve debout.
  useEffect(() => {
    if (etat !== 'reveil' || relectures >= 3) return;
    const minuteur = setTimeout(() => { setRelectures((n) => n + 1); lire(); }, 10_000);
    return () => clearTimeout(minuteur);
  }, [etat, relectures, lire]);

  const enregistrer = () => {
    setStatut('saving');
    setErreur(null);
    putHubspotChamps(tenantId, corpsDesChamps(selection))
      .then((r) => {
        if (!vivant.current) return;
        const s = selectionDe(r.choisis);
        setSelection(s);
        setEnregistree(s);
        setStatut('saved');
      })
      .catch((e: unknown) => {
        if (!vivant.current) return;
        setStatut('error');
        setErreur(e instanceof Error ? e.message : t('Enregistrement impossible', 'Unable to save'));
      });
  };

  const titres: Record<string, string> = {
    contact: t('Contact', 'Contact'),
    deal: t('Transaction', 'Deal'),
    calcule: t('Calculés', 'Computed'),
  };
  const groupes = portail ? groupesDeChamps(portail, recherche, selection) : [];
  const libelle = statut === 'saving' ? t('enregistrement…', 'saving…') : statut === 'saved' ? t('enregistré', 'saved') : '';

  return (
    <div className="mt-4 border-t border-ink-50 pt-4" data-testid="integration-hubspot-champs">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-ink-900">{t('Champs HubSpot à importer', 'HubSpot fields to import')}</p>
        <span className="shrink-0 text-xs text-ink-500">{libelle}</span>
      </div>
      <p className="mt-1 text-xs text-ink-500">
        {t(
          'Chaque champ coché devient un champ de fiche « (HubSpot) », que vous pouvez choisir comme source d’une variable de modèle. Vos workflows HubSpot l’écrivent sur la fiche à chaque lancement, et une valeur vide dans HubSpot le retire de la fiche. Un champ décoché n’est pas supprimé de la fiche.',
          'Each checked field becomes a “(HubSpot)” record field, which you can pick as the source of a template variable. Your HubSpot workflows write it to the record at each launch, and an empty value in HubSpot removes it from the record. An unchecked field is not deleted from the record.',
        )}
      </p>

      {etat === 'lecture' && <p className="mt-3 text-sm text-ink-500">{t('Lecture…', 'Loading…')}</p>}
      {etat === 'reveil' && (
        <p className="mt-3 text-sm text-ink-500" data-testid="integration-hubspot-champs-reveil">
          {relectures < 3
            ? t('Connexion à HubSpot en cours…', 'Connecting to HubSpot…')
            : t('HubSpot ne répond pas pour l’instant. Réessayez dans quelques minutes.', 'HubSpot is not responding right now. Try again in a few minutes.')}
        </p>
      )}

      {etat === 'ok' && portail && (
        <>
          {/* Les champs sélectionnés, toujours visibles quelle que soit la recherche, chacun retiré d'une croix. */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="integration-hubspot-champs-choisis">
            {selection.size === 0 && <span className="text-xs text-ink-500">{t('Aucun champ choisi.', 'No field chosen.')}</span>}
            {champsSelectionnes(portail, selection).map((l) => (
              <span key={idChamp(l)} className="inline-flex items-center gap-1 rounded-controle bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                {titres[l.objet]} : {l.libelle}
                <button
                  type="button"
                  onClick={() => setSelection((s) => basculerChamp(s, l))}
                  disabled={statut === 'saving'}
                  aria-label={t(`Retirer ${l.libelle}`, `Remove ${l.libelle}`)}
                  className="text-brand-600 hover:text-danger"
                  data-testid={`integration-hubspot-champ-retirer-${idChamp(l)}`}
                >
                  <Icone nom="fermer" taille="petite" />
                </button>
              </span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              type="search"
              className={`${inputCls} sm:w-72`}
              placeholder={t('Rechercher une propriété', 'Search a property')}
              aria-label={t('Rechercher une propriété', 'Search a property')}
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              data-testid="integration-hubspot-champs-recherche"
            />
            <span className="text-xs text-ink-500" data-testid="integration-hubspot-champs-compte">
              {t(`${selection.size} sur ${CHAMPS_HUBSPOT_MAX}`, `${selection.size} of ${CHAMPS_HUBSPOT_MAX}`)}
            </span>
          </div>
          <div className="mt-3 max-h-80 space-y-3 overflow-y-auto">
            {groupes.map((g) => (
              <div key={g.objet} data-testid={`integration-hubspot-champs-${g.objet}`}>
                <p className="text-xs font-medium text-ink-500">{titres[g.objet]}</p>
                {g.objet === 'calcule' && accesAAutoriser(portail) && (
                  <p className="mt-1 text-xs text-ink-500">
                    <button
                      type="button"
                      onClick={() => void ouvrir('devis')}
                      disabled={enCours}
                      className="text-sm text-brand-600 hover:underline disabled:opacity-60"
                      data-testid="integration-hubspot-champs-autoriser"
                    >
                      {t('Autoriser l’accès aux devis et à l’agenda', 'Authorize access to quotes and the calendar')}
                    </button>
                    {' '}
                    {t('Une fois l’accès accordé dans HubSpot, rechargez cette page.', 'Once access is granted in HubSpot, reload this page.')}
                  </p>
                )}
                {g.lignes.length === 0 && <p className="mt-1 text-xs text-ink-500">{t('Aucune propriété.', 'No property.')}</p>}
                <ul className="mt-1">
                  {g.lignes.map((l) => (
                    <li key={idChamp(l)}>
                      <label className="flex items-start gap-2 py-1 text-sm text-ink-900">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={selection.has(idChamp(l))}
                          disabled={statut === 'saving' || caseGrisee(selection, l)}
                          onChange={() => setSelection((s) => basculerChamp(s, l))}
                          data-testid={`integration-hubspot-champ-${idChamp(l)}`}
                        />
                        <span className="min-w-0">
                          {l.libelle} <span className="text-xs text-ink-500">{l.nom}</span>
                          {l.acces && (
                            <span className="block text-xs text-ink-500" data-testid={`integration-hubspot-champ-raison-${idChamp(l)}`}>
                              {l.acces === 'devis'
                                ? t('L’accès aux devis HubSpot n’est pas accordé à Messaging Me.', 'Access to HubSpot quotes is not granted to Messaging Me.')
                                : t('L’accès à l’agenda HubSpot n’est pas accordé à Messaging Me.', 'Access to the HubSpot calendar is not granted to Messaging Me.')}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <Bouton
              type="button"
              data-testid="integration-hubspot-champs-enregistrer"
              onClick={enregistrer}
              disabled={statut === 'saving' || !selectionModifiee(selection, enregistree)}
            >
              {t('Enregistrer les champs', 'Save the fields')}
            </Bouton>
          </div>
        </>
      )}

      {erreur && <p className="mt-3 text-sm text-danger" role="alert" data-testid="integration-hubspot-champs-erreur">{erreur}</p>}
    </div>
  );
}
