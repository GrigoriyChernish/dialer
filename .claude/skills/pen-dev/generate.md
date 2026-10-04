# Generate: images and vector artwork

`Generate` is an `execute` function - see [execute.md](./execute.md) for the rest of the API.
Read this file before calling it.

```ts
function Generate(type: "ai" | "svg", nodeId: string, prompt: string): void;
function Generate(type: "stock", nodeId: string, query: string): void;
function Generate(type: "vectorize-image", nodeId: string, imageUrl: string): void;
function Generate(type: "remove-background", imageUrl: string): string; // returns the new asset url
function Generate(type: "replace-background", imageUrl: string, prompt: string): string; // returns the new asset url
```

- `"ai"` and `"stock"` bring in a new image, `"svg"` draws new vector artwork, and `"remove-background"`, `"replace-background"`, and `"vectorize-image"` transform an image the document ALREADY has.
- IMPORTANT: There is NO `image` node type. Images are applied as FILLS to existing nodes; SVGs become paths inside a parent frame.
- `type` comes first. The four types that write into the document take the target `nodeId` next - the node receiving the image fill, or the frame the artwork is drawn into. `"remove-background"` and `"replace-background"` target no node: they RETURN an asset url for you to apply, so the source url follows the type directly. Last comes the input: a prompt for `"ai"` and `"svg"`, a query for `"stock"`, `imageUrl` for the transforms, plus a prompt after it for `"replace-background"`. Leave unused arguments out - never pass `undefined`.

```js
Generate("ai", nodeId, "A dew-covered fern frond, macro, soft morning light")
Generate("stock", nodeId, "fern frond")
Generate("vectorize-image", frameId, url)
Generate("remove-background", url)
Generate("replace-background", url, "On a wet slate slab, muted sage background")
```

## Waiting for a result

- EVERY type is async. Only the bookkeeping happens during the call - the fill is written, or the url returned; the image or drawing itself lands after the `execute` call that started it has returned. Screenshots taken right away will not show it. Never re-generate it, draw the result by hand, or add children to a frame you generated into.
- Check with a cheap read in a LATER `execute` call, never with a screenshot:
  - frame types (`"svg"`, `"vectorize-image"`): Insert the frame with `placeholder: true`; the generator clears that flag when it finishes. `Print(Get(logoFrameId, {depth: 0}).placeholder)`
  - fill types (`"ai"`, `"stock"`, and both background transforms): the url is a `pencil:pending-image-...` placeholder until the image arrives, then rewritten in place to the real asset path. `Print(Get(heroId, {depth: 0}).fill)`
- Generations are slow - SVGs take minutes. Keep designing while one is pending and re-check occasionally, e.g. after finishing a section, not after every call. Never call Generate again for pending work. Only when no other work is left, poll with that tiny read, generously spaced - never back to back.
- Failures are silent: a `placeholder` flag cleared on a frame that still has no children, or a fill whose `url` has disappeared. That is the one case where calling Generate again for the same result is correct.
- Screenshot only once a check says the result arrived.

## `"ai"` and `"stock"`: a new image

- Never guess or invent an image url - it only ever comes from `Generate`.
- Insert the frame or rectangle first, then `Generate` applies the image as its fill.
- `"ai"` takes a detailed descriptive prompt. `"stock"` takes a 1-3 keyword Unsplash query following the Stock query rules: simple, concrete, no use-case or abstract terms.
- Both write the fill during the call and resolve the image afterwards. If no stock photo matches the query, the fill's `url` ends up gone and the node shows nothing - nothing is reported back to you, so check the fill.

```js
const pos = FindEmptySpace({width: 1440, height: 800, padding: 80, nodeId: logoFrameId})
heroId = Insert(document, {type: "frame", name: "Section", x: pos.x, y: pos.y, width: 1440, height: 800, placeholder: true})
Generate("ai", heroId, "Tropical jungle canopy, dense green foliage, sunlight filtering through trees, cinematic aerial view, vibrant greens, moody atmospheric lighting, nature photography")
```

## `"svg"`: new vector artwork

- The only way to produce freeform vector artwork, and the slowest and most expensive operation in Pencil. It is not the default way to fill visual space.
- Generate one only when the artwork itself is the point:
  - the user asks you to draw, illustrate, or create a logo, mark, mascot, or illustration,
  - the design is for a brand or product that needs its own logo mark and the document doesn't already contain one,
  - a section is carried by a custom illustration or diagram that cannot be assembled from icons, shapes, or an image.
- Everything else has a cheaper, better option:
  - icons, arrows, chevrons, checkmarks, UI glyphs -> an `icon` node (`lucide`, `feather`, `Material Symbols`, `phosphor`)
  - photos, textures, hero and background imagery, avatars, product shots -> `"stock"` or `"ai"`
  - badges, tags, pills, buttons, cards, dividers, blobs, glows, gradient backgrounds, abstract patterns, charts -> frames, shapes, strokes, gradient fills, and layout
  - artwork already in the document -> `Copy` it or instance it
- Budget it: turn a generated SVG into a component and reuse it. Never generate a variant per screen, section, or card. When unsure, build the design without artwork first - adding one afterwards is cheap, deleting several is not.
- Insert a frame with the desired width and height and `placeholder: true` first (no other node type is allowed) and pass its id as `nodeId`; the resulting paths are scaled to the frame's bounding box and inserted as its children.
- The generator sees nothing of the document, so the prompt must state the subject, composition, line/fill style, and colors. One generation per prompt - don't ask for a set of variants.

```js
const pos = FindEmptySpace({width: 400, height: 400, padding: 80})
logoFrameId = Insert(document, {type: "frame", name: "Logo", x: pos.x, y: pos.y, width: 400, height: 400, placeholder: true})
Generate("svg", logoFrameId, "A cute fox logo, minimalist vector style, colourful, simple, clean, modern flat design, suitable for a brand logo.")
```

## Transforming an image the document already has

- `"vectorize-image"` draws into a frame you insert first, so that frame's `nodeId` follows the type, and it returns nothing. `"remove-background"` and `"replace-background"` write nothing and target no node: they produce a new asset and RETURN its url - nothing in the document moves until you apply it.
- `imageUrl` is the last argument of all three and must ALREADY be in the document: `Get` the node, pick the `{type: "image"}` fill you actually mean, and pass its `url`. A node's `fill` may be a list drawn in list order, so the visible image is usually the last image fill. Never invent, guess, or hand-write this url.

```js
const imageUrl = n => [Get(n, {depth: 0}).fill].flat().filter(f => f?.type === "image").pop()?.url
```

- The source must have ARRIVED: a url still starting with `pencil:pending-image-` fails, so a generated image or an earlier transform's output has to resolve in a previous `execute` call before you can transform it.
- Apply a returned url with `Update` on the node's `fill` (it holds one fill or a list), in the SAME execute call - no `TakeScreenshot`, `Export`, or further `Generate` in between. Those hand control back to the editor, and once the transform resolves the url you are still holding stops referring to anything. Never carry it into a later call through a global.

```js
Update(nodeId, {fill: {type: "image", url: Generate("remove-background", sourceUrl)}})

const cutoutUrl = Generate("remove-background", sourceUrl)
Update(cardId, {fill: [{type: "image", url: cutoutUrl}, ...]})
```

- The returned url is a pending placeholder like any other generated image, rewritten in place once the transform resolves. Until then the node renders the SOURCE image, so an early screenshot looks like the transform did nothing - check the url instead.
- Nothing else on the node is touched: the fill you passed as `imageUrl` changes only if you `Update` it with the returned url, and other fills stay as they are.
- The source must be a JPEG, PNG or WEBP, at most 16MB, and between 256px and 4096px in both dimensions - the image's own pixels, not the size of the node showing it.

### `"remove-background"`

- Returns a transparent cutout of the subject.
- Use it when a photo's own background is in the way: a product shot, mascot, portrait, or object that has to sit on a design background, overlap another section, or bleed outside its frame.
- Whatever is behind the node shows through the cutout, so give it a transparent or design-colored backdrop rather than leaving an unrelated solid fill behind it.

### `"replace-background"`

- Keeps the subject and generates a new background around it, returning the composed image. The one transform type that takes a prompt.
- Use it when the subject is right but its surroundings are not: a product in a styled scene, a portrait on a different backdrop, or stock photos across a design made to share one setting.
- The prompt describes the background, not the subject: state the setting, surface, lighting, and colors, consistent with the design's palette.
- Reach for `"remove-background"` instead when the design itself should show through behind the subject. The result here is a normal opaque image and needs no backdrop of its own.

### `"vectorize-image"`

- Traces the image into vector paths. Insert a frame with the desired width and height and `placeholder: true` FIRST (no other node type is allowed) and pass its id as `nodeId`; the traced paths are scaled to its bounding box and inserted as its children, exactly like `"svg"`.
- Use it to turn an existing raster logo, mark, or flat illustration into clean, resolution-independent artwork. For artwork that does not exist yet, generate an SVG directly - never generate an image just to vectorize it.
- Works on flat, high-contrast artwork; photographs trace into a mess of paths.

```js
Update(productShotId,{fill:{type:"image",url:Generate("remove-background",imageUrl(productShotId))}})

const pos = FindEmptySpace({width: 400, height: 400, padding: 80, nodeId: logoId})
tracedLogoId = Insert(document,{type:"frame",name:"Logo",x:pos.x,y:pos.y,width:400,height:400,placeholder:true})
Generate("vectorize-image",tracedLogoId,imageUrl(logoId))

const bottleUrl = Generate("replace-background",imageUrl(bottleId),"On a wet slate slab, soft morning light from the left, muted sage background, shallow depth of field")
for (const id of [bottleHeroId, bottleThumbId]) {
  Update(id,{fill:{type:"image",url:bottleUrl}})
}
```
