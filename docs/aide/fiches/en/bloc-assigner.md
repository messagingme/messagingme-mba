---
description: The Assign to an agent block of a WhatsApp scenario: stop the journey and hand the conversation to a team member or to the shared pool.
slug: assign-to-an-agent-block
traduit_de: 56f40e
---
# The Assign to an agent block

Stops the journey and hands the conversation to your team, in "To handle": to a chosen member, or to the shared pool.

**1. Choose who.** Click the block, then choose in "Assign to": a team member, or "no one in particular (shared pool)".

- Only active members are offered. A member removed since then receives nothing: the screen warns you.
- "Shared pool" does not remove a member already assigned to the conversation.
- Admins are notified by email when the conversation reaches them on a reply from the contact, never for a campaign,
  when a wait wakes up or after a "Go to".

**2. Connect nothing after it.** The block ends the journey: nothing you connect after it plays.

- The bottom dot, drawn on the canvas, does nothing.
- The blocks placed before it play first, then the conversation goes to the team.
- Alone at the start of a scenario, it prevents launching it as a campaign.
- It cannot follow the "Then, without waiting" output of a quick message: the scenario cannot be published.
