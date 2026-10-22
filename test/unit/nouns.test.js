const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const N = require('../../extension/nouns.js');

const list = N.slNounList(fs.readFileSync(path.join(__dirname, '..', '..', 'extension', 'freq', 'de-nouns.txt'), 'utf8'));
const said = (word) => {
  const t = N.slNounText(N.slNoun(list, word));
  return t && [t.article, t.lemma, t.plural].join(' | ');
};

test('the list of German nouns: thousands, each with its gender and plural', () => {
  assert.ok(list.nouns.size > 5000, String(list.nouns.size));
  assert.deepEqual(list.nouns.get('Rechnung'), { g: 'f', pl: 'Rechnungen' });
  assert.ok(!list.nouns.has('Berlin') && !list.nouns.has('Thomas'), 'no places or names');
});

test('a noun with its article and plural, found from any of its forms and in any case', () => {
  assert.equal(said('Rechnung'), 'die | Rechnung | die Rechnungen');
  assert.equal(said('Rechnungen'), 'die | Rechnung | die Rechnungen');
  assert.equal(said('Häuser'), 'das | Haus | die Häuser');
  assert.equal(said('mädchen'), 'das | Mädchen | die Mädchen');
  assert.equal(said('Mann,'), 'der | Mann | die Männer', 'punctuation around it is left out');
  assert.equal(N.slNounText(N.slNoun(list, 'See')).article, 'der/die', 'two nouns, two genders');
  const people = N.slNounText(N.slNoun(list, 'Leute'));
  assert.ok(people.pluralOnly && people.article === 'die' && people.g === '', 'used in the plural only');
  assert.equal(N.slNoun(list, 'schnell'), null);
  assert.equal(N.slNoun(list, 'rote Karte'), null, 'one word only');
});

test('a compound not in the list takes the gender of the noun it ends in', () => {
  const n = N.slNoun(list, 'Handyrechnung');
  assert.deepEqual([n.lemma, n.g, n.pl, n.compound], ['Handyrechnung', 'f', 'Handyrechnungen', true]);
  assert.equal(N.slNounText(N.slNoun(list, 'Kinderzimmer')).article, 'das');
  assert.equal(N.slNoun(list, 'Xyz'), null);
});
