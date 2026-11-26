---
description: Connect your CRM or shop: declare the system, set up a call, try it, then give it to an AI agent or a scenario.
slug: connect-an-api-connector
traduit_de: 10e4de
---
# Connect an API connector

An API connector links Messaging Me to one of your systems (CRM, shop, booking tool, back office). You declare it once
in Tools > API connectors, set up calls in it, then your AI agents, Meta's agent and your scenarios use it to read a
piece of information or to send one.

**1. Connect the system.** In Tools > API connectors, "Connect a system": a name for you, the base address of your API,
its authentication, then "Connect".

- The address is HTTPS and public: your agents will never call anywhere outside it.
- Authentication is a token (Bearer), a named header, a username and password (OAuth), or none. The secret is
  encrypted on our side and is never shown again, not even to us: to change it, type the new one then "Replace".
- With "Username and password (OAuth)", also give the token address, the client_id and the username: Messaging Me
  requests the token and renews it on its own.
- A system is shared by the whole workspace: its line says how many agents, calls and scenarios use it.

**2. Test it, then activate it.** Expand the system, enter a path of your API, then "Test". The verdict shows with its
date. "Activate", on the line, then opens the system to your agents.

- The test makes a real call with your authentication: it is the only place where an expired token shows up before
  a customer runs into it.
- A system that does not answer within ten seconds, cuts its answer short or answers too much is refused, with the
  reason.
- "Disable" keeps the system and its tools, but every call fails and says why. "Delete" removes it, which is refused
  while it still carries calls.

**3. Add a call.** Under the system, "Add a call": its name, the method (GET, POST, PUT, PATCH, DELETE) and the path,
relative to the system's address, for example /orders/{{ref}}.

- Variable parts are inserted with the chips of the "Insert:" line; a chip that points to no data is flagged, with a
  button to declare it.
- A DELETE call makes its tools irreversible: the agent will have to be allowed to act alone to use it.

**4. Say what is sent.** The "Data sent" tab declares each piece of data and "Where its value comes from": decided by
the agent, the contact record (number, name, external ID), its latest analysis and risk, a custom field, a system
value (the date, the contact's last message) or a fixed value.

- Mark "Required" a piece of data without which the call must not go out.
- A customer ID comes from the record, never "decided by the agent": this is what stops a contact from getting
  someone else's order.
- The "URL params", "Body" and "Headers" tabs place this data. The body is written as a field list or as raw JSON
  (switching to JSON cannot be undone); in the JSON, a chip goes between quotes, and "Fix it" does it for you.
- To send a document received in a scenario (photo, PDF), choose the "form with file" body and tick "file" on the line
  holding the chip of the document's field: the file itself is sent, and only a scenario API Call block runs this
  call.
- A piece of data taken from a JSON field can have the "JSON" type: in a raw JSON body, it is sent as is, as an object.
  Images in a response stored in a JSON field are never kept.
- Authentication does not go in a call's headers: it lives on the system.

**5. Try, tick, save.** "Try" runs the call with your test values and shows what went out, the status, the duration
and the response. In the "Response (default)" tab, tick the useful fields, then "Save".

- What you tick is only a default: each agent chooses what it may read when you give it the call.
- An unfinished call can still be saved, as a draft, to come back to later.
- Editing a call applies at once to the agents and scenarios that use it, and a call in use cannot be deleted: its
  line says by whom.

**6. Give it to an AI agent.** In the agent, Tools tab, "Add a tool", then "Call an API connector": pick the call,
"Add to this agent", and answer "What does this call do?".

- "It pushes information to your system" (tag a record, create a contact): the agent will only know whether it
  went through.
- "It fetches information, which the agent brings into the conversation": "Try it to see the response", then tick
  what the agent may read. Only these fields reach the model provider.
- Give it its words: the name the agent sees, what it is for, and when not to call it. The tool starts out
  "Inactive"; activate it once you have read it over.

The same call also serves Meta's agent (see "Give tools to Meta's agent"), the API call block of a scenario (see "The
API call block") and the unsubscribe notice sent to your system (see "Track unsubscribes").
