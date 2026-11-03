const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root=require('node:path').join(__dirname,'../');
const html=fs.readFileSync(root+'public/boliglaanstjek-preview.html','utf8');
const ctx=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('const KONV_FAST_OMK'),html.indexOf('// Kurstab/-gevinst')),ctx);
vm.runInContext(fs.readFileSync(root+'public/mortgage-scenarios.js','utf8'),ctx);
const d={ejd:4000000,markedsEjd:null,rest:2600000,nuv:15000,rente:4,loeb:25,ltype:'fastforrentet',renter:{F1:3.2,F3:3.5,F5:3.75,fastforrentet:4.5}};
test('All four types include current type and use one entered baseline',()=>{const m=ctx.blrScenarioModel(d);assert.equal(m.lower.length,4);for(const e of m.lower)assert.equal(e.payment-e.delta,15000);});
test('Borrowing nets costs from cash and keeps debt within 80%',()=>{const e=ctx.blrScenarioModel(d).up.find(e=>e.pct===80);assert.equal(e.debt,3200000);assert.equal(e.gross,600000);assert.equal(e.cash,569000);assert.equal(e.delta,e.payment-15000);assert.equal(e.payment,Math.round(ctx.mYdelse(3200000,4,25,.85)));});
test('Pay down shows full cash needed and new payment at contribution threshold',()=>{const e=ctx.blrScenarioModel(d).down.find(e=>e.pct===60);assert.equal(e.debt,2400000);assert.equal(e.cash,-228000);assert.equal(e.bidrag,.55);assert.equal(e.payment,Math.round(ctx.mYdelse(2400000,4,25,.55)));assert.ok(e.delta<0);});
test('Market property value drives levels; no borrowing over 80%',()=>{const m=ctx.blrScenarioModel({...d,markedsEjd:3000000});assert.equal(m.up.length,0);assert.equal(m.down[0].pct,80);});
test('Interest-only baseline is compared with explicitly amortizing new scenarios',()=>{const m=ctx.blrScenarioModel({...d,ltype:'afdragsfri'});assert.ok(m.lower.every(e=>e.breakEven===null));assert.equal(m.up[0].payment,Math.round(ctx.mYdelse(m.up[0].debt,4,25,.85,false)));});
test('Zero debt clears payment and signed amounts do not become negative zero',()=>{const m=ctx.blrScenarioModel({...d,rest:10000,nuv:100});assert.equal(m.down[0].payment,0);assert.equal(ctx.blrMoney(-.1,true),'0 kr');assert.match(ctx.blrMoney(-1500,true),/^−1/);});
test('Full inline scripts compile and tab markup has accessible help and signed cash',()=>{for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);const markup=ctx.blrScenarioMarkup(d);assert.equal((markup.match(/role="tab"/g)||[]).length,3);assert.match(markup,/Indbetaling inkl. omk./);assert.match(markup,/Udbetalt efter omk./);assert.match(markup,/Forudsætninger/);assert.doesNotMatch(markup,/<th[^>]*>(Betales nu|Break-even|Omkostninger)/);assert.doesNotMatch(markup,/· bidrag/);});

test('Display rounding avoids near-identical LTV rows but preserves contribution thresholds',()=>{const m=ctx.blrScenarioModel({...d,ejd:3692000,rest:2400000});assert.equal(m.down[0].pct,60);const edge=ctx.blrScenarioModel({...d,rest:2401000});assert.equal(edge.down[0].pct,60);});
test('Actual dashboard render uses the same amount in headline and scenarios',()=>{
  const panel={innerHTML:''};ctx.document={getElementById:()=>panel};ctx.window={};ctx.fmt=n=>Math.round(n).toLocaleString('da-DK');
  vm.runInContext(html.slice(html.indexOf('function renderLTVSektion('),html.indexOf('function overvagToggle(')),ctx);
  const state={...d,bidr:.85,mrente:4.5,ltv:65,frivaerdi:1400000,frivaerdiPct:35,sc:{type:'ingen',txt:''},scener:[],extScener:[]};
  ctx.renderResultat(state);const m=ctx.blrScenarioModel(state);
  assert.ok(panel.innerHTML.includes(ctx.blrMoney(m.best.payment)+'/md'));
  assert.ok(panel.innerHTML.includes(ctx.blrMoney(m.best.delta,true)+'/md'));
  assert.ok(panel.innerHTML.includes('goToPanel8()'));
  assert.ok(panel.innerHTML.includes('Gratis: dit overblik nu'));
  ctx.renderResultat({...state,ltv:85});assert.ok(panel.innerHTML.includes('Din belåningsgrad er over 80%'));
});
test('Tabs support touch activation and keyboard movement with correct ARIA state',()=>{
  const elements={};for(const k of ['lower','up','down']){elements['blr-tab-'+k]={setAttribute(name,v){this[name]=v;},focus(){this.focused=true;}};elements['blr-panel-'+k]={};}
  ctx.document={getElementById:id=>elements[id]};ctx.blrSelectScenario('up');assert.equal(elements['blr-tab-up']['aria-selected'],'true');assert.equal(elements['blr-panel-down'].hidden,true);
  let prevented=false;ctx.blrScenarioKey({key:'ArrowRight',preventDefault(){prevented=true;}},1);assert.equal(prevented,true);assert.equal(elements['blr-tab-down'].focused,true);assert.equal(elements['blr-panel-down'].hidden,false);
});
test('Annual and monthly selectors keep existing checkout state in sync',()=>{
 for(const plan of ['aar','maaned']) assert.ok(html.includes("window._blrPlan='"+plan+"';window._overvagPeriode='"+plan+"';"));
});

test('Interest-only comparison visibly explains principal repayments and reports costs once per panel',()=>{
 const markup=ctx.blrScenarioMarkup({...d,ltype:'afdragsfri',nuv:10800});
 const lower=markup.split('id="blr-panel-lower"')[1].split('</section>')[0];
 assert.match(lower,/uden afdrag/);assert.match(lower,/med afdrag/);assert.match(lower,/nedbringer|reducerer/);
 assert.equal((lower.match(/28.000 kr/g)||[]).length,1);
 const down=markup.split('id="blr-panel-down"')[1].split('</section>')[0];
 assert.doesNotMatch(down,/bidrag/);assert.doesNotMatch(down,/<th[^>]*>Omkostninger/);
});

test('Market valuation is approximate on screen while LTV uses the full estimate',()=>{
 assert.equal(ctx.blrPropertyAmount(4730572),'ca. 4,7 mio. kr');
 const m=ctx.blrScenarioModel({...d,ejd:4730572});
 assert.equal(m.value,4730572);
 assert.equal(m.up.find(e=>e.pct===80).debt,4730572*.8);
});
