---
slug: give-tools-to-an-ai-agent
traduit_de: c084ae
description: Give tools to an AI agent: the always-there moves, then a tag, a detail, a block, a scenario, an action or chained steps.
---
# Give tools to an AI agent

By default, your AI agent talks. A tool gives it the right to do something: finish, hand over, search its base, tag
the contact, send a block, start a scenario, call your system. Everything is set in the agent’s “Tools” tab, and the
agent only sees the active tools.

Mind the vocabulary: the Tools menu of the left bar declares your systems, shared by the whole workspace; an agent’s
Tools tab says what THIS agent may do.

**1. Activate the “Always there” moves.** At the top of the tab, “Always there” lists the five moves of the AI agent:
click “Activate” on each one it needs.

- “Finish through a stop rule”: the agent hands back to the scenario through the chosen output, after a last message
  to the contact. Its stop rules, optional, are set in its settings (“Edit”): a case where the agent simply stops, for
  example if the customer insults it. With no rule, it stays active but the model sees nothing of it, and the line says
  so.
- “Hand over to a human”: the conversation moves to “To handle” at once and stays there until someone answers; the
  journey leaves through “Handed to a human”. The agent never takes the floor again on its own. Its “When to call it”
  says when to hand over, the way you would say it: “as soon as a refund comes up, or if the contact gets upset”. The
  “Build by talking” assistant fills it in and enables it when you answer. In “Edit”, “When your team is reachable”
  says what this agent promises: an advisor “At any time”, “Only during business hours” (outside your hours, it says
  when the team is back) or “Never live”. Each agent has its own; the hours are those of “Settings” > “General”.
- “Search the knowledge base”: to call before any substantive question.
- “Read the contact record”: their name, their fields and their latest analysis (sentiment, satisfaction, urgency,
  topic). Their fields include those HubSpot imports and the tracking link of their last Shopify parcel. If a Shopify
  store is connected, their recent orders too: payment, amount, products, shipping. Never someone else’s record.
- “Mark the conversation as urgent”: it moves to the Inbox “Urgent” folder, and the agent keeps answering.
- With no active tool, the agent can talk, but cannot do anything, not even finish.

**2. Set a tool’s words.** “Edit”, on a move’s line: the name seen by the model, “When to call it” and “When not to
call it”. Each field saves when you leave it.

- On a tool added from the grid, “Edit” reopens its form, to save with “Save”.
- These two sentences are what the model reads to decide: taking care of them changes a lot of what the agent does.
- “And also do this” adds a move at the time of the call: tag the contact, or write a value into a field.
- “See what the model sees” shows the tool exactly as it is offered to the model.
- An agent never carries two tools with the same name: the second is refused, because the model would refuse the whole
  list and the agent would stop answering.

**3. Add a tool.** Under “Its tools”, “Add a tool” opens the “Which tool to add?” grid: pick the card for what the
agent must do.

- Nine cards: Tag the contact, Save a detail, Send a block, Start a scenario, Call an API connector, Call an MCP tool,
  and three of the AI agent’s own: Trigger an action, Chain steps, Qualify and hand over.
- A card with nothing to offer is greyed out, with the link to the screen where you create it.
- For the tag, the detail, the block and the scenario, you set the target, one per tool: the agent only decides when.
  It can therefore neither make up a tag nor pick another field.
- Each tool is set with a title, a technical name (seen by the model) and its two instructions, pre-filled: a gap in
  brackets must be completed before “Save”.

**4. Tag the contact.** “Tag the contact” card: the tag to set, the tool’s words, then “Save”.

- To find the contact again in the mini-CRM, or to start an automation on that tag.

**5. Save a detail.** “Save a detail” card: the record field, and if you want to restrict it, the list of allowed
values, one per line.

- The agent provides the value, taken from the conversation; with a list, any other value is refused.
- The field list starts with the base fields (First name, Last name, Email), then your fields in alphabetical order.
- The field is named in what the agent reads, and the proposed title quotes it until you rewrite it.
- One more detail, to use elsewhere in a scenario: a later block reuses that field.

**6. Send a block.** “Send a block” card: the scenario, then the block to send. Tick “Allow the agent to do this on its
own”, then “Save”.

- The block goes alone, without what follows, and the agent keeps the conversation.
- A block that waits for a reply, opens an agent or goes out over RCS is greyed out, with its reason.
- What reaches the customer needs your consent: without the box, every call is refused, and the tool’s line says so. A
  message sent cannot be recalled, and it is billed.

**7. Start a scenario.** “Start a scenario” card: one of your live scenarios, started from its beginning. Tick “Allow
the agent to do this on its own” as well.

- The scenario takes the conversation and the agent steps back: it writes nothing more, and no output of its block is
  taken.
- A scenario unpublished or deleted, or an unsubscribed contact, is refused, and the agent carries on the conversation.
  The agent cannot restart the scenario it is talking in.

**8. Call an API connector.** “Call an API connector” card: pick a call declared in Tools > API connectors, “Add to
this agent”, and give it its words. The full move is in “Connect an API connector”.

- The tool belongs to the workspace, the permission to the agent: the same call serves several agents, and changing its
  words changes them for all. The Tools tab of Meta’s agent names the AI agents that share it.
- “Edit”, on its line, reopens the pre-filled form, without losing the activation.
- A DELETE call is irreversible: it also needs “Allow the agent to do this on its own”.

**9. Call an MCP tool.** “Call an MCP tool” card: the list of tools imported in Tools > MCP connectors that the agent
does not have yet. “Add” gives it one.

- Its parameters are set in MCP connectors, not here.
- If its server changes a tool’s shape, the permission switches off: a “What changed without you” banner says so at
  the top of the record, with the link to the tab.

**10. Trigger an action.** “Trigger an action” card: its name (“Cancellation”), its instruction (when to trigger it,
and what the agent then tells the customer), then the details to collect, with “+ Add a field”.

- Up to ten fields, all optional: text, number, date, email or list of values. The agent goes with what it has; a
  badly formed date or email is sent back to it, and it asks again.
- When the customer makes the request, the agent answers what the instruction says and carries on. Your application
  receives the “AI agent action” event, once a day at most per contact and per action.
- That event is unticked by default: tick it on an address in Developers > Outgoing webhooks, otherwise nothing goes
  out, and the card reminds you. An automation can also start from the action (Scenario > Automation > Other).
- A field’s code is the key your application reads: it follows the label while the field is new, do not change it
  afterwards. Ten actions per agent at most.

**11. Chain steps.** “Chain steps” card: the title and “When to call it”, then “First step”, “+ Add a step”, and “Move
up” or “Move down” to order them.

- Seven kinds of step: ask for a detail, save a fixed value, set a tag, mark the conversation urgent, send a block,
  start a scenario, hand over to “To handle”.
- Example: ask for the first name, last name, campus and course, then start the scenario that passes the contact to
  your team.
- If an answer is missing, the agent asks all the questions in one message, once, then runs everything with what it
  has, even if the contact refuses.
- Two rules, which the screen recalls: a scenario or a handover goes last, only one of the two; no block or scenario
  before a question. As soon as a block or a scenario is part of it, tick “Allow the agent to do this on its own”.

**12. Qualify and hand over.** “Qualify and hand over” card: “When to call it” is already filled in (the contact wants
to talk to someone on the team). Add your questions with “+ Add a question”, each with its field.

- The agent asks your questions in one message, once, then moves the conversation to “To handle”, even if the contact
  answered nothing.
- As with “Hand over to a human”, its last sentence only goes out if it answers the number alone or the team is
  closed; otherwise, what follows your scenario’s “Handed to a human” output does the talking.
- You have to choose: qualify first, or hand over at once. This tool cannot live with “Hand over to a human”, nor with a
  stop rule ticked “hands over to a human”: activating one while the other is there is refused, and the message says
  what to deactivate first.

**13. Activate the tool.** A tool added is born “Inactive”: reread its line, then “Activate”. Until it is, the agent
does not even know it exists.

- The line says what keeps a tool from working: a system switched off, an action that reaches the customer without
  permission, a target that can no longer be read.
- “Deactivate” keeps it with its settings. The cross deletes it; a connector call or an MCP tool is then only removed
  from this agent.
- The activation keeps the name of the person who gave it.
