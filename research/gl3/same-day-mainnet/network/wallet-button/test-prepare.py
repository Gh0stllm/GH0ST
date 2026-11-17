import unittest
from prepare import inject,TAG,function_payload,functions_equal

class Preservation(unittest.TestCase):
    def test_exact_bytes(self):
        for raw in [b'<html><body>x</body></html>',b'<!doctype html>\r\n<BODY>\xff\n</BODY >\r\n',b'<p>implicit body',b'',b'<body>\r\n</body>\r\n<!-- trailer -->']:
            new,placement=inject(raw)
            self.assertEqual(new.count(TAG),1);self.assertEqual(new.replace(TAG,b'',1),raw)
            if b'</body>' in raw:self.assertLess(new.index(TAG),new.rindex(b'</body>'))
    def test_duplicate_refuses(self):
        with self.assertRaises(ValueError):inject(b'<script src="/gh0st-network-wallet.mjs"></script>')
    def test_utf16_refuses(self):
        with self.assertRaises(ValueError):inject('<body>x</body>'.encode('utf-16'))
    def test_function_config_preserved(self):
        f={'n':'live-stats','d':'a'*64,'r':'nodejs24.x','im':'stream','bd':{'runtimeAPIVersion':2},'ro':[{'p':'/api/live-stats','l':'/api/live-stats','e':None,'m':['GET','POST'],'ps':False}],'m':1024,'rg':'us-east-2','mo':1024,'rgo':'us-east-2','p':10}
        hashes,configs=function_payload([f]);self.assertEqual(hashes,{'live-stats':'a'*64});self.assertEqual(configs['live-stats']['routes'][0]['methods'],['GET','POST']);self.assertEqual(configs['live-stats']['memory'],1024)
        self.assertTrue(functions_equal([f],[dict(f,id='new-instance',c='new-time')]))
        for key,value in [('r','nodejs22.x'),('im','buffered'),('d','b'*64),('bd',{'runtimeAPIVersion':1}),('ro',[]),('m',512),('rg','us-west-1'),('p',0)]:self.assertFalse(functions_equal([f],[dict(f,**{key:value})]),key)
        self.assertFalse(functions_equal([f],[]));self.assertFalse(functions_equal([],[f]))
    def test_default_function_config_not_promoted_to_override(self):
        f={'n':'gl3-rpc','d':'b'*64,'r':'nodejs24.x','m':1024,'rg':'us-east-2'}
        _,c=function_payload([f]);self.assertNotIn('memory',c['gl3-rpc']);self.assertNotIn('region',c['gl3-rpc'])
        self.assertFalse(functions_equal([f],[dict(f,mo=1024,rgo='us-east-2')]))

if __name__=='__main__':unittest.main(verbosity=2)
