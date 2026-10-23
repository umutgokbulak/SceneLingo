// The figures of IELTS Academic Writing Task 1, drawn: a line graph, a bar chart or pie charts,
// from the same data as a table ({ kind, title, unit, columns, rows }: the first column names
// each row, the others are its values, a column for each year or group). The drawing is an SVG
// string whose colours come from the page's style sheet (.c0 to .c5), so that it is right in the
// light and the dark. Pure: tested in Node.

const SL_CHART_KINDS = ['line', 'bar', 'pie', 'table'];

const slEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slNum = (v) => {
  const n = String(v).replace(/[^0-9.\-]/g, '');
  return n ? Number(n) : NaN;
};

// A round top for the axis, and its steps: 0 to 860 is 0 to 1,000 in steps of 200.
function slNiceMax(max) {
  if (!(max > 0)) return { top: 1, step: 0.2 };
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    const top = m * pow;
    if (top >= max) {
      const step = top / 5;
      return { top, step };
    }
  }
  return { top: 10 * pow, step: 2 * pow };
}
const slTick = (v) => (Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v)) : String(Math.round(v * 10) / 10));

// The data a figure can be drawn from: rows with a name and as many numbers as there are columns.
// A pie's columns must each come to about 100 (they are shares); a figure that is not right is
// shown as a table.
function slChartData(fig) {
  if (!fig || !Array.isArray(fig.columns) || !Array.isArray(fig.rows) || fig.columns.length < 2 || fig.rows.length < 2) return null;
  const groups = fig.columns.slice(1).map(String);
  const rows = fig.rows.map((r) => ({ name: String(r[0]), values: r.slice(1, 1 + groups.length).map(slNum) }));
  if (rows.some((r) => r.values.length !== groups.length || r.values.some((v) => !isFinite(v) || v < 0))) return null;
  if (fig.kind === 'pie' && groups.some((_, g) => Math.abs(rows.reduce((a, r) => a + r.values[g], 0) - 100) > 3)) return null;
  return { groups, rows };
}

// The kind it can be drawn as: its own, or a table when its data will not make that.
function slChartKind(fig) {
  return SL_CHART_KINDS.includes(fig && fig.kind) && fig.kind !== 'table' && slChartData(fig) ? fig.kind : 'table';
}

function slLegend(names, y, width) {
  let x = 0;
  const items = names.map((n, i) => {
    const w = 22 + Math.min(n.length, 26) * 6.6;
    const at = x;
    x += w + 14;
    return `<g transform="translate(${at},0)"><rect class="c${i % 6}" width="12" height="12" rx="3"/><text x="18" y="10.5">${slEsc(n.length > 26 ? n.slice(0, 25) + '…' : n)}</text></g>`;
  });
  return `<g class="legend" transform="translate(${Math.max(0, (width - x + 14) / 2)},${y})">${items.join('')}</g>`;
}

// A line for each row, across the columns (the years).
function slLineSvg(data, unit) {
  const W = 640, H = 330, L = 52, R = 18, T = 20, B = 84;
  const { top, step } = slNiceMax(Math.max(...data.rows.flatMap((r) => r.values)));
  const x = (i) => L + (data.groups.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (data.groups.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const out = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(`<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${slTick(v)}</text>`);
  data.groups.forEach((g, i) => out.push(`<text class="tick" x="${x(i)}" y="${H - B + 18}" text-anchor="middle">${slEsc(g)}</text>`));
  data.rows.forEach((r, s) => {
    out.push(`<polyline class="line s${s % 6}" points="${r.values.map((v, i) => x(i) + ',' + y(v)).join(' ')}"/>`);
    r.values.forEach((v, i) => out.push(`<circle class="c${s % 6}" cx="${x(i)}" cy="${y(v)}" r="3.5"><title>${slEsc(r.name + ', ' + data.groups[i] + ': ' + v)}</title></circle>`));
  });
  if (unit) out.push(`<text class="unit" x="${L}" y="12">${slEsc(unit)}</text>`);
  out.push(slLegend(data.rows.map((r) => r.name), H - 34, W));
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${out.join('')}</svg>`;
}

// A group of bars for each row, a bar for each column; across, so that long names can be read.
function slBarSvg(data, unit) {
  const n = data.groups.length;
  const bar = 12, gap = 3, pad = 14;
  const groupH = n * (bar + gap) + pad;
  const W = 640, L = 170, R = 40, T = unit ? 26 : 10;
  const H = T + data.rows.length * groupH + 54;
  const { top, step } = slNiceMax(Math.max(...data.rows.flatMap((r) => r.values)));
  const x = (v) => L + ((W - L - R) * v) / top;
  const out = [];
  const bottom = T + data.rows.length * groupH;
  for (let v = 0; v <= top + 1e-9; v += step) out.push(`<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${bottom}"/><text class="tick" x="${x(v)}" y="${bottom + 16}" text-anchor="middle">${slTick(v)}</text>`);
  data.rows.forEach((r, i) => {
    const y0 = T + i * groupH + pad / 2;
    const name = r.name.length > 26 ? r.name.slice(0, 25) + '…' : r.name;
    out.push(`<text class="name" x="${L - 10}" y="${y0 + (n * (bar + gap)) / 2 + 4}" text-anchor="end">${slEsc(name)}</text>`);
    r.values.forEach((v, g) => out.push(`<rect class="c${g % 6}" x="${L}" y="${y0 + g * (bar + gap)}" width="${Math.max(1, x(v) - L)}" height="${bar}" rx="2"><title>${slEsc(r.name + ', ' + data.groups[g] + ': ' + v)}</title></rect>`));
  });
  if (unit) out.push(`<text class="unit" x="${L}" y="14">${slEsc(unit)}</text>`);
  if (n > 1) out.push(slLegend(data.groups, H - 22, W));
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${out.join('')}</svg>`;
}

// A pie for each column, its slices the rows, each with its share.
function slPieSvg(data) {
  const n = data.groups.length;
  const size = n === 1 ? 260 : n === 2 ? 230 : 190;
  const W = 640, gapX = (W - n * size) / (n + 1), r = size / 2 - 12, T = 26;
  const H = T + size + 40 + Math.ceil(data.rows.length / 3) * 20;
  const out = [];
  data.groups.forEach((g, gi) => {
    const cx = gapX + gi * (size + gapX) + size / 2, cy = T + size / 2;
    const total = data.rows.reduce((a, row) => a + row.values[gi], 0) || 1;
    let a0 = -Math.PI / 2;
    data.rows.forEach((row, s) => {
      const share = row.values[gi] / total;
      const a1 = a0 + share * 2 * Math.PI;
      const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      const [x0, y0] = p(a0), [x1, y1] = p(a1);
      const path = share >= 0.9999 ? `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0` : `M${cx},${cy}L${x0},${y0}A${r},${r} 0 ${share > 0.5 ? 1 : 0},1 ${x1},${y1}Z`;
      out.push(`<path class="c${s % 6} slice" d="${path}"><title>${slEsc(row.name + ', ' + g + ': ' + row.values[gi] + '%')}</title></path>`);
      if (share >= 0.05) {
        const mid = (a0 + a1) / 2;
        out.push(`<text class="share" x="${cx + r * 0.64 * Math.cos(mid)}" y="${cy + r * 0.64 * Math.sin(mid) + 4}" text-anchor="middle">${slTick(row.values[gi])}%</text>`);
      }
      a0 = a1;
    });
    out.push(`<text class="name" x="${cx}" y="${T - 8}" text-anchor="middle">${slEsc(g)}</text>`);
  });
  // The legend in rows of three.
  data.rows.forEach((row, s) => {
    const col = s % 3, line = Math.floor(s / 3);
    const name = row.name.length > 24 ? row.name.slice(0, 23) + '…' : row.name;
    out.push(`<g transform="translate(${30 + col * 205},${T + size + 22 + line * 20})"><rect class="c${s % 6}" width="12" height="12" rx="3"/><text x="18" y="10.5">${slEsc(name)}</text></g>`);
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${out.join('')}</svg>`;
}

// The figure drawn, or null for a table (shown as one by the page).
function slChartSvg(fig) {
  const kind = slChartKind(fig);
  if (kind === 'table') return null;
  const data = slChartData(fig);
  return kind === 'line' ? slLineSvg(data, fig.unit) : kind === 'bar' ? slBarSvg(data, fig.unit) : slPieSvg(data);
}

if (typeof module !== 'undefined') Object.assign(module.exports, { SL_CHART_KINDS, slNiceMax, slChartData, slChartKind, slChartSvg });
