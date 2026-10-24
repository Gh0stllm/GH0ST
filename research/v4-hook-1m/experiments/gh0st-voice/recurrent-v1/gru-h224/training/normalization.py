import re,unicodedata
WORD=re.compile(r"[a-z]+(?:'[a-z]+)*(?:[.!?])?")
def words(text):
    text=unicodedata.normalize("NFKD",text).lower().replace("’", "'").replace("‘", "'")
    return WORD.findall(text.encode("ascii","ignore").decode())
