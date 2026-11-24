---
name: shopify
description: Connects the user's Shopify store to Messaging Me so that customers receive WhatsApp messages when an order is paid or shipped, and a reminder when they abandon a checkout, imports the store's customers who subscribed to marketing, and catches up the paid orders of the last 60 days for the segments - creates the store app with the Shopify CLI in the merchant's own organization, installs it with one click, keeps its secret and sets the messages. Use when the user wants to connect Shopify, send order confirmations, shipping updates or abandoned checkout reminders on WhatsApp, import their Shopify customers, bring their past orders into their segments, know how much revenue their WhatsApp messages brought in, or check or cut the Shopify connection.
allowed-tools: mcp__plugin_messagingme_messagingme__get_shopify_state, mcp__plugin_messagingme_messagingme__get_revenue_stats, mcp__plugin_messagingme_messagingme__preview_shopify_customers, mcp__plugin_messagingme_messagingme__preview_shopify_order_history, mcp__plugin_messagingme_messagingme__get_shopify_order_history, mcp__plugin_messagingme_messagingme__list_templates, mcp__plugin_messagingme_messagingme__get_template_status, mcp__plugin_messagingme_messagingme__get_setup_state
---

# Connect a Shopify store

Speak the user's language. The merchant types no command: you run them, and explain each step in one plain sentence
before doing it. The user only signs in to Shopify (once, in the browser the CLI opens) and clicks Install on a link
you give. A link exists for the user only once you write it, in full, as plain text on its own line.

## Tell the way first

Before the first command, tell the user in a few short lines what is coming, so they are never left guessing:

- it takes about five minutes, and you do the technical part;
- they make two gestures: sign in to Shopify with the account that manages their store (the one they use to open its
  admin), in a browser window that opens on its own, then click Install on a link you give;
- connecting the store writes its three WhatsApp messages and sends them to Meta for approval; you show them, and turn
  each one on when they want it, once they have confirmed that their customers agreed to receive them.

Then, at each step, say where you are and what comes next (for example "Step 2 of 4: I am creating the app in your
Shopify account"), and say plainly when you are waiting for them.

## Before anything

- Call `get_shopify_state`. If a store is already connected, say which one and go straight to the messages (The
  messages, below).
- The workspace needs its WhatsApp number connected (`get_setup_state`); without it, nothing can be sent: connect it
  first, with the questions of the setup (`connecter_numero` in the `mise-en-service` skill): every way they lead to
  is an API number. Read its track (`numero.filiere`): `api` is the official API, with templates approved by Meta, and
  everything below applies. On `application`, a number linked by QR code (an older way, no longer offered: never
  propose it), Shopify messages cannot go out: WhatsApp does not let a linked device write
  first to a customer (it cuts or blocks the number), and an order confirmation, a shipping update or a checkout
  reminder writes first. Say it plainly before going on, with the way forward: the merchant keeps the WhatsApp
  Business app and connects the SAME number through Meta (say "keep your WhatsApp Business app", never the word
  coexistence, even when a tool result uses it): `start_whatsapp_connection` with mode `coexistence`, then
  `watch_whatsapp_connection` in the same mode; Meta's window creates the Meta Business account, the conversations
  stay, and what they type in the app does not show in Messaging Me yet. Or another number through Meta.
  `set_shopify_message` refuses them on such a number.
- Node.js must be installed (`node --version`). On Windows, call the CLI with `npx.cmd`, not `npx`: PowerShell blocks
  `npx` by its execution policy. Without Node.js, say why it is needed (it runs Shopify's own tool that creates the
  app) and offer to install it, only once they agree: on Windows `winget install OpenJS.NodeJS.LTS`, on a Mac
  `brew install node`, or else the LTS installer from https://nodejs.org. If `node` is still not found right after, the
  terminal has not seen it yet: ask them to restart Claude Code and to say "connect my Shopify store" again. If they do
  not want to install anything and are on a paid plan (`get_plan`), they can connect the store from the console
  instead (Tools > Integrations, Shopify card), which guides them on screen; on Free there is no console, so Node.js is
  the way.

## Create the app in the merchant's organization

The app is created in the organization that owns the store, never in ours: that is what lets the store open it without
any Shopify review.

1. Find the organization: `npx @shopify/cli@latest organization list --json`. The CLI opens the browser to sign in the
   first time. Just before, tell the user a Shopify window is about to open, to sign in there with the account that
   manages their store, then to come back here. If no window opens, the CLI prints a sign-in link: write it in full.
   Take the organization that has a store; if several do, ask the user which one by its name. If none has a store,
   they signed in with another account: say so, run `npx @shopify/cli@latest auth logout`, and start this step again
   with the account they use to open the store's admin.
2. Find the store: `npx @shopify/cli@latest store list --organization-id <id> --json`. Its `store` field is the
   `<name>.myshopify.com` domain. If several stores are listed, ask which one.
3. In a new folder (for example `messagingme-shopify` in the user's home), run
   `npx @shopify/cli@latest app init --no-input --template=none --name=messagingme --organization-id=<id> --package-manager=npm`,
   then delete the sample extensions it adds in its `extensions` folder.
4. Replace the content of its `shopify.app.toml` with the block below, keeping the client id that `app init` wrote.
   Its application URL is the page Shopify opens right after Install: it tells the user to come back here. Keep it in
   French for a French-speaking user, otherwise use https://app.messagingme.fr/en/shopify/installed/ instead.
5. Publish: `npx @shopify/cli@latest app deploy --no-input --allow-updates`.

```toml
client_id = "<kept from app init>"
name = "Messaging Me"
application_url = "https://app.messagingme.fr/shopify/installe/"
embedded = false

[access_scopes]
scopes = "read_customers,read_orders,read_checkouts,read_fulfillments,read_products"

[webhooks]
api_version = "2026-10"

  [[webhooks.subscriptions]]
  topics = [ "orders/create", "orders/paid", "fulfillments/create", "checkouts/create", "checkouts/update", "app/uninstalled" ]
  uri = "https://api.messagingme.app/shopify/webhooks"

  [[webhooks.subscriptions]]
  compliance_topics = [ "customers/data_request", "customers/redact", "shop/redact" ]
  uri = "https://api.messagingme.app/shopify/webhooks"

[auth]
redirect_urls = [ "https://shopify.dev/apps/default-app-home/api/auth" ]
```

## Install it and connect it

1. Give the user this link, built from the store and the client id, and ask them to click Install:
   https://admin.shopify.com/store/<name>/oauth/install?client_id=<client id>
   Warn them before they click: Shopify shows "This app hasn't been reviewed by Shopify", which is expected, since it
   is their own app, made in their own account; they click Install anyway. Shopify then opens a Messaging Me page
   saying it is installed and to come back to Claude Code. The same link approves new access later, after an update of
   the scopes.
2. Once they say it is installed, read the app's keys with `npx @shopify/cli@latest app env show --no-input`. Do not
   repeat the secret to the user.
3. Call `connect_shopify` with `store`, `client_id` (SHOPIFY_API_KEY) and `client_secret` (SHOPIFY_API_SECRET). A refusal
   says what to do: the app is not installed yet (give the link again), it is not in the store's organization, or the
   keys are wrong.
4. Ask the user to make the phone number required at checkout, in Shopify: Settings > Checkout, the shipping address
   phone number set to Required. Without a phone, an order gets no WhatsApp confirmation and is never attributed to a
   message.

## The messages

On the official API (track `api`), three events send a message: `order_paid` (the order is paid), `order_fulfilled`
(it is shipped, with tracking) and `checkout_abandoned` (below).

Each event has an automation: a scenario whose first step is the template the event sends. Connecting the store
already wrote a standard message for each event, in French, with its Shopify data linked, and sent it to Meta: the
two order messages as utility templates, the checkout reminder as a marketing template. The automations stay off:
nothing reaches a customer before the user turns one on. Nothing is written on a number linked by QR code, nor
without a connected WhatsApp Business account; an automation that has no message yet gets the standard one when it
is turned on in the console.

On Pro and above, the user can add steps after the first message in the console (Scenario > Automation > Shopify,
"Open the scenario"): a reminder after a wait, an answer to a button, a message quoting the order's data. The first
message itself is reworded there too ("Edit this template", which keeps its Shopify data). You only change the first
message: when an automation has more than one step (`get_shopify_state`), say that the others are changed in the
console. On Free there is no console, and only the first message is sent.

1. Show the messages: call `get_shopify_state`. Each automation's `message` is the text of its first message, its
   variables numbered ({{1}}, {{2}}...); say it in plain words, naming the data (first name, order number...). When the
   automation marks its message under review (its note says so too), Meta is still reviewing it, in minutes or up to
   24 hours: they can close Claude Code and come back later with "finish my Shopify messages". Never call `set_shopify_message` on an automation whose
   message is under review: it would cancel the version waiting for Meta.
2. Turn one on once its message is approved (its template set, its status at Meta APPROVED) and the user wants it: call
   `set_shopify_message` with `event`, `template` (the name `get_shopify_state` returns), `language`, `active` true,
   and `variables` exactly as `get_shopify_state` returns them for that automation (the data of {{1}}, {{2}}... in
   order): without them the message would lose its Shopify data. Before the first one, check the merchant's
   attestation (The consent attestation, below).
3. If they want other words, offer to write a new message: create it with `create_template` (a utility template for
   an order, a marketing one for the checkout), links in the body as variables (a URL button takes no variable), wait
   for Meta (`get_template_status`), then set it with `set_shopify_message`, `variables` naming the data of each
   {{n}} in order. The data each event can fill: `order_paid`: `first_name`, `order_number`, `order_total`,
   `order_status_url`; `order_fulfilled`: `first_name`, `order_number`, `carrier`, `tracking_number`, `tracking_url`;
   `checkout_abandoned`: `first_name`, `checkout_url`. For the checkout, a URL button can carry the link instead: its
   address is `https://<store>/{panier_shopify}` (`store` from `get_shopify_state`), and Messaging Me redirects the
   click to the checkout of the customer who clicks, or to the store when they have none left.

Each message records the customer as opted in, for campaigns too, and a customer who said STOP stays opted out and
receives nothing. Every message
goes through the sending rules of Messaging Me (STOP, monthly templates, contact limit), and each first message
shows up in Campaigns, one line per order. `set_shopify_message` with `active` false turns an automation off and stops
its journeys. If a customer writes while the journey sleeps in a Wait step, or taps a button of another message,
the workspace's AI agent, responder scenario or application answers and the journey goes on; in Team or Meta agent
mode, the journey stops and the team or Meta's agent takes over. A written reply to a step that waits for one follows
its "any other reply" output, or ends the journey.

### The consent attestation

No automation turns on until the merchant has attested, once, that their customers agreed to receive their WhatsApp
messages: Meta requires that agreement for any message that writes first. `get_shopify_state` says whether it is done
(`customers_consent_attested`). When it is false, before turning anything on, ask the user, quoting this sentence in
their language (in French: "J’atteste que les clients de ma boutique ont accepté de recevoir de ma part des messages
WhatsApp (confirmation et suivi de commande, relance de panier), et j’en assume la responsabilité."):

"I confirm that my store’s customers have agreed to receive WhatsApp messages from me (order confirmation and
tracking, checkout reminders), and I take responsibility for it."

Only on their clear yes, pass `customers_consent_attested: true` with the call (`set_shopify_message`, or
`connect_shopify` if they confirmed it before connecting): it records who, when and the sentence, in French, word for
word. Never answer for the merchant, never assume it from an earlier request, and never pass it when they hesitate or
say no: then nothing turns on, and say so. A refusal that asks for the attestation means the same: ask the user. It is
withdrawn in the console (Scenario > Automation > Shopify, Pro and above), which turns the three automations off.
Automations already on before the attestation existed keep running.

## Remind abandoned checkouts

A third event, `checkout_abandoned`, sends a reminder when a customer filled the checkout with their phone and did
not order. It is a marketing message, proposed and turned on like the order messages (its own automation), under the
same consent attestation.

1. Its standard message has no address in its text: a "Reprendre mon panier" button (back to my cart) opens the
   customer's own checkout. It ends with the opt-out line "Répondez STOP pour ne plus recevoir ces messages": a
   customer who replies STOP gets nothing more. A reminder written instead keeps that line, in the template's language
   ("Reply STOP to stop these messages" in English).
2. When turning it on, `set_shopify_message` also takes `delay_minutes`: how long after the checkout last changed the
   reminder leaves (60 by default, from 15 to 4320).
3. The first message leaves once per checkout, then the rest of its scenario if it has one; nothing leaves if an order
   came out of it in the meantime, even unpaid, and such an order stops the journey wherever it stands. A newer
   checkout from the same customer takes the place of the older one: its reminder stops the older journey.
4. `checkout_abandoned_agent` is the same reminder with one more button, a quick reply "Vous avez une question ?" (have a
   question?) that hands the conversation to an AI agent of the workspace. It needs an active agent: ask the user which
   one (`list_agents`), or build one first. Turn it on with `set_shopify_message`, `event: checkout_abandoned_agent`,
   `language: fr` and `agent_id`, without a template: its standard message is created and leaves once Meta approves
   it. It turns `checkout_abandoned` off, and the reverse: a checkout gets one reminder. An operator who holds the
   conversation keeps it; if the agent cannot answer (no AI credit, agent disabled), the team gets it.

## Import the store's customers

Only the customers who subscribed to marketing in Shopify (email or SMS) and have a valid phone are imported. Imported
through Claude, they arrive opted in: the user declares that they agreed, under the user's own responsibility, and their
records say who declared it. Never ask the user about consent. A customer who said STOP stays opted out. Each imported
record counts toward the plan's contact limit, and managing that limit is the user's call.

1. Count first with `preview_shopify_customers`, which writes nothing. Tell the user, in plain words: how many subscribed
   customers have a phone, how many are already in the workspace, how many are new, how many free places the plan
   leaves, and how many an import would write. When `complete` is false, these numbers are a minimum: older customers
   were not read yet, and importing again later takes the next ones.
2. Let the user choose: import up to the free places (the newest customers first), fewer, or move to a higher plan first
   (`get_plan`). On Free, Pro and Business, say it before they choose: customers who write first count too, so filling every
   place leaves none for a new customer who writes, whose message then does not get in. Never import before they
   answer.
3. Call `import_shopify_customers` with `max_contacts`, the number they chose. A number above the free places is refused
   and nothing is written. The records are tagged Shopify; calling again imports the next ones without duplicates.

## Add a scope to an app already installed

An app created before November 24, 2026 lacks read_products, which the catch-up of past orders needs (without it,
Shopify does not give the product of an order line): `preview_shopify_order_history` refuses and says so. To add it:

1. In the folder where the app was created (for example `messagingme-shopify`), set `scopes` in `shopify.app.toml` to
   the list of the block above. If that folder is gone, ask the user for the app's client ID (Shopify developer
   dashboard, the Messaging Me app, its settings), then run
   `npx @shopify/cli@latest app config link --client-id=<client id>` in a new folder: it writes the app's
   `shopify.app.toml` again, whose scopes you then set.
2. Publish: `npx @shopify/cli@latest app deploy --no-input --allow-updates`.
3. Give the install link again (Install it and connect it, step 1): the user approves the new access there. Nothing
   else changes: the keys stay the same, there is no need to call `connect_shopify` again.

## Catch up the last 60 days of orders

Orders paid before the store was connected are not in the segments (`find_contacts`: orders, products, amount spent).
The catch-up reads the paid orders created in the last 60 days, the window Shopify opens to the app, and attaches each
one to the record of its phone already in the workspace, amount and products included, as a live order would have
been. It creates no record, sends no message and attributes no revenue: an order whose phone matches no record, or
without a usable phone, is counted and never kept. It is open to every plan.

1. Count first with `preview_shopify_order_history`, which writes nothing. If it refuses for the read_products
   scope, add it first (Add a scope to an app already installed, above), then count again. Tell the user, in plain words: how many paid
   orders the window holds, how many are already known (they get their products), how many would join a record, how
   many have no record or no usable phone (counted, never kept). When `complete` is false, the counts are partial: the
   catch-up itself reads everything.
2. Once the user agrees, call `import_shopify_order_history`. It runs in the background, a few minutes for most
   stores and over an hour for the largest, and is refused while another one runs.
3. `get_shopify_order_history` follows it: its status and its counts. `interrupted` means nothing moved for 15 minutes:
   starting it again closes it and reads the window again. Once it is `termine`, `find_contacts` says from which date
   the orders were caught up, with its orders criteria.

## What WhatsApp brought in

- `get_revenue_stats` (`du` and `au`, the last 30 days by default): the orders paid within 5 days after a WhatsApp
  message, credited to the last one, per currency: the gross amount, its proven part, each source (each campaign by
  its name, each Shopify automation: abandoned checkout, order paid, order shipped, one line each; Builder scenarios,
  AI agent, Meta Business Agent), and the checkouts reminded and recovered. The first message of an order (the
  confirmation, the shipping notice) is never a source: only the steps after it in its scenario are.
- Say the gross amount and its proven part. Never present an unproven sale as caused by a message: it is a match in
  time. Never add two currencies. Refunds are not deducted.
- Test orders (Shopify's test gateway) come apart, in their own block, and never count: mention them separately, they
  are how a development store is tried.
- Only orders paid since the store was connected count: from customers already in the workspace, or, without one,
  through a campaign link (proven by UTM).

## Check or cut

- `get_shopify_state`: the store, whether it is paused, its `automations` (each on or off, its first template and its
  status at Meta, the text of its first message, its number of steps), the last event received, the last 30 days of
  outcomes (sent, opted out,
  contact limit reached...) and, for checkout reminders, the last 7 days (a checkout is kept no longer), with those
  recovered and their amount. Read `automations`, never `messages`: that field is the setting from before automations
  and no longer sends. On the Free plan there is no console: this tool is the way to see the connection.
- A paused store sends nothing, neither a first message nor a following step, and a checkout abandoned during the
  pause is never reminded. The pause is set in the console (Tools > Integrations, Shopify card): when `paused` is
  true, say so before anything else.
- `disconnect_shopify` stops every message. The app stays installed on the store: only the user can uninstall it, from
  the store apps page the tool returns.
