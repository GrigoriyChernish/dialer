// Перевіряє, що CSS-токени застосунку й дизайн-система в документації збігаються зі знімком змінних design/dialer.pen.
// Сам .pen зашифрований і читається лише через Pencil, тому звіряємо зі знімком design/tokens.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = p => readFileSync(root + p, 'utf8');

const { variables } = JSON.parse(read('design/tokens.json'));
const css = read('apps/web/src/app/styles/tokens.css');
const doc = read('docs/design-system.md');

// змінна дизайну → CSS-змінна. Решта змінних (`*-soft`, `*-badge`, `accent-ring-*`, `on-solid`, `on-light`) у CSS задаються прозорістю утиліти
// (`bg-warn/20`, `bg-accent/[.08]`) чи кольором `white`, власних CSS-змінних вони не мають, тож перевіряються лише в документації.
const CSS_VAR = {
  bg: '--bg',
  fg: '--fg',
  mute: '--mute',
  line: '--line',
  'card-top': '--card-top',
  'card-bottom': '--card-bottom',
  'stage-glow': '--stage-glow',
  'stage-missed-glow': '--stage-missed-glow',
  'accent-icon': '--accent-icon',
  'surface-2': '--surface',
  'surface-3': '--surface-strong',
  'surface-tile': '--pip',
  accent: '--color-accent',
  ok: '--color-call-ok',
  bad: '--color-call-bad',
  warn: '--color-warn',
};

// приводить #RGB, #RRGGBB, #RRGGBBAA і rgba(r,g,b,a) до #rrggbb або #rrggbbaa
function norm(v) {
  v = v.trim().toLowerCase();
  const m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(',').map(Number);
    const h = n => Math.round(n).toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b) + (a < 1 ? h(a * 255) : '');
  }
  return v.length === 4 ? '#' + [...v.slice(1)].map(c => c + c).join('') : v;
}

function declared(name, block) {
  const m = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  return m ? norm(m[1]) : null;
}

// темна тема = значення дизайну; беремо блок :root[data-theme="dark"] (лапки будь-які: Prettier ставить одинарні)
const dark = css.match(/:root\[data-theme=["']dark["']\]\s*\{([^}]*)\}/)?.[1] ?? '';
const theme = css.match(/@theme inline\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

const errors = [];
for (const [name, value] of Object.entries(variables)) {
  // числові змінні (радіуси, відступи) у CSS не мапляться, у документації шукаємо назву змінної в одному рядку зі значенням
  if (typeof value === 'number') {
    if (!new RegExp(`\`${name}\`[^\n]*\\b${value}\\b`).test(doc))
      errors.push(`docs/design-system.md: немає ${name} = ${value}`);
    continue;
  }
  const want = norm(value);
  const cssName = CSS_VAR[name];
  if (cssName) {
    const got = declared(cssName, cssName.startsWith('--color-') ? theme : dark);
    if (got !== want) errors.push(`CSS: ${cssName} = ${got ?? 'немає'}, у дизайні ${name} = ${want}`);
  }
  if (!doc.toLowerCase().includes(value.toLowerCase()))
    errors.push(`docs/design-system.md: немає значення ${value} (${name})`);
}

if (errors.length) {
  console.error('Токени розходяться з design/tokens.json:\n- ' + errors.join('\n- '));
  process.exit(1);
}
console.log(`Дизайн-токени збігаються: ${Object.keys(variables).length} змінних.`);
