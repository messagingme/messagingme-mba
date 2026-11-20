---
description: Send the console’s events (message received, link clicked, unsubscribe…) to your tool through an outgoing webhook: the address, the test, the log.
slug: send-events-to-your-tool
traduit_de: 793ad1
---
# Send events to your tool

An outgoing webhook sends to an address of your choice (Make, n8n, Zapier, your application) every event you tick, for
the whole workspace, with no scenario to build: each send carries the contact's record.

**1. Create the address.** In Developers > Outgoing webhooks, paste the address your tool gives you to receive (in Make
"Custom webhook", in n8n the Webhook node, in Zapier "Catch Hook"), a description if you want, tick the events, then
"Create address".

- The events: message received, delivered, read or failed, link clicked, opt-out, conversation analyzed,
  disengagement risk, template review, AI agent action.
- The delivery receipts are unticked by default: a campaign produces up to three per recipient.
- Your plan limits the number of active addresses: 5 with the Pro plan, unlimited with the Enterprise plan.

**2. Keep the secret.** The signing secret is shown only once: copy it, then "I copied the secret".

- It lets your application check that the send really comes from us (Standard Webhooks format, described in
  Developers > API documentation). Make, n8n and Zapier do not need it to receive.
- "Rotate the secret" gives a new one; the old one still signs for 24 hours, the time to update.

**3. Send a test.** "Send a test" goes out right away and says what your tool answered.

- In Make, n8n or Zapier, the test also shows them the shape of the data, so you can map it in the rest of your
  scenario.

**4. Follow the sends.** "Log" lists each send: the event, its status, its attempts, the body sent and the last
answer. "Replay" sends one again, "Replay failures since" a batch.

- An address that does not answer within 10 seconds is retried for 24 hours; the same event keeps its identifier, so
  your tool can ignore a duplicate.
- "Pause" stops the sends without deleting anything; "Delete the address" also erases its log.
