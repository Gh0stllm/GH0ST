"""Conservative, explicit post-generation grammar heuristic; never generates or repairs text.

This is a filter for research measurement, not a proof or a production grammar checker.
All accepted text must already have been naturally emitted by the unchanged model.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import random
import re
from collections import Counter
from screen_sampling import tokenizer, OUT

PRONOUNS=set('i we you he she it they everyone someone anyone nobody everybody somebody everything something nothing this that'.split())
SINGULAR=set('he she it everyone someone anyone nobody everybody somebody everything something nothing this that'.split())
PLURAL=set('we you they'.split())
NAMES=set('alex anna ann amy ben bob bella charlie dan daisy ella emma emily eva henry jack jane jay jean jill joe john jo joy julia kate kay kim leo lily lisa lucy luke luna max maya mia mila mira molly nick nina nora oliver peter ray rex rita rob rose ruby sam sara sarah sue ted tim tina tom tony zoe'.split())
MASS=set('kindness courage happiness friendship hope love joy peace time life fear magic music rain snow water sunlight moonlight wind air fire grass silence darkness light beauty truth luck freedom wisdom patience trust thunder lightning ice heat food nature'.split())
DETERMINERS=set('the a an my your his her our their its this that these those'.split())
ADJECTIVES=set('little small big large kind nice happy sad bright dark young old new shiny gentle tiny huge quiet warm cold deep soft true good bad long short green blue red golden beautiful magical special brave scared afraid strong weak'.split())
FORBIDDEN_LAST=set('a an the my your his her our their its and or but because although if when while than as of to for from with without into onto at in on by over under through between about like very so too not just more less much enough such can could may might must shall should will would do does did am is are was were be been being have has'.split())
PREPOSITIONS=set('to for from with without into onto at in on by over under through between about of'.split())
MODALS=set('can could may might must shall should will would'.split())
COPULAS=set('am is are was were be been being seem seems seemed become becomes became'.split())
AUX=set('do does did have has had'.split())
INTRANSITIVE=set('said say says asked ask asks replied reply replies whispered whisper whispers shouted shout shouts cried cry cries smiled smile smiles laughed laugh laughs nodded nod nods sighed sigh sighs giggled giggle giggles grinned grin grins frowned frown frowns cheered cheer cheers rested rest rests waited wait waits slept sleep sleeps woke wakes awoke sat sit sits stood stand stands arrived arrive arrives returned return returns walked walk walks ran run runs flew fly flies danced dance dances sang sing sings jumped jump jumps hopped hop hops bounced bounce bounces played play plays swam swim swims sparkled sparkle sparkles shone shines glowed glow glows bloomed bloom blooms grew grow grows stopped stop stops started start starts began begins listened listen listens looked look looks watched watch watches wondered wonder wonders agreed agree agrees disagreed disagrees disagreed tried try tries worked work works helped help helps lived live lives died die dies existed exists exist happened happens happen mattered matters matter changed change changes learned learn learns listened listen listens remembered remember remembers dreamed dream dreams dreamt thought think thinks felt feel feels sounded sound sounds stayed stay stays remained remain remains waited wait waits disappeared disappear disappears appeared appear appears joined join joins gathered gather gathers explored explore explores returned return returns followed follow follows won win wins lost lose loses failed fail fails succeeded succeed succeeds struggled struggle struggles trembled tremble trembles shook shakes worried worries worried opened open opens closed close closes escaped escape escapes came come comes went go goes left leave leaves hurried hurry hurries rushed rush rushes moved move moves turned turn turns drifted drift drifts floated float floats shivered shiver shivers glistened glisten glistens fluttered flutter flutters peeked peek peeks hummed hum hums whispered whisper whispers roared roar roars barked bark barks chirped chirp chirps chirruped'.split())
TRANSITIVE=set('told tell tells saw see sees seen found find finds knew know knows known loved love loves liked like likes wanted want wants needed need needs held hold holds carried carry carries made make makes bought buy buys gave give gives taken take takes took put puts kept keep keeps heard hear hears understood understand understands believed believe believes shared share shares touched touch touches hugged hug hugs thanked thank thanks called call calls noticed notice notices brought bring brings caught catch catches showed show shows met meet meets chose choose chooses remembered remember remembers forgot forget forgets forgotten enjoyed enjoy enjoys admired admire admires trusted trust trusts missed miss misses protected protect protects saved save saves recognized recognize recognizes accepted accept accepts offered offer offers wished wish wishes'.split())
BASE_VERBS=set('say ask reply whisper shout cry smile laugh nod sigh giggle grin frown cheer rest wait sleep wake sit stand arrive return walk run fly dance sing jump hop bounce play swim sparkle shine glow bloom grow stop start begin listen look watch wonder agree try work help live die exist happen matter change learn remember dream think feel sound stay remain disappear appear join gather explore follow win lose fail succeed struggle tremble shake worry open close escape come go leave hurry rush move turn drift float shiver glisten flutter peek hum roar bark chirp tell see find know love like want need hold carry make buy give take put keep hear understand believe share touch hug thank call notice bring catch show meet choose forget enjoy admire trust miss protect save recognize accept offer wish be let'.split())
IRREGULAR_PAST=set('said told saw found knew held made bought gave taken took put kept heard understood brought caught met chose forgot felt thought stood sat ran flew sang swam grew began won lost shook came went left'.split())
VERBS=INTRANSITIVE|TRANSITIVE|COPULAS|AUX|MODALS
TRANSITIVE.update({'mean','means','meant','reach','reaches','reached'})
BASE_VERBS.update({'mean','reach'})
VERBS.update({'mean','means','meant','reach','reaches','reached'})
FORBIDDEN_LAST.add('had')
MASS.add('help')
IRREGULAR_PLURALS={'children','people','mice','geese','men','women','feet','teeth'}


def nounish(word):
    return bool(re.fullmatch(r'[a-z]+',word)) and word not in (VERBS|DETERMINERS|PREPOSITIONS|ADJECTIVES|{'and','or','but','very','so','too','not'})


def reason(row, combined=False):
    text=(row['combined'] if combined else row['text']).lower().strip()
    tokens=row['tokens']
    if not (row.get('complete',True) and tokens and tokens[-1] in {1,2,15,30}):return 'not_natural_terminal'
    spellings=tokenizer.convert_ids_to_tokens(tokens[:-1])
    if any(t.startswith('##') or t in {'[UNK]','[EOS]'} for t in spellings):return 'wordpiece_or_special_fragment'
    if not re.fullmatch(r'[a-z ]+[.!?]?',text):return 'interior_punctuation_or_nonword'
    words=text.rstrip('.!?').split()
    if not 2<=len(words)<=7:return 'word_count'
    if any(a==b for a,b in zip(words,words[1:])):return 'repeated_adjacent_word'
    if words[-1] in FORBIDDEN_LAST:return 'dangling_function_word'
    if words[-1] in {'what','who','where','why','when','how'}:return 'dangling_wh_word'
    if 'anymore' in words and not any(w in {'not','never','no','hardly'} for w in words):return 'affirmative_anymore'
    if len(words)>2 and words[-2]=='and' and words[-1] in TRANSITIVE-INTRANSITIVE:return 'missing_coordinated_verb_object'
    if any(words[i] in PREPOSITIONS and (i+1==len(words) or words[i+1] in PREPOSITIONS) for i in range(len(words))):return 'broken_preposition'

    # Fully formed short questions; a wh-fragment is insufficient.
    if words[0] in {'what','who','where','why','how','when'}:
        if not text.endswith('?'):return 'question_without_question_mark'
        if len(words)<3:return 'short_wh_fragment'
        if words[1] in COPULAS:
            if words[1] in {'is','was'} and words[2] in PLURAL:return 'inverted_subject_verb_disagreement'
            if words[1] in {'is','was'} and words[2] in {'these','those'}:return 'inverted_subject_verb_disagreement'
            if words[1] in {'are','were'} and words[2] in SINGULAR:return 'inverted_subject_verb_disagreement'
            if words[1]=='am' and words[2]!='i':return 'inverted_subject_verb_disagreement'
            if words[1] in {'are','were'} and len(words)>=4 and words[2] in {'the','a','an'} and not (words[-1].endswith('s') or words[-1] in IRREGULAR_PLURALS):return 'inverted_noun_number_disagreement'
            if words[-1] in PRONOUNS or words[-1] in MASS or (len(words)>=4 and words[2] in DETERMINERS and nounish(words[-1])):
                return None
            return 'unclear_wh_complement'
        if words[1] in MODALS|{'do','does','did'} and len(words)>=4 and words[2] in PRONOUNS|NAMES and words[3] in BASE_VERBS:
            if words[1]=='does' and words[2] in PLURAL|{'i'}:return 'inverted_subject_verb_disagreement'
            if words[1]=='do' and words[2] in SINGULAR|NAMES:return 'inverted_subject_verb_disagreement'
            return None
        if words[:2]==['what','if'] and len(words)>=4 and words[2] in PRONOUNS|NAMES and words[3] in VERBS:return None
        return 'unclear_wh_clause'
    if words[0] in MODALS|{'do','does','did'}:
        if not text.endswith('?'):return 'question_without_question_mark'
        if len(words)>=2 and words[0]=='does' and words[1] in PLURAL|{'i'}:return 'inverted_subject_verb_disagreement'
        if len(words)>=2 and words[0]=='do' and words[1] in SINGULAR|NAMES:return 'inverted_subject_verb_disagreement'
        return None if len(words)>=3 and words[1] in PRONOUNS|NAMES and words[2] in BASE_VERBS else 'unclear_inverted_question'

    # Explicit subject + finite predicate. This deliberately rejects many valid
    # unusual clauses rather than silently accepting every punctuation ending.
    if words[0] in {'and','but','then','now'}:
        words=words[1:]
        if len(words)<2:return 'missing_clause_after_connector'
    first=words[0]
    subject_plural=first in PLURAL
    subject_singular=first in SINGULAR|NAMES|MASS or first=='i'
    if first in PRONOUNS|NAMES|MASS:
        vi=1
    elif first in DETERMINERS and len(words)>=3:
        if words[1] in ADJECTIVES:
            if len(words)<4 or not nounish(words[2]):return 'unfinished_subject_noun_phrase'
            vi=3
            subject_plural=words[2].endswith('s')
        else:
            if not nounish(words[1]):return 'unclear_subject_noun'
            vi=2
            subject_plural=words[1].endswith('s')
        subject_singular=not subject_plural
    elif first.endswith('s') and nounish(first):
        vi=1;subject_plural=True
    else:
        # Conservative imperatives, with complete complements when necessary.
        if first not in BASE_VERBS:return 'unrecognized_subject_or_command'
        if first in {'be','let'}:
            if first=='let' and (len(words)<3 or words[2] not in BASE_VERBS):return 'unfinished_let_command'
            return None if len(words)>=2 and words[-1] not in FORBIDDEN_LAST else 'unfinished_command'
        if first in TRANSITIVE and len(words)<2:return 'missing_command_object'
        return None
    if vi>=len(words):return 'missing_finite_predicate'
    verb=words[vi]
    had_modal=verb in MODALS
    if verb not in VERBS:return 'unrecognized_finite_verb'
    if verb=='am' and first!='i':return 'subject_verb_disagreement'
    if verb in {'is','has','does'} and (subject_plural or first=='i'):return 'subject_verb_disagreement'
    if verb in {'are','were','have','do'} and subject_singular and first!='you' and not (verb=='have' and first=='i'):
        return 'subject_verb_disagreement'
    if verb=='was' and subject_plural:return 'subject_verb_disagreement'
    if verb in MODALS:
        if vi+1>=len(words) or words[vi+1] not in BASE_VERBS:return 'missing_modal_main_verb'
        verb=words[vi+1];vi+=1
    tail=words[vi+1:]
    if verb in COPULAS and not tail:return 'missing_copula_complement'
    if verb in COPULAS and subject_singular and tail==['friends']:return 'unfinished_collective_complement'
    if verb in COPULAS and len(tail)>=2 and tail[0] in ADJECTIVES and tail[1] in PRONOUNS:return 'extra_nominative_after_adjective'
    if tail and tail[0] in {'not','never'}:
        tail=tail[1:]
    if verb in {'do','does','did'} and tail and tail[0] in VERBS-BASE_VERBS:return 'inflected_verb_after_do_auxiliary'
    if verb in {'has','have','had'} and tail and tail[0] in BASE_VERBS-MASS-{'run','put','cut','read'}:return 'bare_verb_after_have_auxiliary'
    if verb in {'said','says','say'} and len(tail)>=2 and tail[0]=='at' and tail[1] in NAMES:return 'said_at_person'
    if verb in TRANSITIVE-{'know','knows','knew','think','thinks','thought','hear','hears','heard','see','sees','saw','feel','feels','felt','notice','notices','noticed'} and len(tail)>=2 and tail[0] in PRONOUNS and tail[1] in BASE_VERBS:return 'missing_connector_after_object'
    if verb in COPULAS and not tail:return 'missing_copula_complement'
    if tail and tail[-1] in {'he','she','they','we','i'} and verb not in COPULAS:return 'dangling_nominative_pronoun'
    if verb in TRANSITIVE-INTRANSITIVE and not tail:return 'missing_object'
    if tail and tail[0] in {'a','an','the','my','your','his','her','our','their'}:
        if len(tail)<2 or tail[-1] in ADJECTIVES:return 'unfinished_object_noun_phrase'
    if not had_modal and subject_singular and first!='i' and verb in BASE_VERBS-IRREGULAR_PAST-{'cut','put'}:
        return 'bare_verb_with_singular_subject'
    return None


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('file')
    parser.add_argument('--combined',action='store_true')
    parser.add_argument('--label')
    args=parser.parse_args()
    source=Path(args.file)
    data=json.loads(source.read_text())
    accepted=[];rejected=[];reasons=Counter()
    for row in data:
        why=reason(row,args.combined)
        if why is None:accepted.append(row)
        else:rejected.append(row|{'reason':why});reasons[why]+=1
    by_words={}
    key_name='combined' if args.combined else 'text'
    for row in accepted:
        normalized=' '.join(row[key_name].casefold().rstrip('.!?').split())
        by_words.setdefault(normalized,row|{'word_sequence_key':normalized})
    raw_accepted=len(accepted)
    accepted=list(by_words.values())
    label=args.label or source.stem+'-grammar'
    summary={'scope':'Conservative heuristic post-screen of unchanged model emissions; not a grammar guarantee.',
        'source_file':str(source),'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'screen_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'uses_visible_prompt':args.combined,'natural_unique_inputs':len(data),
        'accepted_exact_strings':raw_accepted,'accepted_distinct_word_sequences':len(accepted),
        'accepted_unique':len(accepted),'rejected':len(rejected),
        'rejection_reasons':dict(reasons),'limitations':['Finite verb and subject recognition are approximate word-level rules.',
            'This changes no generated text and forces no model token.','Human random-sample review is required; false accepts and false rejects remain possible.']}
    (OUT/f'{label}-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    (OUT/f'{label}-accepted.json').write_text(json.dumps(accepted,separators=(',',':'))+'\n')
    sample=random.Random(271828).sample(accepted,min(150,len(accepted)))
    (OUT/f'{label}-review.json').write_text(json.dumps(sample,indent=2)+'\n')
    key='combined' if args.combined else 'text'
    (OUT/f'{label}-review.txt').write_text('\n'.join(f'{i+1}. {row[key]}' for i,row in enumerate(sample))+'\n')
    (OUT/f'{label}-rejected-sample.json').write_text(json.dumps(random.Random(42).sample(rejected,min(150,len(rejected))),indent=2)+'\n')
    print(json.dumps(summary,indent=2))


if __name__=='__main__':main()
