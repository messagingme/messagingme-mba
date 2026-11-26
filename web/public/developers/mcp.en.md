<!-- Markdown version of https://console.messagingme.app/developers/mcp, generated from the page (npm run doc:md). Français : https://console.messagingme.app/developers/mcp.md -->

# MCP server

Connect an assistant (Claude, or any MCP-compatible client) to the workspace, with no integration to build.

<a id="api-ou-mcp"></a>

## API or MCP?

| In short | API | MCP |
| --- | --- | --- |
| Who acts | Your code, on each event of your application | An assistant (Claude, ChatGPT…), when you ask it |
| What you connect | An API key, in your server | The Claude Code plugin, or the MCP server endpoint |
| For | Sending on each order, sign-up or appointment, and receiving every message through a signed webhook | Setting the workspace up, tuning the AI agent, replying, preparing a campaign, reading your figures, in conversation |
| Start | [API quickstart](https://console.messagingme.app/developers/api/quickstart.en.md) | [MCP server](https://console.messagingme.app/developers/mcp.en.md) |

The two work together: Claude sets the workspace up and creates your application’s key, your code sends and receives.

<a id="plugin"></a>

## Path 1: Claude Code, with the plugin (recommended)

The simplest way in Claude Code. No key to copy: every tool, and the step-by-step setup (number, AI agent, bubble, test).

1. Install the plugin, one command after the other:

  _Command 1_

  ```
  /plugin marketplace add https://github.com/messagingme/messagingme-plugin.git
  ```

  _Command 2_

  ```
  /plugin install messagingme@messagingme
  ```
2. Authorize: `/mcp`, pick `plugin:messagingme:messagingme`, then `Authenticate`. Our authorization page opens; an administrator signs in and picks the workspace. No account yet? The workspace is created at that moment.
3. Start the setup:

  _Then, in Claude Code_

  ```
  /messagingme:demarrer
  ```

Check, without changing anything: ask “Where does my workspace stand?”. The assistant reads the workspace state (get_setup_state) and tells the next step.

<a id="oauth"></a>

## Path 2: another client, through OAuth (ChatGPT, Cursor, VS Code, Lovable)

No key to copy: OAuth authorization. The same tools as with the plugin, on behalf of the administrator who authorized; the guided setup is specific to the plugin.

1. Add a remote MCP server (or a connector) at this address:

  _Endpoint_

  ```
  https://api.messagingme.app/mcp
  ```
2. Choose OAuth authentication. The client opens our authorization page, where a workspace administrator signs in and picks the workspace.
3. Check, without changing anything: ask “Where does my workspace stand?”. The assistant reads the workspace state (get_setup_state) and tells the next step.

- The authorization page says where the client’s name comes from: verified for Claude, published by its domain for a client with an identity document (ChatGPT), unverified for a client that registers itself (Cursor, VS Code).
- The client receives its code on an https address, or on localhost and 127.0.0.1: a return through an app scheme (cursor://) is refused.

<a id="cle"></a>

## Path 3: by hand, with an API key

For a client that cannot do OAuth, or a script.

1. Create an API key with the `mcp:read` scope, and `mcp:write` to act. [Create a key](https://console.messagingme.app/developers/keys)
2. Replace VOTRE_CLE with that key, then run:

  _Command to copy_

  ```
  claude mcp add --transport http mba https://api.messagingme.app/mcp --header "Authorization: Bearer VOTRE_CLE"
  ```
3. Check, without changing anything: ask “Where does my workspace stand?”. The assistant reads the workspace state (get_setup_state) and tells the next step.

> **Caution**
>
> A key does not open the tools that act on behalf of a person, that is most writes (templates, webhooks, campaigns, AI agent, credit, contact deletion): the “Scope” column below marks them “OAuth connection required”. A read-only key does not see the ones that write. With the plugin, do not also add this command: Claude Code would keep that server, which does not open the setup tools.

<a id="limites"></a>

## What it does not do

- **No send without your yes.** It prepares a campaign or a scenario for one person (on Pro), or a template for one person (every plan), and shows you its summary; nothing leaves except on an administrator’s click in the console, on the page it links to.
- **Outside the 24 h window, only an approved template goes out.** A free-form message is refused, with the reason; an approved template is prepared with send_template_to_contact.
- **WhatsApp number unlinked, nothing is sent.** The tool refuses, with the reason, until an admin relinks the number from the Home page.
- **Automations are not triggered.** A tag set by the assistant classifies the contact, without waking the automations listening for that tag.
- **Activating an AI agent does not make it answer.** Created and activated by the assistant, it talks to customers inside a published scenario that contains it, or once chosen to answer the customer (set_default_responder, “agent” mode): it then answers every message nobody handles, and Meta’s agent, if on, stays on standby.

<a id="acces"></a>

## Removing access, and if it does not work

- **Cutting an assistant off.** A key, like an OAuth connection, carries the workspace and the scopes: revoke either one under Developers > API keys.
- **A 401 refusal.** The key is revoked or miscopied; with OAuth, authorize again (in Claude Code: /mcp, then Authenticate).
- **Connected, but no tool.** The key has no MCP scope: give it `mcp:read`, and `mcp:write` to act.
- **The setup tools are missing in Claude Code.** A server added by hand with a key hides the plugin’s one: remove it (`claude mcp remove mba`, or the name you gave it).
- **The plugin does not update itself.** In Claude Code: /plugin, Marketplaces tab, messagingme, “Update marketplace”.

<a id="outils"></a>

## What the assistant can do

Tools marked "OAuth connection required" act on behalf of a person: an API key does not see them. They open when the assistant connects to the workspace with an administrator’s consent, who signs what they do.

### Setup and plan

| Tool | Scope | What it does |
| --- | --- | --- |
| get_setup_state | mcp:read | Where the workspace setup stands (number, AI agent, responder, bubble, credit, plan), and the next step with its tools. Call it first to set up a workspace, or to resume. |
| get_plan | mcp:read | The workspace plan, its limits and current usage, with the link to upgrade. |
| subscribe_pro | mcp:write OAuth connection required | Open the Pro plan payment, monthly or yearly, amount before tax; the person pays on Stripe’s page and comes back to “Payment received”. |
| take_credit_line | mcp:write OAuth connection required | Open the credit line option payment, €30 excl. tax per number per month, before connecting the number; the person pays on Stripe’s page and comes back to “Payment received”. |
| get_credit | mcp:read | The AI credit balance and its latest movements. |
| buy_credit | mcp:write OAuth connection required | Open a top-up payment, amount before tax; the person pays on the Stripe page themselves. |
| create_api_key | mcp:write OAuth connection required | Create your application’s API key, shown only once: it passes through the conversation, to put at once in the .env file. |
| list_members | mcp:read | Workspace members, to assign threads to them. |
| contact_support | mcp:write OAuth connection required | Write to Messaging Me Support, with the workspace context joined by the server. |

### WhatsApp number

| Tool | Scope | What it does |
| --- | --- | --- |
| start_whatsapp_connection | mcp:write OAuth connection required | Give the link that opens the WhatsApp number connection, without the console, valid for one hour: provided or own number, or the WhatsApp Business app number, keeping the app (messages sent through Messaging Me are billed by Meta). A provided number can also go into the WhatsApp Business app, kept the same way. Without a Meta Business account, Meta’s window creates it along the way. |
| watch_whatsapp_connection | mcp:write OAuth connection required | Follow the number connection to the end: number assigned, verification code to read out, number connected, or linked while keeping the WhatsApp Business app. |
| get_account_status | mcp:read OAuth connection required | The WhatsApp account status, read again at Meta: display name, quality, messaging tier, business verification, Marketing Messages. |
| request_number_code | mcp:write OAuth connection required | Have Meta send the number verification code, by call or by SMS. |
| activate_number | mcp:write OAuth connection required | Activate the connected number with its verification code. |
| get_number_subscription | mcp:read | The provided number’s subscription: its status, the end of the paid period and the number. |
| manage_number_subscription | mcp:write OAuth connection required | Open the Stripe portal for the number subscription: card, invoices, cancellation. |
| resubscribe_number | mcp:write OAuth connection required | Renew the number subscription when it is overdue or ended: the Stripe portal, or a new payment that restores the same number. |
| return_number_at_plan_end | mcp:write OAuth connection required | Choose to give back the provided number when Pro ends, or keep it at €3.50 excl. VAT a month on the same card. |

### AI agent

| Tool | Scope | What it does |
| --- | --- | --- |
| list_agents | mcp:read | AI agents, their status, and what is still missing before they can be activated. |
| get_agent | mcp:read | An AI agent: its profile, model, tools, knowledge, what it lacks, and the offered models with their price. |
| create_agent | mcp:write OAuth connection required | Create a draft AI agent. A workspace’s first agent needs a little credit. |
| update_agent | mcp:write OAuth connection required | Edit an AI agent’s profile (goal, tone, handovers, stop rules) and its model, logged under the person’s name. |
| set_agent_limits | mcp:write OAuth connection required | Set the limits of an AI agent’s conversation (answers, actions, credit spent, no credit limit by default), logged under the person’s name. |
| set_agent_tools | mcp:write OAuth connection required | Add and enable an AI agent’s four safe tools (finish, search, read the contact, hand over). |
| set_agent_action | mcp:write OAuth connection required | Create or edit an AI agent action: what it collects and sends to your app (agent.action webhook) when the customer makes a request, once a day per contact. |
| delete_agent_action | mcp:write OAuth connection required | Delete an AI agent action. |
| test_agent | mcp:write OAuth connection required | Try an AI agent on a mock conversation. Each try is charged to the credit. |
| activate_agent | mcp:write OAuth connection required | Activate a complete AI agent, or deactivate it. It answers in a published scenario, or if chosen to answer the customer. |
| set_default_responder | mcp:write OAuth connection required | Choose who answers the customer (a new contact, and every message nobody handles): Meta’s agent, an active AI agent, a published scenario, the team, or your app (an outgoing webhook address). Outside Meta’s agent mode, it stays on standby. |
| set_transfer_mode | mcp:write OAuth connection required | Set what AI agents promise about team availability when they hand over. |
| set_business_hours | mcp:write OAuth connection required | Set the workspace’s opening hours and time zone: the ones AI agents announce outside hours. |

### Agent knowledge

| Tool | Scope | What it does |
| --- | --- | --- |
| list_knowledge | mcp:read | An AI agent’s knowledge entries, with their source. |
| add_knowledge | mcp:write OAuth connection required | Add written knowledge entries, up to 50 per call. |
| delete_knowledge | mcp:write OAuth connection required | Delete knowledge entries; their content stays in the history. |
| preview_site | mcp:read OAuth connection required | Read a site from the server and see what an import would make of it, without writing anything. |
| import_site | mcp:write OAuth connection required | Import a site’s pages as knowledge; a page read again replaces its entries. |
| import_document_text | mcp:write OAuth connection required | Import a document’s text under its name, filed like an uploaded document. |

### Conversations

| Tool | Scope | What it does |
| --- | --- | --- |
| list_conversations | mcp:read | Conversations, most recently active first, over a period if needed, with each one’s contact. |
| get_conversation | mcp:read | Thread details, and whether the 24 h window is open. |
| get_messages | mcp:read | The last 50 messages of a thread, oldest first, and before to go further back. |
| reply_in_open_window | mcp:write | Reply, only while the 24 h window is open; on a number linked by QR code, outside the window, a reply to a customer who wrote is queued; this number never writes first. |
| send_message | mcp:write | Send within the 24-hour window an image, a document, a location, buttons, a list or a link button, in Meta’s format. |
| control_conversation | mcp:write | Take over a thread, or hand it back to the automatic responder, which answers the next message. |
| tag_conversation | mcp:write | Add tags to a thread’s contact. |
| assign_conversation | mcp:write | Assign a thread to a member, or release it. |
| get_conversation_insights | mcp:read | What the analysis understood of conversations: sentiment, intents, resolution, topics, and satisfaction and urgency over time. |

### Templates

| Tool | Scope | What it does |
| --- | --- | --- |
| list_templates | mcp:read | The workspace’s WhatsApp templates, with their language, category and status at Meta. |
| get_template_status | mcp:read | A template’s status at Meta, language by language, with the reason for a rejection. |
| create_template | mcp:write OAuth connection required | Create a template in Meta’s format and submit it for review; a header image is given by its address. |
| update_template | mcp:write OAuth connection required | Edit one language of a template, in Meta’s format, which goes back to review; a media header cannot be edited. |
| delete_template | mcp:write OAuth connection required | Delete a template, all its languages; refused while an active campaign uses it. |
| send_template_to_contact | mcp:write OAuth connection required | Prepare sending an approved template to one person, even outside the 24-hour window: it goes out on an administrator’s click in the console, once, with the sends rules (STOP, monthly templates); the person’s agreement is declared by the client. |
| get_message_status | mcp:read | The delivery status of a sent message: sent, delivered, read or failed, with Meta’s reason. |

### Contacts and campaigns

| Tool | Scope | What it does |
| --- | --- | --- |
| search_contacts | mcp:read | Find a contact by name or number, with their latest analysis. |
| get_contact | mcp:read | A contact record from its number, with their latest analysis and its summary. |
| create_contact | mcp:write OAuth connection required | Add a contact by hand: number, name, fields, tags, and their consent, always stated (yes or no). |
| block_contact | mcp:write OAuth connection required | Block or unblock a contact: nothing is sent to them anymore, their messages are still recorded. |
| prepare_contacts_deletion | mcp:write OAuth connection required | Prepare the deletion of a selection of contacts without erasing anything (tags, consent, a list, the N oldest, 1,000 at most): their count, 10 records at most and the link of the button an administrator clicks to delete. |
| delete_contacts | mcp:write OAuth connection required | What an administrator’s click deleted: records, conversations and messages erased, as in the console; nothing goes without that click. The click is refused if a record shown was deleted since. |
| find_contacts | mcp:read | The contacts of a target, like the contact list filters: tags, consent, activity, country and, with a connected Shopify store, orders (count, amount spent, last order) and, on the Enterprise plan, the latest analysis. The total, and up to 100 contacts. |
| tag_contacts | mcp:write OAuth connection required | Tag the contacts of a target (the criteria of find_contacts) or of a list of conversations: a segment is a tag. Through the console’s bulk action, without starting any automation. |
| list_tags | mcp:read | The workspace tags, with the number of contacts carrying each one. |
| rename_tag | mcp:write OAuth connection required | Rename a tag on every record; a name already taken merges the two tags. |
| delete_tag | mcp:write OAuth connection required | Remove a tag from every record, with no way back. |
| list_fields | mcp:read | The custom contact fields: key, label, type. A template variable can come from one of them. |
| create_field | mcp:write OAuth connection required | Create a custom field, as in the console: its key comes from the label. |
| update_field | mcp:write OAuth connection required | Change the label or the type of a field: its key does not change. |
| delete_field | mcp:write OAuth connection required | Delete a field: the values already written stay in the records, hidden. |
| get_field_usage | mcp:read | How many records have each field filled in, out of the total: before changing or deleting a field. |
| set_contact_field | mcp:write OAuth connection required | Set a field on the contacts of a target (the criteria of find_contacts) or of a list of conversations, like the console’s bulk action, without starting any automation. |
| prepare_campaign | mcp:write OAuth connection required | Prepare a template campaign without sending anything, for a target (the criteria of find_contacts): a draft visible in the console, a summary (targeted, sent, left out and why, five names, the billable volume) and the link of the button an administrator clicks to send. |
| launch_campaign | mcp:write OAuth connection required | What an administrator’s click did with a prepared campaign: sending, scheduled for its date or resumed; nothing leaves without that click in the console. Resumes a sending cut short without sending anything twice. |
| control_campaign | mcp:write OAuth connection required | Pause a sending campaign, unschedule a scheduled one, or prepare to resume a paused one (a summary and the link of the button that resumes it). |
| list_scenarios | mcp:read | Scenarios, and which are published: a widget only starts a published scenario. |
| get_scenario | mcp:read | A scenario as a recipe, with the fingerprint that guards its replacement, and its draft if it has one. |
| simulate_scenario | mcp:read | Play a scenario for a fictitious contact, sending and writing nothing: the blocks passed, the branch each answer takes, the planned effects and the end. |
| get_scenario_test_link | mcp:read OAuth connection required | The test link of a scenario: a WhatsApp link to your number with the test word already typed, to try the draft from your phone. |
| get_contact_journey | mcp:read | Where a contact stands in a scenario: their runs, the blocks passed and when, the errors of their number. |
| list_delivery_errors | mcp:read | The delivery error log: what Meta answered when a message did not leave or did not arrive. |
| list_system_errors | mcp:read | The system error log: the calls to your own systems that did not succeed. |
| create_scenario | mcp:write OAuth connection required | Create a scenario from its recipe (template and buttons, quick-reply messages and a file, questions and actions, AI agent, team), published at once, or as a draft that an administrator puts live with one click. |
| update_scenario | mcp:write OAuth connection required | Replace a scenario, published at once if it comes from the API or Claude, or as a draft, the console’s included, if nobody changed it in the meantime. |
| delete_scenario | mcp:write OAuth connection required | Delete a scenario created through the API or by Claude, if nothing uses it any more. |
| send_scenario_to_contact | mcp:write OAuth connection required | Prepare starting a published scenario for one person, even outside the 24-hour window, through its opening template: it goes out on an administrator’s click in the console, once, with the sends rules (STOP, monthly templates); the person’s agreement is declared by the client. |
| list_scenario_versions | mcp:read | The published versions of a scenario, most recent first, and the one that is live. |
| propose_go_live | mcp:write OAuth connection required | Prepare a go-live (publish a draft, restore a version, set the responder): returns the link of the page where an administrator accepts it with one click; nothing happens before that click. |
| get_go_live | mcp:read | Where a go-live or the button of a prepared send stands: waiting for the click, done or stopped, and the result of each action (the id of a send that went out). |

### Chat bubble

| Tool | Scope | What it does |
| --- | --- | --- |
| list_widgets | mcp:read | The workspace’s WhatsApp widgets, with the tag to paste on the site. |
| create_widget | mcp:write | Create a WhatsApp widget, with the screen’s checks, and get its tag. |
| update_widget | mcp:write | Edit a widget; its tag never changes. |

### Shopify store

| Tool | Scope | What it does |
| --- | --- | --- |
| connect_shopify | mcp:write OAuth connection required | Connect the merchant’s Shopify store with the app the shopify skill created in its organization; the connection is checked with Shopify before the secret is kept, encrypted. |
| set_shopify_message | mcp:write OAuth connection required | Set the first message of a Shopify event’s automation (order paid or fulfilled, abandoned checkout), or turn it off: an approved template, with Shopify data, through the sends rules (STOP, monthly templates, contact limit); the rest of the scenario is set in the console. The customer’s record becomes opted in, under the merchant’s responsibility. A number linked by QR code cannot send them: it never writes first. |
| get_shopify_state | mcp:read OAuth connection required | The connected Shopify store: its state, its pause, its automations (on or off, their first template and its status at Meta, their number of steps), the last event received, the last 30 days of outcomes, the last 7 days of checkouts, and the Shopify tags read with the state of their sync. |
| preview_shopify_customers | mcp:read OAuth connection required | Count, writing nothing, the Shopify customers subscribed to marketing (email or SMS) who have a phone: already in the workspace, new, free places of the plan, importable. |
| import_shopify_customers | mcp:write OAuth connection required | Import the subscribed Shopify customers the merchant chose, newest first: records tagged Shopify, opted in by the client’s declaration, within the plan’s limit. |
| preview_shopify_order_history | mcp:read OAuth connection required | Count, writing nothing, the paid orders of the Shopify store (60 days, or 24 months on Pro when the app has the read_all_orders scope): already known, to attach, buyer records to create within the plan’s free places, without a record or a phone, never paid. |
| import_shopify_order_history | mcp:write OAuth connection required | Catch up the paid orders (60 days, or 24 months on Pro when the app has the read_all_orders scope): each one joins the record of its phone, or the one created for its buyer, opted in on the strength of the merchant’s attestation, with its amount and products; no message sent. |
| get_shopify_order_history | mcp:read OAuth connection required | The state of the last orders catch-up: running, done or stopped, and its counts (read, attached, records created, over the plan’s limit, already known, without a record, without a phone). |
| sync_shopify_customer_tags | mcp:write OAuth connection required | Turn on and start, or turn off, the sync of the tags the merchant puts on their customers in Shopify: a list of their own, never mixed with the Messaging Me tags; no record created. Refreshed daily on the Pro plan, on demand at most once every 24 hours on the Free plan. |
| disconnect_shopify | mcp:write OAuth connection required | Cut the Shopify store: no message leaves anymore, the store’s privacy requests are still honored. |

### Webhooks

| Tool | Scope | What it does |
| --- | --- | --- |
| create_webhook_endpoint | mcp:write OAuth connection required | Register the HTTPS address of the app that will receive the chosen events (signed outgoing webhook); the signing secret is shown only once. |
| list_webhook_endpoints | mcp:read OAuth connection required | The outgoing webhook endpoints, their event types and status, and the plan limit. |
| update_webhook_endpoint | mcp:write OAuth connection required | Edit an endpoint: its event types, a pause, or a new secret, shown once. |
| delete_webhook_endpoint | mcp:write OAuth connection required | Delete an endpoint and its log; to change its URL, delete it and create it again. |
| send_test_event | mcp:write OAuth connection required | Send a signed test event to an address right away, and read what the app answered. |
| get_webhook_deliveries | mcp:read OAuth connection required | An endpoint’s log: each delivery, its status, the app’s answer and the body sent. |
| replay_webhook_delivery | mcp:write OAuth connection required | Replay a finished delivery: same body, same event id. |

### Statistics

| Tool | Scope | What it does |
| --- | --- | --- |
| get_message_stats | mcp:read | Message figures as chart-ready series: templates sent, delivered, read, failed; with the plan’s statistics, categories, exchanges, contacts and estimated cost. |
| get_campaign_stats | mcp:read | The period’s campaigns with their estimated cost, clicks and Meta errors, or one campaign’s funnel. |
| get_ai_stats | mcp:read | AI agent figures: cost of agent turns on the credit, messages written by AI, requests opened for the team and actions triggered. |
| get_revenue_stats | mcp:read | What your WhatsApp sends brought in on the Shopify store: gross revenue per currency, its proven part, the breakdown by source, and the checkouts reminded and recovered; test orders apart. |
