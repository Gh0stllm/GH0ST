import unittest
from grammar_negatives import negatives, VERBS


class GrammarNegativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        words={w for row in VERBS for w in row}
        words.update('i am we they you he she it are were can could will would should must may might not the box doors open apple hour user honest uniform herb historical sql a an'.split())
        cls.index={w:i for i,w in enumerate(sorted(words))}
        cls.reverse={i:w for w,i in cls.index.items()}

    def got(self,text,punct=None):
        words=text.split()
        return {(pos,self.reverse[bad])for pos,bad in negatives(words,punct or [0]*len(words),self.index)}

    def test_subject_auxiliaries(self):
        self.assertEqual(self.got('i am'),{(1,'is'),(1,'has')})
        self.assertEqual(self.got('i was'),{(1,'is'),(1,'has')})
        self.assertEqual(self.got('we are'),{(1,'is'),(1,'has')})
        self.assertEqual(self.got('they have'),{(1,'is'),(1,'has')})
        self.assertEqual(self.got('i were'),set())
        self.assertEqual(self.got('i am',[2,0]),set())

    def test_modal_gold_base_and_boundaries(self):
        self.assertEqual(self.got('i can write'),{(2,'writes'),(2,'wrote'),(2,'writing')})
        self.assertEqual(self.got('we could not go'),{(3,'goes'),(3,'went'),(3,'going')})
        self.assertEqual(self.got('the can work'),set())
        self.assertEqual(self.got('i can wrote'),set())
        self.assertEqual(self.got('i can write',[0,2,0]),set())

    def test_perfect_avoids_adjective_ambiguity(self):
        got=self.got('i had made the box')
        self.assertEqual(got,{(2,'make'),(2,'makes')})
        self.assertEqual(self.got('i had opened doors'),set())
        self.assertEqual(self.got('i had opened the box'),{(2,'open'),(2,'opens')})
        self.assertEqual(self.got('i had cut the box'),{(2,'cuts')})
        self.assertEqual(self.got('i had been'),{(2,'be'),(2,'is')})

    def test_article_sound_and_ambiguities(self):
        self.assertEqual(self.got('an apple'),{(0,'a')})
        self.assertEqual(self.got('an hour'),{(0,'a')})
        self.assertEqual(self.got('a user'),{(0,'an')})
        self.assertEqual(self.got('a uniform'),{(0,'an')})
        for text in ('an herb','a historical','a sql','a honest','an user'):
            self.assertEqual(self.got(text),set(),text)
        self.assertEqual(self.got('an apple',[1,0]),set())

    def test_ids_unknown_absent_negative_and_alignment(self):
        ids=[self.index[w]for w in ('i','can','write')]
        self.assertEqual(negatives(ids,[0,0,0],self.index),negatives(['i','can','write'],[0,0,0],self.index))
        self.assertEqual(negatives([999999,self.index['can'],self.index['write']],[0,0,0],self.index),[])
        smaller={w:i for w,i in self.index.items()if w!='writing'}
        self.assertNotIn((2,self.index['writing']),negatives(['i','can','write'],[0,0,0],smaller))
        with self.assertRaises(ValueError):negatives(['i','am'],[0],self.index)


if __name__=='__main__':unittest.main()
