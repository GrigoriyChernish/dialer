# Using scripts and shaders on the pen.dev canvas

## Scripting

Use `script` node types to generate content with JavaScript. Scripts are `.js` files on disk, referenced via relative uri path in `scriptUri`.

- Every script must start with `/** @schema 2.11 */` (current version). Missing this tag is an error.
- Scripts receive a `pencil` object: `pencil.width`, `pencil.height`, `pencil.input.<name>`.
- Scripts must return an array of node objects following the `.pen` schema.
- Declare inputs as `@input name: type [= default]`. Available types: `number`, `string`, `boolean`, `color`, `ref`, `enum`.
- Math.random() is deterministic in scripts and can be safely used for procedural generation.

```js
/**
 * @schema 2.11
 * @input rows: number = 3
 * @input gap: number = 4
 * @input color: color = #3B82F6
 * @input label: string = "Hello"
 * @input filled: boolean = true
 * @input layout: enum("grid", "stack", "scatter") = "grid"
 * @input target: ref
 */
const rows = Math.max(1, Math.floor(pencil.input.rows));
const cellH = (pencil.height - pencil.input.gap * (rows - 1)) / rows;

const nodes = [];
for (let r = 0; r < rows; r++) {
  nodes.push({
    type: "rectangle",
    name: "Bar " + (r + 1),
    x: 0,
    y: r * (cellH + pencil.input.gap),
    width: pencil.width,
    height: cellH * Math.random(),
    fill: pencil.input.color,
  });
}

return nodes;
```

## Shaders

The `shader` fill type can be used to create complex graphics effects using WebGL shaders.

- Shaders are WebGL 1.0 fragment shaders (#version 100), with one addition: textureSize(sampler, lod) is available for aspect-correct texturing.
- Supported uniform types:
  - float, int: as numbers
  - vec2/3/4, ivec2/3/4: as arrays of numbers or "#RRGGBB" strings for colors
  - sampler2D: as image URL strings
- Uniforms can be annotated with special comments:
  - @color: marks vec3 or vec4 uniforms to use color picker controls.
  - @default: sets the default value for the uniform.
  - @resolution: set to the resolution of the output. e.g. can be used to normalize gl_FragCoord.
  - @mouse: set to the mouse position in the same space as gl_FragCoord. For interactive effects.
  - @time: set to the elapsed time in seconds. For animations.
  - @sdf: a sampler2D set to an SDF texture of the node's shape. The r channel holds the signed distance in @resolution units (positive = inside). The gb channels hold the gradient of the distance field (direction of increasing distance), in texel space. Use gb instead of numerically differentiating the r channel!
  - @backdrop: a sampler2D set to the content rendered behind the node. offset/distort the sampling coordinate for refraction-like effects. Ideal for glass/frosted/refraction/magnifier effects. Prefer @backdrop over faking the background.
  - @min/@max: set the range of a uniform for better UI controls. Only applies to number uniforms.
  - @range <min>, <max>: shorthand for @min and @max on the same line. Shows a slider in the UI.
  - @label <text>: sets the uniform's display name in the UI. Always set the label.

```glsl
/** @resolution */
uniform vec2 u_resolution;

/**
 * @label Size
 * @default 32
 */
uniform float u_size;

/**
 * @label Primary Color
 * @color
 * @default #ffffff
 */
uniform vec3 u_color1;

/**
 * @label Secondary Color
 * @color
 * @default #000000
 */
uniform vec3 u_color2;

void main() {
  vec2 cell = floor(gl_FragCoord.xy / u_size);
  float check = mod(cell.x + cell.y, 2.0);
  vec3 color = mix(u_color1, u_color2, check);
  gl_FragColor = vec4(color, 1.0);
}
```
