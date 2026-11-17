---
description: The Action block of a WhatsApp scenario: add or remove tags, fill in or clear fields, change the contact's consent.
slug: action-block
traduit_de: e201ba
---
# The Action block

Acts on the contact's record without sending them anything: their tags, their fields, their consent.

**1. Choose the action.** Click the block: its panel opens on the right, with the "Action" list at the top.

- Six actions: add a tag, remove tags, update a field, clear fields, mark as opted in, mark as opted out.
- "Add an action" chains up to 10 in the same block, played in the order shown.
- Changing the action clears its settings. An incomplete action (empty tag, no field chosen) does nothing.

**2. Add or remove tags.** Write the tag; to remove several, press Enter after each one.

- 64 characters at most. Spaces at the start and at the end are removed.
- A new tag goes into Content > Library > Tags as soon as you leave the box. Removing it from a contact does not delete
  it from the library.
- A tag the contact did not have starts your automations "a tag is added to a contact", except in a campaign.

**3. Fill in or clear a field.** "Update a field": the field, then its value, fixed, "now" or "contact's last
message".

- A fixed value is written as it is: no variable is replaced in it, and its type is not checked.
- "now" sets the date and time, in your workspace's time zone.
- "contact's last message" copies their last written message; if they have not written anything yet, the field is
  emptied.
- A field that comes from HubSpot is written to HubSpot first: if HubSpot refuses, the record does not change and the
  Error log says why.
- "Clear fields" also accepts JSON fields; "Update a field" does not.

**4. Change the consent.** "Mark as opted in" or "Mark as opted out".

- Opted in: the contact receives your marketing campaigns. Place it after a step where they gave their consent: it
  also lifts a STOP the contact had sent.
- Opted out: the contact leaves all your campaigns, even those already scheduled. It is the action to put behind an
  unsubscribe keyword.

**5. Connect what follows.** The block has only one dot, at the bottom: what follows goes out right away, without
waiting.

- Connected to nothing, the journey stops there.
- A Condition placed after it already sees the tags and fields that were set, but not the consent: it still reads the
  old one.
- The actions apply even to a contact who replied STOP.
