'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { politiqueTransfertAgent, type ModeTransfertAgent } from '@/lib/api/inbox';

/**
 * QUAND VOTRE ÉQUIPE EST JOIGNABLE, POUR CET AGENT (décision de Julien, 2026-11-26) : le réglage vivait dans
 * « Sécurité » > « IA » pour tout l'espace, alors que c'est le comportement d'un agent. Il se règle sur son outil
 * « Passer la main à un humain » (`agents.transfert_mode`, 0330). Les horaires restent ceux de l'espace.
 *
 * 🔴 IL NE DÉCIDE PAS SI ON TRANSFÈRE, et l'écran le DIT : la conversation arrive dans « À traiter » dans tous les cas.
 * Un agent qui n'a rien choisi suit l'espace (`modeAgent` nul) : la case cochée est alors celle de l'espace, lue ici.
 */
export function TransfertEquipe({ tenantId, modeAgent, busy, onChoisir }: {
  tenantId: string;
  /** Le choix de l'agent ; `null` = l'espace ; `undefined` = une API d'avant 0330, qui ne le rend pas. */
  modeAgent: ModeTransfertAgent | null | undefined;
  busy: boolean;
  onChoisir: (mode: ModeTransfertAgent) => void;
}) {
  const t = useT();
  const [modeEspace, setModeEspace] = useState<ModeTransfertAgent | null>(null);
  useEffect(() => {
    if (modeAgent) return;
    let vivant = true;
    void politiqueTransfertAgent(tenantId).then((r) => { if (vivant) setModeEspace(r.mode); }, () => {});
    return () => { vivant = false; };
  }, [tenantId, modeAgent]);
  // Une API d'avant 0330 ne rend pas le champ : l'écran ne propose rien qu'elle ne saurait enregistrer.
  if (modeAgent === undefined) return null;
  const coche = modeAgent ?? modeEspace;

  const choix: Array<{ valeur: ModeTransfertAgent; titre: string; texte: string }> = [
    {
      valeur: 'always',
      titre: t('À toute heure', 'At any time'),
      texte: t(
        'L’agent annonce qu’un conseiller prend le relais, quelle que soit l’heure. À choisir si quelqu’un répond la nuit et le week-end.',
        'The agent announces that a human is taking over, whatever the time. Choose this if someone answers at night and on weekends.',
      ),
    },
    {
      valeur: 'business_hours',
      titre: t('Seulement aux heures d’ouverture', 'Only during business hours'),
      texte: t(
        'Hors de vos horaires (Paramètres > Général), l’agent n’annonce pas de conseiller : il dit quand votre équipe reprend, en calculant la vraie prochaine ouverture. Un samedi, il annonce lundi, pas demain.',
        'Outside your hours (Settings > General), the agent does not announce a human: it says when your team is back, computing the real next opening. On a Saturday it says Monday, not tomorrow.',
      ),
    },
    {
      valeur: 'never',
      titre: t('Jamais en direct', 'Never live'),
      texte: t(
        'L’agent ne promet ni conseiller ni délai. Il dit simplement que la demande est transmise.',
        'The agent promises neither a human nor a delay. It simply says the request has been passed on.',
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-2" data-testid="transfert-agent">
      <div>
        <p className="text-sm font-medium text-ink-900">{t('Quand votre équipe est joignable', 'When your team is reachable')}</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          {t(
            'Ce réglage ne coupe jamais le transfert : la conversation arrive dans « À traiter » dans tous les cas. Il décide de ce que cet agent a le droit de promettre au contact.',
            'This setting never disables handover: the conversation always lands in “To handle”. It decides what this agent may promise to the contact.',
          )}
        </p>
      </div>
      <div className="divide-y divide-ink-100 rounded-controle border border-ink-100">
        {choix.map((o) => (
          <label key={o.valeur} className="flex cursor-pointer items-start gap-3 px-3 py-2" data-testid={`transfert-agent-${o.valeur}`}>
            <input
              type="radio"
              name="transfert-agent"
              className="mt-1"
              disabled={busy}
              checked={coche === o.valeur}
              // `onClick` et non `onChange` : la case de l'espace, déjà cochée, s'épingle sur l'agent d'un clic.
              onClick={() => { if (o.valeur !== modeAgent) onChoisir(o.valeur); }}
              onChange={() => {}}
            />
            <span className="min-w-0">
              <span className="block text-sm text-ink-900">{o.titre}</span>
              <span className="block text-xs text-ink-500">{o.texte}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
