'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { CsvImport } from '@/components/CsvImport';
import type { Session } from '@/lib/session';
import {
  listContacts,
  queryContacts,
  countContacts,
  listUserFields,
  listTags,
  bulkContactAction,
  deleteContacts,
  exportContacts,
  createContact,
  type Contact,
  type UserFieldDef,
  type ContactFilters,
  type BulkTarget,
  type BulkAction,
} from '@/lib/api';
import { filtersActive } from '@/lib/contact-filters';
import { basculerContact, basculerLignesAffichees, cibleContacts, estRetenu, nbRetenus, selectionTout, selectionVide } from '@/lib/selection-contacts';
import { ContactFilterPanel } from '@/components/ContactFilterPanel';
import { useT } from '@/lib/i18n';
import { inputCls } from '@/lib/ui';
import { fieldValue, sansJson } from '@/lib/fields';
import { ContactDetail, OPT_IN_LABEL } from '@/components/ContactDetail';
import { Bouton } from '@/components/Bouton';
import { TitrePage } from '@/components/TitrePage';
import { BandeauPackContacts } from '@/components/BandeauPackContacts';
import { Icone } from '@/components/Icone';
import { Modale } from '@/components/Modale';
import { VoileMenu } from '@/components/Flottant';
import { Squelette } from '@/components/Squelette';
import { ApiError, erreurDeChargement } from '@/lib/http';
import { avisStopsGardes, quiLeveUnStop } from '@/lib/stops-gardes';
import { colonnesExportables } from '@/lib/partage/export-contacts';
import { downloadCsv, toCsv } from '@/lib/csv';

/** Le nombre de contacts par page : 20 par défaut, 50 ou 100 au plus (demande de Julien, 2026-11-24). */
const TAILLES_PAGE = [20, 50, 100] as const;
type TaillePage = (typeof TAILLES_PAGE)[number];

export default function ContactsPage() {
  return <AppShell active="contacts">{(session) => <ContactsInner session={session} />}</AppShell>;
}

function ContactsInner({ session }: { session: Session }) {
  const t = useT();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'import'>('list');
  const [detail, setDetail] = useState<Contact | null>(null);
  const [userFields, setUserFields] = useState<UserFieldDef[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);

  // Filtres (mini-CRM). Objet ContactFilters édité par le panneau. La sérialisation vit dans web/lib/contact-filters.
  const [filters, setFilters] = useState<ContactFilters>({});
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  // Retour d'action positif (ajout d'un contact) : distinct de `error`, qui est rouge.
  const [info, setInfo] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const active = useMemo(() => filtersActive(filters), [filters]);

  // La politique de remise à zéro au changement de filtres appartient à cet écran.
  const [selection, setSelection] = useState(selectionVide);
  // Action en masse ouverte (modale). null = fermée.
  const [action, setAction] = useState<ActionCrm | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Menu « Rajouter des contacts » : les deux façons d'en ajouter tiennent derrière un seul bouton. */
  const [ajoutMenuOuvert, setAjoutMenuOuvert] = useState(false);

  // Une page à la fois, les plus récents d'abord (le serveur trie par date de création décroissante).
  const [taillePage, setTaillePage] = useState<TaillePage>(20);
  const [page, setPage] = useState(0);
  // Garde anti-course : chaque `load` prend un numéro de séquence ; une réponse périmée (filtre changé entre
  // temps, ou GET rejoué après un 5xx transitoire) est ignorée. Sans ça, une réponse lente d'un filtre ANCIEN
  // pourrait écraser la liste + le total courants, et fausser le compteur montré dans la confirmation de suppression.
  const reqSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    setError(null);
    const offset = page * taillePage;
    try {
      const [lignes, compte] = filtersActive(filters)
        ? await queryContacts(session.tenantId, filters, { limit: taillePage, offset }).then((r) => [r.contacts, r.total] as const)
        // Sans filtre, la liste ne rend pas de total : le compteur le donne, au mieux (un échec ne vide pas la liste).
        : await Promise.all([
          listContacts(session.tenantId, { limit: taillePage, offset }).then((r) => r.contacts),
          countContacts(session.tenantId, {}).then((r) => r.total, () => undefined),
        ]);
      if (seq !== reqSeq.current) return;
      // Une page vidée (sa dernière fiche supprimée) : retour à la dernière page qui a des contacts.
      if (lignes.length === 0 && page > 0) {
        setPage(typeof compte === 'number' ? Math.max(0, Math.ceil(compte / taillePage) - 1) : page - 1);
        return;
      }
      setContacts(lignes);
      // Total inconnu et page pleine : on ne sait pas combien il y en a (pas de « tout sélectionner » sûr).
      setTotal(typeof compte === 'number' ? compte : lignes.length < taillePage ? offset + lignes.length : null);
    } catch (err) {
      if (seq !== reqSeq.current) return;
      setError(erreurDeChargement(err, t));
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [session.tenantId, filters, page, taillePage]);

  // Debounce sur les filtres (350 ms) : évite un fetch par frappe.
  useEffect(() => {
    setLoading(true);
    const id = setTimeout(() => { void load(); }, 350);
    return () => clearTimeout(id);
  }, [load]);

  // Changement de filtres -> la sélection précédente n'a plus de sens (jeu de résultats différent) : reset, et retour
  // à la première page. Changer de page garde la sélection : elle porte des identifiants, pas des lignes affichées.
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);
  useEffect(() => { setSelection(selectionVide()); setPage(0); }, [filtersKey]);

  // Définitions user fields + tags existants (fiche + filtres + actions) : chargés une fois.
  useEffect(() => {
    listUserFields(session.tenantId).then(({ fields }) => setUserFields(fields)).catch(() => setUserFields([]));
    listTags(session.tenantId).then(({ tags }) => setTagSuggestions(tags.map((t) => t.tag))).catch(() => setTagSuggestions([]));
  }, [session.tenantId]);

  // Reflète une modif de fiche dans la liste ET la modale, sans recharger toute la liste.
  function onContactUpdated(updated: Contact) {
    setDetail(updated);
    setContacts((list) => list.map((c) => (c.id === updated.id ? updated : c)));
  }
  function onFieldCreated(def: UserFieldDef) {
    setUserFields((defs) => (defs.some((d) => d.key === def.key) ? defs : [...defs, def]));
  }

  // ---- Sélection ----
  const loadedIds = useMemo(() => contacts.map((c) => c.id), [contacts]);
  const isRowChecked = (id: string) => estRetenu(selection, id);
  const selectedCount = nbRetenus(selection, total ?? loadedIds.length);
  const allLoadedChecked = loadedIds.length > 0 && loadedIds.every((id) => isRowChecked(id));
  const moreThanLoaded = total != null && total > loadedIds.length;

  function toggleRow(id: string) { setSelection((current) => basculerContact(current, id)); }
  function toggleHeader() { setSelection((current) => basculerLignesAffichees(current, loadedIds)); }
  function selectAllMatching() { setSelection(selectionTout()); }
  function clearSelection() { setSelection(selectionVide()); }

  // Cible d'action : par ids cochés, OU par filtres + exclusions (jamais un payload massif d'UUID).
  const currentTarget = () => cibleContacts(selection, filters);

  /** `avis` : ce que l'action a gardé en l'état et que l'opérateur doit savoir (des fiches restées en STOP). */
  async function onActionDone(affected: number, avis: string | null) {
    setAction(null);
    setMenuOpen(false);
    clearSelection();
    if (avis) setInfo(avis);
    await load();
    // Rafraîchit aussi les suggestions de tags (un add_tag a pu créer un nouveau tag).
    listTags(session.tenantId).then(({ tags }) => setTagSuggestions(tags.map((tg) => tg.tag))).catch(() => {});
    void affected;
  }

  if (mode === 'import') {
    return (
      <div className="mx-auto max-w-formulaire">
        <button onClick={() => setMode('list')} className="mb-4 text-sm text-brand-600 hover:underline">
          ← {t('Retour aux contacts', 'Back to contacts')}
        </button>
        <CsvImport tenantId={session.tenantId} onImported={() => { void load(); }} />
      </div>
    );
  }

  const countLabel = total != null ? String(total) : `${page * taillePage + contacts.length}+`;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <TitrePage className="tabular-nums">{t('Contacts', 'Contacts')} ({countLabel})</TitrePage>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFilters((s) => !s)}
            className={`rounded-controle border px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${active ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-500 hover:bg-ink-50'}`}
            data-testid="contacts-toggle-filters"
          >
            {t('Filtres', 'Filters')}{active ? ' •' : ''}
          </button>
          <button onClick={() => void load()} className="text-xs text-brand-600 hover:underline">{t('Rafraîchir', 'Refresh')}</button>
          {/* UN seul geste pour ajouter des contacts, et le choix de la façon ensuite. Les deux boutons côte à
              côte donnaient deux actions de même poids, alors qu'on cherche d'abord « en ajouter ». */}
          <div className="relative">
            <Bouton
              onClick={() => setAjoutMenuOuvert((o) => !o)}
              data-testid="contacts-ajouter-menu"
              aria-haspopup="menu"
              aria-expanded={ajoutMenuOuvert}
            >
              <Icone nom="ajouter" />{t('Rajouter des contacts', 'Add contacts')}
            </Bouton>
            {ajoutMenuOuvert && (
              <>
                <VoileMenu z="z-10" onClose={() => setAjoutMenuOuvert(false)} />
                <div role="menu" className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-controle border border-ink-200 bg-white py-1 text-sm shadow-mm-md">
                  {/* Ajout à l'unité : jusqu'ici il fallait fabriquer un fichier CSV pour un seul numéro. */}
                  <button
                    onClick={() => { setAjoutMenuOuvert(false); setAjoutOuvert(true); }}
                    data-testid="contact-ajouter"
                    className="block w-full px-4 py-2 text-left hover:bg-ink-50"
                  >
                    {t('Ajouter un contact', 'Add a contact')}
                  </button>
                  <button
                    onClick={() => { setAjoutMenuOuvert(false); setMode('import'); }}
                    data-testid="contact-importer-csv"
                    className="block w-full px-4 py-2 text-left hover:bg-ink-50"
                  >
                    {t('Importer un CSV', 'Import a CSV')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Un Pro à 80 % de sa limite ou plus : le pack de 1 000 contacts, à un clic (2026-11-25). */}
      <BandeauPackContacts tenantId={session.tenantId} />

      {info && (
        <p className="mb-4 flex items-center justify-between gap-3 rounded-controle bg-succes-50 px-3 py-2 text-sm text-succes-700" data-testid="contact-info">
          <span>{info}</span>
          <button onClick={() => setInfo(null)} className="text-xs text-succes-700 hover:underline">{t('Fermer', 'Close')}</button>
        </p>
      )}

      {ajoutOuvert && (
        <AjoutContactModal
          tenantId={session.tenantId}
          tagSuggestions={tagSuggestions}
          onClose={() => setAjoutOuvert(false)}
          onDone={(message) => {
            setAjoutOuvert(false);
            setInfo(message);
            void load();
            listTags(session.tenantId).then(({ tags }) => setTagSuggestions(tags.map((tg) => tg.tag))).catch(() => {});
          }}
        />
      )}

      {showFilters && (
        <ContactFilterPanel
          tenantId={session.tenantId}
          filters={filters}
          onChange={setFilters}
          userFields={userFields}
          tagSuggestions={tagSuggestions}
          onClear={() => setFilters({})}
          lignes={contacts}
        />
      )}

      {/* Barre de sélection + action : apparaît dès qu'un contact est coché. */}
      {selectedCount > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-carte border border-brand-200 bg-brand-50/50 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-3 text-sm text-ink-900">
            <span className="font-medium">{t(`${selectedCount} sélectionné(s)`, `${selectedCount} selected`)}</span>
            {!selection.toutFiltre && moreThanLoaded && allLoadedChecked && (
              <button onClick={selectAllMatching} className="text-brand-600 hover:underline" data-testid="contacts-select-all-matching">
                {active
                  ? t(`Sélectionner les ${total} contacts correspondants`, `Select all ${total} matching contacts`)
                  : t(`Sélectionner les ${total} contacts de l’espace`, `Select all ${total} contacts in the workspace`)}
              </button>
            )}
            <button onClick={clearSelection} className="text-ink-500 hover:underline">{t('Tout désélectionner', 'Clear selection')}</button>
          </div>
          <div className="relative">
            <Bouton
              onClick={() => setMenuOpen((o) => !o)}
              data-testid="contacts-action"
            >
              {t('Action', 'Action')}<Icone nom="deplier" taille="petite" />
            </Bouton>
            {menuOpen && (
              <>
                <VoileMenu z="z-10" onClose={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-controle border border-ink-200 bg-white py-1 text-sm shadow-mm-md">
                  <button onClick={() => { setAction('add_tag'); setMenuOpen(false); }} className="block w-full px-4 py-2 text-left hover:bg-ink-50">{t('Ajouter une étiquette', 'Add a tag')}</button>
                  <button onClick={() => { setAction('remove_tag'); setMenuOpen(false); }} className="block w-full px-4 py-2 text-left hover:bg-ink-50">{t('Retirer une étiquette', 'Remove a tag')}</button>
                  <button onClick={() => { setAction('set_field'); setMenuOpen(false); }} className="block w-full px-4 py-2 text-left hover:bg-ink-50">{t('Ajouter un champ', 'Set a field')}</button>
                  <div className="my-1 border-t border-ink-100" />
                  <button onClick={() => { setAction('optin'); setMenuOpen(false); }} data-testid="contacts-action-optin" className="block w-full px-4 py-2 text-left hover:bg-ink-50">{t('Passer en opt-in', 'Mark as opted in')}</button>
                  <button onClick={() => { setAction('optout'); setMenuOpen(false); }} data-testid="contacts-action-optout" className="block w-full px-4 py-2 text-left hover:bg-ink-50">{t('Passer en opt-out', 'Mark as opted out')}</button>
                  <div className="my-1 border-t border-ink-100" />
                  <button onClick={() => { setAction('export'); setMenuOpen(false); }} data-testid="contacts-action-export" className="block w-full px-4 py-2 text-left hover:bg-ink-50">{t('Exporter en CSV', 'Export to CSV')}</button>
                  <div className="my-1 border-t border-ink-100" />
                  <button onClick={() => { setAction('delete'); setMenuOpen(false); }} data-testid="contacts-action-delete" className="block w-full px-4 py-2 text-left text-danger-600 hover:bg-danger-50">{t('Supprimer', 'Delete')}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {error && <p className="mb-3 rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
      <ContactsTable
        contacts={contacts}
        loading={loading}
        onSelect={setDetail}
        isRowChecked={isRowChecked}
        onToggleRow={toggleRow}
        onToggleHeader={toggleHeader}
        headerChecked={selection.toutFiltre || allLoadedChecked}
      />
      {!loading && (contacts.length > 0 || page > 0) && (
        <Pagination
          taille={taillePage}
          page={page}
          affiches={contacts.length}
          total={total}
          onTaille={(n) => { setTaillePage(n); setPage(0); }}
          onPage={setPage}
        />
      )}

      {action && (
        <BulkActionModal
          action={action}
          tenantId={session.tenantId}
          target={currentTarget()}
          count={selectedCount}
          userFields={userFields}
          tagSuggestions={tagSuggestions}
          onDone={onActionDone}
          onClose={() => setAction(null)}
        />
      )}

      {detail && (
        <ContactDetail
          contact={detail}
          userFields={userFields}
          tagSuggestions={tagSuggestions}
          tenantId={session.tenantId}
          onUpdated={onContactUpdated}
          onFieldCreated={onFieldCreated}
          onClose={() => setDetail(null)}
        />
      )}
    </section>
  );
}

/**
 * Ajout d'UN contact à la main. Le mini-CRM ne savait créer que par import CSV : il fallait fabriquer un
 * fichier pour un seul numéro. Réutilise la coquille de `BulkActionModal` (overlay, `inputCls`, pied
 * Annuler/Valider) plutôt qu'une seconde mise en page de modale.
 *
 * Le serveur délègue au MÊME upsert que l'import et l'API publique : le numéro est donc normalisé pareil, et un
 * numéro DÉJÀ connu met le contact à jour. On le DIT, au lieu d'annoncer une création qui n'a pas eu lieu.
 */
function AjoutContactModal({ tenantId, tagSuggestions, onDone, onClose }: {
  tenantId: string;
  tagSuggestions: string[];
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [phone, setPhone] = useState('');
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [email, setEmail] = useState('');
  const [bsuid, setBsuid] = useState('');
  // PLUSIEURS tags : la saisie est un tampon, les tags retenus vivent dans `tags`. Un seul champ texte
  // n'en acceptait qu'un, alors que la route accepte déjà une liste et que la fiche sait en afficher plusieurs.
  const [tags, setTags] = useState<string[]>([]);
  const [tagBuffer, setTagBuffer] = useState('');
  // PRÉ-COCHÉE : un numéro saisi à la main vient de la personne. Décochable pour le cas contraire.
  const [optIn, setOptIn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = phone.trim() !== '' && !busy;

  /** Retient le tampon comme tag. Borné et dédupliqué comme côté serveur, pour ne pas promettre autre chose. */
  function ajouterTag(): void {
    const brut = tagBuffer.trim().slice(0, 64);
    if (brut === '') return;
    setTags((prev) => (prev.includes(brut) || prev.length >= 50 ? prev : [...prev, brut]));
    setTagBuffer('');
  }

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      // Un tag laissé dans le tampon sans validation compte quand même : sinon on perd en silence ce que
      // l'opérateur vient de taper, juste parce qu'il n'a pas appuyé sur Entrée.
      const tousLesTags = [...new Set(tagBuffer.trim() !== '' ? [...tags, tagBuffer.trim().slice(0, 64)] : tags)];
      // `prenom` et `email` sont des champs SOCLE : la route les matérialise à la première écriture, il n'y a
      // donc rien à créer avant. Les clés vides sont écartées plutôt qu'envoyées à blanc.
      const champs: Record<string, string> = {};
      if (prenom.trim() !== '') champs.prenom = prenom.trim();
      if (email.trim() !== '') champs.email = email.trim();

      const res = await createContact(tenantId, {
        phone: phone.trim(),
        ...(nom.trim() !== '' ? { name: nom.trim() } : {}),
        ...(Object.keys(champs).length > 0 ? { fields: champs } : {}),
        ...(tousLesTags.length > 0 ? { tags: tousLesTags } : {}),
        ...(bsuid.trim() !== '' ? { bsuid: bsuid.trim() } : {}),
        optIn,
      });
      onDone(res.status === 'created'
        ? t('Contact ajouté.', 'Contact added.')
        : t('Ce numéro était déjà dans la liste : le contact a été mis à jour.', 'This number was already in the list: the contact was updated.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Ajout impossible', 'Could not add'));
      setBusy(false);
    }
  }

  return (
    <Modale
      titre={t('Ajouter un contact', 'Add a contact')}
      sousTitre={t('Le numéro suffit. Le reste peut se compléter ensuite sur la fiche.', 'The number is enough. The rest can be filled in later on the record.')}
      taille="petite"
      onClose={onClose}
    >

      <div className="mt-4 space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-900">
            {t('Téléphone', 'Phone')} <span className="text-danger-500">*</span>
          </label>
          <input
            autoFocus value={phone} onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) void submit(); }}
            placeholder="+33 6 12 34 56 78" data-testid="ajout-telephone" className={inputCls}
          />
          <p className="mt-1 text-xs text-ink-500">{t('Format libre : le numéro est normalisé comme à l’import.', 'Free format: the number is normalized as on import.')}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-900">{t('Prénom', 'First name')}</label>
            <input value={prenom} onChange={(e) => setPrenom(e.target.value)} data-testid="ajout-prenom" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-900">{t('Nom', 'Name')}</label>
            <input value={nom} onChange={(e) => setNom(e.target.value)} data-testid="ajout-nom" className={inputCls} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-900">{t('E-mail (optionnel)', 'Email (optional)')}</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="ajout-email" className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-900">{t('Étiquettes (optionnel)', 'Tags (optional)')}</label>
          {tags.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5" data-testid="ajout-tags-retenus">
              {tags.map((tg) => (
                <span key={tg} className="inline-flex items-center gap-1 rounded-controle bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                  {tg}
                  <button type="button" onClick={() => setTags((prev) => prev.filter((x) => x !== tg))} aria-label={t('Retirer', 'Remove')} className="text-brand-400 transition-colors duration-150 hover:text-danger"><Icone nom="fermer" taille="petite" /></button>
                </span>
              ))}
            </div>
          )}
          {/* Entrée AJOUTE le tag au lieu de valider le formulaire : sinon saisir un 2e tag envoyait la fiche. */}
          <div className="flex gap-2">
            <input
              list="ajout-tag-suggestions" value={tagBuffer} onChange={(e) => setTagBuffer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ajouterTag(); } }}
              placeholder={t('Une étiquette, puis Entrée', 'A tag, then Enter')} data-testid="ajout-tag" className={inputCls}
            />
            <Bouton variante="secondaire" type="button" onClick={ajouterTag} disabled={tagBuffer.trim() === ''} data-testid="ajout-tag-valider"
              className="shrink-0">
              {t('Ajouter', 'Add')}
            </Bouton>
          </div>
          <datalist id="ajout-tag-suggestions">{tagSuggestions.map((tg) => <option key={tg} value={tg} />)}</datalist>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-900">{t('Compte WhatsApp / BSUID (optionnel)', 'WhatsApp account / BSUID (optional)')}</label>
          <input value={bsuid} onChange={(e) => setBsuid(e.target.value)} data-testid="ajout-bsuid" className={`${inputCls} font-mono`} />
          <p className="mt-1 text-xs text-ink-500">
            {t("Identifiant WhatsApp d’un client qui n’a pas partagé son numéro. À ne renseigner que si vous l’avez.", "WhatsApp identifier for a customer who hasn't shared their number. Only fill this in if you have it.")}
          </p>
        </div>
        {/* Pré-cochée : voir le commentaire de `optIn`. Un contact saisi à la main sans opt-in serait ignoré
            par toutes les campagnes, sans que rien ne l'annonce au moment de la saisie. */}
        <label className="flex items-start gap-2 text-sm text-ink-900">
          <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} data-testid="ajout-optin" className="mt-0.5 h-4 w-4" />
          <span>{t('Ce contact a donné son accord pour recevoir des messages marketing', 'This contact agreed to receive marketing messages')}</span>
        </label>
        {error && <p className="rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} disabled={busy} className="rounded-controle px-3 py-2 text-sm text-ink-500 hover:text-ink-900 disabled:opacity-50">{t('Annuler', 'Cancel')}</button>
        <Bouton
          onClick={() => void submit()} disabled={!canSubmit} data-testid="ajout-valider"
        >
          {busy ? t('Ajout…', 'Adding…') : t('Ajouter', 'Add')}
        </Bouton>
      </div>
    </Modale>
  );
}

/**
 * Actions en masse du mini-CRM, telles que l'écran les propose.
 *
 * Volontairement distinctes des actions de l'API : le consentement s'expose ici en DEUX entrées de menu
 * (« Passer en opt-in » / « Passer en opt-out ») là où le serveur n'a qu'une action portant une valeur.
 * Faire choisir la valeur dans un menu déroulant aurait ajouté un clic pour rien.
 */
type ActionCrm = 'add_tag' | 'remove_tag' | 'set_field' | 'optin' | 'optout' | 'export' | 'delete';

/** Modale d'une action en masse : formulaire adapté (tag / champ / consentement / suppression), appelle l'API
 *  avec la cible calculée, puis onDone(affected).
 *
 *  UNE SEULE destruction. Il en a existé deux, une douce qui gardait la conversation et une définitive ;
 *  personne ne veut supprimer un contact à moitié, et la douce laissait le fil dans l'Inbox après coup.
 *  Supprimer efface donc pour de vrai, et exige de taper le mot : le serveur le demande déjà, mais c'est le
 *  client qui l'envoie, donc cette garde-là ne protège que d'une erreur d'API. La saisie est la seule qui
 *  protège l'opérateur, et c'est la seule erreur qui arrive vraiment ici. */
function BulkActionModal({ action, tenantId, target, count, userFields, tagSuggestions, onDone, onClose }: {
  action: ActionCrm;
  tenantId: string;
  target: BulkTarget;
  count: number;
  userFields: UserFieldDef[];
  tagSuggestions: string[];
  onDone: (affected: number, avis: string | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [tag, setTag] = useState('');
  const [fieldKey, setFieldKey] = useState(sansJson(userFields).find((d) => d.key !== 'email')?.key ?? sansJson(userFields)[0]?.key ?? '');
  const [fieldVal, setFieldVal] = useState('');
  const [confirmation, setConfirmation] = useState('');
  // L'export : chaque colonne se coche une à une, aucune ne l'est d'avance (rien ne sort sans avoir été choisi).
  const colonnes = useMemo(() => colonnesExportables(userFields), [userFields]);
  const [cochees, setCochees] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titles: Record<ActionCrm, string> = {
    add_tag: t('Ajouter une étiquette', 'Add a tag'),
    remove_tag: t('Retirer une étiquette', 'Remove a tag'),
    set_field: t('Ajouter un champ', 'Set a field'),
    optin: t('Passer en opt-in', 'Mark as opted in'),
    optout: t('Passer en opt-out', 'Mark as opted out'),
    export: t('Exporter en CSV', 'Export to CSV'),
    delete: t('Supprimer les contacts', 'Delete contacts'),
  };

  const canSubmit = action === 'delete'
    ? confirmation.trim().toUpperCase() === 'SUPPRIMER'
    : action === 'optin' || action === 'optout'
      ? true
      : action === 'export'
        ? cochees.size > 0
        : action === 'set_field'
          ? fieldKey !== '' && fieldVal.trim() !== ''
          : tag.trim() !== '';

  function basculerColonne(cle: string): void {
    setCochees((avant) => {
      const apres = new Set(avant);
      if (apres.has(cle)) apres.delete(cle); else apres.add(cle);
      return apres;
    });
  }

  /** Le fichier se construit ici : les en-têtes dans la langue de l'écran, l'opt-in en clair comme dans la liste. */
  async function exporter(): Promise<number> {
    const choisies = colonnes.filter((c) => cochees.has(c.cle));
    const res = await exportContacts(tenantId, target, choisies.map((c) => c.cle));
    const libelles = new Map(choisies.map((c) => [c.cle, t(...c.libelle)]));
    const lignes = res.lignes.map((l) => l.map((v, i) => {
      if (res.colonnes[i] !== 'opt_in' || v === null) return v;
      const badge = OPT_IN_LABEL[v];
      return badge ? t(...badge.text) : v;
    }));
    const jour = new Date().toISOString().slice(0, 10);
    downloadCsv(`contacts-${jour}.csv`, toCsv(res.colonnes.map((c) => libelles.get(c) ?? c), lignes));
    return res.lignes.length;
  }

  async function submit() {
    if (busy) return; // garde de ré-entrance : un double Entrée (inputs non désactivés) ne double pas l'appel
    setBusy(true);
    setError(null);
    try {
      let affected: number;
      let avis: string | null = null;
      if (action === 'delete') {
        // `purges` = le nombre de PERSONNES supprimées, c'est ce que l'opérateur a demandé ; pas le nombre de
        // messages détruits au passage, qui serait un chiffre spectaculaire et sans rapport avec sa décision.
        affected = (await deleteContacts(tenantId, target)).purges;
      } else if (action === 'export') {
        affected = await exporter();
        avis = t(`${affected} contact(s) exporté(s).`, `${affected} contact(s) exported.`);
      } else {
        const act: BulkAction = action === 'set_field'
          ? { type: 'set_field', key: fieldKey, value: fieldVal.trim() }
          : action === 'optin' || action === 'optout'
            ? { type: 'set_optin', value: action === 'optin' ? 'opted_in' : 'opted_out' }
            : { type: action, tags: [tag.trim()] };
        const r = await bulkContactAction(tenantId, target, act);
        affected = r.affected;
        avis = avisStopsGardes(r, t);
      }
      onDone(affected, avis);
    } catch (err) {
      // Un 404 sur l'export : la console est publiée avant l'API qui porte sa route (déploiement en attente).
      setError(action === 'export' && err instanceof ApiError && err.status === 404
        ? t('L’export n’est pas encore disponible : réessayez dans quelques minutes.', 'Export is not available yet: try again in a few minutes.')
        : err instanceof Error ? err.message : t('Action impossible', 'Action failed'));
      setBusy(false);
    }
  }

  return (
    <Modale
      titre={titles[action]}
      sousTitre={t(`${count} contact(s) concerné(s).`, `${count} contact(s) affected.`)}
      taille="petite"
      onClose={onClose}
    >

      <div className="mt-4 space-y-3">
        {(action === 'add_tag' || action === 'remove_tag') && (
          <>
            <input list="bulk-tag-suggestions" autoFocus value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) void submit(); }} placeholder={t('Nom de l’étiquette', 'Tag name')} className={inputCls} />
            <datalist id="bulk-tag-suggestions">{tagSuggestions.map((tg) => <option key={tg} value={tg} />)}</datalist>
          </>
        )}
        {action === 'set_field' && (
          <div className="flex flex-col gap-2">
            <select value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} className={`${inputCls} bg-white`}>
              {sansJson(userFields).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
            <input autoFocus value={fieldVal} onChange={(e) => setFieldVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) void submit(); }} placeholder={t('Valeur à poser', 'Value to set')} className={inputCls} />
            <p className="text-xs text-ink-500">{t('La valeur écrase le champ sur tous les contacts sélectionnés.', 'The value overwrites the field on all selected contacts.')}</p>
          </div>
        )}
        {action === 'optin' && (
          <p className="rounded-controle bg-succes-50 px-3 py-2 text-sm text-succes-800">
            {t(`Les ${count} contact(s) deviennent destinataires de campagne. À n’utiliser que si vous détenez une preuve de leur consentement. Ceux qui ont répondu STOP le restent : `, `The ${count} contact(s) become eligible for campaigns. Only use this if you hold proof of their consent. Those who replied STOP stay unsubscribed: `) + quiLeveUnStop(t)}
          </p>
        )}
        {action === 'optout' && (
          <p className="rounded-controle bg-alerte-50 px-3 py-2 text-sm text-alerte-800">
            {t(`Les ${count} contact(s) seront exclus de toute campagne, y compris de celles déjà programmées. Leur fiche et leur historique restent intacts.`, `The ${count} contact(s) will be excluded from every campaign, including already scheduled ones. Their record and history stay intact.`)}
          </p>
        )}
        {action === 'export' && (
          <>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-ink-500">{t('Cochez chaque colonne à extraire.', 'Tick each column to extract.')}</span>
              <button
                type="button"
                onClick={() => setCochees(cochees.size === colonnes.length ? new Set() : new Set(colonnes.map((c) => c.cle)))}
                data-testid="export-tout"
                className="shrink-0 text-brand-600 hover:underline"
              >
                {cochees.size === colonnes.length ? t('Tout décocher', 'Untick all') : t('Tout cocher', 'Tick all')}
              </button>
            </div>
            <ul className="max-h-72 divide-y divide-ink-100 overflow-y-auto rounded-controle border border-ink-200" data-testid="export-colonnes">
              {colonnes.map((c) => (
                <li key={c.cle}>
                  <label className="flex items-center gap-2 px-3 py-2 text-sm text-ink-900 hover:bg-ink-50">
                    <input
                      type="checkbox"
                      checked={cochees.has(c.cle)}
                      onChange={() => basculerColonne(c.cle)}
                      data-testid={`export-colonne-${c.cle}`}
                      className="h-4 w-4 rounded-controle border-ink-300 text-brand-600 focus:ring-brand-400"
                    />
                    {t(...c.libelle)}
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-500">
              {t('Les étiquettes et les données venues de Shopify ou de HubSpot ne s’exportent pas.', 'Tags and data from Shopify or HubSpot are not exported.')}
            </p>
          </>
        )}
        {action === 'delete' && (
          <>
            <p className="rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700">
              {t(`Irréversible. Pour les ${count} contact(s) : la fiche, la conversation dans l’Inbox, ses messages et son analyse sont détruits. Les compteurs de campagne restent justes, mais plus personne n’est reconnaissable. Un contact désabonné (STOP) le reste s’il revient : une empreinte de son numéro, illisible sans notre clé, est gardée trois ans après son STOP.`, `Irreversible. For the ${count} contact(s): the record, the Inbox conversation, its messages and its analysis are destroyed. Campaign counters stay accurate, but nobody is identifiable any more. An opted-out contact (STOP) stays opted out if they come back: a fingerprint of their number, unreadable without our key, is kept for three years after their STOP.`)}
            </p>
            <label className="block text-sm text-ink-500">
              {t('Tapez SUPPRIMER pour confirmer', 'Type SUPPRIMER to confirm')}
              <input autoFocus value={confirmation} onChange={(e) => setConfirmation(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) void submit(); }} placeholder="SUPPRIMER" data-testid="suppression-confirm" className={`${inputCls} mt-1`} />
            </label>
          </>
        )}
        {error && <p className="rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} disabled={busy} className="rounded-controle px-3 py-2 text-sm text-ink-500 hover:text-ink-900 disabled:opacity-50">{t('Annuler', 'Cancel')}</button>
        <button
          onClick={() => void submit()}
          disabled={busy || !canSubmit}
          className={`rounded-controle px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 ${action === 'delete' ? 'bg-danger-600 hover:bg-danger-700' : 'bg-brand-600 hover:bg-brand-700'}`}
          data-testid="bulk-submit"
        >
          {busy ? t('…', '…') : action === 'delete' ? t('Supprimer', 'Delete') : action === 'export' ? t('Exporter', 'Export') : t('Appliquer', 'Apply')}
        </button>
      </div>
    </Modale>
  );
}


/**
 * Le pied de la liste : combien par page (20, 50 ou 100) et les pages précédente et suivante. Total inconnu (compteur
 * en échec) : « Suivant » reste possible tant que la page est pleine.
 */
function Pagination({ taille, page, affiches, total, onTaille, onPage }: {
  taille: TaillePage;
  page: number;
  affiches: number;
  total: number | null;
  onTaille: (n: TaillePage) => void;
  onPage: (p: number) => void;
}) {
  const t = useT();
  const debut = page * taille;
  const aSuivre = total != null ? debut + affiches < total : affiches === taille;
  const bouton = 'rounded-controle border border-ink-200 px-3 py-1.5 text-sm text-ink-900 transition-colors duration-150 hover:bg-ink-50 disabled:opacity-50 disabled:hover:bg-transparent';
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-500" data-testid="contacts-pagination">
      <label className="flex items-center gap-2">
        {t('Afficher', 'Show')}
        <select
          value={taille}
          onChange={(e) => onTaille(Number(e.target.value) as TaillePage)}
          data-testid="contacts-taille-page"
          className="rounded-controle border border-ink-200 bg-white px-2 py-1 text-sm text-ink-900"
        >
          {TAILLES_PAGE.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {t('contacts par page', 'contacts per page')}
      </label>
      <div className="flex items-center gap-3">
        <span className="tabular-nums">
          {affiches === 0
            ? t('Aucun contact sur cette page', 'No contacts on this page')
            : t(`${debut + 1} à ${debut + affiches}`, `${debut + 1} to ${debut + affiches}`) + (total != null ? t(` sur ${total}`, ` of ${total}`) : '')}
        </span>
        <button onClick={() => onPage(page - 1)} disabled={page === 0} data-testid="contacts-page-precedente" className={bouton}>
          {t('Précédent', 'Previous')}
        </button>
        <button onClick={() => onPage(page + 1)} disabled={!aSuivre} data-testid="contacts-page-suivante" className={bouton}>
          {t('Suivant', 'Next')}
        </button>
      </div>
    </div>
  );
}

/** WhatsApp ID (wa_id) : la clé de routage WhatsApp = les chiffres du numéro sans « + », sinon le BSUID. */
function waIdOf(c: Contact): string | null {
  if (c.phoneE164) return c.phoneE164.replace(/[^0-9]/g, '');
  return c.bsuid ?? null;
}


function ContactsTable({ contacts, loading, onSelect, isRowChecked, onToggleRow, onToggleHeader, headerChecked }: {
  contacts: Contact[];
  loading: boolean;
  onSelect: (c: Contact) => void;
  isRowChecked: (id: string) => boolean;
  onToggleRow: (id: string) => void;
  onToggleHeader: () => void;
  headerChecked: boolean;
}) {
  const t = useT();
  if (loading) return <Squelette forme="lignes" />;
  if (contacts.length === 0)
    return (
      <div className="px-4 py-10 text-center text-sm text-ink-500">
        {t('Aucun contact pour l’instant. Cliquez sur « Rajouter des contacts » pour commencer.', 'No contacts yet. Click "Add contacts" to get started.')}
      </div>
    );
  return (
    <div className="overflow-x-auto rounded-carte border border-ink-200 bg-white">
      <table className="w-full min-w-[920px] text-sm">
        <thead className="bg-ink-50 text-left text-xs text-ink-500">
          <tr>
            <th className="w-10 px-4 py-2.5">
              <input type="checkbox" checked={headerChecked} onChange={onToggleHeader} aria-label={t('Tout sélectionner', 'Select all')} data-testid="contacts-select-all" className="h-4 w-4 rounded-controle border-ink-300 text-brand-600 focus:ring-brand-400" />
            </th>
            <th className="px-4 py-2.5 font-medium">{t('Nom', 'Name')}</th>
            <th className="px-4 py-2.5 font-medium">{t('Prénom', 'First name')}</th>
            <th className="px-4 py-2.5 font-medium">{t('Téléphone', 'Phone')}</th>
            <th className="px-4 py-2.5 font-medium">BSUID</th>
            <th className="px-4 py-2.5 font-medium">WhatsApp ID</th>
            <th className="px-4 py-2.5 font-medium">Email</th>
            <th className="px-4 py-2.5 font-medium">Opt-in</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {contacts.map((c) => {
            const badge = OPT_IN_LABEL[c.optInStatus] ?? OPT_IN_LABEL.unknown!;
            const waId = waIdOf(c);
            const checked = isRowChecked(c.id);
            return (
              <tr key={c.id} className={`transition-colors duration-150 hover:bg-brand-50 ${checked ? 'bg-brand-50/60' : ''}`}>
                <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={checked} onChange={() => onToggleRow(c.id)} aria-label={t('Sélectionner', 'Select')} className="h-4 w-4 rounded-controle border-ink-300 text-brand-600 focus:ring-brand-400" />
                </td>
                <td className="cursor-pointer px-4 py-2.5 font-medium text-ink-900" onClick={() => onSelect(c)}>{c.profileName ?? <span className="font-normal text-ink-500">-</span>}</td>
                <td className="cursor-pointer px-4 py-2.5" onClick={() => onSelect(c)}>{fieldValue(c, 'prenom') ?? <span className="text-ink-500">-</span>}</td>
                <td className="cursor-pointer px-4 py-2.5 font-mono text-xs" onClick={() => onSelect(c)}>{c.phoneE164 ?? <span className="text-ink-500">-</span>}</td>
                <td className="cursor-pointer px-4 py-2.5 font-mono text-xs" onClick={() => onSelect(c)}>
                  {c.bsuid
                    ? <span className="inline-flex max-w-[160px] items-center gap-1"><span className="truncate" title={c.bsuid}>{c.bsuid}</span></span>
                    : <span className="text-ink-500">-</span>}
                </td>
                <td className="cursor-pointer px-4 py-2.5 font-mono text-xs" onClick={() => onSelect(c)}>
                  {waId
                    ? <span className="inline-flex max-w-[160px] items-center gap-1"><span className="truncate" title={waId}>{waId}</span></span>
                    : <span className="text-ink-500">-</span>}
                </td>
                <td className="cursor-pointer px-4 py-2.5 text-xs text-ink-900" onClick={() => onSelect(c)}>{fieldValue(c, 'email') ?? <span className="text-ink-500">-</span>}</td>
                <td className="cursor-pointer px-4 py-2.5" onClick={() => onSelect(c)}>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>{t(...badge.text)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
