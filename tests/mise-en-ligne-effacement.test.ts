import { describe, it, expect } from 'vitest';
import { accepter, proposer, reprendre } from '../src/mise-en-ligne/mise-en-ligne';
import type { Offre } from '../src/offres/offres';
import { STATUT_REFUS_OFFRE } from '../src/offres/refus';
import { OUTILS, outilsPour, type DepsMcp } from '../src/mcp/outils';
import type { DepsEnvoisAuOui } from '../src/mise-en-ligne/envois';
import { envoisAuOuiInertes } from './routes-inertes';
import { ADMIN, CSM, T, AUTRE, monter } from './mise-en-ligne-fixtures';

/**
 * L'EFFACEMENT DES MESSAGES D'UNE CONVERSATION AU OUI (lot 1 du CSM virtuel, B10, livraison 2b) : rien ne rattrape un
 * effacement, donc l'outil prépare et un admin clique, comme le bouton « Effacer le contenu » de l'Inbox lui est réservé.
 * Le clic relit que la conversation est DANS l'espace et qu'elle porte les messages annoncés (leur nombre et le plus
 * récent). Le dépôt est un faux dont les méthodes lisent `this`, qui note l'espace visé et lève, comme Postgres, sur un
 * identifiant qui n'est pas un uuid.
 */
const CONV = '44444444-4444-4444-8444-444444444444';
const MOI = { userId: CSM.userId, autorisationId: CSM.autorisationId };
const EFFACER = [{ type: 'effacement_messages' as const, conversation: CONV }];

class FauxInbox {
  readonly effaces: Array<{ tenant: string; conversation: string }> = [];
  /** Les messages de la conversation, du plus ancien au plus récent. */
  ids: string[];
  /** Une coupure, une fois : avant l'effacement (rien n'est effacé), ou après (effacé, mais le résultat n'est pas noté). */
  panne: 'avant' | 'apres' | null = null;
  private suivant = 0;
  constructor(messages: number) {
    this.ids = Array.from({ length: messages }, () => this.neuf());
  }
  private neuf(): string { return `m-${++this.suivant}`; }
  /** Le contact écrit : un message de plus, le plus récent. */
  recevoir(): void { this.ids.push(this.neuf()); }
  get nombre(): number { return this.ids.length; }
  private lire(tenant: string, conversation: string): boolean {
    if (!/^[0-9a-f-]{36}$/.test(conversation)) throw new Error('22P02 : invalid input syntax for type uuid');
    return tenant === T && conversation === CONV;
  }
  async etatDesMessages(tenant: string, conversation: string) {
    return this.lire(tenant, conversation) ? { nombre: this.ids.length, dernier: this.ids.at(-1) ?? null } : null;
  }
  async effacerMessages(tenant: string, conversation: string) {
    if (!this.lire(tenant, conversation)) return null;
    const panne = this.panne;
    this.panne = null;
    if (panne === 'avant') throw new Error('coupure avant l’effacement');
    this.effaces.push({ tenant, conversation });
    const n = this.ids.length;
    this.ids = [];
    if (panne === 'apres') throw new Error('coupure après l’effacement');
    return n;
  }
}

function monterEffacement(messages = 12, offre: Offre = 'pro') {
  const inbox = new FauxInbox(messages);
  const envois: DepsEnvoisAuOui = { ...envoisAuOuiInertes, effacementMessages: inbox };
  return { m: monter({ envois, offre }), inbox };
}

describe('l’effacement des messages d’une conversation au oui (CSM, B10, livraison 2b)', () => {
  it('🔴 préparé sans rien effacer, le bouton dit combien, le récapitulatif dit la fenêtre fermée ; le clic efface, une fois', async () => {
    const { m, inbox } = monterEffacement();
    const r = await proposer(m.deps, T, CSM, EFFACER);
    if (!r.ok) throw new Error(r.erreur);
    expect(r.valeur.libelle).toBe('Effacer 12 messages');
    expect(r.valeur.recapitulatif.join(' ')).toMatch(
      /Les 12 messages de cette conversation sont effacés pour de bon, reçus comme envoyés\. La conversation reste[\s\S]*fenêtre de 24 heures[\s\S]*elle est fermée[\s\S]*ne se rattrape pas/,
    );
    // La page lie la conversation, par son identifiant : l'admin la voit avant de cliquer.
    expect(r.valeur.actions[0]).toMatchObject({ type: 'effacement_messages', nom: 'une conversation', conversation: CONV });
    expect(inbox.effaces).toEqual([]);
    const clic = await accepter(m.deps, T, r.valeur.id, ADMIN);
    if (!clic.ok) throw new Error(clic.erreur);
    expect(clic.valeur).toMatchObject({ etat: 'faite', actions: [{ resultat: { ok: true, etat: 'effacee', messages: 12 } }] });
    expect(inbox.effaces).toEqual([{ tenant: T, conversation: CONV }]);
    // La trace de la route de la console, signée de l'admin qui a cliqué.
    expect(m.audit.filter((a) => a.action === 'conversation.effacee')).toEqual([
      { action: 'conversation.effacee', userId: ADMIN.userId, detail: { messages: 12, via: 'mise_en_ligne' } },
    ]);
    // Un second clic rend le résultat, sans rien refaire.
    await accepter(m.deps, T, r.valeur.id, ADMIN);
    expect(inbox.effaces).toHaveLength(1);
  });

  it('🔴 rien du contact n’est gardé : la conversation, le nombre, l’identifiant du plus récent, un nom générique', async () => {
    const { m } = monterEffacement();
    const r = await proposer(m.deps, T, CSM, EFFACER);
    if (!r.ok) throw new Error(r.erreur);
    const gardee = await m.store.lire(T, r.valeur.id);
    expect(Object.keys(gardee!.actions[0]!).sort()).toEqual(['conversation', 'dernier', 'messages', 'nom', 'type']);
  });

  it('un seul message : le bouton et le récapitulatif le disent au singulier', async () => {
    const { m } = monterEffacement(1);
    const r = await proposer(m.deps, T, CSM, EFFACER);
    if (!r.ok) throw new Error(r.erreur);
    expect(r.valeur.libelle).toBe('Effacer 1 message');
    expect(r.valeur.recapitulatif[0]).toBe('Le seul message de cette conversation est effacé pour de bon. La conversation reste dans l’Inbox, vide.');
  });

  it('🔴 une conversation d’un autre espace, inconnue ou mal formée est introuvable ; une conversation vide n’a rien à effacer', async () => {
    const { m } = monterEffacement();
    expect(await proposer(m.deps, AUTRE, CSM, EFFACER)).toMatchObject({ ok: false, statut: 404 });
    expect(await proposer(m.deps, T, CSM, [{ type: 'effacement_messages', conversation: '55555555-5555-4555-8555-555555555555' }]))
      .toMatchObject({ ok: false, statut: 404 });
    // Mal formée : un refus avant la base, jamais une erreur de Postgres.
    expect(await proposer(m.deps, T, CSM, [{ type: 'effacement_messages', conversation: 'conv-1' }])).toMatchObject({ ok: false, statut: 404 });
    expect(await proposer(monterEffacement(0).m.deps, T, CSM, EFFACER)).toMatchObject({ ok: false, statut: 409 });
  });

  it('🔴 l’Inbox est une fonction de l’offre : refusée en Free à la préparation, et au clic d’un espace redescendu depuis', async () => {
    expect(await proposer(monterEffacement(12, 'base').m.deps, T, CSM, EFFACER)).toMatchObject({ ok: false, statut: STATUT_REFUS_OFFRE });
    const { m, inbox } = monterEffacement();
    const r = await proposer(m.deps, T, CSM, EFFACER);
    if (!r.ok) throw new Error(r.erreur);
    m.offre.valeur = 'base';
    expect(await accepter(m.deps, T, r.valeur.id, ADMIN)).toMatchObject({ ok: false });
    expect(inbox.effaces).toEqual([]);
  });

  it('🔴 le clic relit : un message reçu depuis la préparation, et rien n’est effacé', async () => {
    const { m, inbox } = monterEffacement();
    const r = await proposer(m.deps, T, CSM, EFFACER);
    if (!r.ok) throw new Error(r.erreur);
    inbox.recevoir(); // le contact a réécrit entre-temps
    expect(await accepter(m.deps, T, r.valeur.id, ADMIN)).toMatchObject({ ok: false, statut: 409 });
    expect(inbox.effaces).toEqual([]);
  });

  it('🔴 deux boutons pour la même conversation : le second refuse les messages arrivés après le premier, au même nombre', async () => {
    const { m, inbox } = monterEffacement(2);
    const a = await proposer(m.deps, T, CSM, EFFACER);
    const b = await proposer(m.deps, T, CSM, EFFACER);
    if (!a.ok || !b.ok) throw new Error('préparation refusée');
    await accepter(m.deps, T, a.valeur.id, ADMIN);
    inbox.recevoir();
    inbox.recevoir(); // deux messages neufs : le nombre annoncé par le second bouton, mais pas les mêmes
    expect(await accepter(m.deps, T, b.valeur.id, ADMIN)).toMatchObject({ ok: false, statut: 409 });
    expect(inbox.nombre).toBe(2);
    expect(inbox.effaces).toHaveLength(1);
  });

  it('🔴 une reprise après une coupure relit : un message arrivé entre-temps n’est pas effacé', async () => {
    const { m, inbox } = monterEffacement();
    const r = await proposer(m.deps, T, CSM, EFFACER);
    if (!r.ok) throw new Error(r.erreur);
    inbox.panne = 'avant';
    const coupee = await accepter(m.deps, T, r.valeur.id, ADMIN);
    expect(coupee.ok && coupee.valeur.etat).toBe('interrompue');
    inbox.recevoir();
    const v = await reprendre(m.deps, T, r.valeur.id);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'echouee', actions: [{ resultat: { ok: false, code: 'modifiee' } }] });
    expect(inbox.effaces).toEqual([]);
  });

  it('une reprise relit aussi le nombre : un ancien message parti entre-temps (la conservation), et rien n’est effacé', async () => {
    const { m, inbox } = monterEffacement();
    const r = await proposer(m.deps, T, CSM, EFFACER);
    if (!r.ok) throw new Error(r.erreur);
    inbox.panne = 'avant';
    await accepter(m.deps, T, r.valeur.id, ADMIN);
    inbox.ids.shift(); // la purge de conservation retire le plus ancien ; le plus récent reste le même
    const v = await reprendre(m.deps, T, r.valeur.id);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'echouee', actions: [{ resultat: { ok: false, code: 'modifiee' } }] });
    expect(inbox.effaces).toEqual([]);
  });

  it('🔴 une reprise après une coupure qui suivait l’effacement : des messages neufs, au même nombre, ne sont pas effacés', async () => {
    const { m, inbox } = monterEffacement(1);
    const r = await proposer(m.deps, T, CSM, EFFACER);
    if (!r.ok) throw new Error(r.erreur);
    inbox.panne = 'apres';
    const coupee = await accepter(m.deps, T, r.valeur.id, ADMIN);
    expect(coupee.ok && coupee.valeur.etat).toBe('interrompue');
    inbox.recevoir(); // le contact réécrit : un message, comme annoncé, mais pas celui qui a été montré
    const v = await reprendre(m.deps, T, r.valeur.id);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'echouee', actions: [{ resultat: { ok: false, code: 'modifiee' } }] });
    expect(inbox.effaces).toHaveLength(1);
    expect(inbox.nombre).toBe(1);
  });

  it('une reprise après une coupure qui suivait l’effacement, sans message neuf, dit « déjà effacés » sans rien refaire', async () => {
    const { m, inbox } = monterEffacement();
    const r = await proposer(m.deps, T, CSM, EFFACER);
    if (!r.ok) throw new Error(r.erreur);
    inbox.panne = 'apres';
    const coupee = await accepter(m.deps, T, r.valeur.id, ADMIN);
    expect(coupee.ok && coupee.valeur.etat).toBe('interrompue');
    const v = await reprendre(m.deps, T, r.valeur.id);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'faite', actions: [{ resultat: { ok: true, etat: 'deja_effacee' } }] });
    expect(inbox.effaces).toHaveLength(1);
  });

  it('🔴 une reprise d’un espace redescendu en Free depuis le clic est refusée, et rien n’est effacé', async () => {
    const { m, inbox } = monterEffacement();
    const r = await proposer(m.deps, T, CSM, EFFACER);
    if (!r.ok) throw new Error(r.erreur);
    inbox.panne = 'avant';
    await accepter(m.deps, T, r.valeur.id, ADMIN);
    m.offre.valeur = 'base';
    const v = await reprendre(m.deps, T, r.valeur.id);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'echouee', actions: [{ resultat: { ok: false, code: 'plan_feature_unavailable' } }] });
    expect(inbox.effaces).toEqual([]);
  });

  it('l’outil prépare le bouton, sans rien effacer ; une conversation inconnue ou absente est refusée', async () => {
    const { m, inbox } = monterEffacement();
    const deps = { misesEnLigne: m.deps } as unknown as DepsMcp;
    const outil = OUTILS.find((o) => o.nom === 'erase_conversation_messages')!;
    const r = await outil.executer(deps, T, { conversation_id: CONV }, MOI) as { go_live: { bouton: string }; a_savoir: string };
    expect(r.go_live.bouton).toBe('Effacer 12 messages');
    expect(r.a_savoir).toMatch(/^Rien n’est effacé : un administrateur clique « Effacer 12 messages »/);
    expect(inbox.effaces).toEqual([]);
    await expect(outil.executer(deps, T, { conversation_id: 'conv-1' }, MOI)).rejects.toMatchObject({ code: 'not_found' });
    await expect(outil.executer(deps, T, {}, MOI)).rejects.toMatchObject({ code: 'invalid_args' });
  });

  it('🔴 l’outil est réservé à une personne : une clé d’API ne le voit pas', () => {
    const cle = outilsPour({ scopes: ['mcp:read', 'mcp:write'], personne: null }).map((o) => o.nom);
    expect(cle).not.toContain('erase_conversation_messages');
  });
});
