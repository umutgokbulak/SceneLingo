const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../extension/charts.js');

const fig = (kind, extra = {}) => ({
  kind,
  title: 'Visitors to three museums',
  unit: 'thousands',
  columns: ['Museum', '2019', '2020', '2021'],
  rows: [['History <Museum>', '820', '210', '380'], ['Art Gallery', '640', '150', '310'], ['Science Centre', '510', '170', '290']],
  ...extra,
});

test('a round top for the axis, in five steps', () => {
  assert.deepEqual(C.slNiceMax(860), { top: 1000, step: 200 });
  assert.deepEqual(C.slNiceMax(47), { top: 50, step: 10 });
  assert.deepEqual(C.slNiceMax(0), { top: 1, step: 0.2 });
});

test('a line graph, a bar chart and pie charts are drawn from the numbers of a table', () => {
  const line = C.slChartSvg(fig('line'));
  assert.match(line, /^<svg class="chart"/);
  assert.equal((line.match(/<polyline/g) || []).length, 3, 'a line for each row');
  assert.match(line, /History &lt;Museum&gt;/, 'names are escaped');
  const bar = C.slChartSvg(fig('bar'));
  assert.equal((bar.match(/<rect class="c\d" x=/g) || []).length, 9, 'a bar for each row and year');
  const pie = C.slChartSvg({ kind: 'pie', title: 'Energy', columns: ['Source', '2000', '2020'], rows: [['Coal', '50', '30'], ['Gas', '30', '35'], ['Wind', '20', '35']] });
  assert.equal((pie.match(/class="c\d slice"/g) || []).length, 6, 'two pies of three slices');
  assert.match(pie, />35%</);
});

test('a figure whose numbers will not make its kind is shown as a table', () => {
  assert.equal(C.slChartSvg(fig('table')), null);
  assert.equal(C.slChartKind({ kind: 'pie', columns: ['a', 'b'], rows: [['x', '40'], ['y', '40']] }), 'table', 'a pie that does not come to 100');
  assert.equal(C.slChartKind(fig('line', { rows: [['a', '1', 'x', '3'], ['b', '1', '2', '3']] })), 'table', 'a number that is not one');
  assert.equal(C.slChartKind(null), 'table');
});
