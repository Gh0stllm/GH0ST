# Source attribution and permission evidence

Downloaded 24 October 2026 from primary publication endpoints. Text was acquired only for this local research corpus. Raw files, publisher metadata, source hashes and license evidence are retained. No Truth Terminal transcript, post, or fan imitation dataset is included.

## Project Gutenberg

Each book metadata page explicitly labels the selected edition “Public domain in the USA.” The full accompanying Project Gutenberg terms are retained in `licenses/pg-ID-license.txt`; original text and metadata files remain in `raw/`. That publisher statement is recorded precisely rather than represented as a worldwide legal opinion. Original publication years below identify the works, not necessarily the translation/edition year.

|Work|Original year|Retained words|Primary metadata|
|---|---:|---:|---|
|The Diary of a Nobody by George Grossmith and Weedon Grossmith|1892|41,087|[Publisher page](https://www.gutenberg.org/ebooks/1026)|
|Orthodoxy by G. K. Chesterton|1908|60,364|[Publisher page](https://www.gutenberg.org/ebooks/130)|
|The Private Papers of Henry Ryecroft by George Gissing|1903|60,480|[Publisher page](https://www.gutenberg.org/ebooks/1463)|
|The Road by Jack London|1907|49,889|[Publisher page](https://www.gutenberg.org/ebooks/14658)|
|Confessions of an English Opium-Eater by Thomas De Quincey|1821|30,703|[Publisher page](https://www.gutenberg.org/ebooks/2040)|
|Walden, and On The Duty Of Civil Disobedience by Henry David Thoreau|1854|106,873|[Publisher page](https://www.gutenberg.org/ebooks/205)|
|Three men in a boat (to say nothing of the dog) by Jerome K. Jerome|1889|53,614|[Publisher page](https://www.gutenberg.org/ebooks/308)|
|The Innocents Abroad by Mark Twain|1869|163,141|[Publisher page](https://www.gutenberg.org/ebooks/3176)|
|Roughing It by Mark Twain|1872|122,130|[Publisher page](https://www.gutenberg.org/ebooks/3177)|
|Heretics by G. K. Chesterton|1905|59,685|[Publisher page](https://www.gutenberg.org/ebooks/470)|
|An inland voyage by Robert Louis Stevenson|1878|36,187|[Publisher page](https://www.gutenberg.org/ebooks/534)|
|Travels with a donkey in the Cevennes by Robert Louis Stevenson|1879|32,979|[Publisher page](https://www.gutenberg.org/ebooks/535)|
|Notes from the Underground by Fyodor Dostoyevsky|1864|41,575|[Publisher page](https://www.gutenberg.org/ebooks/600)|
|The Idle Thoughts of an Idle Fellow by Jerome K. Jerome|1886|36,440|[Publisher page](https://www.gutenberg.org/ebooks/849)|
|De Profundis by Oscar Wilde|1905|16,979|[Publisher page](https://www.gutenberg.org/ebooks/921)|

## Gwern

The author explicitly grants a [Creative Commons public-domain CC-0 license](https://gwern.net/about#license). The exact grant paragraph and full-source hash are saved in `licenses/gwern-cc0-license-excerpt.txt`. The corpus keeps selected author paragraphs after excluding blockquotes, inline quoted runs longer than 15 words, code, lists and footnote material. Short quotations inside otherwise authored discussion may remain. These are contemporary essays, not independent verification of their claims.

|Essay|Created year|Retained words|Primary source|
|---|---:|---:|---|
|About This Website|2010|2,897|[Author page](https://gwern.net/about)|
|Why To Not Write A Book|2024|2,454|[Author page](https://gwern.net/book-writing)|
|Choosing Software|2008|730|[Author page](https://gwern.net/choosing-software)|
|Creatine Cognition Meta-analysis|2013|587|[Author page](https://gwern.net/creatine)|
|Culture Is Not About Esthetics|2009|4,684|[Author page](https://gwern.net/culture-is-not-about-esthetics)|
|<em>Death Note</em>: L, Anonymity & Eluding Entropy|2011|1,563|[Author page](https://gwern.net/death-note-anonymity)|
|'Dual <em>n</em>-Back FAQ'|2009|2,181|[Author page](https://gwern.net/dnb-faq)|
|My Ordinary Life: Improvements Since the 1990s|2018|208|[Author page](https://gwern.net/improvement)|
|Lithium in ground-water and well-being|2010|314|[Author page](https://gwern.net/lithium)|
|About Gwern|2009|987|[Author page](https://gwern.net/me)|
|Melatonin|2008|1,570|[Author page](https://gwern.net/melatonin)|
|Modafinil|2009|3,459|[Author page](https://gwern.net/modafinil)|
|Nicotine|2011|1,433|[Author page](https://gwern.net/nicotine)|
|On Really Trying|2009|314|[Author page](https://gwern.net/on-really-trying)|
|Silk Road 1: Theory & Practice|2011|7,143|[Author page](https://gwern.net/silk-road)|
|On Having Enough Socks|2017|2,932|[Author page](https://gwern.net/socks)|
|Spaced Repetition for Efficient Learning|2009|1,556|[Author page](https://gwern.net/spaced-repetition)|
|The Melancholy of Subculture Society|2009|2,107|[Author page](https://gwern.net/subculture)|
|Are Sunk Costs Fallacies?|2012|919|[Author page](https://gwern.net/sunk-cost)|
|Why Tool AIs Want to Be Agent AIs|2016|1,343|[Author page](https://gwern.net/tool-ai)|

## Original GH0ST anchors

799 distinct prior project-authored passages, 38,311 words. The source snapshot is `original-anchor-snapshot.jsonl`. Inputs are the 36 long original monologues, 80 later long originals, 250 recovery vignettes and 433 earlier original paragraphs selected strictly by `source_kind=authored` from the archived mixed corpus. Compositional expansions, teacher replies and children-story replay are excluded. Full original parents replace 996 old clipped training spans covering 706 parent IDs. Original split/group assignments are preserved.

## Acquisition exclusions

The downloader records failed URLs and title mismatches; they do not enter training. Three acquired Gwern collections are explicitly excluded: fiction/clippy, AI daydreaming, and book reviews. The incorrect preliminary PG 305 lookup was rejected on title mismatch; PG 308 is the verified Three Men in a Boat edition.
