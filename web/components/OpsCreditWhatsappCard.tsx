'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { inputCls } from '@/lib/ui';
import { Bouton } from '@/components/Bouton';
import { OpsGrilleMeta } from '@/components/OpsGrilleMeta';
import {
  abandonnerAttenteOps, chargerGrilleMetaOps, lireNumerosEnAttenteOps, lireReglagesCreditWhatsappOps,
  reglerCommissionMessagesOps, type NumeroEnAttenteOps, type ResumeGrilleMeta,
} from '@/lib/api';

/**
 * LES RÉGLAGES DU CRÉDIT WHATSAPP DANS `/ops` (plan du Crédit WhatsApp, tâche 2) : la grille de Meta, chargée depuis le
 * fichier en euros que Meta publie, et la commission des messages.
 *
 * Un seul geste pour la grille : choisir le fichier, sa date d'entrée en vigueur, dire d'où il vient. C'est le serveur
 * qui le lit, et qui le refuse en nommant la ligne fautive. Comme la grille de prix, la carte se masque quand l'API n'a
 * pas encore la route, et rien ne s'affiche « enregistré » avant la réponse du serveur.
 */
const champ = `mt-1 ${inputCls}`;

function dateLisible(iso: string): string {
  return new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
}

/**
 * « NE PAS POSER » (relecture du lot E6, jaune 5) : la ligne attendue ne viendra pas (le partenaire n'attache pas, le
 * client renonce), ou l'attache est vérifiée sur un compte déjà couvert. Sur un compte déjà couvert SANS attache, ce n'est
 * pas le geste : notre ligne resterait, et le client paierait deux fois ; la retirer plutôt (relecture du lot V8, jaune 3).
 * L'exemple du champ reste donc neutre. Une note dit pourquoi ; le serveur efface l'attente et rend la liste relue. Rien
 * n'est dit fait avant sa réponse.
 */
function NePasPoser({ token, n, surListe }: { token: string; n: NumeroEnAttenteOps; surListe: (l: NumeroEnAttenteOps[]) => void }) {
  const t = useT();
  const [note, setNote] = useState('');
  const [etat, setEtat] = useState<{ statut: 'idle' | 'saving' | 'error'; msg?: string }>({ statut: 'idle' });

  async function abandonner() {
    setEtat({ statut: 'saving' });
    try {
      surListe((await abandonnerAttenteOps(token, n.tenantId, n.phoneNumberId, note)).numeros);
    } catch (err) {
      setEtat({ statut: 'error', msg: err instanceof Error ? err.message : undefined });
    }
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <input
        value={note} onChange={(e) => { setNote(e.target.value); setEtat({ statut: 'idle' }); }} className={`${inputCls} max-w-xs`}
        aria-label={t('Pourquoi sa ligne ne sera pas posée', 'Why its line will not be set')}
        placeholder={t('pourquoi : la ligne ne viendra pas…', 'why: the line will not come…')}
        data-testid="ops-credit-whatsapp-en-attente-note"
      />
      <Bouton
        type="button" variante="secondaire" taille="petite" onClick={() => { void abandonner(); }}
        disabled={etat.statut === 'saving' || note.trim().length < 3} enCours={etat.statut === 'saving'}
        data-testid="ops-credit-whatsapp-en-attente-ne-pas-poser"
      >
        {t('Ne pas poser', 'Do not set')}
      </Bouton>
      {etat.statut === 'error' && (
        <span className="text-xs text-danger-700" data-testid="ops-credit-whatsapp-en-attente-erreur">
          {etat.msg ?? t('Impossible pour l’instant.', 'Not possible right now.')}
        </span>
      )}
    </div>
  );
}

/**
 * LES NUMÉROS QUI ATTENDENT LEUR LIGNE (relecture du lot E5, jaune 3 ; décision de Julien du 2026-11-09) : arrivés par la
 * fenêtre du partenaire, sans ligne posée depuis, tous espaces. Le geste (demander l'attache au partenaire, puis poser la
 * ligne de l'espace quand il la confirme) ne dépend plus d'une alerte Telegram, qui peut se perdre (essai 236) ; une
 * ligne qui ne viendra pas se lève par « Ne pas poser ». Une API d'avant la route : la liste se dit illisible, le reste
 * de la carte demeure.
 */
function EnAttenteDeLigne({ token }: { token: string }) {
  const t = useT();
  const [numeros, setNumeros] = useState<NumeroEnAttenteOps[] | null | undefined>(undefined);

  useEffect(() => {
    let vivant = true;
    lireNumerosEnAttenteOps(token)
      .then((r) => { if (vivant) setNumeros(r.numeros); })
      .catch(() => { if (vivant) setNumeros(null); });
    return () => { vivant = false; };
  }, [token]);

  return (
    <div className="mt-4 rounded-carte border border-ink-200 p-3" data-testid="ops-credit-whatsapp-en-attente">
      <h3 className="text-xs font-semibold text-ink-900">{t('En attente de leur ligne', 'Waiting for their line')}</h3>
      <p className="mt-1 text-xs text-ink-500">
        {t(
          'Arrivés par la fenêtre du partenaire : lui demander d’attacher sa ligne de crédit, puis poser celle de l’espace (son lien « offre ») quand il confirme l’attache, pas avant. « Ne pas poser » sort un numéro de cette liste, quand la ligne ne viendra pas ou que l’attache est vérifiée sur un compte déjà couvert : une Entreprise sans ligne repasse sur demande, avec le conseil de sa carte chez Meta ; un compte déjà couvert, l’attache vérifiée, garde sa ligne, qui couvre bien son numéro (« payés par votre Crédit WhatsApp ») ; sans attache, « Ne pas poser » ne retire pas la nôtre : la retirer plutôt, le numéro restant ici jusqu’à ce qu’on la repose, l’attache confirmée ; une Entreprise qui garde seulement la ligne active d’un ancien numéro d’un AUTRE compte WhatsApp lit aussi « payés par votre Crédit WhatsApp », sans que son numéro soit couvert ; une option payée sans ligne reste en attente. Refusé tant qu’une ligne d’un autre espace, ou arrêtée, bloque encore le compte.',
          'Connected through the partner’s window: ask the partner to attach their credit line, then set the workspace’s line (its “plan” link) once they confirm, not before. “Do not set” removes a number from this list, when the line will not come or the attachment is checked on an account already covered: an Enterprise with no line goes back to on request, with the advice about its card at Meta; an account already covered, the attachment checked, keeps its line, which does cover its number (“paid by your WhatsApp Credit”); with no attachment, “Do not set” does not remove ours: remove it instead, the number staying here until it is set again, once the attachment is confirmed; an Enterprise that only keeps the active line of a former number on ANOTHER WhatsApp account also reads “paid by your WhatsApp Credit”, while its number is not covered; a paid option with no line stays pending. Refused while a line of another workspace, or a stopped line, still blocks the account.',
        )}
      </p>
      {numeros === null && (
        <p className="mt-2 text-xs text-ink-500" data-testid="ops-credit-whatsapp-en-attente-illisible">
          {t('Liste illisible : l’API n’a peut-être pas encore la route.', 'List unreadable: the API may not have the route yet.')}
        </p>
      )}
      {numeros !== null && numeros !== undefined && numeros.length === 0 && (
        <p className="mt-2 text-sm text-ink-900">{t('Aucun numéro n’attend sa ligne.', 'No number is waiting for its line.')}</p>
      )}
      {numeros !== null && numeros !== undefined && numeros.length > 0 && (
        <ul className="mt-2 space-y-2 text-sm text-ink-900">
          {numeros.map((n) => (
            <li key={n.phoneNumberId}>
              <span data-testid="ops-credit-whatsapp-en-attente-numero">
                {t(
                  `${n.espace} : ${n.numero ?? n.phoneNumberId}, connecté le ${dateLisible(n.depuis)}`,
                  `${n.espace}: ${n.numero ?? n.phoneNumberId}, connected on ${dateLisible(n.depuis)}`,
                )}
              </span>
              <NePasPoser token={token} n={n} surListe={setNumeros} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OpsCreditWhatsappCard({ token }: { token: string }) {
  const t = useT();
  const [absente, setAbsente] = useState(false);
  const [grille, setGrille] = useState<ResumeGrilleMeta | null | undefined>(undefined);
  const [commission, setCommission] = useState('');
  const [fichier, setFichier] = useState<File | null>(null);
  const [enVigueurLe, setEnVigueurLe] = useState('');
  const [noteGrille, setNoteGrille] = useState('');
  const [noteCommission, setNoteCommission] = useState('');
  const [etatGrille, setEtatGrille] = useState<{ statut: 'idle' | 'saving' | 'saved' | 'error'; msg?: string }>({ statut: 'idle' });
  const [etatCommission, setEtatCommission] = useState<{ statut: 'idle' | 'saving' | 'saved' | 'error'; msg?: string }>({ statut: 'idle' });
  // Une commission enregistrée change tous les prix client : le tableau de la grille se relit.
  const [versionPrix, setVersionPrix] = useState(0);

  useEffect(() => {
    let vivant = true;
    lireReglagesCreditWhatsappOps(token)
      .then((r) => { if (vivant) { setGrille(r.grille); setCommission(String(r.commissionPct)); } })
      .catch(() => { if (vivant) setAbsente(true); });
    return () => { vivant = false; };
  }, [token]);

  async function charger() {
    if (fichier === null) return;
    setEtatGrille({ statut: 'saving' });
    try {
      const r = await chargerGrilleMetaOps(token, await fichier.text(), enVigueurLe, noteGrille);
      setGrille(r.grille);
      setEtatGrille({ statut: 'saved' });
      setFichier(null);
      setNoteGrille('');
    } catch (err) {
      setEtatGrille({ statut: 'error', msg: err instanceof Error ? err.message : undefined });
    }
  }

  async function reglerCommission() {
    setEtatCommission({ statut: 'saving' });
    try {
      const r = await reglerCommissionMessagesOps(token, Number(commission), noteCommission);
      setCommission(String(r.commissionPct));
      setEtatCommission({ statut: 'saved' });
      setVersionPrix((v) => v + 1);
      setNoteCommission('');
    } catch (err) {
      setEtatCommission({ statut: 'error', msg: err instanceof Error ? err.message : undefined });
    }
  }

  if (absente) {
    return (
      <div className="rounded-carte border border-ink-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-ink-900">{t('Crédit WhatsApp', 'WhatsApp credit')}</h2>
        <p className="mt-1 text-xs text-ink-500">
          {t('Indisponible sur cette instance : l’API n’a pas encore la route.', 'Unavailable on this instance: the API does not have the route yet.')}
        </p>
      </div>
    );
  }
  if (grille === undefined) return null;

  return (
    <div className="rounded-carte border border-ink-200 bg-white p-5" data-testid="ops-credit-whatsapp">
      <h2 className="text-sm font-semibold text-ink-900">{t('Crédit WhatsApp : grille de Meta et commission', 'WhatsApp credit: Meta rate card and commission')}</h2>
      <p className="mt-1 text-xs text-ink-500">
        {t(
          'Le prix d’un message sur la ligne de crédit : le tarif de Meta du pays et de la catégorie, plus la commission. Aucun numéro ne peut passer sur la ligne sans grille.',
          'The price of a message on the credit line: Meta’s rate for the country and category, plus the commission. No number can go on the line without a rate card.',
        )}
      </p>

      <EnAttenteDeLigne token={token} />

      <div className="mt-4 text-sm text-ink-900" data-testid="ops-grille-meta-etat">
        {grille === null
          ? t('Aucune grille chargée.', 'No rate card loaded.')
          : t(
            `En vigueur depuis le ${dateLisible(grille.enVigueurLe)} : ${grille.tarifs} tarifs, chargée le ${dateLisible(grille.chargeeLe)} par ${grille.chargeePar}.`,
            `In force since ${dateLisible(grille.enVigueurLe)}: ${grille.tarifs} rates, loaded on ${dateLisible(grille.chargeeLe)} by ${grille.chargeePar}.`,
          )}
        {grille?.perimee && (
          <p className="mt-1 text-xs text-alerte-700" data-testid="ops-grille-meta-perimee">
            {t(
              'Elle date d’avant ce trimestre : Meta change ses tarifs au 1er jour de chaque trimestre. Chargez la nouvelle.',
              'It predates this quarter: Meta changes its rates on the first day of each quarter. Load the new one.',
            )}
          </p>
        )}
        {grille?.prochaine && (
          <p className="mt-1 text-xs text-ink-500">
            {t(`Une grille suivante prendra effet le ${dateLisible(grille.prochaine.enVigueurLe)}.`, `A next rate card takes effect on ${dateLisible(grille.prochaine.enVigueurLe)}.`)}
          </p>
        )}
      </div>

      {/* Les prix eux-mêmes, relus après chaque chargement d'une grille et chaque commission enregistrée. */}
      {grille !== null && <OpsGrilleMeta key={`${grille.id}:${versionPrix}`} token={token} />}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="grille-meta-fichier" className="block text-xs font-medium text-ink-900">
            {t('Fichier de Meta « EUR list rates » (CSV)', 'Meta file “EUR list rates” (CSV)')}
          </label>
          <input
            id="grille-meta-fichier" type="file" accept=".csv,text/csv" className={champ} data-testid="ops-grille-meta-fichier"
            onChange={(e) => { setFichier(e.target.files?.[0] ?? null); setEtatGrille({ statut: 'idle' }); }}
          />
        </div>
        <div>
          <label htmlFor="grille-meta-date" className="block text-xs font-medium text-ink-900">{t('En vigueur le', 'In force from')}</label>
          <input id="grille-meta-date" type="date" value={enVigueurLe} onChange={(e) => setEnVigueurLe(e.target.value)} className={champ} />
        </div>
      </div>
      <div className="mt-3">
        <label htmlFor="grille-meta-note" className="block text-xs font-medium text-ink-900">{t('D’où vient ce fichier ?', 'Where does this file come from?')}</label>
        <input
          id="grille-meta-note" value={noteGrille} onChange={(e) => setNoteGrille(e.target.value)} className={champ}
          placeholder={t('par exemple : grille du T1 2027, téléchargée sur la page Pricing de Meta', 'for example: Q1 2027 rate card, from Meta’s Pricing page')}
        />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Bouton type="button" onClick={() => { void charger(); }} disabled={etatGrille.statut === 'saving' || fichier === null || enVigueurLe === ''} data-testid="ops-grille-meta-charger">
          {etatGrille.statut === 'saving' ? t('Chargement…', 'Loading…') : t('Charger la grille', 'Load the rate card')}
        </Bouton>
        {etatGrille.statut === 'saved' && <span className="text-xs text-succes-700">{t('Grille chargée', 'Rate card loaded')}</span>}
        {etatGrille.statut === 'error' && (
          <span className="text-xs text-danger-700" data-testid="ops-grille-meta-erreur">{etatGrille.msg ?? t('Chargement impossible.', 'Could not load.')}</span>
        )}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="commission-messages" className="block text-xs font-medium text-ink-900">{t('Commission des messages (%)', 'Message commission (%)')}</label>
          <input
            id="commission-messages" type="number" min={0} max={100} step={1} value={commission} className={champ}
            onChange={(e) => { setCommission(e.target.value); setEtatCommission({ statut: 'idle' }); }}
          />
        </div>
        <div>
          <label htmlFor="commission-note" className="block text-xs font-medium text-ink-900">{t('Pourquoi ce changement ?', 'Why this change?')}</label>
          <input id="commission-note" value={noteCommission} onChange={(e) => setNoteCommission(e.target.value)} className={champ} />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Bouton type="button" onClick={() => { void reglerCommission(); }} disabled={etatCommission.statut === 'saving'}>
          {etatCommission.statut === 'saving' ? t('Enregistrement…', 'Saving…') : t('Enregistrer', 'Save')}
        </Bouton>
        {etatCommission.statut === 'saved' && <span className="text-xs text-succes-700">{t('Enregistré', 'Saved')}</span>}
        {etatCommission.statut === 'error' && (
          <span className="text-xs text-danger-700">{etatCommission.msg ?? t('Enregistrement impossible.', 'Could not save.')}</span>
        )}
      </div>
      <p className="mt-3 text-xs text-ink-500">
        {t(
          'La commission ne s’affiche jamais en taux chez le client : il voit des prix, commission comprise. L’Entreprise peut avoir la sienne, réglée avec son offre.',
          'The commission is never shown as a rate to the client: they see prices, commission included. An Enterprise can have its own, set with its plan.',
        )}
      </p>
    </div>
  );
}
