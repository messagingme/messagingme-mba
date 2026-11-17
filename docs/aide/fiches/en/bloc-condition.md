---
description: The Condition block of a WhatsApp scenario: the conditions, their types, the groups and their outputs, and the traps of empty values.
slug: condition-block
traduit_de: c92379
---
# The Condition block

Routes the contact according to their state: their tags, their fields, their consent, the day or the time.

**1. Add a condition.** Click the block, then "Add a condition" and choose its type: field, latest analysis (when it is
offered), tag, day of week, business hours, time of day, contact info or consent.

- A text or number field, or a language, left empty holds nothing back: the condition is always true. A tag, days or
  countries left empty hold nobody: it is always false.
- "is exactly" respects upper case, "contains" does not. A tag is compared letter for letter, upper case included.
- An empty number field is never compared: neither greater, nor smaller, nor equal.
- Day, time and business hours follow your workspace's time zone.

**2. Combine several conditions.** From two conditions on, choose: "all conditions are true" or "at least one condition
is true".

**3. Read the System fields.** In the list of fields, under "System": the last message received, the detected
language and the country of the dialling code.

- The country comes from the contact's number: without a number, no country holds them. French overseas departments
  have their own dialling code, to tick in addition to France.
- A language never detected counts as empty.
- "Last message received" is the date of their last message, reactions excluded.

**4. Add groups.** "Add a group" creates another branch, with its name and its conditions.

- 10 groups at most.
- The contact follows the first true group, from top to bottom; if none is true, they go to "Otherwise".
- Moving a group up or down changes the order without unhooking the arrows. Removing a group removes its arrow.

**5. Connect each output.** One output per group, with its name, then "Otherwise".

- An output connected to nothing stops the journey, without any warning.
- A contact whose record cannot be read goes to "Otherwise".
