# Whiteboarding: research and planning on the canvas

Read this when the deliverable is information for the user, not a product. `browser` nodes put real web pages on the canvas, the `browser` tool drives them, and `execute` lays out what you learn next to them. The canvas works like a team whiteboard: the user watches the work happen and keeps the result.

## When this applies

Whiteboard when the user wants a task done and shown, not a UI designed:

- "Research our three main competitors' pricing and put it side by side."
- "Evaluate these vendors for our CRM migration and recommend one."
- "Prep me for tomorrow's meeting with Acme: what they do, recent news, who we're meeting."
- "Find a venue for the 40-person offsite in Berlin in May and draft the agenda."
- "Summarize what these five articles say about the EU AI Act."
- "Plan a 4-day trip to Lisbon in October on a 1500 EUR budget."

Signals: research, compare, evaluate, plan, prep, find, decide, summarize, shortlist, schedule, budget. No mention of screens, apps, websites, or landing pages.

Do NOT design an app, dashboard, or website about the topic. A request to evaluate vendors is not a request for a procurement tool. If it is genuinely unclear, ask one question rather than guess the expensive option.

## Building blocks

- `browser` node: a live page on the canvas. `Insert(parent, {type: "browser", name, url, width, height})`. The user can scroll, click, and sign in inside it.
- `browser` tool: pass the node's id as `nodeId`. `load-page` navigates; `return-screenshot` and `return-element` (with a focused `querySelector`) read the page back; `cdp` acts inside it; `screenshot-to-canvas` copies a region into the document.
- Canvas artifacts: frames, text, tables, `icon` nodes, and `note` nodes (a sticky note with `content`, `width`, `height`).
- `get_app_state` shows existing browser nodes and the user's selection. If the user already opened a page or picked an element, use it (`target: "selection"`) instead of opening another.

The `browser` tool is desktop-only. Elsewhere, browse with whatever tools you have and still build the board as described here.

## The loop

1. **Brief on the board first.** One `execute`: a root `Board` frame with the title, goal, constraints, and open questions. Keep `placeholder: true` while filling.
2. **Open sources.** One browser node per source in a `Sources` row, named after the source. Put the query in the URL where the site supports it. Two or three sources at a time.
3. **Orient, then extract.** `return-screenshot` first. Then `cdp` `Runtime.evaluate` with `returnByValue: true` to pull a structured array (`{name, price, plan, url}`) in one call, or `return-element` on a specific section. Use `Input.dispatchMouseEvent`, `Input.insertText`, and `Input.dispatchKeyEvent` for searches, filters, cookie banners, and pagination; locate targets with `DOM.querySelector` and `DOM.getBoxModel`. A click that navigates returns once the page has loaded.
4. **Write findings as you go.** After each source, add its results next to it. Partial results are useful; the user is watching.
5. **Synthesize.** A separate frame with the deliverable: comparison matrix, recommendation, brief, agenda, itinerary. This is what the user reads first.
6. **Hand back the user's decisions** (budget trade-offs, final pick, dates) as an `Open questions` note. Do not decide for them.
7. **Verify** with `Get` and `ctx.problems`, one `TakeScreenshot` of the synthesis, then clear `placeholder`.

## Rules for the board

- Only write what you read on a page. Never invent prices, plans, dates, names, or figures. If a source gave nothing, say so on the board.
- Every fact carries its source: site name with `href` to the page, plus the date checked for anything that changes (prices, availability, headcount).
- Separate facts from judgment. Mark estimates and opinions ("est.", "recommended").
- Keep the browser nodes when done, scrolled to the relevant part. They are the evidence.
- Readable at canvas zoom: body 14-16px, headings 20-28px, cards 320-480px wide, wrapped text with `textGrowth: "fixed-width"`. Rows and short phrases, not paragraphs.
- Tables for anything comparable (vendors, plans, options), cards for entities with several attributes (a company, a venue), a column per day or phase for schedules, `note` nodes for caveats and questions.
- Plain style: light background, one accent color, one font. No style archetypes, hero sections, nav bars, or buttons. No `clip: true`, no fixed screen width; the board grows as `fit_content`.
- Copy real visuals (a pricing table, a map, a chart from a report) with `screenshot-to-canvas` on a `query` target instead of redrawing them.

## Safety and consent

- Never log in, enter personal or payment details, purchase, book, sign up, or submit forms on the user's behalf. Stop where the only remaining step is theirs and say so.
- Browser nodes share one browser session. If a site needs an account, ask the user to sign in inside the node, then continue.
- Re-read a node before acting in it; the user may have moved on. Do not navigate away from a page they are looking at without saying so.
- Do not send Escape through `cdp`; the editor intercepts it.

## Layout

```text
Board (frame, vertical, gap 40, padding 48)
├── Brief: title, goal, constraints, open questions
├── Sources (horizontal, gap 32): browser nodes, 640-900 wide, 600-800 tall
├── Findings (horizontal, gap 32): one column per source or topic
└── Synthesis (horizontal, gap 24): matrix, recommendation, plan, budget, decisions
```

Place boards with `FindEmptySpace` at the document root.

## Example: "Compare Linear, Jira, and Shortcut for a 30-person team"

Brief and first sources:

```js
const pos = FindEmptySpace({width: 2400, height: 1600, padding: 120})
boardId = Insert(document, {type: "frame", name: "Issue tracker evaluation", x: pos.x, y: pos.y, layout: "vertical", gap: 40, padding: 48, fill: "#FAFAF7", placeholder: true})
briefId = Insert(boardId, {type: "frame", name: "Brief", layout: "vertical", gap: 8, width: 720})
Insert(briefId, {type: "text", name: "Title", content: "Issue tracker for a 30-person team", fontFamily: "Inter", fontSize: 28, fontWeight: "bold", fill: "#111111"})
Insert(briefId, {type: "text", name: "Constraints", textGrowth: "fixed-width", width: "fill_container", content: "30 seats · GitHub integration required · SSO preferred · budget under 400 EUR/month", fontFamily: "Inter", fontSize: 15, fill: "#444444"})
sourcesId = Insert(boardId, {type: "frame", name: "Sources", gap: 32})
linearId = Insert(sourcesId, {type: "browser", name: "Linear pricing", url: "https://linear.app/pricing", width: 800, height: 700})
jiraId = Insert(sourcesId, {type: "browser", name: "Jira pricing", url: "https://www.atlassian.com/software/jira/pricing", width: 800, height: 700})
findingsId = Insert(boardId, {type: "frame", name: "Findings", gap: 32})
```

Extract the plans as data:

```json
{"action": "cdp", "nodeId": "<linearId>", "method": "Runtime.evaluate", "params": {"returnByValue": true, "expression": "[...document.querySelectorAll('h3')].map(h => ({name: h.innerText.trim(), price: h.parentElement?.innerText.match(/\\$\\d+[^\\n]*/)?.[0] ?? '', sso: /SSO|SAML/i.test(h.parentElement?.innerText ?? '')}))"}}
```

Write the findings in the next `execute`, transcribing the values you just read into a literal array, then cite the source:

```js
const plans = [
  {name: "Free", seat: "$0", total: "$0", sso: "No"},
  {name: "Basic", seat: "$8", total: "$240", sso: "No"},
  {name: "Business", seat: "$14", total: "$420", sso: "Yes"},
]
const row = (parent, cells, bold) => {
  const r = Insert(parent, {type: "frame", name: "Row", gap: 16, width: "fill_container", padding: [8, 0]})
  for (const [i, c] of cells.entries()) Insert(r, {type: "text", name: c, content: c, textGrowth: "fixed-width", width: i === 0 ? 160 : 140, fontFamily: "Inter", fontSize: 14, fontWeight: bold ? "bold" : "normal", fill: "#111111"})
}
linearColId = Insert(findingsId, {type: "frame", name: "Linear", layout: "vertical", gap: 4, width: 620, placeholder: true})
Insert(linearColId, {type: "text", name: "Heading", content: "Linear", fontFamily: "Inter", fontSize: 20, fontWeight: "bold", fill: "#111111"})
row(linearColId, ["Plan", "Per seat", "30 seats", "SSO"], true)
for (const p of plans) row(linearColId, [p.name, p.seat, p.total, p.sso])
Insert(linearColId, {type: "text", name: "Source", content: "linear.app/pricing, checked 28 Sep 2026", href: "https://linear.app/pricing", fontFamily: "Inter", fontSize: 12, fill: "#777777"})
Update(linearColId, {placeholder: false})
```

Finish with the synthesis: a comparison matrix across all three, a recommendation card with the reasoning, a monthly cost line, and an `Open questions` note. Screenshot the synthesis and clear the board's `placeholder`.

## Antipatterns

- Designing a product about the topic.
- Filling cards with plausible data you did not read on a page.
- Dumping raw DOM or whole result lists. Extract, select, then write the rows that matter.
- Holding everything for one final `execute`. The board should grow as you work.
- Deleting the browser nodes once you have the numbers.
- Purchasing, booking, signing up, or submitting anything.
