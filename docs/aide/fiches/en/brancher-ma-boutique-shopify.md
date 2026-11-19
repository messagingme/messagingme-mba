---
description: Connect a Shopify store to WhatsApp from the console: order confirmation, shipping notice with tracking, abandoned checkout reminders.
slug: connect-my-shopify-store
traduit_de: 7fd28d
bouton_console: Connect Shopify in the console
---
# Connect my Shopify store

Your Shopify customers get on WhatsApp the **confirmation of their paid order**, the **shipping notice** with the
carrier and the tracking link, and a **reminder if they abandon their checkout**. This guide follows the console, with the Pro plan.

## From the console, with the Pro plan

The Shopify card of the console guides you from start to finish, in seven steps.

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
store”. The card then shows your three messages, each with its status.

**4. Write the message.** For each message, “Set up” opens an assistant. It suggests a text, which you can edit: the
order data is written in curly brackets, such as {first name} or {checkout link}, and a preview shows you what the
customer will get.

Each new text creates a new template at Meta: you can therefore rework it as often as you like. The previous one, if it
was created here, is deleted shortly after the new one is approved. The templates created by the assistant (their name
starts with “shopify_”) serve the store: do not reuse them in a scenario or a campaign.

**5. Set the delay, then send.** For the reminder, choose the delay after the checkout (1 h by default). Finally, “Send
to Meta and switch on once approved”.

The message switches on by itself when Meta approves it, usually within minutes, and an email lets you know (or tells
you why Meta refused it). Editing an active message does not stop it: the old one goes out until the new one is
approved. Changing only the reminder’s delay applies right away, without going back through Meta.

**6. Import your customers.** “Import” opens the import of the store’s customers subscribed to your marketing (email or
SMS) who have a phone number. They are counted first, along with the room your plan leaves; you choose how many to
import, the most recent first.

The records are tagged “Shopify” and arrive without WhatsApp consent: an email or SMS agreement is not one.

**7. Follow up, or cut.** The card shows the connected store, the status of each message, the last event received and
the figures for the last 30 days: messages sent, customers left out and why. “Cut” stops every message.

The app then stays installed on your store: uninstall it from the store apps page, whose link is on the card. You can
reconnect it from the card.

**Good to know.** Each message from the store makes the customer’s record consenting everywhere, campaigns included; a
customer who replied STOP stays opted out and gets nothing.

## The abandoned checkout reminder

A customer who fills in the checkout with their phone number without ordering gets ONE reminder on WhatsApp, with the
link that reopens their checkout, at the delay you choose after its last change (from 15 min to 72 h). Nothing goes out
if an order came of it in the meantime, even an unpaid one. It is a marketing message: it carries at the bottom the
line “Reply STOP to stop these messages” (in a French template, “Répondez STOP pour ne plus recevoir ces messages”). The
card counts the reminders sent, the checkouts that turned into an order in time, and those waiting; and, by reminder
date, the checkouts recovered (reminded then paid) and their amount.

**Good to know.** The first name is optional at Shopify: many customers do not give it, especially before abandoning
their checkout. A message that contains the first name still goes out, with “there” in its place (“Hello there”; “à
vous” for a template in French). That is why the text suggested for the reminder simply starts with “Hello,”.

## A phone number required at checkout

In Shopify, set the shipping address phone number to “Required” (Settings > Checkout). Without a phone number, an order
gets neither a confirmation nor a reminder on WhatsApp, and only a visit that came through one of your campaign links
can still tie it to your messages.

## What your sends brought in

The revenue from your orders paid after a WhatsApp message, and what your messages cost.

**8. Open Performance Lab > Quantitative > Shopify.** Pro plan: the revenue, what your messages cost, and
your ROI, overall and for each campaign.

**Good to know.** The figure counts the orders paid within 5 days after a WhatsApp message was received, credited to
the last send. It is gross (refunds not deducted) and counted per currency. The **proven** part: the reminded checkout
itself paid, or a visit that came through a WhatsApp link; the rest is a match in time. Shopify test orders are shown
apart, never counted. The cost only counts what can bring a sale, never order confirmations or shipping notices.

## Targeting your customers by their orders

Your customers picked by their paid orders: how many, for how much, the last one when.

**9. Filter by “Purchases and activity”.** Pro plan: in the mini-CRM, open the filters; the same part serves a
campaign’s recipients. Paid orders, spend, last order, over the period you choose.

**Good to know.** Orders only count from the moment the store was connected: Shopify’s history is not taken over, and
an imported customer arrives without their past orders. Right after connecting, “at least 2 orders” therefore finds
nobody; the panel gives the date tracking started. Only orders from a number already in your contacts count, test
orders included. Country and activity work in every workspace, with or without a store.

## The sending rules

A customer who replied STOP gets nothing, and the monthly templates and your plan’s contact limit count: a new
customer’s record counts. If that limit is reached, new customers no longer get their messages; the card counts them,
and you get an email at the first refusal of the month. Each message shows in Campaigns, one line per order. The
message goes out even when the agent or your team holds the conversation, without cutting it.

## Your customers’ requests

An erasure request from a customer forwarded by Shopify erases their record; an access request is reported to you by
email, and it is up to you to answer it. A store connected from the console does not forward these requests to us:
when Shopify forwards one to you, delete the customer’s record yourself in Contacts.
