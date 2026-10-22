# Word frequency lists

`en.txt` and `de.txt` hold the 20,000 most common words of English and German film and TV subtitles,
the commonest first, one a line. They are made from the 2018 lists of
[FrequencyWords](https://github.com/hermitdave/FrequencyWords) by Hermit Dave, which count the words of the
[OpenSubtitles 2018](http://opus.nlpl.eu/OpenSubtitles2018.php) corpus: only the words were kept, lower-cased,
letters only, each once.

The lists are licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), as their source
is; the rest of SceneLingo is under the MIT license.

SceneLingo uses them to find, in an episode's subtitles, the words a learner at a given level is not likely
to know yet (`extension/episode.js`).

`de-nouns.txt` holds the German nouns among those words, about 6,000, with their gender and plural, and the
forms of them that point back to them (`=Häuser<TAB>Haus`). It is made by `test/nouns.py` from
[german-nouns](https://github.com/gambolputty/german-nouns) by gambolputty, compiled from the German
Wiktionary, and is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) as that is.
SceneLingo uses it to give German nouns their article (`extension/nouns.js`).
