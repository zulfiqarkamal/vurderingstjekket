import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizeClaudeLoanResponse,OCRNormalizationError,classifyOCRProviderError} from '../mortgage-ocr.js';
const html=readFileSync(new URL('../public/boliglaanstjek-preview.html',import.meta.url),'utf8');
const frontend=html.slice(html.indexOf('let loanUploadVersion='),html.indexOf('// Drag-and-drop',html.indexOf('let loanUploadVersion=')));
const file={name:'synthetic.png',type:'image/png',size:120};
const response=(status,data)=>({ok:status>=200&&status<300,status,headers:{get:()=> 'application/json'},json:async()=>data});
function browser(fetcher){const elements=new Map(),readers=[],alerts=[],steps=[],requests=[];const get=id=>{if(!elements.has(id))elements.set(id,{value:'',style:{display:id==='extractedBadge'?'none':''},hidden:true,textContent:''});return elements.get(id)};class FileReader{constructor(){readers.push(this)}readAsDataURL(file){this.file=file}};const context=vm.createContext({document:{getElementById:get},window:{},FileReader,AbortSignal,alert:message=>alerts.push(message),goTo:step=>steps.push(step),fetch:async(url,options)=>{requests.push({url,options});return fetcher(url,options)}});vm.runInContext(frontend,context);return{context,elements,get,readers,alerts,steps,requests,upload:input=>context.handleScreenshotUpload({files:[input||file]}),load:reader=>reader.onload({target:{result:'data:image/png;base64,c3ludGhldGlj'}})}}
const noSuccess=f=>{assert.deepEqual(f.steps,[]);assert.equal(f.get('extractedBadge').style.display,'none');assert.equal(f.get('analyzing').style.display,'none');assert.equal(f.get('uploadZone').style.display,'')};
test('503 and502 JSON OCR errors show failure and never advance or mark success',async()=>{for(const status of [503,502]){const f=browser(async()=>response(status,{error:'Syntetisk analysefejl'}));f.upload();await f.load(f.readers[0]);noSuccess(f);assert.equal(f.alerts.length,1);assert.match(f.alerts[0],/analysefejl/)}});
test('200 empty OCR output never marks success or advances',async()=>{const f=browser(async()=>response(200,{}));f.upload();await f.load(f.readers[0]);noSuccess(f);assert.match(f.alerts[0],/Ingen lånetal/)});
test('Danish normalized numeric values and zero fill actual frontend fields without string coercion bugs',async()=>{const data=normalizeClaudeLoanResponse({restgaeld:'2.400.000 kr.',maanedligYdelse:'10.800,00',rente:'0,00 %',loebetid:21,laantype:'afdragsfri',currentBidrag:'1,1412 %',institution:'Nordea Kredit',afdragsfriAar:0,refinansiering:'2027-01-01'});const f=browser(async()=>response(200,data));f.upload();await f.load(f.readers[0]);assert.deepEqual(f.steps,[3]);assert.equal(f.get('restgaeld').value,2400000);assert.equal(f.get('maanedligYdelse').value,10800);assert.equal(f.get('rente').value,0);assert.equal(f.get('currentBidrag').value,1.1412);assert.equal(f.get('loanInterestOnlyYears').value,0);assert.equal(f.get('loanInstitution').value,'Nordea');assert.equal(f.get('loanRefinancing').value,'2027-01-01');assert.equal(f.get('laantype').value,'afdragsfri');assert.equal(f.get('extractedBadge').style.display,'flex');assert.equal(f.alerts.length,0)});
test('unknown payment period displays raw source amount and requires an explicit period choice',async()=>{
 const data=normalizeClaudeLoanResponse({institution:'Nykredit',currentBidrag:'1,00',naesteBetaling:'32.400,00',betalingsperiode:'ukendt'});
 const f=browser(async()=>response(200,data));f.upload();await f.load(f.readers[0]);
 assert.equal(f.get('maanedligYdelse').value,32400);assert.equal(f.get('loanPaymentMonths').value,'');assert.equal(f.get('currentBidrag').value,1);assert.equal(f.get('loanInstitution').value,'Nykredit');
 assert.equal(f.get('uploadPaymentHelp').hidden,false);assert.match(f.get('uploadPaymentHelp').textContent,/vælg|Vælg/);assert.match(f.get('uploadPaymentHelp').textContent,/gætter ikke/);
});

test('file read failure restores upload UI and never requests paid provider',()=>{const f=browser(()=>assert.fail('No API on file-read failure'));f.upload();f.readers[0].onerror();noSuccess(f);assert.equal(f.requests.length,0);assert.match(f.alerts[0],/ikke læses/)});
test('unsupported HEIC never starts reader or API',()=>{const f=browser(()=>assert.fail('No API for unsupported HEIC'));f.upload({name:'synthetic.heic',type:'image/heic',size:100});assert.equal(f.readers.length,0);assert.equal(f.requests.length,0);assert.deepEqual(f.steps,[]);assert.match(f.alerts[0],/HEIC/)});
test('out-of-order fetch completion cannot replace newer uploaded loan',async()=>{let resolveFirst,count=0;const f=browser(async()=>++count===1?new Promise(resolve=>{resolveFirst=resolve}):response(200,{restgaeld:2000000}));f.upload();const first=f.load(f.readers[0]);f.upload({...file,name:'new.png'});await f.load(f.readers[1]);resolveFirst(response(200,{restgaeld:1000000}));await first;assert.equal(f.get('restgaeld').value,2000000);assert.deepEqual(f.steps,[3])});
test('out-of-order JSON body completion cannot replace newer uploaded loan',async()=>{let resolveJson,jsonReady,count=0;const ready=new Promise(resolve=>{jsonReady=resolve});const f=browser(async()=>++count===1?{...response(200,{}),json:()=>new Promise(resolve=>{resolveJson=resolve;jsonReady()})}:response(200,{restgaeld:2000000}));f.upload();const first=f.load(f.readers[0]);await ready;f.upload({...file,name:'new.png'});await f.load(f.readers[1]);resolveJson({restgaeld:1000000});await first;assert.equal(f.get('restgaeld').value,2000000);assert.deepEqual(f.steps,[3])});

function route(provider,key='synthetic-no-real-credential'){let handler,calls=0;const logs=[];const app={post(_path,fn){handler=fn}};const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');const start=source.indexOf('app.post("/api/analyze-screenshot"');const end=source.indexOf('\n});',start)+4;assert.ok(start>=0&&end>start);vm.runInNewContext(source.slice(start,end),{app,anonymousUsageLimiter:{},enforceDailyUsage:()=>true,normalizeClaudeLoanResponse,OCRNormalizationError,classifyOCRProviderError,process:{env:{ANTHROPIC_API_KEY:key}},fetch:async(url,options)=>{calls++;assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(options.headers['x-api-key'],'synthetic-no-real-credential');return provider()},console:{warn(...args){logs.push(args)}}});return{logs,get calls(){return calls},async request(){const res={statusCode:200,status(n){this.statusCode=n;return this},json(data){this.body=data;return this}};await handler({body:{image:'c3ludGhldGlj',mediaType:'image/png'}},res);return res}}}
test('actual OCR route maps malformed provider JSON text to422',async()=>{const f=route(()=>({ok:true,json:async()=>({content:[{type:'text',text:'{not valid JSON}'}]})}));const r=await f.request();assert.equal(r.statusCode,422);assert.ok(r.body.error);assert.equal(f.calls,1)});
test('actual OCR route normalizes valid provider Danish response to200 numeric fields including zero',async()=>{const f=route(()=>({ok:true,json:async()=>({content:[{type:'text',text:JSON.stringify({restgaeld:'2.400.000',rente:'0,00 %',currentBidrag:'1,1412',naesteBetaling:'32.400',betalingsperiode:'kvartal',institution:'Nordea'})}]})}));const r=await f.request();assert.equal(r.statusCode,200);assert.equal(r.body.restgaeld,2400000);assert.equal(r.body.rente,0);assert.equal(r.body.currentBidrag,1.1412);assert.equal(r.body.maanedligYdelse,10800);assert.equal(r.body.institution,'Nordea');assert.equal(f.calls,1)});
test('actual OCR route missing configuration returns503 without provider call',async()=>{const f=route(()=>assert.fail('No provider without API configuration'),'');const r=await f.request();assert.equal(r.statusCode,503);assert.equal(f.calls,0)});
test('actual OCR route upstream provider failure returns502 and never fabricated loan values',async()=>{const f=route(()=>({ok:false,status:503,text:async()=> 'synthetic provider failure'}));const r=await f.request();assert.equal(r.statusCode,502);assert.ok(r.body.error);assert.equal(r.body.restgaeld,undefined)});

test('a normalized zero interest rate reaches calculation with valid property and actual monthly payment',async()=>{const values={ejendomsvaerdi:'4700000',restgaeld:'2400000',rente:'0',loebetid:'21',laantype:'afdragsfri',maanedligYdelse:'10800',loanPaymentMonths:'1'},alerts=[];let reachedRates=false;const sentinel=new Error('Rate stage reached');const source=html.slice(html.indexOf('async function beregn()'),html.indexOf('function renderLTVSektion('));const context=vm.createContext({document:{getElementById:id=>({value:values[id]||''})},window:{_markedsvaerdi:4700000,_mortgageProperty:{status:'ready'}},alert:message=>alerts.push(message),hentMarkedsrenter:async()=>{reachedRates=true;throw sentinel}});vm.runInContext(source,context);await assert.rejects(context.beregn(),error=>error===sentinel);assert.equal(reachedRates,true);assert.deepEqual(alerts,[])});

test('actual OCR route logs only allowlisted provider categories and returns manual fallback without private details',async()=>{
 const privateValue='SYNTHETIC_CUSTOMER_SECRET_UNIQUE';
 for(const [status,type,message,category]of [[400,'invalid_request_error','Your credit balance is too low.','credit_balance'],[401,'authentication_error','Invalid API key','auth'],[404,'not_found_error','Model does not exist','model'],[400,'invalid_request_error','Invalid image','request'],[529,'overloaded_error','Busy','unavailable']]){
  const f=route(()=>({ok:false,status,text:async()=>JSON.stringify({error:{type,message:message+' '+privateValue},request_id:privateValue})}));
  const r=await f.request();assert.equal(r.statusCode,502);assert.match(r.body.error,/manuelt/);assert.equal(JSON.stringify(r.body).includes(privateValue),false);assert.doesNotMatch(r.body.error,/credit|balance|API.key|authentication|model/i);assert.deepEqual(f.logs,[["[OCR] Provider error category:",category]]);assert.equal(JSON.stringify(f.logs).includes(privateValue),false);
 }
});

test('quarter OCR keeps source25030 in the input with period3 and help shows8343.33 permonth',async()=>{
 const data=normalizeClaudeLoanResponse({restgaeld:2300000,rente:3,maanedligYdelse:25030,naesteBetaling:25030,betalingsperiode:'kvartal'});
 const f=browser(async()=>response(200,data));f.upload();await f.load(f.readers[0]);
 assert.equal(f.get('maanedligYdelse').value,25030);assert.equal(f.get('loanPaymentMonths').value,'3');assert.match(f.get('uploadPaymentHelp').textContent,/8\.343,33 kr\.\/md/);assert.deepEqual(f.steps,[3]);
});
test('a distinct explicit monthlypayment staysmonthly rather than being divided again',async()=>{
 const data=normalizeClaudeLoanResponse({restgaeld:2300000,rente:3,maanedligYdelse:9000,naesteBetaling:25030,betalingsperiode:'kvartal'});
 const f=browser(async()=>response(200,data));f.upload();await f.load(f.readers[0]);assert.equal(f.get('maanedligYdelse').value,9000);assert.equal(f.get('loanPaymentMonths').value,'1');assert.match(f.get('uploadPaymentHelp').textContent,/9\.000 kr\.\/md/);
});
function calculationPrefix(period,amount='25030'){
 const values={ejendomsvaerdi:'4700000',restgaeld:'2300000',rente:'3',loebetid:'21',laantype:'afdragsfri',maanedligYdelse:amount,loanPaymentMonths:period};const alerts=[];
 const start=html.indexOf('async function beregn()'),end=html.indexOf('  const rentediff',start);
 const context=vm.createContext({document:{getElementById:id=>({get value(){return values[id]??''},set value(v){values[id]=v}})},window:{_markedsvaerdi:4700000,_mortgageProperty:{status:'ready'}},alert:message=>alerts.push(message),hentMarkedsrenter:async()=>({afdragsfri:3,fastforrentet:4}),bidragssats:()=>.55});
 vm.runInContext(html.slice(start,end)+'return {nuv,mYdl,paymentMonths};}',context);return{context,values,alerts};
}
test('actual calculationprefix uses quarterly25030 as monthly8343.33 baseline',async()=>{
 const f=calculationPrefix('3');const result=await f.context.beregn();assert.equal(result.nuv,25030/3);assert.equal(Math.round(result.nuv*100)/100,8343.33);assert.deepEqual(f.alerts,[]);
});
test('unknown period blocks calculation; customer can explicitly select3 without changing sourceamount',async()=>{
 const f=calculationPrefix('');assert.equal(await f.context.beregn(),undefined);assert.equal(f.alerts.length,1);assert.match(f.alerts[0],/vælg.*måneder/);
 f.values.loanPaymentMonths='3';const result=await f.context.beregn();assert.equal(f.values.maanedligYdelse,'25030');assert.equal(result.nuv,25030/3);
});
test('manual month,halfyear,year and zero amounts respect the chosen period',async()=>{
 for(const period of ['1','3','6','12']){const f=calculationPrefix(period,'24000');assert.equal((await f.context.beregn()).nuv,24000/Number(period));}
 const zero=calculationPrefix('3','0');assert.equal((await zero.context.beregn()).nuv,0);assert.deepEqual(zero.alerts,[]);
});

test('an OCR field namedmonthly with explicitlyunknownperiod still requires customerconfirmation',async()=>{
 const data=normalizeClaudeLoanResponse({restgaeld:2300000,rente:3,loebetid:21,laantype:'afdragsfri',maanedligYdelse:25030,naesteBetaling:25030,betalingsperiode:'ukendt'});
 const f=browser(async()=>response(200,data));f.upload();await f.load(f.readers[0]);
 assert.equal(f.get('maanedligYdelse').value,25030);assert.equal(f.get('loanPaymentMonths').value,'');assert.match(f.get('uploadPaymentHelp').textContent,/gætter ikke/);
 const calc=calculationPrefix(f.get('loanPaymentMonths').value,String(f.get('maanedligYdelse').value));assert.equal(await calc.context.beregn(),undefined);assert.equal(calc.alerts.length,1);
 calc.values.loanPaymentMonths='3';assert.equal((await calc.context.beregn()).nuv,25030/3);
});
