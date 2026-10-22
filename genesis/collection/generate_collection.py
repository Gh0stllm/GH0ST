#!/usr/bin/env python3
"""Reproducible GH0ST Genesis vector artwork and shard-linked metadata."""
import argparse
import concurrent.futures
import csv
import hashlib
import html
import itertools
import json
import shutil
from collections import Counter
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

VERSION = 'GH0ST-GENESIS-DOTMATRIX-1'
SIZE = 1280
WHITE = '#f5f6fa'
PALETTES = [
    ('Cyan', '#00dce7'), ('Emerald', '#36f5a2'), ('Amber', '#ffbf47'),
    ('Violet', '#b49aff'), ('Ice', '#a0ddff'), ('Rose', '#ff91c4'),
    ('Lime', '#c4f66d'), ('Cobalt', '#659dff'), ('Pearl', '#d3e7f5')]
SIGNALS = ['Mouth', 'Eyes', 'Brackets', 'Left Eye', 'Single Dot']
EXPRESSIONS = [
    ('Awake', '0', '0', '[0_0]'), ('Focused', '-', '-', '[-_-]'),
    ('Curious', 'o', '0', '[o_0]'), ('Wink', '0', '-', '[0_-]'),
    ('Reverse Wink', '-', '0', '[-_0]'), ('Dreaming', 'u', 'u', '[u_u]'),
    ('Joy', '^', '^', '[^_^]'), ('Wonder', 'O', 'O', '[O_O]'),
    ('Doubt', '0', 'o', '[0_o]'), ('Pause', '=', '=', '[=_=]'),
    ('Glitch', 'x', 'x', '[x_x]')]
EYES = {
    '0': ['01110', '10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    'o': ['00000', '00000', '01110', '10001', '10001', '01110', '00000', '00000'],
    '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000', '00000'],
    'u': ['00000', '00000', '10001', '10001', '10001', '10001', '01110', '00000'],
    '^': ['00000', '00100', '01010', '10001', '00000', '00000', '00000', '00000'],
    'O': ['11111', '10001', '10001', '10001', '10001', '10001', '10001', '11111'],
    '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000', '00000'],
    'x': ['00000', '10001', '01010', '00100', '01010', '10001', '00000', '00000']}
FONT = {
    'G': ['01111','10000','10000','10111','10001','10001','01110'],
    'H': ['10001','10001','10001','11111','10001','10001','10001'],
    'S': ['01111','10000','10000','01110','00001','00001','11110'],
    'T': ['11111','00100','00100','00100','00100','00100','00100'],
    'E': ['11111','10000','10000','11110','10000','10000','11111'],
    'N': ['10001','11001','11001','10101','10011','10011','10001'],
    'I': ['11111','00100','00100','00100','00100','00100','11111'],
    '0': ['01110','10001','10011','10101','11001','10001','01110'],
    '1': ['00100','01100','00100','00100','00100','00100','01110'],
    '2': ['01110','10001','00001','00010','00100','01000','11111'],
    '3': ['11110','00001','00001','01110','00001','00001','11110'],
    '4': ['00010','00110','01010','10010','11111','00010','00010'],
    '5': ['11111','10000','10000','11110','00001','00001','11110'],
    '6': ['01110','10000','10000','11110','10001','10001','01110'],
    '7': ['11111','00001','00010','00100','01000','01000','01000'],
    '8': ['01110','10001','10001','01110','10001','10001','01110'],
    '9': ['01110','10001','10001','01111','00001','00001','01110'],
    '/': ['00001','00001','00010','00100','01000','10000','10000'],
    ' ': ['00000']*7}

def dump(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def seed_for(record):
    raw = f"{VERSION}|{record['chain_id']}|{record['shard_address'].lower()}|{record['runtime_code_hash'].lower()}"
    return hashlib.sha256(raw.encode()).hexdigest()

def label_dots(text, cy, pitch, color):
    width = (len(text)*7-2)*pitch
    x0 = (SIZE-width)/2
    dots = []
    for n,char in enumerate(text):
        for y,row in enumerate(FONT[char]):
            for x,bit in enumerate(row):
                if bit == '1': dots.append((x0+(n*7+x)*pitch, cy+y*pitch, pitch*.35, color))
    return dots

def primitives(record, assignment):
    expr_idx, palette_idx, signal_idx = assignment
    name, left, right, face = EXPRESSIONS[expr_idx]
    palette, accent = PALETTES[palette_idx]
    signal = SIGNALS[signal_idx]
    seed = seed_for(record)
    parts = []
    # Brackets match the supplied broad, circular-dot reference.
    for side in ['left-bracket', 'right-bracket']:
        xs = [285,314,343] if side == 'left-bracket' else [908,937,966]
        for x in xs:
            parts.extend([(x,440,10,side),(x,759,10,side)])
        x = xs[0] if side == 'left-bracket' else xs[-1]
        for y in range(1,11): parts.append((x,440+29*y,10,side))
    for eye, glyph, x0 in [('left-eye',left,415),('right-eye',right,734)]:
        for y,row in enumerate(EYES[glyph]):
            for x,bit in enumerate(row):
                if bit == '1': parts.append((x0+27*x,498+29*y,10,eye))
    for x in range(5): parts.append((568+x*29,749,10,'mouth'))
    singleton = int(seed[0:8],16) % len(parts)
    dots = []
    for idx,(x,y,r,part) in enumerate(parts):
        accented = ((signal == 'Mouth' and part == 'mouth') or
                    (signal == 'Eyes' and part.endswith('eye')) or
                    (signal == 'Brackets' and part.endswith('bracket')) or
                    (signal == 'Left Eye' and part == 'left-eye') or
                    (signal == 'Single Dot' and idx == singleton))
        dots.append((x,y,r,accent if accented else WHITE))
    dots += label_dots('GH0ST / GENESIS',1064,3.5,WHITE)
    dots += label_dots(f"{record['token_id']:03d} / 495",1118,2.9,'#8d959d')
    # An unobtrusive visual fingerprint derived from the same shard seed.
    for i,bit in enumerate(bin(int(seed[:8],16))[2:].zfill(32)):
        dots.append((500+i*9,1182,1.7,accent if bit == '1' else '#22272b'))
    traits = {'Expression':name,'Face':face,'Accent':palette,'Signal':signal,
              'Edition':'Genesis','Art Version':VERSION}
    return dots, traits, seed

def render_one(args):
    record, assignment, out_str = args
    out = Path(out_str)
    number = record['shard_number']
    dots, traits, seed = primitives(record, assignment)
    title = f"GH0ST Genesis #{number}"
    desc = f"{traits['Face']} — {traits['Expression']}; {traits['Accent']} / {traits['Signal']}. Token {record['token_id']} maps to weight shard index {record['shard_index']}."
    big = [p for p in dots if p[2] >= 8]
    def circles(values):
        return ''.join(f'<circle cx="{x:g}" cy="{y:g}" r="{r:g}" fill="{c}"/>' for x,y,r,c in values)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="1280" viewBox="0 0 1280 1280" role="img" aria-labelledby="title desc">'
           f'<title id="title">{html.escape(title)}</title><desc id="desc">{html.escape(desc)}</desc>'
           '<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter></defs>'
           '<rect width="1280" height="1280" fill="#000000"/>'
           f'<g filter="url(#glow)" opacity=".24">{circles(big)}</g>{circles(dots)}</svg>\n')
    vector_path = out/'vectors'/f'{number}.svg'
    vector_path.write_text(svg)
    scale=2
    canvas=Image.new('RGB',(SIZE*scale,SIZE*scale),'black')
    glow=Image.new('RGB',canvas.size,'black')
    g=ImageDraw.Draw(glow)
    for x,y,r,c in big:
        g.ellipse(((x-r)*scale,(y-r)*scale,(x+r)*scale,(y+r)*scale),fill=c)
    glow=glow.filter(ImageFilter.GaussianBlur(5*scale)).point(lambda p:int(p*.24))
    canvas=Image.blend(canvas,glow,1)
    draw=ImageDraw.Draw(canvas)
    for x,y,r,c in dots:
        draw.ellipse(((x-r)*scale,(y-r)*scale,(x+r)*scale,(y+r)*scale),fill=c)
    canvas=canvas.resize((SIZE,SIZE),Image.Resampling.LANCZOS)
    image_path=out/'images'/f'{number}.png'
    canvas.save(image_path,optimize=True)
    return {'token_id':record['token_id'],'number':number,'traits':traits,'art_seed_sha256':seed,
            'image_sha256':sha(image_path),'vector_sha256':sha(vector_path)}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--workers',type=int,default=4)
    args=parser.parse_args()
    source=json.loads(args.source.read_text())
    records=source['records']
    assert len(records)==495 and {r['token_id'] for r in records}==set(range(1,496))
    out=args.output
    for sub in ['images','vectors','metadata-templates','evidence']:(out/sub).mkdir(parents=True,exist_ok=True)
    # Balanced 11 x 9 x 5 trait grid; shard-seed ranking determines the assignment.
    combos=list(itertools.product(range(11),range(9),range(5)))
    ranked=sorted(records,key=lambda r:seed_for(r))
    allocation={r['token_id']:c for r,c in zip(ranked,combos)}
    tasks=[(r,allocation[r['token_id']],str(out)) for r in records]
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        artworks=list(pool.map(render_one,tasks))
    by_id={a['token_id']:a for a in artworks}
    inventory=[]
    for record in records:
        art=by_id[record['token_id']]
        number=record['shard_number']
        attrs=[{'trait_type':k,'value':v} for k,v in art['traits'].items()]
        attrs += [{'trait_type':'Shard Index','value':record['shard_index']},
                  {'trait_type':'Payload Bytes','value':record['payload_length_bytes']},
                  {'trait_type':'Chain ID','value':record['chain_id']}]
        metadata={
            'name':f'GH0ST Genesis #{number}',
            'description':f"Genesis collectible associated with weight shard {record['shard_index']} of GH0ST's deployed Falcon-H1-Tiny-90M-Instruct four-bit export. {art['traits']['Expression']} / {art['traits']['Accent']} / {art['traits']['Signal']}. This NFT association does not grant exclusive access, control over inference, model copyright or automatic revenue rights. GH0ST is built using artificial intelligence technology from the Technology Innovation Institute.",
            'image':f'ipfs://__IMAGE_CID__/{number}.png',
            'external_url':f"{source['explorer_base_url']}/address/{record['shard_address']}",
            'attributes':attrs,
            'properties':{
                'schema_version':1,'collection':'GH0ST Genesis','token_id':record['token_id'],
                'chain':{'name':source['chain_name'],'chain_id':source['chain_id'],'environment':source['network_environment']},
                'shard':record,
                'model':{'id':source['model_id'],'revision':source['model_revision'],
                         'parameters':source['model_parameters'],'upstream_license':source['model_license'],
                         'export_variant':source['weight_export_variant'],
                         'export_sha256':source['weight_export_sha256'],'export_length_bytes':source['weight_export_length_bytes']},
                'artwork':{'generator_version':VERSION,'art_seed_sha256':art['art_seed_sha256'],
                           'seed_derivation':'SHA-256(generator_version|chain_id|lowercase_shard_address|lowercase_runtime_code_hash)',
                           'trait_assignment':'Lexicographic shard-seed rank mapped to balanced Expression x Accent x Signal grid.',
                           'png_sha256':art['image_sha256'],'svg_sha256':art['vector_sha256'],
                           'dimensions':{'width':SIZE,'height':SIZE},'mime_type':'image/png'},
                'provenance':{'repository':source['repository'],'commit':source['repository_commit'],
                              'manifest_path':source['repository_manifest_path'],'manifest_as_of_utc':source['repository_manifest_as_of_utc'],
                              'evidence_basis':source['evidence_basis'],
                              'runtime_hash_scope':source['shard_runtime_layout']}}}
        dump(out/'metadata-templates'/f'{number}.json',metadata)
        inventory.append({'token_id':record['token_id'],'image':f'images/{number}.png',
                          'vector':f'vectors/{number}.svg','metadata_template':f'metadata-templates/{number}.json',
                          'shard_address':record['shard_address'],'runtime_code_hash':record['runtime_code_hash'],
                          **art})
    dump(out/'collection-manifest.json',{'schema_version':1,'name':'GH0ST Genesis','generator_version':VERSION,
         'supply':495,'token_ids':{'first':1,'last':495,'filename_format':'three-digit padded; 001.json through 495.json'},
         'chain_id':source['chain_id'],'source_commit':source['repository_commit'],
         'proposed_burn_to_mint':{'token_address':'0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559',
                                 'tokens_per_nft':200000,'maximum_tokens_at_full_mint':99000000,
                                 'status':'Proposed; no NFT contract deployed and no token burn performed.'},
         'upload_status':'Not uploaded; requires Pinata authentication and CID finalization.',
         'items':inventory})
    dump(out/'collection-template.json',{'name':'GH0ST Genesis',
         'description':'495 dot-matrix collectibles, each associated with an actual deployed GH0ST model weight shard. GH0ST is built using artificial intelligence technology from the Technology Innovation Institute.',
         'image':'ipfs://__IMAGE_CID__/001.png','external_link':'https://gh0st.fyi'})
    for p in args.source.parent.iterdir():
        if p.is_file():shutil.copy2(p,out/'evidence'/p.name)
    fields=['token_id','shard_index','shard_address','runtime_code_hash','payload_offset_bytes','payload_length_bytes','deployment_transaction_hash','expression','accent','signal','image_sha256']
    with (out/'inventory.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
        for r in records:
            a=by_id[r['token_id']]
            w.writerow({**{k:r[k] for k in fields if k in r},'expression':a['traits']['Expression'],
                        'accent':a['traits']['Accent'],'signal':a['traits']['Signal'],'image_sha256':a['image_sha256']})
    counts={k:dict(Counter(a['traits'][k] for a in artworks)) for k in ['Expression','Accent','Signal']}
    report={'supply':495,'unique_png_sha256':len({a['image_sha256'] for a in artworks}),
            'unique_svg_sha256':len({a['vector_sha256'] for a in artworks}),
            'unique_trait_combinations':len({tuple(a['traits'][k] for k in ['Expression','Accent','Signal']) for a in artworks}),
            'unique_art_seeds':len({a['art_seed_sha256'] for a in artworks}),'trait_counts':counts}
    assert all(report[k]==495 for k in ['unique_png_sha256','unique_svg_sha256','unique_trait_combinations','unique_art_seeds'])
    dump(out/'generation-report.json',report)
    shutil.copy2(Path(__file__),out/'generate_collection.py')
    print(json.dumps({'output':str(out),'validation':report},indent=2))

if __name__=='__main__':main()
