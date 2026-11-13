---
name: regles-whatsapp
description: WhatsApp rules that decide whether a message can be sent through Messaging Me, and what Meta charges for it - the 24-hour window, templates and their categories (utility, marketing, authentication) with their price, consent and STOP, number quality and sending limits, received media. Use before creating or sending a template or a message to a contact, when a send is refused, when the user asks what a message costs or which category a template is, or when writing app code that sends WhatsApp messages.
---

# WhatsApp rules

Speak the user's language. These rules come from Meta; Messaging Me applies them and says so in its refusals.

## The 24-hour window

- Within 24 hours of the person's last message, any reply can be sent: free text, media, buttons
  (`reply_in_open_window`, `send_message`). `get_conversation` tells whether the window is open.
- After that, only a template approved by Meta can start the conversation again (`send_template_to_contact`).
- The window is the person's, not yours: writing to them does not reopen it.

## Templates

- Meta reviews every template, in minutes or up to 24 hours; only an approved template is sent
  (`create_template`, then `get_template_status`).
- Three categories (Meta's template categorization guidelines). What decides is what the message is FOR, not its tone:
  - **Utility**: non-promotional AND about something the person did or asked for (their order, booking, account,
    payment, an opt-in or opt-out confirmation), or an essential alert for them. Factual and specific (an order number,
    a date), with no offer, no recommendation, no up-sell.
  - **Marketing**: everything else. Offers, promo codes, new products, newsletters, events, birthdays, a welcome message
    that presents the business, a general feedback survey, and an abandoned cart reminder (marketing even when the
    person asked for it). A template that mixes an order update with a promotion is marketing, and so is a vague one
    (only a variable, or "Congratulations!").
  - **Authentication**: one-time codes only, from Meta's template library, with a code button, and no link, media or
    emoji. A code never goes out in a utility or marketing template.
- Before `create_template`, tell the user in a few plain lines: the category you chose and why (the rule above), what
  one message costs in that category (see "Money" below), and what Meta will check. When the need fits utility (a
  confirmation, a reminder of their own booking), offer the sober utility wording; when they want an offer in it, say
  that it makes the template marketing, which costs more. Never declare utility to pay less: Meta approves such a
  template as marketing anyway, and repeated misuse gets the account's utility templates limited, then all moved to
  marketing.
- After the review, `get_template_status` and `list_templates` show the category Meta kept. If Meta changed it, tell the
  user, with the new price. A change can be contested within 60 days in WhatsApp Manager (Business Support Home,
  "Template Category Updates", "Request Review").
- A template can be paused for poor quality, then disabled for good if it happens again. Its parameters must match it,
  in number and in kind.

## Consent and STOP

- Send a template only to people who agreed to receive messages from the business. Through Claude, that agreement is
  the user's responsibility, and three tools record it on their behalf: sending a template to one number
  (`send_template_to_contact`) and importing the Shopify customers (`import_shopify_customers`), whose records say who
  declared it, and the Shopify store's messages (`set_shopify_message`), whose records name the store. For these three
  there is no consent question to ask. Campaigns still only reach contacts who agreed.
- A person who answers STOP is unsubscribed, and Messaging Me refuses to send to them. The person can also refuse
  marketing from the business inside WhatsApp itself.

## Number quality and limits

- A new number can only start a limited number of conversations a day; Meta raises that limit as the number sends
  well and its quality stays good. Many blocks or reports lower its quality, then its limit.
- Too many messages to the same person in a short time are refused for that person only.
- Meta limits how many marketing templates one person receives, across all businesses.
- The Messaging Me plan limits templates (`get_plan`); replies within the 24-hour window are never limited by the plan.
- The API has daily quotas per workspace, set by the plan and raised on request. Templates and free-form
  replies are counted separately, so sending templates never takes the room of replies to customers. Beyond a quota,
  calls are refused with `quota_exceeded` (HTTP 429) until midnight, Paris time: an app that sends notifications must
  spread them or ask for more.

## Received media

Meta keeps a received file only 7 days: download it as soon as it arrives if the app needs it.

## Money

- Meta bills per delivered message: templates by category, and replies within the 24-hour window beyond a monthly
  allowance. It bills them on the card of the business's Meta Business account, except with the credit line, prepaid at
  Messaging Me (not possible with the WhatsApp Business app). No Messaging Me plan, Free included, includes these fees.
  Who pays and where to add the card: the `faq` skill.
- The price comes from a tool, never from memory: `list_templates` returns `prix_meta`, Meta's base price per delivered
  message for a recipient in France, for each category (`service` is a reply within the window), read from Meta's rate
  card in force (`grille_du`), in euros excluding tax; `create_template` returns the one of its category. Say it is
  Meta's price, not Messaging Me's, give its date, and say that Meta lowers the utility and authentication prices by
  monthly volume tiers (not the marketing one). For a recipient in
  another country, or when `prix_meta` is null, point to Meta's rate card: https://developers.facebook.com/docs/whatsapp/pricing.
