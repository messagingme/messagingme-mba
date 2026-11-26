/**
 * La poignée qui range un STOP sous la mesure `reply_text` d'un bloc (Julien, 2026-11-26) : le contact a répondu par
 * une demande d'arrêt (`estDemandeArret`, la même règle qui le désabonne). Sans elle, ce refus se comptait dans
 * « A répondu (sans cliquer) », donc comme un engagement. Même famille que la pièce reçue (`SORTIE_FICHIER`) : une
 * poignée sous `reply_text`, que « A répondu (sans cliquer) » (poignée nulle) ne compte plus.
 */
export const MESURE_STOP = 'stop';
