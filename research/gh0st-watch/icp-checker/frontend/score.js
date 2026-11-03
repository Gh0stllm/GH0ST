// Version 1 of the published concern rubric. Counts triggered checks and holder
// concentration. Neither a probability of fraud nor an estimate of loss.
const CHECKS = [
  ['mint', 'Ordinary-account mint'], ['underflow', 'Balance underflow'],
  ['withdraw', 'Withdrawal reentry'], ['authorization', 'Payment authorization'],
  ['replay', 'Coupon replay'], ['token', 'Credit after failed transfer']
];

function percentValue(text) {
  if (typeof text !== 'string' || !/^\d+(?:\.\d+)?%$/.test(text)) return null;
  const percent = Number(text.slice(0,-1));
  return percent >= 0 && percent <= 100 ? percent : null;
}

const round = value => Math.round(value * 10) / 10;

function summarize(factors) {
  const available = factors.filter(f => f.points !== null);
  const possible = factors.reduce((n,f) => n+f.weight,0);
  const assessed = available.reduce((n,f) => n+f.weight,0);
  const total = available.reduce((n,f) => n+f.points,0);
  const score = assessed > 0 ? Math.round(100*total/assessed) : null;
  const coverage = Math.round(100*assessed/possible);
  const unknown = possible-assessed;
  return {
    score, coverage, label: score === null ? 'No scored evidence' : unknown ? 'Partial evidence' : 'All rubric inputs measured',
    earned:round(total), assessed, possible,
    // Unknown factors could contribute anything from zero to their full weight.
    lower:Math.round(100*total/possible), upper:Math.round(100*(total+unknown)/possible),
    factors
  };
}

export function scoreReport(r,intel) {
  const factors = CHECKS.map(([key,name]) => {
    const rule = r.rules.find(rule => rule.key === key);
    const reproduced = rule?.status === 'Reproduced';
    const negative = rule?.status === 'Not reproduced';
    const scope = rule?.scope ? rule.scope + '. ' : '';
    return {
      key, name, weight:15, points: reproduced ? 15 : negative ? 0 : null,
      observation:reproduced || negative ? rule.status : 'Untested',
      detail:reproduced || negative ? scope + rule.detail : rule?.detail || 'No execution evidence returned.'
    };
  });
  if (r.erc20) {
    const token = intel?.token, share = percentValue(token?.top);
    const count = Number(token?.count);
    const measured = share !== null && Number.isInteger(count) && count >= 1 && count <= 10;
    factors.push({
      key:'holders', name:'Largest listed holders', weight:10, points:measured ? share/10 : null,
      observation:measured ? token.top : 'Unknown',
      detail:measured ? `${count} explorer-listed accounts held ${token.top} of supply at the scan block. Pool and contract accounts may be included.` :
        'Requires listed holder addresses, their balances and total supply.'
    });
  }
  return summarize(factors);
}

// A scenario changes a copy of measured inputs. A missing value explicitly
// returns the selected factor to unknown. The live observation remains intact.
export function scoreScenario(measured,key,value) {
  return summarize(measured.factors.map(factor => {
    if (factor.key !== key) return factor;
    if (value === null) return {...factor, points:null};
    if (typeof value !== 'number' || !Number.isFinite(value) || value<0 || value>100 ||
        (factor.key !== 'holders' && value !== 0 && value !== 100))
      throw new RangeError('Invalid hypothetical factor value');
    return {...factor,points:factor.weight*value/100};
  }));
}

function element(tag,text,cls) {
  const n=document.createElement(tag);
  if(text!=null)n.textContent=text;
  if(cls)n.className=cls;
  return n;
}
function option(value,text) {const o=element('option',text);o.value=value;return o;}
function labeled(text,control) {const label=element('label',text);label.append(control);return label;}
function scoreText(result) {
  return result.score === null ? 'Unknown' : String(result.score) + ' / 100';
}

function comparisonBar(label, result) {
  const wrapper=element('div',null,'sc-bar');
  const caption=element('span',label+' · '+scoreText(result));
  const meter=element('meter');
  meter.min=0;meter.max=100;meter.value=result.score??0;
  meter.setAttribute('aria-label',label+' concern index');
  if(result.score===null)meter.hidden=true;
  wrapper.append(caption,meter);
  return wrapper;
}

function stressTest(measured) {
  const panel=element('details',null,'sc-scenario');
  panel.append(element('summary','Explore a what-if scenario'),element('p','Change one assumption to compare its effect. The scan observations stay fixed.'));
  const controls=element('div',null,'sc-controls');
  const selector=element('select');
  for(const f of measured.factors) selector.append(option(f.key,f.name));
  const override=element('div'), reset=element('button','Reset assumption');
  reset.type='button';
  controls.append(labeled('Factor to explore',selector),override,reset);
  const chart=element('div',null,'sc-chart');
  chart.setAttribute('aria-live','polite');
  const update=result=>{
    chart.replaceChildren(comparisonBar('Measured',measured),comparisonBar('What if',result),
      element('p',`Hypothetical coverage ${result.coverage}% · possible full-evidence range ${result.lower}–${result.upper} / 100.`));
  };
  function chooseFactor(){
    const f=measured.factors.find(item=>item.key===selector.value);
    const control=element('select');
    control.append(option('measured','Use measured observation'),option('unknown','Treat as unknown'));
    if(f.key==='holders') {
      for(const x of [0,10,25,50,75,90,100])control.append(option(String(x),x+'% of supply'));
    } else {
      control.append(option('100','Assume behavior reproduced'),option('0','Assume behavior did not reproduce'));
    }
    control.onchange=()=>update(control.value==='measured' ? measured :
      scoreScenario(measured,f.key,control.value==='unknown' ? null : Number(control.value)));
    override.replaceChildren(labeled('Hypothetical observation',control));update(measured);
  }
  selector.onchange=chooseFactor;reset.onclick=chooseFactor;chooseFactor();
  panel.append(controls,chart);return panel;
}

export function mountScore(container,r,intel) {
  const m=scoreReport(r,intel);
  const section=element('section',null,'score-panel');
  const head=element('div',null,'sc-head');
  head.append(element('h3','Concern index'),element('span',m.label,'sc-chip'));
  const numbers=element('div',null,'sc-numbers');
  const primary=element('div'),coverage=element('div');
  primary.append(element('strong',scoreText(m)),element('span','Observed inputs'));
  coverage.append(element('strong',m.coverage+'%'),element('span','Weighted coverage'));
  numbers.append(primary,coverage);
  section.append(head,numbers,element('p',
    m.assessed===0 ? 'All scored inputs are unknown.' :
    `${m.earned} concern points across ${m.assessed} assessed weight. The index scales that fraction to 100.`));
  if(m.assessed<m.possible)section.append(element('p',`With the missing evidence, the full-rubric result could range from ${m.lower} to ${m.upper} / 100.`));
  const breakdown=element('details');breakdown.append(element('summary','How this score is calculated'));
  const rubric = r.erc20
    ? 'Each reproduced behavior adds 15 points. The largest listed holders’ share contributes up to 10 points in direct proportion to their share of supply.'
    : 'Each reproduced behavior adds 15 points. The six behavior checks carry 90 total points for this contract.';
  breakdown.append(element('p',rubric+' A completed negative adds zero. Unavailable evidence is excluded from the observed denominator. Weights are a review rubric; the index does not estimate fraud probability.'));
  const list=element('ul',null,'sc-factors');
  for(const f of m.factors){
    const li=element('li'), label=element('div');
    label.append(element('b',f.name),element('span',f.points===null?'Unknown':round(f.points)+' / '+f.weight));
    li.append(label,element('p',f.observation+' · '+f.detail));list.append(li);
  }
  breakdown.append(list);section.append(breakdown,stressTest(m));container.replaceChildren(section);
}
