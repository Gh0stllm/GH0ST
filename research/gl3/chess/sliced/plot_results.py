"""Render the measured local results; no projected hosted performance is plotted."""
from pathlib import Path
import json,statistics
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

HERE=Path(__file__).resolve().parent;GL3=HERE.parents[1];E=HERE/'evidence'
fixed=(E/'cachefix-mixed-traffic.json').exists()
traffic=json.loads((E/('cachefix-mixed-traffic.json' if fixed else 'mixed-traffic-blocks.json')).read_text())
old=json.loads((E/'evm-full-snapshot-v1.json').read_text())
new=json.loads((E/'evm-word-delta-full.json').read_text())
# Full fixture wall time includes recovery checks. These exact completed-run
# durations are recorded in the source test logs and published history.
durations=[825.86,143.22 if fixed else 206.73]
bg='#070808';white='#eeeae2';amber='#f6bc60';muted='#92958f';grid='#30332f'
plt.rcParams.update({'font.family':'DejaVu Sans Mono','text.color':white,'axes.labelcolor':muted,'xtick.color':muted,'ytick.color':muted,'svg.fonttype':'none'})
fig=plt.figure(figsize=(15.36,10.24),facecolor=bg)
fig.text(.065,.938,'GH0ST  /  GL3',color=amber,fontsize=16)
fig.text(.065,.885,'CHESS IN SMALL STEPS',fontsize=29,weight='bold')
for x,big,label in [(.065,str(len(traffic['simultaneousOrdinaryTransfers'])),'ORDINARY TRANSFERS'),(.39,'128','COMPUTE TRANSACTIONS'),(.715,'24M','UNCHANGED NODE TARGET')]:
 fig.text(x,.784,big,color=amber,fontsize=35,weight='bold');fig.text(x,.748,label,color=muted,fontsize=10)
ax=fig.add_axes([.075,.30,.52,.36],facecolor=bg)
for key,color,label,marker in [('simultaneousOrdinaryTransfers',white,'Ordinary transfers','o'),('chessRows',amber,'Chess operations','.')]:
 y=np.array([r['seconds']*1000 for r in traffic[key]])
 ax.scatter(np.arange(1,len(y)+1),y,s=15 if marker=='o' else 23,c=color,alpha=.82,label=label,marker=marker,linewidths=0)
ax.axhline(100,color=amber,alpha=.4,linestyle=(0,(3,4)),linewidth=1)
ax.text(2,102,'100 ms target',color=muted,fontsize=8)
ax.set(xlim=(0,132),ylim=(70,240),xlabel='Confirmed transaction index',ylabel='Receipt latency (ms)')
ax.grid(axis='y',color=grid,alpha=.55);ax.set_axisbelow(True);ax.spines[['top','right']].set_visible(False)
for spine in ['bottom','left']:ax.spines[spine].set_color(grid)
ax.legend(frameon=False,labelcolor=white,loc='upper left',fontsize=9)
ax.set_title('TRANSFERS CONTINUED WHILE SEARCH WAS PENDING',fontsize=10,loc='left',pad=20,color=white)
b=fig.add_axes([.685,.30,.245,.36],facecolor=bg)
b.barh([1,0],durations,height=.32,color=[white,amber],alpha=.9)
for y,value,label in [(1,durations[0],'Page snapshots'),(0,durations[1],'Word deltas + cache fixes')]:
 b.text(0,y+.23,label,fontsize=10,color=muted)
 b.text(value+16,y,f'{value:.0f}s',va='center',fontsize=12,color=white)
b.set(xlim=(0,1030),ylim=(-.5,1.55),xlabel='Complete EVM experiment (seconds)',yticks=[])
b.set_xticks([0,400,800]);b.spines[['top','right','left']].set_visible(False);b.spines['bottom'].set_color(grid)
b.set_title('SAME COMPLETE 24M DECISION',fontsize=10,loc='left',pad=20,color=white)
median=statistics.median(r['seconds'] for r in traffic['simultaneousOrdinaryTransfers'])*1000
fig.text(.075,.205,f'{median:.0f} ms',color=white,fontsize=24,weight='bold')
fig.text(.075,.173,'Median ordinary-transfer confirmation',color=muted,fontsize=10)
fig.text(.685,.205,f'{durations[0]/durations[1]:.1f}×',color=amber,fontsize=24,weight='bold')
fig.text(.685,.173,'Faster than the first resumable design',color=muted,fontsize=9)
fig.text(.065,.09,'LOCAL RESEARCH  /  PUBLIC LAUNCH PENDING',color=amber,fontsize=10)
fig.text(.065,.057,'Receipt measurements use a 100 ms block target. Model work spans multiple blocks.',color=muted,fontsize=9)
fig.text(.065,.034,'Separate local runs; includes recovery probes. Full moves still require minutes.',color=muted,fontsize=9)
out=GL3/'assets';out.mkdir(exist_ok=True)
for ext in ['png','svg']:fig.savefig(out/f'chess-resume-results.{ext}',dpi=150,facecolor=bg)
svg=out/'chess-resume-results.svg'
svg.write_text('\n'.join(line.rstrip() for line in svg.read_text().splitlines())+'\n')
print(out/'chess-resume-results.png')
