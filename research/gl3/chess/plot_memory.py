"""Render the measured prover samples, preserving the late-sampling boundary."""
from pathlib import Path
import csv,json,os

HERE=Path(__file__).resolve().parent
os.environ.setdefault('MPLCONFIGDIR',str(HERE/'.cache/mpl-config'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

samples=HERE/'evidence/prover-memory-samples.csv'
rows=list(csv.DictReader(samples.open()))
x=[float(r['secondsSinceLateSamplingStart'])/60 for r in rows]
y=[int(r['rssKiB'])/1024**2 for r in rows]
peak=max(y);ix=y.index(peak)
plt.rcParams.update({'font.family':'DejaVu Sans Mono','font.size':11,'svg.fonttype':'path'})
fig,ax=plt.subplots(figsize=(12.8,6.4),facecolor='#050505')
fig.subplots_adjust(left=.09,right=.96,bottom=.22,top=.72)
ax.set_facecolor('#050505')
for spine in ax.spines.values():spine.set_visible(False)
ax.plot(x,y,color='#ffc165',linewidth=.8,alpha=.85)
ax.scatter([x[ix]],[peak],s=38,color='#ffc165',zorder=5)
ax.axhline(16,color='#f7f1e4',linewidth=.7,linestyle=(0,(2,5)),alpha=.35)
ax.set_ylim(0,max(18,peak*1.2));ax.set_xlim(0,max(x)*1.03)
ax.set_yticks([0,4,8,12,16]);ax.grid(axis='y',color='#39352d',linewidth=.5,alpha=.6)
ax.tick_params(colors='#b8b0a3',length=0,pad=12)
ax.set_xlabel('MINUTES FROM SAMPLER START',color='#b8b0a3',labelpad=16)
ax.set_ylabel('PROVER RSS / GiB',color='#b8b0a3',labelpad=16)
fig.text(.09,.89,'GH0ST  /  GL3',color='#ffc165',size=15)
fig.text(.09,.80,'FULL CHESS REPLAY',color='#f7f1e4',size=25)
fig.text(.96,.88,f'{peak:.2f} GiB',ha='right',color='#ffc165',size=23)
fig.text(.96,.82,'OBSERVED PEAK',ha='right',color='#b8b0a3',size=10)
fig.text(.09,.085,'24m nodes / full NNUE / unchanged bot',color='#f7f1e4',size=10)
fig.text(.09,.04,'Late-start samples on 24 GiB M5. Node excluded. No hard 16 GB limit.',color='#8c8578',size=9)
assets=HERE.parent/'assets'
for ext in ['png','svg']:fig.savefig(assets/('full-chess-prover-memory.'+ext),dpi=160,facecolor=fig.get_facecolor())
plt.close(fig)
print(json.dumps({'samples':len(rows),'observedPeakGiB':peak,'scope':'Late-start single-prover samples; lower bound on complete-run peak, not a16GB Linux acceptance test'}))
