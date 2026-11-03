const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'../');
function fixture({failMarket=false,failBBR=false,shape='wrapped',delayBBR,ambiguous=false}={}) {
 const fields={};const element=id=>fields[id]||= {value:'',dataset:{},style:{},textContent:'',classList:{toggle(){}},replaceChildren(){},append(){},setAttribute(){}};
 const calls=[],steps=[],alerts=[];
 const item={label:'Demovej 10, 9999 Demoby',postnr:'9999',husnummerId:'fixture-house',adresseId:'fixture-address',kommunekode:'0001'};
 const ctx=vm.createContext({window:{},document:{getElementById:element,addEventListener(){},querySelectorAll(){return [];},createElement:()=>element('temp')},URLSearchParams,AbortSignal,setTimeout,clearTimeout,alert:s=>alerts.push(s),goTo:n=>steps.push(n),fetch:async url=>{
  calls.push(url);
  if(url.includes('/api/adresse'))return {ok:true,json:async()=>{const rows=ambiguous?[item,{...item,label:'Demovej 10, 1., 9999 Demoby'}]:[item];return shape==='wrapped'?{suggestions:rows}:rows;}};
  if(url.includes('/api/bbr')){if(delayBBR)await delayBBR;return {ok:!failBBR,json:async()=>({found:!failBBR,m2:150,anvKode:'120',kommunekode:'0001'})};}
  if(url.includes('/api/markedsvaerdi'))return {ok:true,json:async()=>({markedsvaerdi:failMarket?null:3300000,kilde:'boliga',compsCount:3,handler:[]})};
  throw Error('Unexpected request');
 }});
 vm.runInContext(fs.readFileSync(root+'public/mortgage-property.js','utf8'),ctx);
 element('adresseM').value=item.label;element('adresse').value=item.label;
 return {ctx,fields,element,calls,steps,alerts,item};
}
test('Typed address without selecting autocomplete completes address → BBR → market before advancing',async()=>{
 const f=fixture();await f.ctx.confirmManuel();assert.equal(f.steps.at(-1),2);assert.equal(f.ctx.window._markedsvaerdi,3300000);assert.equal(f.element('ejendomsvaerdi').value,3300000);assert.equal(f.calls.length,3);
});
test('VT entry accepts the existing {suggestions} response and uses market rather than EV',async()=>{
 const f=fixture();f.element('ejendomsvaerdi').value=9999999;await f.ctx.confirmVT();assert.equal(f.steps.at(-1),2);assert.equal(f.element('ejendomsvaerdi').value,3300000);
});
test('Legacy array address responses work too',async()=>{const f=fixture({shape:'array'});await f.ctx.confirmVT();assert.equal(f.ctx.window._markedsvaerdi,3300000);});
test('Missing market data cannot silently advance using an EV or invented value',async()=>{
 const f=fixture({failMarket:true});f.element('ejendomsvaerdi').value=4200000;f.element('ejendomsvaerdiM').value=4200000;await f.ctx.confirmManuel();assert.equal(f.steps.length,0);assert.equal(f.ctx.window._markedsvaerdi,null);assert.equal(f.element('ejendomsvaerdi').value,'');assert.match(f.element('markedsBadgeText').textContent,/opfinder ikke/);
});
test('Confirmation waits for the in-flight BBR response',async()=>{
 let release;const wait=new Promise(r=>release=r),f=fixture({delayBBR:wait});const pending=f.ctx.selectMortgageProperty(f.item);const confirmation=f.ctx.confirmManuel();assert.equal(f.steps.length,0);release();await Promise.all([pending,confirmation]);assert.equal(f.steps.at(-1),2);
});
test('Changing address discards stale market results from the previous property',async()=>{
 let release;const wait=new Promise(r=>release=r),f=fixture({delayBBR:wait});const pending=f.ctx.selectMortgageProperty(f.item);f.ctx.resetMortgageProperty();release();await pending;assert.equal(f.ctx.window._markedsvaerdi,null);assert.equal(f.element('ejendomsvaerdi').value,'');
});
test('If BBR fails, user area/type can still retrieve a market estimate',async()=>{
 const f=fixture({failBBR:true});await f.ctx.confirmManuel();assert.equal(f.steps.length,0);f.element('boligarealM').value=150;f.element('boligtypeM').value='120';await f.ctx.confirmManuel();assert.equal(f.ctx.window._markedsvaerdi,3300000);assert.equal(f.steps.at(-1),2);
});
test('Ambiguous typed addresses require selecting a unit instead of silently using the first',async()=>{
 const f=fixture({ambiguous:true});f.element('adresseM').value='Demovej 10';await f.ctx.confirmManuel();assert.equal(f.steps.length,0);assert.match(f.element('markedsBadgeText').textContent,/præcise adresse/);
});

test('Main calculation rejects an EV in the hidden field when there is no market estimate',async()=>{
 const f=fixture({failMarket:true});f.element('ejendomsvaerdi').value=4200000;
 for(const [id,value] of Object.entries({restgaeld:2400000,rente:4,loebetid:21,laantype:'afdragsfri',maanedligYdelse:10800}))f.element(id).value=value;
 const page=fs.readFileSync(root+'public/boliglaanstjek-preview.html','utf8');
 vm.runInContext(page.slice(page.indexOf('async function beregn()'),page.indexOf('function renderLTVSektion(')),f.ctx);
 await f.ctx.beregn();assert.equal(f.steps.at(-1),1);assert.match(f.alerts.at(-1),/Markedsdata har førsteprioritet/);assert.equal(f.ctx.window._beregningState,undefined);
});

test('An explicitly entered official EV is a labelled reserve only after the market lookup has failed',async()=>{
 const f=fixture({failMarket:true});await f.ctx.confirmManuel();assert.equal(f.steps.length,0);
 f.element('officielEVFallback').value=4200000;await f.ctx.confirmManuel();assert.equal(f.steps.at(-1),2);assert.equal(f.ctx.window._mortgageProperty.kilde,'ev');assert.match(f.ctx.window._mortgageProperty.note,/Skats vurdering/);
});
test('A transferred EV never overrides an available market value',async()=>{
 const f=fixture();f.ctx.window._mortgageEV={value:9000000,address:'demovej 10, 9999 demoby'};await f.ctx.confirmVT();assert.equal(f.ctx.window._markedsvaerdi,3300000);assert.equal(f.ctx.window._mortgageProperty.kilde,'boliga');
});
