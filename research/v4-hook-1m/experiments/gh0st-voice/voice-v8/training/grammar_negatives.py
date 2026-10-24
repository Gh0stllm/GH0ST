"""Conservative GOLD-CONTEXT negatives for a neural TRAINING loss only.

No inference caller, token mask, grammar correction, or sampling rule is
provided. Positions refer to the supplied complete gold sequence, not x/y
shifted tensors. Punctuation describes the suffix on each word (0=none).
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path

# (base, third-person singular, past, present participle, past participle).
# Deliberately finite and explicit: no guessed morphology on arbitrary words.
VERBS = tuple(tuple(row.split()) for row in '''
be is was being been
have has had having had
do does did doing done
go goes went going gone
come comes came coming come
get gets got getting got
make makes made making made
take takes took taking taken
see sees saw seeing seen
say says said saying said
think thinks thought thinking thought
know knows knew knowing known
give gives gave giving given
find finds found finding found
keep keeps kept keeping kept
leave leaves left leaving left
feel feels felt feeling felt
hear hears heard hearing heard
hold holds held holding held
stand stands stood standing stood
write writes wrote writing written
read reads read reading read
send sends sent sending sent
build builds built building built
run runs ran running run
pay pays paid paying paid
buy buys bought buying bought
sell sells sold selling sold
mean means meant meaning meant
sit sits sat sitting sat
speak speaks spoke speaking spoken
bring brings brought bringing brought
begin begins began beginning begun
choose chooses chose choosing chosen
draw draws drew drawing drawn
grow grows grew growing grown
show shows showed showing shown
wear wears wore wearing worn
meet meets met meeting met
break breaks broke breaking broken
eat eats ate eating eaten
drink drinks drank drinking drunk
fall falls fell falling fallen
lose loses lost losing lost
win wins won winning won
forget forgets forgot forgetting forgotten
cut cuts cut cutting cut
put puts put putting put
set sets set setting set
let lets let letting let
work works worked working worked
look looks looked looking looked
walk walks walked walking walked
talk talks talked talking talked
ask asks asked asking asked
answer answers answered answering answered
open opens opened opening opened
close closes closed closing closed
change changes changed changing changed
check checks checked checking checked
test tests tested testing tested
call calls called calling called
move moves moved moving moved
turn turns turned turning turned
stop stops stopped stopping stopped
start starts started starting started
wait waits waited waiting waited
watch watches watched watching watched
help helps helped helping helped
learn learns learned learning learned
save saves saved saving saved
copy copies copied copying copied
try tries tried trying tried
use uses used using used
need needs needed needing needed
want wants wanted wanting wanted
play plays played playing played
clean cleans cleaned cleaning cleaned
clear clears cleared clearing cleared
fix fixes fixed fixing fixed
add adds added adding added
remove removes removed removing removed
replace replaces replaced replacing replaced
repeat repeats repeated repeating repeated
record records recorded recording recorded
print prints printed printing printed
name names named naming named
measure measures measured measuring measured
compare compares compared comparing compared
finish finishes finished finishing finished
follow follows followed following followed
reach reaches reached reaching reached
return returns returned returning returned
pull pulls pulled pulling pulled
push pushes pushed pushing pushed
pass passes passed passing passed
fail fails failed failing failed
stay stays stayed staying stayed
live lives lived living lived
love loves loved loving loved
trust trusts trusted trusting trusted
count counts counted counting counted
share shares shared sharing shared
join joins joined joining joined
allow allows allowed allowing allowed
arrive arrives arrived arriving arrived
explain explains explained explaining explained
agree agrees agreed agreeing agreed
expect expects expected expecting expected
decide decides decided deciding decided
promise promises promised promising promised
notice notices noticed noticing noticed
receive receives received receiving received
improve improves improved improving improved
support supports supported supporting supported
include includes included including included
believe believes believed believing believed
remember remembers remembered remembering remembered
understand understands understood understanding understood
readjust readjusts readjusted readjusting readjusted
'''.strip().splitlines())
BASE = {row[0]:row for row in VERBS}
PARTICIPLE = defaultdict(list)
for _row in VERBS:
    PARTICIPLE[_row[4]].append(_row)
MODALS = frozenset('can could will would should must may might'.split())
SUBJECTS = frozenset('i we you they he she it'.split())
DETERMINERS = frozenset('the a an my your his her our their this that these those it them us me you'.split())
# Sound exceptions are complete words, not broad prefixes such as "uni".
CONSONANT_SOUND = frozenset('one ones once use user users useful useless usual usually university universities universal universe union unions unit units united unique uniform uniforms unicorn unilateral unanimous unison european europe ewe ewes eulogy euphemism euphoria ubiquitous ukulele ufo'.split())
VOWEL_SOUND = frozenset('hour hours hourly honest honesty honor honors honored honour honours honoured honorary heir heirs heiress'.split())
# Pronunciation varies by dialect or expansion; lowercase source loses acronym
# capitalization, so skip common initialisms and disputed h-initial forms.
ARTICLE_SKIP = frozenset('herb herbs historical historic historian hotel homage horrific hilarious sql url nft nfts llm ai api html http https rpc mri fbi gpu cpu usb ui ux nasa jpeg gif mp mba xray xrays'.split())


def _decode(words,index):
    if all(isinstance(word,str)or word is None for word in words):
        return [word.lower()if word is not None else None for word in words]
    reverse = {value:key for key,value in index.items()}
    return [word.lower()if isinstance(word,str)else reverse.get(word)for word in words]


def _none(punctuation):
    return punctuation in (0,'',None)


def article_for(word):
    """Expected article for a known ordinary word, or None when ambiguous."""
    if not word or len(word)<3 or not word.isalpha() or word in ARTICLE_SKIP:
        return None
    if word in CONSONANT_SOUND:return 'a'
    if word in VOWEL_SOUND:return 'an'
    return 'an'if word[0]in'aeiou'else'a'


def _records(words,punct,index):
    if len(words)!=len(punct):raise ValueError('One punctuation suffix is required per gold word')
    tokens = _decode(words,index)
    rows = set()
    def add(pos,bad,rule):
        if bad in index and tokens[pos] in index and bad!=tokens[pos]:
            rows.add((pos,index[bad],rule))
    for pos,gold in enumerate(tokens):
        if gold not in index:continue  # Explicitly skip BOS/UNK or unavailable targets.
        previous = tokens[pos-1]if pos else None
        joined = pos>0 and _none(punct[pos-1])
        if joined and previous=='i'and gold in ('am','have','was'):
            for bad in ('is','has'):add(pos,bad,'first_person_auxiliary')
        if joined and previous in ('we','they')and gold in ('are','have'):
            for bad in ('is','has'):add(pos,bad,'plural_auxiliary')

        # An explicit subject before the modal avoids treating a noun "can" or
        # "will" as an auxiliary. An optional "not" remains tightly adjacent.
        modal_pos = pos-1
        if joined and previous=='not':modal_pos=pos-2
        if (modal_pos>=1 and tokens[modal_pos]in MODALS and
                tokens[modal_pos-1]in SUBJECTS and
                all(_none(punct[q])for q in range(modal_pos-1,pos)) and gold in BASE):
            base,third,past,ing,part = BASE[gold]
            for bad in (third,past,ing):add(pos,bad,'modal_base_verb')

        # Restrict perfects to a nearby pronoun subject, with a following
        # determiner/pronoun argument (or "been"). This avoids e.g. turning
        # "have opened doors" into the grammatical nominal phrase "have open
        # doors" and falsely labeling it ungrammatical.
        if (joined and previous in ('have','has','had')and pos>=2 and
                tokens[pos-2]in SUBJECTS and _none(punct[pos-2]) and
                (gold=='been'or(pos+1<len(tokens)and _none(punct[pos])and tokens[pos+1]in DETERMINERS))):
            for base,third,past,ing,part in PARTICIPLE.get(gold,()):
                for bad in (base,third):add(pos,bad,'perfect_participle')

        # Article negative is at the article position, with the actual next
        # GOLD word used only to select a sound-unambiguous training example.
        if (gold in ('a','an')and pos+1<len(tokens)and _none(punct[pos])and tokens[pos+1]in index):
            expected = article_for(tokens[pos+1])
            if expected==gold:add(pos,'an'if gold=='a'else'a','article_sound')
    return sorted(rows)


def negatives(words,punct,index):
    """Return sorted unique (gold_token_position, negative_word_id) pairs.

    ``words`` may be lower/uppercase gold strings or vocabulary IDs. ``index``
    maps lowercase words to output IDs. Unknown IDs and absent words are skipped.
    Returned positions refer to ``words``; callers must shift them explicitly
    when creating teacher-forced next-token labels. This function must only be
    called while preparing training data or calculating a training loss.
    """
    return sorted({(pos,bad)for pos,bad,_ in _records(words,punct,index)})


def main():
    p=argparse.ArgumentParser(description='Count training-only grammar negatives; no model calls')
    p.add_argument('--train',type=Path,required=True,help='Encoded TRAIN JSONL, never validation/test')
    p.add_argument('--vocabulary',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True,help='New audit directory')
    a=p.parse_args()
    if a.out.exists():p.error('Choose a new audit output directory')
    if a.train.name!='train.jsonl':p.error('The count/audit tool only accepts a file named train.jsonl')
    vocab=json.loads(a.vocabulary.read_text());index={w:i for i,w in enumerate(vocab)}
    counter=Counter();kinds=Counter();examples={};documents=words_total=0
    for line in a.train.open():
        row=json.loads(line)
        if row.get('split','train')!='train':raise ValueError('Nontraining source row')
        ids=row['token_ids'];punct=row['punctuation'];tokens=_decode(ids,index)
        documents+=1;words_total+=len(ids)
        for pos,bad,rule in _records(tokens,punct,index):
            counter[rule]+=1;kinds[row.get('kind',row.get('source_kind','unknown'))]+=1
            start=max(0,pos-6);end=min(len(tokens),pos+8)
            window=tokens[start:end]
            key=(rule,tuple(window),pos-start,bad)
            if key not in examples:
                identity=hashlib.sha256(repr(key).encode()).hexdigest()
                examples[key]={'rule':rule,'source_id':row.get('id'),'position':pos,
                    'gold':tokens[pos],'negative':vocab[bad],'context':' '.join(w or '[UNK]'for w in window),
                    'context_position':pos-start,'selection_hash':identity}
    sample=[]
    for rule in sorted(counter):
        items=sorted((r for r in examples.values()if r['rule']==rule),key=lambda r:r['selection_hash'])
        sample.extend(items[:20])
    selected={r['selection_hash']for r in sample}
    remaining=sorted((r for r in examples.values()if r['selection_hash']not in selected),key=lambda r:r['selection_hash'])
    sample.extend(remaining[:max(0,100-len(sample))]);sample=sample[:100]
    a.out.mkdir(parents=True)
    report={'status':'TRAINING_ONLY_CANDIDATE_COUNTS_NOT_LANGUAGE_OR_MODEL_RESULT',
        'source':str(a.train.resolve()),'source_sha256':hashlib.sha256(a.train.read_bytes()).hexdigest(),
        'vocabulary_sha256':hashlib.sha256(a.vocabulary.read_bytes()).hexdigest(),
        'module_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'documents':documents,'word_positions':words_total,'negative_pairs':sum(counter.values()),
        'by_rule':dict(counter),'by_kind':dict(kinds),'unique_context_negative_examples':len(examples),
        'sample_count':len(sample),'sample_policy':'20 per available rule then hash-ranked fill to100, training only',
        'false_positive_review':'PENDING_MANUAL_REVIEW','runtime_use':'none; training label construction only'}
    (a.out/'counts.json').write_text(json.dumps(report,indent=2)+'\n')
    (a.out/'examples-100.json').write_text(json.dumps(sample,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
