import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { keccak256, toUtf8Bytes } from "ethers";
import { afterimageAltText } from "./x-media.mjs";

export const AFTERIMAGE_VERSION = "gh0st-afterimage-v1";
export const LONG_AFTERIMAGE_VERSION = "gh0st-afterimage-v2";
function configuredPath(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0"))
    throw Error(`${name} must be an absolute local path`);
  return value;
}
if (process.env.GH0ST_SERVER_LEGACY_ONLY !== undefined &&
    !["0", "1"].includes(process.env.GH0ST_SERVER_LEGACY_ONLY))
  throw Error("GH0ST_SERVER_LEGACY_ONLY must be 0 or 1");
export const AFTERIMAGE_PYTHON = configuredPath("GH0ST_AFTERIMAGE_PYTHON",
  "/Users/abhijith/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3");
export const AFTERIMAGE_FONT = configuredPath("GH0ST_AFTERIMAGE_FONT", "/System/Library/Fonts/Menlo.ttc");
export const AFTERIMAGE_FONT_SHA256 = "f2d400484a6aace67980730ec0a9ef24ce9e535a2604f118e6fdc2510021b85f";
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

// Fixed local rasterizer. BASIC font layout, font bytes and raster-library
// versions are pinned; there is no browser, remote asset or generative service.
const PYTHON = String.raw`
import base64, hashlib, io, json, re, sys, zlib
from PIL import Image, ImageDraw, ImageFont, PngImagePlugin, features
import PIL

request = json.load(sys.stdin)
answer = request['answer']
font_path = request['fontPath']
if (PIL.__version__, features.version_module('freetype2'), zlib.ZLIB_VERSION) != ('12.3.0', '2.14.3', '1.2.12'):
    raise RuntimeError('Pinned local rasterizer versions are unavailable')
font_bytes = open(font_path, 'rb').read()
if hashlib.sha256(font_bytes).hexdigest() != request['fontSha256']:
    raise RuntimeError('Pinned Afterimage font differs')

WIDTH = HEIGHT = 1200
X, Y, WRAP_WIDTH, MAX_BOTTOM = 140, 430, 910, 1010
PAPER, AMBER, BLACK = (238,234,224), (230,180,84), (7,8,7)

def wrap(font, text):
    lines, position = [], 0
    while position < len(text):
        remaining = text[position:]
        count = 0
        while count < len(remaining) and font.getlength(remaining[:count+1]) <= WRAP_WIDTH:
            count += 1
        if count == 0:
            raise RuntimeError('Text cannot fit the card')
        end, separator = count, ''
        if count < len(remaining):
            space = remaining.rfind(' ', 0, count + 1)
            if space > 0:
                end, separator = space, ' '
        line = remaining[:end]
        lines.append({'text':line, 'start':position, 'end':position+end, 'separator':separator})
        position += end + len(separator)
    if ''.join(line['text'] + line['separator'] for line in lines) != text:
        raise RuntimeError('Wrapping changed the exact thought')
    return lines

for size in range(67, 23, -1):
    font = ImageFont.truetype(font_path, size, index=0, layout_engine=ImageFont.Layout.BASIC)
    lines = wrap(font, answer)
    line_height = size * 1.53
    bounds = [font.getbbox(line['text'], anchor='la') for line in lines]
    bottom = max(Y + i * line_height + box[3] for i,box in enumerate(bounds))
    right = max(X + box[2] for box in bounds)
    if bottom <= MAX_BOTTOM and right <= X + WRAP_WIDTH:
        break
else:
    raise RuntimeError('Exact thought cannot fit the card')

mask = Image.new('L',(WIDTH,HEIGHT),0)
draw_mask = ImageDraw.Draw(mask)
for i,line in enumerate(lines):
    draw_mask.text((X,Y+i*line_height),line['text'],font=font,fill=255,anchor='la',stroke_width=0)

# Supersampling is applied to the dots, not to the font sampling grid. This
# keeps the same five-pixel dot grid as the chosen preview while smoothing it.
SCALE=4
image = Image.new('RGB',(WIDTH*SCALE,HEIGHT*SCALE),BLACK)
draw = ImageDraw.Draw(image)
def dot(x,y,r,color,alpha=1):
    blended=tuple(round(BLACK[i]*(1-alpha)+color[i]*alpha) for i in range(3))
    draw.ellipse(((x-r)*SCALE,(y-r)*SCALE,(x+r)*SCALE,(y+r)*SCALE),fill=blended)

cx,cy,s=184,184,5.7
for i in range(11):
    dot(cx-8*s,cy+(i-5)*s,s*.29,PAPER)
    dot(cx+8*s,cy+(i-5)*s,s*.29,PAPER)
for i in [1,2]:
    for side in [-1,1]:
        for end in [-5,5]:
            dot(cx+side*(8-i)*s,cy+end*s,s*.29,PAPER)
for side in [-1,1]:
    for i in range(3):
        dot(cx+side*3*s,cy+(i-1)*s,s*.35,AMBER)
for i in [-1,0,1]:
    dot(cx+i*s,cy+3*s,s*.3,PAPER)

pixels=mask.load()
text_dots=0
for py in range(Y,min(HEIGHT,int(Y+len(lines)*line_height)+1),5):
    for px in range(X,min(WIDTH,X+WRAP_WIDTH+size),5):
        if pixels[px,py]>80:
            dot(px,py,1.75,PAPER)
            text_dots+=1
for px in range(144,1050,22):
    dot(px,1060,1.8,PAPER,.08)
image=image.resize((WIDTH,HEIGHT),Image.Resampling.LANCZOS)
info=PngImagePlugin.PngInfo()
info.add_text('Software',request['version'])
info.add_text('Description',answer)
info.add_text('AnswerHash',request['answerHash'])
info.add_text('Font-SHA256',request['fontSha256'])
out=io.BytesIO()
image.save(out,format='PNG',pnginfo=info,compress_level=9,optimize=False)
json.dump({'png':base64.b64encode(out.getvalue()).decode('ascii'),
    'layout':{'x':X,'y':Y,'wrapWidth':WRAP_WIDTH,'fontSize':size,'lineHeight':line_height,
        'lines':lines,'inkBottom':bottom,'inkRight':right,'textDots':text_dots},
    'runtime':{'python':sys.version.split()[0],'pillow':PIL.__version__,
        'freetype':features.version_module('freetype2'),'zlib':zlib.ZLIB_VERSION},
    'fontName':list(font.getname())},sys.stdout,separators=(',',':'))
`;

// Keep the original short-card renderer bytes unchanged for stored assets.
// Longer thoughts may extend the card vertically; no text is truncated.
const LONG_PYTHON = PYTHON.replace(
  "else:\n    raise RuntimeError('Exact thought cannot fit the card')",
  "else:\n    HEIGHT = max(1200, int(bottom + 191))\n    if HEIGHT > 4096 or right > X + WRAP_WIDTH:\n        raise RuntimeError('Exact thought needs a paged image layout')",
).replace("range(67, 23, -1)", "range(67, 17, -1)")
  .replace("dot(px,1060,1.8", "dot(px,HEIGHT-140,1.8")
  .replace("pixels=mask.load()", "TEXT_STEP = 2 if size < 36 else 3 if size <= 48 else 5\nTEXT_RADIUS = .7 if size < 36 else 1.05 if size <= 48 else 1.75\npixels=mask.load()")
  .replace("int(Y+len(lines)*line_height)+1),5):", "int(Y+len(lines)*line_height)+1),TEXT_STEP):")
  .replace("X+WRAP_WIDTH+size),5):", "X+WRAP_WIDTH+size),TEXT_STEP):")
  .replace("dot(px,py,1.75,PAPER)", "dot(px,py,TEXT_RADIUS,PAPER)");

function runRenderer(input, pythonPath, source = PYTHON) {
  return new Promise((resolve, reject) => {
    const child = execFile(pythonPath, ["-c", source],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, encoding: "utf8", windowsHide: true },
      (error, stdout) => {
        if (error) { reject(Error("Local Afterimage renderer failed; verify the pinned Python, Pillow and font installation")); return; }
        try { resolve(JSON.parse(stdout)); } catch { reject(Error("Local Afterimage renderer returned invalid metadata")); }
      });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(input));
  });
}

function saveIdentical(filename, bytes) {
  const parent = path.dirname(filename);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const verify = () => {
    const s = fs.lstatSync(filename);
    if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077) !== 0 ||
        (typeof process.getuid === "function" && s.uid !== process.getuid()) ||
        !fs.readFileSync(filename).equals(bytes)) throw Error("Existing Afterimage asset differs or is not a private owned file");
  };
  if (fs.existsSync(filename)) { verify(); return; }
  const temporary = path.join(parent, ".afterimage-" + crypto.randomBytes(12).toString("hex") + ".tmp");
  const fd = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    try { fs.linkSync(temporary, filename); }
    catch (error) { if (error.code !== "EEXIST") throw error; verify(); }
  } finally { fs.unlinkSync(temporary); }
  const directory = fs.openSync(parent, "r");
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  verify();
}

/** Render the exact committed thought; never rewrite case, punctuation or spaces. */
export async function renderAfterimage({ answer, answerHash: expectedAnswerHash, outputPath, proofUrl,
  pythonPath = AFTERIMAGE_PYTHON } = {}) {
  if (process.env.GH0ST_SERVER_LEGACY_ONLY === "1" &&
      (typeof answer !== "string" || answer.length < 30 || answer.length > 180))
    throw Error("Server migration preserves the live 30-180 character thought bound");
  if (typeof answer !== "string" || answer.length < 1 || answer.length > 8192 ||
      answer.trim() !== answer || !/^[\x20-\x7e]+$/.test(answer))
    throw Error("Afterimage requires the exact 1-8192 byte single-line ASCII thought");
  const answerHash = keccak256(toUtf8Bytes(answer));
  const altText = afterimageAltText(answer, proofUrl);
  if (expectedAnswerHash !== undefined && expectedAnswerHash !== answerHash)
    throw Error("Afterimage thought differs from the committed answer hash");
  if (outputPath !== undefined && (!path.isAbsolute(outputPath) || path.extname(outputPath).toLowerCase() !== ".png"))
    throw Error("Afterimage output must be an absolute PNG file path");
  const legacy = answer.length >= 30 && answer.length <= 180;
  const rendererVersion = legacy ? AFTERIMAGE_VERSION : LONG_AFTERIMAGE_VERSION;
  const source = legacy ? PYTHON : LONG_PYTHON;
  const rendered = await runRenderer({ answer, answerHash, version: rendererVersion,
    fontPath: AFTERIMAGE_FONT, fontSha256: AFTERIMAGE_FONT_SHA256 }, pythonPath, source);
  const bytes = Buffer.from(rendered.png, "base64");
  const height = bytes.length >= 24 ? bytes.readUInt32BE(20) : 0;
  if (bytes.length < 32 || !bytes.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
      bytes.readUInt32BE(16) !== 1200 || height < 1200 || height > 4096 || (legacy && height !== 1200) ||
      rendered.layout.lines.map(line => line.text + line.separator).join("") !== answer)
    throw Error("Afterimage PNG dimensions or exact-text layout are invalid");
  const pngSha256 = sha(bytes);
  const metadata = { schema: "gh0st-afterimage-asset-v1", rendererVersion,
    rendererSourceSha256: sha(Buffer.from(source)), mimeType: "image/png", width: 1200, height,
    answer, answerHash, altText, ...(answer !== altText ? { proofUrl } : {}), sha256: pngSha256, pngSha256,
    fontSha256: AFTERIMAGE_FONT_SHA256, fontName: rendered.fontName, fontIndex: 0,
    runtime: rendered.runtime, layout: rendered.layout };
  const metadataBytes = Buffer.from(JSON.stringify(metadata, null, 2) + "\n");
  const result = { ...metadata, bytes, metadata, metadataSha256: sha(metadataBytes) };
  if (outputPath !== undefined) {
    saveIdentical(outputPath, bytes);
    saveIdentical(outputPath + ".json", metadataBytes);
    result.path = outputPath;
    result.metadataPath = outputPath + ".json";
  }
  return result;
}
