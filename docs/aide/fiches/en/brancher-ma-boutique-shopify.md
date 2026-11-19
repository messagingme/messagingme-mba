---
description: Connect a Shopify store to WhatsApp from the console: order confirmation, shipping notice, abandoned checkout reminders, and their follow-up.
slug: connect-my-shopify-store
traduit_de: 1636b1
bouton_console: Connect Shopify in the console
---
# Connect my Shopify store

Your Shopify customers get on WhatsApp the **confirmation of their paid order**, the **shipping notice** and a
**reminder if they abandon their checkout**: three automations, each with the follow-up you want. This guide follows
the console, with the Pro plan.

## From the console, with the Pro plan

The console guides you from start to finish, in eight steps.

**1. Open the Shopify card.** In the Tools > Integrations menu, the Shopify card says what it
does and guides you in two steps, the first at Shopify, the second in the console.

It only shows to the workspace’s administrators.

**2. Create your app at Shopify.** On the Shopify developer dashboard, signed in with the account that manages your
store, create the app manually (Create app manually) and paste the address and the scopes that the card lets you copy
in one click. Allow five minutes.

Untick “Embed app in Shopify admin”, leave the rest as it is, then Create app and Release. Then install it on your
store: the message “This app hasn’t been reviewed” is expected, it is your own app. Finally, open the app in Apps:
its Client ID and its Client secret are in the Credentials box, on the right.

**3. Connect the store.** Back in the card, paste the store name, the Client ID and the Client secret, then “Connect the
store”. Your messages are then set in the Automation menu.

**4. Switch on an automation.** In the Automation menu, the Shopify section lists your three automations: Order paid,
Order shipped and Abandoned checkout, each with its status. Switch one on: its scenario opens in the builder.

For the checkout, also choose the delay after its last change: 15 min, 1 h (by default), 3 h or 24 h. “Open the
scenario” takes you back to it at any time; switching an automation off stops its journeys under way.

**5. Choose the first message, then publish.** The first block, marked “first message”, is the template the event
sends. Choose one, or “Write a new template”, then link each of its variables to a piece of Shopify data: the first
name, the order number, the checkout link… Finally, “Publish”.

The automation switches on when Meta approves the template, usually within minutes. Changing the template does not stop
it: the old one goes out until the new one is approved. A template written from an automation belongs to it: do not
reuse it elsewhere, it is deleted at Meta shortly after it is replaced. The first block itself cannot be deleted.

**6. Build the follow-up, if you want one.** After the first message, add blocks as in any scenario: a Wait block then a
reminder, a template button that leads to an answer, a message that quotes a piece of the order’s data (“Shopify
data”, in the choice of variables). Without a follow-up, only the first message goes out.

As long as the customer has neither replied nor clicked, every send must be a template: the builder tells you so. Each
block has its own page in the help.

**7. Import your customers.** “Import”, on the Shopify card, opens the import of the store’s customers subscribed to
your marketing (email or SMS) who have a phone number. They are counted first, along with the room your plan leaves;
you choose how many to import, the most recent first.

The records are tagged “Shopify” and arrive without WhatsApp consent: an email or SMS agreement is not one.

**8. Follow up, pause or cut.** The Shopify card shows the connected store, the last event received and the figures for
the last 30 days: messages sent, customers left out and why. The pause switch stops every send without disconnecting
anything; “Cut” disconnects the store.

While paused, your automations keep their settings, but nothing goes out, neither first message nor follow-up; the
journeys under way stop, and a checkout abandoned during the pause is never reminded afterwards. After “Cut”, the app
stays installed on your store: uninstall it from the store apps page, whose link is on the card. You can reconnect it
from the card.

**Good to know.** Each message from the store makes the customer’s record consenting everywhere, campaigns included; a
customer who replied STOP stays opted out and gets nothing.

## The abandoned checkout reminder

A customer who fills in the checkout with their phone number without ordering gets the first message of the Abandoned
checkout automation, with the link that reopens their checkout, at the delay you chose after its last change, then the
follow-up of its scenario. Nothing goes out if an order came of it in the meantime, even an unpaid one, and an order
born from the checkout stops its journey, wherever it stands. A second checkout takes the place of the first: its
reminder stops the journey of the previous one.

A customer who replies STOP gets nothing more: say it at the bottom of the reminder template (“Reply STOP to stop
these messages”). The card counts the reminders sent, the checkouts that turned into an order in
time, and those waiting; and, by reminder date, the checkouts recovered (reminded then paid) and their amount.

**Good to know.** The first name is optional at Shopify: many customers do not give it, especially before abandoning
their checkout. A message that contains the first name still goes out, with “there” in its place (“Hello there”; “à
vous” for a template in French). A checkout message is therefore better off simply starting with “Hello,”.

## A phone number required at checkout

In Shopify, set the shipping address phone number to “Required” (Settings > Checkout). Without a phone number, an order
gets neither a confirmation nor a reminder on WhatsApp, and only a visit that came through one of your campaign links
can still tie it to your messages.

## What your sends brought in

The revenue from your orders paid after a WhatsApp message, and what your messages cost.

**9. Open Performance Lab > Quantitative > Shopify.** Pro plan: the revenue, what your messages cost, and
your ROI, overall, for each campaign and for each Shopify automation.

**Good to know.** The figure counts the orders paid within 5 days after a WhatsApp message was received, credited to
the last send. It is gross (refunds not deducted) and counted per currency. The **proven** part: the reminded checkout
itself paid, or a visit that came through a WhatsApp link; the rest is a match in time. Shopify test orders are shown
apart, never counted. The cost only counts what can bring a sale: never the first message of an order (the
confirmation, the shipping notice), only the follow-up of its scenario.

## Targeting your customers by their orders

Your customers picked by their paid orders: how many, for how much, the last one when.

**10. Filter by “Purchases and activity”.** Pro plan: in the mini-CRM, open the filters; the same part serves a
campaign’s recipients. Paid orders, spend, last order, over the period you choose.

**Good to know.** Orders only count from the moment the store was connected: Shopify’s history is not taken over, and
an imported customer arrives without their past orders. Right after connecting, “at least 2 orders” therefore finds
nobody; the panel gives the date tracking started. Only orders from a number already in your contacts count, test
orders included. Country and activity work in every workspace, with or without a store.

## The sending rules

A customer who replied STOP gets nothing, and the monthly templates and your plan’s contact limit count: a new
customer’s record counts. If that limit is reached, new customers no longer get their messages; the card counts them,
and you get an email at the first refusal of the month. Each first message shows in Campaigns, one line per order. It
goes out even when the agent or your team holds the conversation, without cutting it.

If the customer writes during a Wait block, or taps a button of another of your messages: the AI agent, the responder
scenario or your application answers them, and the automation goes on. In Team or Meta agent mode, the automation
stops: the request lands in “To handle”, or Meta’s agent answers. If they reply in writing to a block that waits for
their reply, the automation follows that block’s “Any other reply” output; without it, it stops.

## Your customers’ requests

An erasure request from a customer forwarded by Shopify erases their record; an access request is reported to you by
email, and it is up to you to answer it. A store connected from the console does not forward these requests to us:
when Shopify forwards one to you, delete the customer’s record yourself in Contacts.
