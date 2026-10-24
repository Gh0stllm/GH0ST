#!/usr/bin/env python3
"""Human scores and known-training copy audit for the fixed V9 first gate."""
import collections
import hashlib
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
PREPARED = HERE.parent/'pretrained-continuity/prepared'
BASE = [
    ([2,1,1,2], 'Boss becomes a boy in a game, with repeated screen/game descriptions.'),
    ([3,0,0,2], 'Boss and narrator disappear into a boy/robot friendship story.'),
    ([2,1,1,2], 'Crowd/future becomes letters to an unspecified woman and a garden.'),
    ([3,0,0,3], 'Crowd prompt becomes friends, stars, a spaceship and an alien.'),
    ([2,1,0,2], 'Owned object becomes talking treasure/stone, with confused pronouns.'),
    ([3,1,0,2], 'Permission premise becomes an old man and boy helping find a toy.'),
    ([1,0,0,2], 'Frog/ball story switches character gender and location repeatedly.'),
    ([2,1,0,1], 'Frog story repeats honesty/bravery morals and contradictory comparisons.'),
    ([2,1,0,2], 'Bird alternates friend, unable to fly, then flying higher; narrator is lost.'),
    ([3,0,0,1], 'Bird song repeats and EOS begins unrelated girl/star story.'),
    ([2,1,1,1], 'Map finding repeats, then EOS begins unrelated girl/brother story.'),
    ([2,2,1,1], 'Some first-person adventure connection, but repeated exhortations and broken quotations.'),
    ([1,0,0,1], 'Mug/trade disappears into children and repeated laughter.'),
    ([2,0,1,2], 'Mug disappears into inconsistent man/he/I references and hidden door.'),
    ([3,1,2,2], 'Notebook deadline briefly persists as regret, then cosmic bravery and new girl story after EOS.'),
    ([2,0,1,2], 'Notebook premise becomes shadow/sky, then an unrelated village story after EOS.'),
]
ADAPTED = [
    ([2,0,0,1], 'Boss prompt becomes man/robot/Alex helping loops and confused identity.'),
    ([3,0,0,1], 'Boss and narrator disappear into scientists and repeated project teamwork.'),
    ([3,1,0,2], 'Crowd setting persists loosely but narrator becomes an unspecified she/boy dance story.'),
    ([3,1,0,2], 'Crowd premise becomes boy painting sky and family dialogue.'),
    ([3,1,0,2], 'Owned object becomes a cat, box, treasure, book and chest without ownership continuity.'),
    ([2,1,0,1], 'Object premise becomes boy and repeatedly smart robot.'),
    ([2,1,0,1], 'Frog/ball becomes sister, tree, rock and fish with repeated pulling.'),
    ([1,0,1,1], 'Narrator becomes a frog with malformed moral, then unrelated Peter story after EOS.'),
    ([3,1,1,1], 'Block/bird premise becomes repeated plans to make a mistake and use bird magic.'),
    ([3,0,0,2], 'Bird becomes a cat, then EOS introduces unrelated Samuel/book story.'),
    ([1,2,1,1], 'First-person treasure route remains but malformed secret/treasure claims and repetitions prevent prose coherence.'),
    ([2,2,1,2], 'Map/forest theme remains, but hears agreement and twisted-like-a-snack imagery fail grammar/meaning.'),
    ([3,0,1,1], 'Mug/trade lost immediately to riddle, hero and friends dialogue.'),
    ([1,0,1,1], 'Mug/trade becomes screen and repeated honesty/treasure assertions with broken questions.'),
    ([3,1,2,1], 'Notebook deadline becomes generic bravery/path repetition, then unrelated Leo story after EOS.'),
    ([3,0,1,2], 'Notebook becomes same-man/shadow, then unrelated boy/Jose story after EOS.'),
]


def words(text):
    return re.findall(r"[a-z]+(?:'[a-z]+)?|[0-9]+", text.lower())


def extend(a, ai, b, bi):
    left, right = 0, 4
    while ai > left and bi > left and a[ai-left-1] == b[bi-left-1]:
        left += 1
    while ai+right < len(a) and bi+right < len(b) and a[ai+right] == b[bi+right]:
        right += 1
    return bi-left, left+right


def main():
    results, hashes = [], {}
    candidates = collections.defaultdict(list)
    for variant, judgments in [('base', BASE), ('voice50k', ADAPTED)]:
        path = HERE/f'{variant}-gate-raw.json'
        source = json.loads(path.read_text())
        assert len(source['outputs']) == len(judgments) == 16
        hashes[variant] = hashlib.sha256(path.read_bytes()).hexdigest()
        for row, (scores, reason) in zip(source['outputs'], judgments):
            seq = words(row['continuation'])
            result = {'variant': variant, 'seed': row['seed'], 'prompt_id': row['prompt_id'],
                      'scores': dict(zip(['grammar','continuity','voice','repetition'],scores)),
                      'passes_all_four': all(x>=3 for x in scores), 'reason': reason,
                      'eos_positions': row['eos_positions'], 'text': row['text'],
                      'longest_known_training_match': {'words':0}, '_tokens':seq}
            index = len(results)
            results.append(result)
            for pos in range(len(seq)-3):
                candidates[tuple(seq[pos:pos+4])].append((index,pos))
    count = 0
    for line in (PREPARED/'train.jsonl').open():
        row=json.loads(line);seq=words(row['text']);count+=1
        for pos in range(len(seq)-3):
            for index, outpos in candidates.get(tuple(seq[pos:pos+4]), ()):
                start,n=extend(results[index]['_tokens'],outpos,seq,pos)
                if n>results[index]['longest_known_training_match']['words']:
                    results[index]['longest_known_training_match']={'words':n,'text':' '.join(seq[start:start+n]),'source_id':row['id'],'source_kind':row['kind']}
    for row in results:del row['_tokens']
    summary={}
    for variant in ['base','voice50k']:
        group=[r for r in results if r['variant']==variant]
        summary[variant]={'streams':len(group),'passes_all_four':sum(r['passes_all_four']for r in group),
                          'scores_at_least_3':{k:sum(r['scores'][k]>=3 for r in group)for k in ['grammar','continuity','voice','repetition']},
                          'streams_emitting_eos_without_reset':sum(bool(r['eos_positions'])for r in group),
                          'max_known_training_span':max(r['longest_known_training_match']['words']for r in group)}
    report={'status':'V9_FIRST_GATE_QUALITY_NOT_APPROVED','all_raw_outputs_reviewed':True,
            'raw_sha256':hashes,'summary':summary,'outputs':results,
            'training_documents_searched':count,
            'copy_method':'Normalized words, exact matches of four or more; generated continuation only, not provided prefix. Both replay and original training searched.',
            'copy_limitations':'Known prepared corpus only; no claim about the unavailable complete original pretraining corpus or semantic paraphrase.',
            'development_samples':'All12 i/quote base/25k/50k samples also manually read; third-person children, repetitive morals and unrelated post-EOS stories remained.',
            'decision':'The50kvoice/199923total target trial did not establish first-person continuity or voice. Small NLL improvements do not justify automatic extension on the current evidence.',
            'runtime_limit':'CPU native FP32 study, not Q12/EVM gas or parity evidence.'}
    (HERE/'V9-FIRST-GATE-REVIEW.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(summary,indent=2))


if __name__=='__main__':main()
