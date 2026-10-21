"""Test strict output acceptance; no generated action is executed."""
from dataset import validate, build, score

def main():
    splits=build()
    valid_count=0
    for rows in splits.values():
        for row in rows:
            assert validate(row['target']);valid_count+=1
    bad=[None,[],{}, {'action':'transfer','amount':1},
         {'action':'complete_task','task_id':True},
         {'action':'complete_task','task_id':'7'},
         {'action':'complete_task','task_id':0},
         {'action':'complete_task','task_id':10000},
         {'action':'create_task','title':''},
         {'action':'create_task','title':'x'*81},
         {'action':'create_task','title':'ok','execute':True},
         {'action':'set_preference','key':'private_key','value':'secret'},
         {'action':'get_preference','key':'theme','value':'dark'},
         {'action':'reply','text':[]},
         {'action':'reply','text':'x'*241}]
    for value in bad: assert not validate(value),value
    row={'group':'complete_task','target':{'action':'complete_task','task_id':7}}
    assert score(row,'{"action":"complete_task","task_id":7}')['case_pass']
    assert not score(row,'{"action":"complete_task","task_id":8}')['case_pass']
    assert not score(row,'```json\n{"action":"complete_task","task_id":7}\n```')['case_pass']
    print({'valid_targets':valid_count,'invalid_objects_rejected':len(bad),'scoring_checks':3})

if __name__=='__main__': main()
