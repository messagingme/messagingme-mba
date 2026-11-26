'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Bouton } from '@/components/Bouton';
import { IntroPage, TitrePage } from '@/components/TitrePage';
import { Squelette } from '@/components/Squelette';
import { ApiError, accepterMiseEnLigne, lireMiseEnLigne } from '@/lib/api';
import { useArme } from '@/lib/armement';
import { useLocale, useT } from '@/lib/i18n';
import type { ResultatAction, VueMiseEnLigne } from '@/lib/partage/mise-en-ligne';
import type { Session } from '@/lib/session';

/**
 * LE OUI DE MISE EN LIGNE (lot 1 du CSM virtuel, B2) : Claude a préparé une mise en ligne et donné ce lien
 * (`propose_go_live`). La page montre ce que le clic va faire, avec le récapitulatif écrit par le SERVEUR, et UN bouton
 * qui nomme l'effet. Le clic d'un administrateur connecté vaut accord : il n'y a rien d'autre à confirmer. Ensuite elle
 * dit où en est chaque action. Sous la garde d'admin de l'API : un autre rôle lit un refus, et la page le dit.
 * 🔴 Le bouton ne part qu'une demi-seconde après chaque retour sur la page (`useArme`), comme ceux qui accordent un accès.
 */
export default function MiseEnLignePage() {
  // L'accueil, ouvert à toutes les offres : la Free y vient dire oui à une suppression de contacts (B8). Le serveur juge
  // chaque action (une publication exige les scénarios).
  return <AppShell active="accueil">{(session) => <MiseEnLigneInner session={session} />}</AppShell>;
}

function MiseEnLigneInner({ session }: { session: Session }) {
  const t = useT();
  const { locale } = useLocale();
  const [id, setId] = useState<string | null | undefined>(undefined);
  const [vue, setVue] = useState<VueMiseEnLigne | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const { arme, estArme } = useArme();

  const motif = useCallback((err: unknown): string => {
    if (err instanceof ApiError && err.status === 403) {
      return t('Seul un administrateur de l’espace peut accepter une mise en ligne.', 'Only an administrator of the workspace can accept a go-live.');
    }
    if (err instanceof ApiError && err.status === 404) {
      return t(
        'Cette mise en ligne n’existe pas dans l’espace ouvert : vérifiez que vous êtes connecté à l’espace où Claude l’a préparée.',
        'This go-live does not exist in the open workspace: check that you are signed in to the workspace where Claude prepared it.',
      );
    }
    return err instanceof Error ? err.message : t('Lecture impossible pour le moment.', 'Unable to read it right now.');
  }, [t]);

  useEffect(() => {
    // Lu ici et pas au rendu : l'adresse n'existe pas côté serveur.
    const lu = new URLSearchParams(window.location.search).get('id');
    setId(lu);
    if (!lu) return;
    let vivant = true;
    lireMiseEnLigne(session.tenantId, lu)
      .then((v) => { if (vivant) setVue(v); })
      .catch((err: unknown) => { if (vivant) setErreur(motif(err)); });
    return () => { vivant = false; };
  }, [session.tenantId, motif]);

  async function cliquer(): Promise<void> {
    // Relu dans le geste : un appui arrivé avant le rendu qui désactive le bouton ne part pas non plus.
    if (!id || !estArme() || enCours) return;
    setErreur(null);
    setEnCours(true);
    try {
      setVue(await accepterMiseEnLigne(session.tenantId, id));
    } catch (err) {
      setErreur(motif(err));
      // Un refus (échu, modifié depuis) : la page relit l'état pour montrer ce qui en est.
      lireMiseEnLigne(session.tenantId, id).then(setVue).catch(() => undefined);
    } finally {
      setEnCours(false);
    }
  }

  const date = (iso: string): string => new Date(iso).toLocaleString(locale === 'en' ? 'en-GB' : 'fr-FR', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });

  const etatAction = (r: ResultatAction | null): string => {
    if (r === null) return t('pas encore fait', 'not done yet');
    if (!r.ok) return `${t('refusé', 'refused')} : ${r.message}`;
    switch (r.etat) {
      case 'programme': return t('programmé : il part dès que Meta valide son template', 'scheduled: it goes live as soon as Meta approves its template');
      case 'branche': return t('branché', 'switched on');
      case 'publie': return t('publié', 'published');
      // Les envois au oui (B8) : une campagne, une suppression de contacts.
      case 'envoyee': return t(`part à ${r.destinataires} contact(s)`, `sending to ${r.destinataires} contact(s)`);
      case 'programmee': return t('programmée à sa date', 'scheduled for its date');
      case 'reprise': return t(`reprise : ${r.destinataires} contact(s) en attente la reçoivent`, `resumed: ${r.destinataires} waiting contact(s) receive it`);
      case 'deja_partie': return t('déjà partie : rien n’a été renvoyé', 'had already left: nothing was sent again');
      case 'supprimes': return t(`${r.contacts} contact(s) supprimé(s)`, `${r.contacts} contact(s) deleted`);
    }
  };

  if (id === undefined) return <Squelette />;

  return (
    <div className="max-w-formulaire space-y-6">
      <div>
        <TitrePage>{t('Préparé par Claude, à votre clic', 'Prepared by Claude, awaiting your click')}</TitrePage>
        <IntroPage>{t('Voici ce que le bouton va faire. Rien n’est fait avant votre clic.', 'Here is what the button will do. Nothing happens before your click.')}</IntroPage>
      </div>

      {id === null && (
        <p className="rounded-carte border border-ink-200 bg-white p-5 text-sm text-ink-700">
          {t('Ce lien est incomplet : demandez à Claude de vous le redonner.', 'This link is incomplete: ask Claude to give it to you again.')}
        </p>
      )}

      {erreur && <p className="rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700" data-testid="mise-en-ligne-erreur">{erreur}</p>}

      {id !== null && vue === null && erreur === null && <Squelette />}

      {vue && (
        <div className="space-y-4 rounded-carte border border-ink-200 bg-white p-5">
          <ul className="list-disc space-y-2 pl-5 text-sm text-ink-700" data-testid="mise-en-ligne-recapitulatif">
            {vue.recapitulatif.map((ligne) => <li key={ligne}>{ligne}</li>)}
          </ul>

          {vue.etat === 'proposee' && (
            <div className="space-y-2">
              <Bouton enCours={enCours} disabled={enCours || !arme} onClick={() => { void cliquer(); }} data-testid="mise-en-ligne-bouton">
                {enCours ? t('En cours…', 'Working…') : vue.libelle}
              </Bouton>
              <p className="text-xs text-ink-500">
                {t('Ce bouton sert une fois, jusqu’au', 'This button works once, until')} {date(vue.expireLe)}.
              </p>
            </div>
          )}

          {vue.etat === 'expiree' && (
            <p className="text-sm text-ink-700">{t('Ce bouton a expiré : demandez à Claude de le préparer à nouveau.', 'This button has expired: ask Claude to prepare it again.')}</p>
          )}

          {vue.etat === 'en_cours' && (
            <p className="text-sm text-ink-700">{t('C’est en cours. Rechargez la page dans un instant.', 'It is running. Reload the page in a moment.')}</p>
          )}

          {vue.etat === 'interrompue' && (
            <div className="space-y-2">
              <p className="text-sm text-ink-700">
                {t('Une panne l’a interrompu. Reprenez : il repart après la dernière action faite, sans rien refaire ni renvoyer.', 'An outage interrupted it. Resume: it starts again after the last action done, without redoing or resending anything.')}
              </p>
              <Bouton enCours={enCours} disabled={enCours || !arme} onClick={() => { void cliquer(); }} data-testid="mise-en-ligne-reprendre">
                {t('Reprendre', 'Resume')}
              </Bouton>
            </div>
          )}

          {vue.etat === 'faite' && (
            <p className="rounded-carte border border-succes-200 bg-succes-50 px-4 py-3 text-sm text-succes-700" data-testid="mise-en-ligne-faite">
              {t('C’est fait. Claude peut maintenant vérifier le résultat.', 'Done. Claude can now check the result.')}
            </p>
          )}

          {vue.etat === 'echouee' && (
            <p className="rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700">
              {t('Il s’est arrêté sur un refus : ce qui suit n’a pas été fait. Demandez à Claude de corriger, puis de vous redonner un bouton.', 'It stopped on a refusal: what follows was not done. Ask Claude to fix it, then to give you a new button.')}
            </p>
          )}

          {vue.etat !== 'proposee' && vue.etat !== 'expiree' && (
            <ul className="space-y-1 text-sm text-ink-700" data-testid="mise-en-ligne-actions">
              {vue.actions.map((a, i) => (
                <li key={`${a.type}-${a.scenario ?? a.campagne ?? ''}-${i}`}>
                  <span className="font-medium">{a.nom}</span> : {etatAction(a.resultat)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
