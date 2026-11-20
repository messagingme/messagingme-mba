---
description: Connect Make, n8n or Zapier both ways: receive their data, and send them yours, continuously or at a precise point of a scenario.
slug: connect-make-n8n-or-zapier
traduit_de: f6f00d
---
# Connect Make, n8n or Zapier

Make, n8n and Zapier connect without code, both ways. First choose the direction, then the route: each one has its
step-by-step guide.

**1. Receive: your tool sends us data.** A form filled in, a quote signed, an order: your tool creates or updates the
contact, and can launch a scenario.

- **The simplest, an incoming webhook**: Tools > Webhooks gives you an address, to paste into Make's HTTP module, n8n's
  HTTP Request node or Zapier's "Webhooks by Zapier" action (POST, JSON body). See "Receive data by webhook".
- **To go further, our API**: with a key (Developers > API keys), your tool's HTTP module can also send a WhatsApp
  template or read a contact. The key goes in the Authorization header (Bearer); the calls are described in
  Developers > API documentation.

**2. Send, continuously: every event goes to your tool.** Message received, link clicked, opt-out, conversation
analyzed: each ticked event goes out, for the whole workspace, with no scenario to build.

- Your tool gives you a receiving address (Make "Custom webhook", n8n the Webhook node, Zapier "Catch Hook"): paste it
  in Developers > Outgoing webhooks. See "Send events to your tool".

**3. Send, at a precise point: a scenario pushes to your tool.** Only when a journey goes through that point, with only
the data you choose, for example a customer's answers to your questions.

- Declare your tool's receiving address as a system in Tools > API connectors (see "Connect an API connector"): the
  base address is the start of the address (https://hook.eu1.make.com), the authentication "none", and the call a POST
  whose path is the end of the address (/abc123…), with in its body the contact fields to send.
- Then place an API call block in the scenario, where you want it (see "The API call block"). For your tool to send an
  answer back to the block, end its scenario with a response (in Make, the "Webhook response" module).
