---
slug: build-an-ai-agent
traduit_de: 6df49b
description: Create a WhatsApp AI agent, set it up by talking to the assistant or tab by tab, activate it, then have it answer your customers.
---
# Build an AI agent

An AI agent is a responder you build yourself and place where you need it: in the “AI agent” block of a scenario, to
answer the customer the way Meta’s agent does, or on the WhatsApp stage of a campaign. Outside these three places, it
does not speak.

This page follows the build step by step. Each topic then has its own page: “Fill an AI agent’s knowledge base”, “Give
tools to an AI agent”, “Test an AI agent and read its history”, and “An AI agent’s model, credit and guardrails”.

**1. Create the agent.** In AI Agent > Other AI agent, “Create an agent” card: type an internal name, then “Create”.

- The internal name is the one you see in the list and in the scenario builder. The contact never sees it.
- Each line of the list shows the logo of the model that makes the agent talk, then its badge: Draft, Active or
  Disabled.
- “Delete”, on the line, erases the agent with its conversations, its tools and its knowledge base, and the scenario
  blocks that use it stop answering. The confirmation says so before the click.
- With no AI credit, creation is refused, with a message telling you to top up.

**2. Choose your path: the assistant or the tabs.** The agent’s record always opens on “Build by talking”. Its nine
tabs are in the left column: both paths lead to the same agent.

- Take the assistant when you start from scratch: it asks every question needed, one at a time, and leaves no setting
  aside. It is the safest path for a first agent. It is part of the Business plan: on the Pro plan, the tab says so,
  and the other tabs stay open.
- Take the tabs when you already know what to write, or to adjust a single setting: Identity and tone, Objective and
  handovers.
- Everything the assistant writes stays editable in the tabs, field by field. Each field saves when you leave it, with
  no button.
- The open tab is part of the address: the record can be shared by a link, and a refresh brings you back where you
  were.

**3. With the assistant: describe your business.** Write what your agent is for, or click one of the two examples.
The assistant then goes round the topic, one question at a time.

- It covers, in order: what the agent is there to do, what it never talks about, where its substantive answers come
  from, what a conversation that ends well looks like, the moments when it must do something other than answer, when
  it lets go of a silent contact, when a human takes over, under what name it introduces itself, whether it says it is
  an AI, and how it talks.
- You can answer with the number of a choice (“4”). If you mention several moments at once, it takes them one by one.
- If you say the agent acts on its own (“it books the appointment”), it asks by what means: a tool, a connector. If
  nothing that exists fits, it says so instead of making one up.
- As long as a point is not settled, it shows nothing and says how many are left. If you had already answered while
  describing your business, it just asks you to confirm.

**4. With the assistant: give it your website.** Give your website’s address when it asks where the substantive
answers come from: its pages are read and split into entries while you carry on.

- The entries wait for you in the Knowledge base tab, to reread and fix. A site already imported by hand is not read
  again, so as not to overwrite your fixes.
- The “Attach a file” paperclip adds a document or a photo to the base: see “Fill an AI agent’s knowledge base”.

**5. With the assistant: keep, edit or drop each line.** Once the topic is covered, it shows “What this would change”:
each proposed setting, with the previous value struck through. Reread, then “Save”.

- Nothing is written to the tabs before that click: the assistant proposes, it changes nothing on its own.
- Everything is kept at first. Each line has two buttons, “Keep” and “Drop”, and its text can be edited in place.
  Once a line is dropped, the button says how many lines will be saved (“Save the 4 kept”). “Drop all” discards the
  proposal.
- After “Save”, a box tells you what comes next: “Your agent is ready.”, with “Activate the agent” and “Test it”; or,
  if something is still missing, the list of what is missing, each line leading to its tab.
- Stop rules are kept or dropped as a block: they are edited afterwards in Objective and handovers.
- A moment when the agent must start a scenario: name one of your live scenarios when it lists them. The proposal then
  carries a “Start a scenario” tool line, and “Save” places the tool, “Inactive”, in the Tools tab.
- It can also connect or disconnect a tool from your library if you ask, never create one. Connecting does not
  activate.
- It may not write the AI disclosure, the caps or the model, nor activate a tool.

**6. With the assistant: follow the closing list.** Its last message lists, in order, what is left to do: save the
proposal, import the site, connect the connector a moment needs, activate a scenario’s tool, check the model, test,
activate.

- The list is computed from the agent’s real state: a step already done is not in it.
- The conversation is kept, and shared between admins: each of your messages carries its author’s address.
- Reopened later, the assistant recalls the agent’s state and waits for your request. If a field set during the
  interview has been emptied since, it asks you whether that is intended.
- “Restart” erases the conversation and starts over, without touching what is saved in the tabs.

**7. By hand: Identity and tone.** “Identity and tone” tab: the internal name, the name given to the contact, the tone,
the personality and the AI disclosure.

- Left empty, the name given to the contact makes an agent that gives itself no name.
- Write the tone as you would tell a new hire: “formal, short sentences, no emoji”.
- The AI disclosure can never be empty: see “An AI agent’s model, credit and guardrails”.

**8. By hand: Objective and handovers.** “Objective and handovers” tab: the agent’s objective in a sentence or two,
then when to hand over to a human, in plain words.

- The objective is the field that weighs most on what the agent will answer.
- For the handover, write it the way you would say it: “as soon as a refund comes up, or if the contact gets upset”.

**9. Declare the stop rules.** Further down the same tab, “Stop rules”: a code, what it means, then “Add”. A stop rule
is “when the agent has finished doing this, it leaves through there”.

- Each rule becomes an output of the AI agent block, to connect to the rest of the journey: see “The AI agent block”.
  Twelve at most.
- The code is formatted as you type, and a code already in use is flagged.
- The “hands over to a human” box changes nothing in what the rule does (your scenario does the routing): it says the
  rule leads to the team.
- With no rule at all, the agent only leaves through the block’s five automatic outputs.

**10. Read the header and finish the steps.** At the top of the record: the model’s logo, the agent’s name, its model,
its badge, and “n steps left”. Each step leads to the tab where it is set.

- A step is an empty field that prevents activation: objective, handover rule, stop rule, knowledge base, active tool.
  Never a judgement on what you wrote. “All set” when none is left.
- The number of messages exchanged over 30 days counts the whole thread of the conversations the agent held, campaigns
  and your team’s messages included: it is not what the agent wrote itself, nor the same count as the Home screen. Your
  tests are not included, and as long as it is not known, nothing is shown.
- On a phone, the column of tabs becomes a bar at the top again.

**11. Activate the agent.** “Activate”, next to the badge. The agent can then be chosen in a scenario’s AI agent block,
in “Who answers the customer” and in a campaign’s choice of responder.

- Activated means it can be chosen, not “it answers everything”: answering everything is chosen on the Home screen, at
  the next step.
- An incomplete agent is refused, and the header lists what is missing.
- Try it first: see “Test an AI agent and read its history”.
- “Deactivate” silences it: a block that uses it flags it, and no longer answers until it is reactivated. “Delete”, at
  the top of the record, erases it.

**12. Have it answer the customer.** On the Home screen, “Who answers the customer” card: tick “An AI agent”, pick the
agent among your active agents, then “Save”. The agents page links there.

- It then answers every WhatsApp message that neither a scenario, nor a keyword, nor a member of your team is handling,
  taking into account what the contact has just written. Admins only.
- Meta’s agent stays on, on standby: it only takes the contacts a “Send to MBA” block or a campaign hands it. If it was
  the one answering, the Home screen asks you to confirm, because it stops answering the conversations it holds.
- With no scenario behind it, a stop rule or “No reply” ends its conversation; “Handed to a human”, “No source”, “Cap
  reached” and “Technical failure” pass it to your team, in “To handle”.
- The Inbox Detail panel notes each exit (“The AI agent has finished”, with the rule), and the contact’s next message
  starts the agent again (after a handover, once your team has handed back control). A reaction, a thumbs up for
  example, does not make it answer.
- Deactivating or deleting the agent that answers removes it from this role: messages then go to your team. The screen
  tells you before, and the Home screen flags it.
- Elsewhere, it answers in a scenario through the AI agent block (see “The AI agent block”), or to the first reply of a
  campaign’s contacts, if you choose it at the Content step, in the responder choice.
