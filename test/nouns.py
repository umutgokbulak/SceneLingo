# German nouns for SceneLingo (extension/freq/de-nouns.txt):
#   python test/nouns.py nouns.csv extension/freq/de.txt extension/freq/de-nouns.txt
# nouns.csv is german_nouns/nouns.csv of https://github.com/gambolputty/german-nouns (CC BY-SA 4.0).
# The nouns of the 20,000 commonest words in German film subtitles,
# with their gender and plural, and the plural and genitive forms that point back to them.
import csv, sys
src, freqfile, out = sys.argv[1:4]
freq = [w.strip() for w in open(freqfile, encoding='utf-8') if w.strip()]
common = set(freq)
NAMES = ('Toponym', 'Vorname', 'Nachname', 'Eigenname', 'Abkürzung', 'Buchstabe', 'Symbol', 'Wortverbindung')
nouns = {}  # lemma -> [genders, plural]
order = []
for r in csv.DictReader(open(src, encoding='utf-8')):
    lemma = r['lemma'].strip()
    if not lemma or not lemma[0].isupper() or ' ' in lemma or '-' == lemma[0]:
        continue
    if any(n in r['pos'] for n in NAMES) or 'Substantiv' not in r['pos']:
        continue
    if lemma.lower() not in common:
        continue
    g = ''.join(x for x in [r['genus'], r['genus 1'], r['genus 2'], r['genus 3'], r['genus 4']] if x in ('m', 'f', 'n'))
    pl = next((r[k] for k in ['nominativ plural', 'nominativ plural 1', 'nominativ plural*', 'nominativ plural 2', 'nominativ plural stark'] if r.get(k)), '')
    if not g and not pl:
        continue
    if lemma not in nouns:
        nouns[lemma] = [g, pl, []]
        order.append(lemma)
    else:
        e = nouns[lemma]
        e[0] += ''.join(x for x in g if x not in e[0])
        e[1] = e[1] or pl
    forms = nouns[lemma][2]
    for k in ['nominativ plural', 'nominativ plural 1', 'dativ plural', 'dativ plural 1', 'genitiv singular', 'genitiv singular 1', 'dativ singular*']:
        f = r.get(k, '').strip()
        if f and f != lemma and ' ' not in f and f.lower() in common and f not in forms:
            forms.append(f)
lines = []
seen_forms = {}
for lemma in order:
    g, pl, forms = nouns[lemma]
    lines.append(lemma + '\t' + ''.join(dict.fromkeys(g)) + '\t' + pl)
    for f in forms:
        if f not in nouns and f not in seen_forms:
            seen_forms[f] = lemma
head = ['# German nouns, their gender (m, f, n; none: plural only) and plural; then "=form<TAB>lemma".',
        '# From german-nouns by gambolputty (WiktionaryDE), CC BY-SA 4.0; only the nouns among the 20,000',
        '# commonest words of German film subtitles (see README.md).']
with open(out, 'w', encoding='utf-8', newline='\n') as fh:
    fh.write('\n'.join(head + lines + ['=' + f + '\t' + l for f, l in seen_forms.items()]) + '\n')
print(len(lines), 'nouns', len(seen_forms), 'forms')
