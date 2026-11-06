'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getInboxHubspot, putInboxHubspot, type InboxHubspot as EtatInbox } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { inputCls } from '@/lib/ui';
import { Bouton } from '@/components/Bouton';
import { useInstallationHubspot } from '@/lib/hubspot-installation';

/**
 * LE BLOC « CONVERSATIONS DANS L'INBOX HUBSPOT » de Tools > Intégrations > HubSpot (lot 1 de l'Inbox, tâche 6 du plan
 * `~/mm-hubspot/docs/2026-11-06-inbox-hubspot-lot1-plan.md`) : l'admin choisit la boîte de réception où les conversations
 * WhatsApp de sa ligne apparaissent. Un portail en Sales Hub ou Service Hub Professionnel ou Entreprise seulement : sans
 * eux, HubSpot n'accorde pas les accès aux conversations, et le bloc le dit avec le bouton qui les redemande.
 *
 * 🔴 Une API trop ancienne n'a pas la route (404) : le bloc ne s'affiche pas, il ne dit jamais « aucune boîte ».
 * ⚠️ ADMIN SEULEMENT, comme la carte qui le porte.
 */
export function InboxHubspot({ tenantId }: { tenantId: string }) {
  const t = useT();
  const [etat, setEtat] = useState<'lecture' | 'ok' | 'absent' | 'echec'>('lecture');
  const [inbox, setInbox] = useState<EtatInbox | null>(null);
  const [choisie, setChoisie] = useState('');
  const [statut, setStatut] = useState<'idle' | 'saving' | 'error'>('idle');
  const [erreur, setErreur] = useState<string | null>(null);
  const vivant = useRef(true);
  const { ouvrir, enCours } = useInstallationHubspot(tenantId, true);

  const lire = useCallback(() => {
    getInboxHubspot(tenantId)
      .then((r) => {
        if (!vivant.current) return;
        setInbox(r);
        setChoisie(r.boite ?? r.boites?.[0]?.id ?? '');
        setEtat('ok');
      })
      .catch((e: unknown) => {
        if (!vivant.current) return;
        setEtat(e instanceof ApiError && e.status === 404 ? 'absent' : 'echec');
      });
  }, [tenantId]);

  useEffect(() => {
    vivant.current = true;
    lire();
    return () => { vivant.current = false; };
  }, [lire]);

  const poser = (inboxId: string | null) => {
    setStatut('saving');
    setErreur(null);
    putInboxHubspot(tenantId, inboxId)
      .then((r) => {
        if (!vivant.current) return;
        setInbox((avant) => (avant ? { ...avant, boite: r.boite } : avant));
        setStatut('idle');
      })
      .catch((e: unknown) => {
        if (!vivant.current) return;
        setStatut('error');
        const code = e instanceof ApiError ? (e.corps as { error?: string } | undefined)?.error : undefined;
        setErreur(
          code === 'portees_inbox_manquantes'
            ? t('Votre portail HubSpot n’a pas donné accès aux conversations : autorisez-les, puis réessayez.', 'Your HubSpot portal has not granted access to conversations: authorize them, then try again.')
            : code === 'connecteur_indisponible'
              ? t('La connexion à HubSpot est en cours : réessayez dans un instant.', 'The HubSpot connection is starting: try again in a moment.')
              : e instanceof ApiError && e.status === 402
                ? e.message
                : t('Le réglage n’a pas pu être enregistré : réessayez dans un moment.', 'The setting could not be saved: try again in a moment.'),
        );
      });
  };

  if (etat === 'absent' || etat === 'lecture') return null;

  const branchee = inbox?.boite ?? null;
  const nomBranchee = inbox?.boites?.find((b) => b.id === branchee)?.nom ?? null;

  return (
    <div className="mt-4 border-t border-ink-50 pt-4" data-testid="integration-hubspot-inbox">
      <p className="text-sm font-semibold text-ink-900">{t('Conversations dans l’Inbox HubSpot', 'Conversations in the HubSpot inbox')}</p>
      <p className="mt-1 text-xs text-ink-500">
        {t(
          'Les messages WhatsApp de votre ligne apparaissent dans une boîte de réception de HubSpot, dans le fil de leur conversation, sur la fiche du contact. Il faut Sales Hub ou Service Hub Professionnel ou Entreprise.',
          'The WhatsApp messages of your line appear in a HubSpot inbox, in their conversation thread, on the contact record. It requires Sales Hub or Service Hub Professional or Enterprise.',
        )}
      </p>

      {etat === 'echec' && (
        <p className="mt-2 text-sm text-danger" role="alert">{t('Ce réglage n’a pas pu être lu : rechargez la page.', 'This setting could not be read: reload the page.')}</p>
      )}

      {inbox?.raison === 'sans_numero' && (
        <p className="mt-2 text-sm text-ink-700">{t('Connectez d’abord un numéro WhatsApp.', 'Connect a WhatsApp number first.')}</p>
      )}

      {inbox?.raison === 'portees_inbox_manquantes' && (
        <div className="mt-2" data-testid="integration-hubspot-inbox-acces">
          <p className="text-sm text-ink-700">
            {t(
              'Votre portail HubSpot n’a pas encore donné accès aux conversations. À l’écran d’autorisation, cochez les trois accès aux conversations et aux messages.',
              'Your HubSpot portal has not granted access to conversations yet. On the authorization screen, tick the three conversations and messages accesses.',
            )}
          </p>
          <button type="button" onClick={() => void ouvrir('lists')} disabled={enCours} className="mt-2 text-sm text-brand-600 hover:underline disabled:opacity-60">
            {t('Autoriser l’accès aux conversations', 'Authorize access to conversations')}
          </button>
        </div>
      )}

      {inbox?.raison === 'connecteur_indisponible' && (
        <div className="mt-2">
          <p className="text-sm text-ink-700">{t('La connexion à HubSpot est en cours.', 'The HubSpot connection is starting.')}</p>
          <button type="button" onClick={lire} className="mt-2 text-sm text-brand-600 hover:underline">{t('Relire', 'Reload')}</button>
        </div>
      )}

      {inbox?.boites && (
        <div className="mt-3">
          {branchee && (
            <p className="text-sm text-ink-700" data-testid="integration-hubspot-inbox-branchee">
              {t('Branchée sur la boîte', 'Connected to the inbox')} « {nomBranchee ?? branchee} ».
            </p>
          )}
          {inbox.boites.length === 0 ? (
            <p className="mt-2 text-sm text-ink-700">{t('Votre portail n’a aucune boîte de réception : créez-en une dans HubSpot, puis rechargez la page.', 'Your portal has no inbox: create one in HubSpot, then reload the page.')}</p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select value={choisie} onChange={(e) => setChoisie(e.target.value)} className={`${inputCls} w-auto`} aria-label={t('Boîte de réception HubSpot', 'HubSpot inbox')}>
                {inbox.boites.map((b) => <option key={b.id} value={b.id}>{b.nom}</option>)}
              </select>
              {choisie !== branchee && (
                <Bouton type="button" onClick={() => poser(choisie)} disabled={statut === 'saving' || !choisie}>
                  {branchee ? t('Changer de boîte', 'Change inbox') : t('Brancher', 'Connect')}
                </Bouton>
              )}
              {branchee && (
                <Bouton type="button" variante="secondaire" onClick={() => poser(null)} disabled={statut === 'saving'}>
                  {t('Débrancher', 'Disconnect')}
                </Bouton>
              )}
            </div>
          )}
        </div>
      )}

      {erreur && <p className="mt-2 text-sm text-danger" role="alert">{erreur}</p>}
    </div>
  );
}
