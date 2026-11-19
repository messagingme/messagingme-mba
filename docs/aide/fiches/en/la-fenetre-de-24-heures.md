---
slug: the-24-hour-window
traduit_de: 3f5a77
---
# Why my message does not go out: the 24-hour window

It is the WhatsApp rule that surprises people most, and it explains most refused messages.

**WhatsApp does not let you write freely to just anyone.** You can only send a free-form message to someone who
wrote to you in the last twenty-four hours. After that, the conversation is considered closed, and only an
**approved template** can reopen it.

What it changes, in practice:

- **A campaign** reaches people who have not written to you. Its first message must therefore always be an
  approved template, or a scenario that starts with one.
- **A scenario** that starts with a free-form message can only go out if the contact has just written: a keyword,
  a first message, a test link. That is why a scenario does not appear in a campaign’s picker if it opens any
  other way.
- **In an ongoing conversation**, anything goes: the customer has just written, the window is open, you reply
  whatever you want.
- **A Wait block** does not keep the window open: when it wakes up, the window decides what can go out. The guide
  "The Wait block" explains it.
- **A scenario started by an event** (a date, tag or webhook automation, a campaign) starts with the conversation
  closed: until the customer replies, only an approved template gets through. The builder flags each free message
  placed there in yellow. It refuses nothing: replace that block with a template, or place it after a reply from the
  customer.
- **The "No reply" output** of a template or a question also goes out before the customer has replied: the follow-up
  after it must be an approved template when the conversation was not open.
- **On the Scenario > Automation > Other screen**, an automation that does not come from a customer's message, and whose
  scenario would send a free message before any reply, carries the warning under its name.

**Good to know.** The reflex to adopt: as soon as the message goes to someone who has not just written to you, think
approved template. As soon as it answers someone who has just spoken, write freely.
