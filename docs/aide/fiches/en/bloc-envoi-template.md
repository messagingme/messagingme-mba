---
description: The Send template block of a WhatsApp scenario: choose the approved template, connect its variables, its buttons and what follows.
slug: send-template-block
traduit_de: f234ca
---
# The Send template block

Sends an approved WhatsApp template: the only message that reaches a contact who has not written to you in the last 24
hours, so the one that opens a campaign.

**1. Choose the template.** Click the block: its panel opens on the right, with the "Template to send" list at the top.

- Only templates approved by WhatsApp are offered. On the canvas, the block shows a thumbnail of it.
- It goes out even in a conversation closed for more than 24 hours, including when a wait wakes up.
- As the first block of a scenario launched as a campaign, it is what the campaign sends: while it is empty, the
  scenario cannot go out as a campaign.
- Two templates with the same name in two languages are not told apart: only one of them goes out.

**2. Connect each variable.** Under "Template variables", each {{1}}, {{2}}… has its list: a contact field, today's
date or a fixed text.

- Each variable first follows the field chosen when the template was written. Your choice only applies to this block;
  the template and its approval by WhatsApp do not change.
- "Use the template fields" cancels your choices.
- A variable connected to nothing has a red border: the block will not go out.
- A contact whose field is empty does not receive the template: during a journey, the conversation goes to your team
  and the Error log says why; when a campaign is launched, it counts as a failure.
- "Today's date" is written DD/MM/YYYY, in Paris time.
- First template of a scenario launched as a campaign: its variables are chosen at the Content step of the campaign,
  which takes over your choices.

**3. Connect each reply button.** Each quick reply of the template becomes a dot on the right of the block: drag an
arrow to the next block.

- Link or form buttons have no dot: they open a page and send nothing back.
- Carousel: each quick reply of each card has its dot, marked C1, C2…
- A red dot is a button connected to nothing. If it is tapped, the contact goes through "Any other reply" if it is
  connected; otherwise, they get nothing and the conversation goes to your team, in "To handle".

**4. Plan for other replies.** The "Any other reply" dot is used when the contact writes instead of tapping a button.

- An emoji reaction to the template counts as another reply.
- Connected to nothing, the journey stops and the conversation goes back to whoever usually answers your customers.

**5. Chain after a template without buttons.** The block has only one dot, at the bottom: connect it to the next block.

- What follows goes out when the contact replies, whatever the reply. Without a reply, the journey waits, with no time
  limit.
- Exception: if Meta's agent answers your customers, what follows goes out right away.
- If your team or Meta's agent took over the conversation, the contact's reply no longer moves the journey forward.
