# Using the `execute` tool on the pen.dev canvas

- The `execute` tool executes a small javascript snippet to modify the document.

- In case of an error, all modifications and the created globals will be reverted.
- When an `execute` call fails, ALWAYS fix it with the `edits` parameter and the `editId` from the failure message - never resend the snippet. If the patched snippet fails again, keep fixing it with further `edits` under the same `editId`; `find` must then match the snippet as already patched.
- A list of warnings will be returned in the response message. Always Fix them in the next execute call.

- Use normal JavaScript to generate repeated design structure: arrays, `for...of` loops, computed values, conditionals, object spreads, helper functions, and template strings are all useful.
- Be smart about writing JavaScript to remove duplication and minimize the length of the generated code.
- Prefer loops/spreads/helpers over long handwritten repetitive code when creating nav items, table rows, cards, metrics, menus, or similar repeated UI.
- Do not include comments in the generated `execute` JavaScript snippet. Keep the input small.

- You MUST set the `name` property with a human readable name on every node and child node you add. This will make the document cleaner and easier to understand. A mapping from names to ids will be returned at the end of each `execute` call so you can reference the created nodes in the next calls.

- When creating style objects that are then spread when creating nodes. Make sure to include `type` in the style object.
- Never set `id` when creating, copying, or replacing nodes or components. pen.dev will always generate unique random IDs and override the input.

- Always prefer the returned node id in the `ref` property when creating instances.
- Use `Get` to read node data, including nodes created earlier in the same call.
- `Insert`/`Copy`/`Replace` return plain id strings. To access the children of a newly created node, read its subtree with `Get` first, e.g. `Get(rowId, {depth: 1}).children`.

- Each `execute` is executed in its own scope. Local variables and helper functions are NOT shared between `execute` calls. To persist values between calls, don't use `const` or `let` when declaring variables, use `myNodeId = Insert(...)`.

## `execute` API

Only these functions are supported in `execute`. Use other tools for other operations.

```ts
const document: string; // predefined root node

// Mutations
function Insert(parent: string, nodeData: Child): string; // returns the inserted node's id
function Copy(path: string, parent: string, copyNodeData?: Child): string; // returns the copied node's id (descendants get new ids - Get the copy to read them)
function Update(path: string, updateData: Child): void;
function Replace(path: string, nodeData: Child): string; // returns the replacement node's id
function Move(path: string, parent: string | undefined, index?: number): void;
function Delete(path: string): void;
function Generate(type: "ai" | "svg", nodeId: string, prompt: string): void; // generate an image fill or an SVG drawing - see generate.md
function Generate(type: "stock", nodeId: string, query: string): void;
function Generate(type: "vectorize-image", nodeId: string, imageUrl: string): void;
function Generate(type: "remove-background", imageUrl: string): string; // returns the new asset url
function Generate(type: "replace-background", imageUrl: string, prompt: string): string;
function SetVariables(variables: Record<string, VariableDefinition>, replace?: boolean): void;

// Reading
function Get(path: string, options?: GetOptions): Child; // one node, children nested
function Get<T>(path: string, visit: Visit<T>, options?: GetOptions): T[]; // visit a subtree
function Get<T>(visit: Visit<T>, options?: GetOptions): T[]; // visit the whole document
function GetVariables(): { variables: Record<string, VariableDefinition>; themes?: Record<string, string[]> };
function FindEmptySpace(input: { width: number; height: number; direction?: "top" | "right" | "bottom" | "left"; padding?: number; nodeId?: string }): { x: number; y: number; parentId?: string };
function Print(...values: unknown[]): void; // add a line to the execute response: strings raw, other values as JSON, joined with spaces
function TakeScreenshot(nodeIds: string[]): void;
function Export(nodeIds: string[], format: "png" | "jpeg" | "webp" | "pdf" | "html-tailwind" | "html-css", outputPath: string, options?: ExportOptions): void; // export nodes to image or HTML files

type Visit<T> = (node: Child, ctx: Ctx) => T | undefined; // returning undefined collects nothing for this node

interface ExportOptions {
  scale?: number; // image scale factor, default 2
  quality?: number; // JPEG/WEBP quality 1-100
  includeHtmlScaffold?: boolean; // html: full document scaffold, default true
  includeLayerNames?: boolean; // html: layer names as data attributes, default true
  includeLayerIds?: boolean; // html: layer ids as data attributes, default false
}

interface GetOptions {
  depth?: number; // 0 = the node itself; elided children appear as "..."
  resolveVariables?: boolean; // computed values instead of $variable references
  resolveInstances?: boolean; // expand component instances into full subtrees
  includePathGeometry?: boolean;
}

interface Ctx {
  node: Child; // the visited node (= visit's first argument)
  parentCtx?: Ctx; // parent's context; undefined at the top - follow the chain for ancestors
  depth: number;
  index: number; // position among siblings
  bounds: Rect; // resolved bounds in the parent's coordinate space (same space as node x/y)
  problems?: "partially clipped" | "fully clipped"; // node sticks out of its parent
  skipChildren(): void; // don't descend into this node's children
}
```

`Get` arguments are recognized by type, so unused ones are simply omitted: `Get(screen, visit)`, `Get(visit)`, `Get(id, {depth: 1})` all work. There is deliberately no visitor-less whole-document read - it would dump the entire serialized document.

The `path` argument (used by `Get`, `Copy`, `Update`, `Replace`, `Move`, `Delete`) is a node ID, or a slash-separated path to a node nested inside a component instance (`instanceId/childId`). Slashes are only valid for component-instance nesting, not normal layer structure, and work for any nesting depth.

Targets - `path` and `Insert`'s `parent` - are always id/path strings: never pass a node object; when holding a node from `Get`, pass its `.id`. Returned ids concatenate directly: `cardId + "/childId"`, `{[metricLabelId]: {...}}`. To operate on a node you only know by name, find it with a visitor:

```js
Get(n => n.name === "Primary Button" && Insert(n.id, {type: "text", name: "Button Label", content: "RESERVE NOW", fontFamily: "Inter", fontSize: 13, fill: "#111111"}))
```

### Insert

- Insert a new node at the end of the children array of the specified parent node.
- An insert can only be a single node, if you want to add children to it, use the returned id in the next Insert call.
- When working with components (reusable: true), insert their instances as refs with their properties overridden. Override descendant properties inline with the `descendants` map, or with subsequent Update operations.
- Use the Replace to override children inside a component instance, e.g. `Replace("myInstance/childId",{type:"text",...})`
- Returns the inserted node's id as a string.
- To access the children of a newly inserted node, read its subtree with `Get` first (it reflects nodes created earlier in the same call): `Get(rowId, {depth: 1}).children`.

### Copy

- "path": The ID of the existing node to copy. If you want to customize some properties of the copied node, just add them next to the `path` property. If you want to customize nested nodes _under_ the copied one, use the same kind of `descendants` map that `ref` nodes use!

- When copying a node and modifying its descendants, you MUST use the "descendants" property in the Copy operation itself. DO NOT use separate Update operations for descendants of copied nodes, as this will fail due to ID mismatches. The copied node and its descendants receive new IDs, so Update operations referencing the original descendant IDs will fail.
- `descendants`: Optional, used for components. Keys may be node IDs/paths or unique descendant names inside the referenced component. If a name matches multiple descendants, use the node ID/path instead.

- Copying a reusable node creates a connected instance (a `ref` node).
- Returns the copied node's id as a string. The copy's descendants all get new ids - read them with `Get(copiedId)` if you need to modify them individually.

### Update

- Update the properties of existing nodes, without listing their children.
- DO NOT use this to update the node's `children`, use Replace function for that.
- This function CANNOT change the `id`, `type` or `ref` properties of any node!
- `path`: The node to update.

- `updateData`: The node data to update

### Replace

- Replace a node with a new node. All properties including the x/y are replaced.
- This tool is ideal for swapping out parts of a component instance with new nodes.
- Returns the replacement node's id as a string
- `path`: The path of the node which will be replaced
- `nodeData`: The properties of the new node

### Move

- Move a node to a different location in the node tree in a .pen file.
- `path`: The node to move.
- `parent`: Optional. The new parent node. If omitted, the node stays under its current parent.
- `index`: Optional new position of the moved node among its siblings. If omitted, the node is placed at the end.

### Delete

- Delete a node from a .pen file.
- `path`: The node to delete.
- Cannot delete descendants of component instances - emulate the deletion by overriding the descendant's `enabled` property with `false` instead.

### SetVariables

- Define or update the variables and themes of the .pen file. Read existing variables with `Print(GetVariables())` first.
- `variables`: An object keyed by variable name. Each value MUST be an object with a `type` (`"color"`, `"number"`, or `"string"`) and a `value`. Passing a bare value like `"#A3B59A"` or `16` will fail.
- Variable names are arbitrary strings and MUST NOT begin with a dollar sign. The `$` prefix is only used when referencing a variable from a property (e.g. `fill: "$accent"`).
- `replace` (optional, default `false`): when `false`, the variables are merged into the existing definitions. Pass `true` to completely replace the document's existing variable definitions.
- Don't specify themes separately. If a variable uses theming, theme axes and values that aren't yet present in the document are registered automatically. For themed values, pass an array of `{value, theme}` entries.

```js
SetVariables({
  accent: {type:"color",value:"#A3B59A"},
  "spacing-unit": {type:"number",value:16},
  "font-heading": {type:"string",value:"Playfair Display"},
  background: {type:"color",value:[
    {value:"#F8F5F0",theme:{mode:"light"}},
    {value:"#1A1A1A",theme:{mode:"dark"}}
  ]}
})
```

### GetVariables

- Returns the variables and themes currently defined in the .pen file, including changes made earlier in the same `execute` call.
- Use the result to reference existing variables, to avoid overwriting them with `SetVariables`, or to create global CSS rules when generating code from a design.
- Combine with `Print` to read the variables in the tool response: `Print(GetVariables())`.

### Get

- Reflects changes made earlier in the same `execute` call, so you can read back what you just created or modified.
- `path` is a node ID or instance path (with `resolveInstances`, expanded node ids are full `instanceId/childId` paths that `Update`/`Replace` accept).
- Without `visit`, the returned node is pure schema data that round-trips straight into `Insert`/`Copy`/`Update`/`Replace`.
- With `visit`, every read node is visited top-down. Only an `undefined` return collects nothing - a `false` from a `cond && Update(...)` visitor is collected, which is fine when the result is discarded. Skipped nodes' children are still visited unless you call `ctx.skipChildren()`.
- Use `ctx.bounds`/`ctx.problems` to verify layout instead of guessing; `bounds` compares directly against the node's `x`/`y` and feeds straight into `Update`.
- Use `visit` to `Print` one compact row per node you care about, to apply an operation to every matching node in one pass, or to collect nodes when you need the list itself (sorting, slicing, driving loops).
- Keep visitors compact with single-letter parameter names: `(n, c) => ({id: n.id, name: n.name, w: c.bounds.width})`.
- Don't store large `Get` results in globals; only ids and small values are worth persisting between calls.

```js
Print(Get("Xk9f2", {depth: 3}))  // read a node subtree
Get(n => n.reusable && Print(n.id, n.name))  // list all components
Get(screen, n => n.type === "text" && n.fontSize < 12 && Update(n.id, {fontSize: 12}), {resolveVariables: true})  // query and modify in one pass
Get(screen, (n, c) => Print(n.id, n.name, c.depth, c.bounds.width))  // compact overview of a subtree
Get(screen, (n, c) => c.problems && Print(n.name, "in", c.parentCtx?.node.name, ":", c.problems))  // layout problems check
Get(card, (n, c) => c.parentCtx && Math.abs(c.bounds.x + c.bounds.width / 2 - c.parentCtx.bounds.width / 2) > 1 && Print(n.name, "off-center"))
const texts = Get(screen, n => n.type === "text" ? n : undefined)  // collect only when you need the list (sorting, slicing, driving loops)
```

### Print

- Adds one line to the `execute` response so you can read it after the call completes. Each argument is printed raw if it's a string and as JSON otherwise, joined with spaces. Print only JSON-compatible values.
- Keep responses small: for row-shaped data, print compact positional lines from a `Get` visitor instead of JSON objects - your own `Print` call documents what the columns mean. Reserve JSON for single structured values.
- Values printed by a failed `execute` call are not returned.

```js
Get(root, n => Print(n.id, "=", n.name, n.reusable ? "✓" : ""))  // one compact row per node
Get(screen, (n, c) => c.problems && Print(n.name, "|", c.parentCtx?.node.name, "|", c.problems))
Print(GetVariables())
Print(FindEmptySpace({width:1440,height:1024}))
```

### TakeScreenshot

- Renders the given nodes and attaches the screenshots as images to the `execute` response, one per node id. Returns nothing.
- `nodeIds`: the nodes to screenshot; use `"document"` to screenshot the entire document.
- The screenshots reflect the changes made earlier in the same `execute` call.
- Good practice: when an `execute` call finishes a whole section or design, end that same call with a `TakeScreenshot` of it. There is no need to finish the generation first and issue a separate tool call just to screenshot the result.
- Screenshots are expensive - use them sparingly. Take one only after a complete section is done, not in every `execute` call.
- Prefer the smallest meaningful node (a section frame, not the whole document) - large nodes use more tokens and obscure detail.
- Use `Get` with a visitor (`ctx.bounds` carries the resolved bounds) for structural/sizing checks; reach for a screenshot only when visual fidelity (color, type, alignment) is what you need to verify.
- Screenshots of a failed `execute` call are not returned.

```js
heroId=Insert(pageId,{type:"frame",name:"Hero",layout:"vertical",gap:24,padding:64,width:"fill_container"})
Insert(heroId,{type:"text",name:"Headline",content:"Ship faster.",fontSize:64,fontWeight:"bold",fill:"$text-primary"})
Insert(heroId,{type:"text",name:"Subhead",content:"Design at the speed of thought.",fontSize:20,fill:"$text-secondary"})
TakeScreenshot([heroId])
```

### Export

- Exports nodes to files on disk. Returns nothing; the absolute paths of the written files are listed in the response.
- `outputPath`: for image formats a directory - each node is written as `<nodeId>.<ext>`; for HTML formats the path of the output file.
- Image formats (`png`, `jpeg`, `webp`, `pdf`): each node is exported as a separate file at 2x scale by default. For `pdf`, all nodes are combined into a single multi-page `export.pdf`.
- HTML formats (`html-tailwind`, `html-css`): all nodes are exported into one HTML file. Image assets are referenced with relative paths, never embedded.
- Use Export to deliver final assets or hand a design off to code - not to check your work; verify visuals with `TakeScreenshot` instead.

```js
Export([heroId, pricingId], "png", "./exports")
Export([pageId], "html-tailwind", "./landing.html")
```

### Generate

- Brings imagery and vector artwork into the document: `"ai"` and `"stock"` for a new image, `"svg"` for new vector artwork, and `"remove-background"`, `"replace-background"`, and `"vectorize-image"` for an image the document ALREADY has.
- IMPORTANT: There is NO `image` node type. Images are applied as FILLS to existing nodes; SVGs become paths inside a parent frame.
- Every type is async: the result lands after the `execute` call that started it has returned, so a screenshot taken right away will not show it. Never re-generate it, draw the result by hand, or add children to a frame you generated into.
- Read [generate.md](./generate.md) before calling it.

### FindEmptySpace

- Finds an empty `width` x `height` area.
- When placing objects directly to document root and you don't have an exact position, use `FindEmptySpace` at the start of your `execute` to find an empty area for your content. Never overlap root objects.
- Don't just pick random coordinates unless you know exact position from the context or the user request.
- For multiple sequential screens, use the previous element's ID as the `nodeId` parameter in `FindEmptySpace`.
- `direction` (optional, default "right"): where to search, one of "top", "right", "bottom", "left".
- `padding` (optional, default 0): minimum distance from other elements.
- `nodeId` (optional): anchor node used for chaining multiple screens together.
- Returns `{x, y, parentId?}`. Insert or Copy into `parentId` (or `document` if absent) at the returned `x`/`y`.

## Examples

Create the reusable `Metric` component (a vertical frame with a label and a value text), capturing the returned ids:

```js
const pos=FindEmptySpace({width:240,height:96,direction:"top", padding:80})
metricCardId=Insert(document,{type:"frame",name:"Metric",x:pos.x,y:pos.y,reusable:true,layout:"vertical",gap:4,placeholder:true})
metricLabelId=Insert(metricCardId,{type:"text",name:"Label",fontFamily:"Inter",fontSize:13,fill:"$text-secondary",content:"Label"})
metricValueId=Insert(metricCardId,{type:"text",name:"Value",fontFamily:"Inter",fontSize:28,fill:"$text-primary",content:"0"})
Update(metricCardId,{placeholder:false})
```

Insert a screen at the document root and fill it with a loop:

```js
const pos=FindEmptySpace({width:1440,height:1024,padding:80})
pageId=Insert(document,{type:"frame",name:"Landing Page",x:pos.x,y:pos.y,layout:"vertical",width:1440,padding:40,gap:24,clip:true,placeholder:true})

const navItem={type:"text",fontFamily:"Inter",fontSize:14,fill:"$text-secondary"}
navId=Insert(pageId,{type:"frame",name:"Nav",gap:32,alignItems:"center",width:"fill_container"})
for (const label of ["Home","Our Story","Visit","Journal"]) {
  Insert(navId,{...navItem,name:label,content:label})
}
```

Instantiate the component in a loop (even in the same `execute`), keyed by the captured `metricLabelId`/`metricValueId` ids:

```js
rowId=Insert(pageId,{type:"frame",name:"Metrics",gap:16,width:"fill_container"})
for (const [label,value] of [["Orders","1,284"],["Revenue","$48.2K"],["Customers","9,431"]]) {
  Insert(rowId,{type:"ref",ref:metricCardId,name:label,width:"fill_container",descendants:{[metricLabelId]:{content:label},[metricValueId]:{content:value}}})
}

Update(pageId,{placeholder:false})
```

Copy an existing screen, customize its descendants in the same `Copy` call, and delete a node:

```js
const pos=FindEmptySpace({width:1440,height:1024,padding:80})
dashboardV2Id=Copy("Xk9f2",document,{name:"Dashboard V2",x:pos.x,y:pos.y,placeholder:true,descendants:{"Jd6Ru":{fill:"#0F172A"},"Pc2Ny/Gh9Kf":{content:"Reports"}}})
Update(dashboardV2Id,{placeholder:false})

Delete("Vn4kP")
```

Define the design tokens first, then reference them with `$` when building. Themed values are passed as `{value, theme}` arrays (the `dark` axis value is registered on the fly), so `$bg`/`$text-primary` references resolve per theme automatically:

```js
SetVariables({
  "bg":{type:"color",value:[
    {value:"#FAFAF7",theme:{mode:"light"}},
    {value:"#141414",theme:{mode:"dark"}}
  ]},
  "text-primary":{type:"color",value:[
    {value:"#1A1A1A",theme:{mode:"light"}},
    {value:"#F5F5F5",theme:{mode:"dark"}}
  ]},
  "font-body":{type:"string",value:"Inter"},
  "gap-md":{type:"number",value:16}
})

cardId=Insert(document,{type:"frame",name:"Card",layout:"vertical",fill:"$bg",padding:"$gap-md",gap:"$gap-md",x:80,y:80})
Insert(cardId,{type:"text",name:"Title",fontFamily:"$font-body",fontSize:20,fill:"$text-primary",content:"Tokens applied"})
```
