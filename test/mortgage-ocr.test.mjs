import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeClaudeLoanResponse,OCRNormalizationError,classifyOCRProviderError} from '../mortgage-ocr.js';
const provider=text=>({content:[{type:'text',text}],stop_reason:'end_turn'});
test('DanishOCR numbers normalize into usable typed fields',()=>{
 const r=normalizeClaudeLoanResponse(provider('```json\n{"restgaeld":"2.400.000 kr", "maanedligYdelse":"10.800,50", "rente":"3,08 %", "loebetid":"21 år", "laantype":"F3", "institution":"Nordea Kredit"}\n```'));
 assert.equal(r.restgaeld,2400000);assert.equal(r.maanedligYdelse,10800.5);assert.equal(r.rente,3.08);assert.equal(r.loebetid,21);assert.equal(r.laantype,'F3');assert.equal(r.institution,'Nordea');
});
test('provider text blocks join and prose around a completeJSONobject is accepted',()=>{
 const r=normalizeClaudeLoanResponse({content:[{type:'text',text:'Her er resultatet: {"restgaeld":'},{type:'text',text:'2400000, "rente":4} Færdig.'}]});assert.equal(r.restgaeld,2400000);assert.equal(r.rente,4);
});
test('invalidJSON, emptyobjects, typeless data and truncatedprovideroutputs are errors',()=>{
 for(const r of [provider('not JSON'),provider('{}'),provider('{"restgaeld":2400'),provider('{"laantype":"F3"}'),{error:{message:'provider error'}},{content:[]},{content:[{type:'text',text:'{"restgaeld":123}'}],stop_reason:'max_tokens'},provider('[{"restgaeld":2}]'),provider('{"restgaeld":1} {"restgaeld":2}')])assert.throws(()=>normalizeClaudeLoanResponse(r),OCRNormalizationError);
});
test('real zero remains zero, absentvalues staynull and numberboundaries are enforced',()=>{
 const r=normalizeClaudeLoanResponse({rente:0,restgaeld:null,maanedligYdelse:0,loebetid:null});assert.equal(r.rente,0);assert.equal(r.maanedligYdelse,0);assert.equal(r.restgaeld,null);assert.equal(r.loebetid,null);
 for(const value of [true,Infinity,-1,'200.000.000 kr','NaN'])assert.equal(normalizeClaudeLoanResponse({restgaeld:value,rente:4}).restgaeld,null);
 assert.equal(normalizeClaudeLoanResponse({restgaeld:2,rente:31,loebetid:51}).rente,null);
});
test('remaining years mustbe integer and originalterm is never silently reused',()=>{
 assert.equal(normalizeClaudeLoanResponse({restgaeld:2,loebetid:30,loebetidType:'oprindelig'}).loebetid,null);
 assert.equal(normalizeClaudeLoanResponse({restgaeld:2,oprindeligLoebetid:30}).loebetid,null);
 assert.equal(normalizeClaudeLoanResponse({restgaeld:2,loebetid:30,loebetidType:'oprindelig',resterendeLoebetid:'21 år'}).loebetid,21);
 assert.equal(normalizeClaudeLoanResponse({restgaeld:2,loebetid:'21,5 år'}).loebetid,null);
});
test('explicit interestonly retains underlyingloantype without guessing a flexibleloan',()=>{
 const r=normalizeClaudeLoanResponse({restgaeld:2400000,laantype:'F5',afdragsfri:true});assert.equal(r.laantype,'afdragsfri');assert.equal(r.underlyingLaantype,'F5');assert.equal(r.afdragsfri,true);
 for(const laantype of ['variabel','rentetilpasning','unknown'])assert.equal(normalizeClaudeLoanResponse({restgaeld:2,laantype}).laantype,null);
 assert.equal(normalizeClaudeLoanResponse({restgaeld:2,laantype:'fast rente'}).laantype,'fastforrentet');
});
test('institutions are explicitallowlisted names, not inferred or executablemarkup',()=>{
 for(const institution of ['Nordea<script>alert(1)</script>','Best provider','<b>Nykredit</b>',null])assert.equal(normalizeClaudeLoanResponse({restgaeld:2,institution}).institution,null);
 assert.equal(normalizeClaudeLoanResponse({restgaeld:2}).institution,null);
 assert.equal(normalizeClaudeLoanResponse({restgaeld:2,institution:'Realkredit Danmark'}).institution,'Realkredit Danmark');
 assert.equal(normalizeClaudeLoanResponse({restgaeld:2,institution:'Jyske Realkredit'}).institution,'Jyske');
});
test('decimal formats and currencylabels do not become arbitrary extractedtext',()=>{
 assert.equal(normalizeClaudeLoanResponse({restgaeld:'DKK 2 400 000',rente:'3.080%'}).restgaeld,2400000);
 assert.equal(normalizeClaudeLoanResponse({restgaeld:2,rente:'3.080%'}).rente,3.08);
 assert.equal(normalizeClaudeLoanResponse({restgaeld:2,maanedligYdelse:'<b>10800</b>'}).maanedligYdelse,null);
 assert.equal(normalizeClaudeLoanResponse({restgaeld:2,rente:'se side 3,08'}).rente,null);
});

test('nextpayment with unknownfrequency is not a monthlypayment and S1 is not F1',()=>{
 const r=normalizeClaudeLoanResponse({restgaeld:2300000,rente:'3.045 %',loebetid:20,laantype:'S1',bidragssats:'1,1234 %',naesteBetaling:'24.000 kr',afdragsfriAar:2,refinansiering:'2028-10-01'});
 assert.equal(r.maanedligYdelse,null);assert.equal(r.naesteBetaling,24000);assert.equal(r.betalingsperiode,'ukendt');assert.equal(r.currentBidrag,1.1234);assert.equal(r.rente,3.045);assert.equal(r.laantype,null);assert.equal(r.underlyingLaantype,null);assert.equal(r.afdragsfriAar,2);assert.equal(r.refinansiering,'2028-10-01');
});
test('only explicitpaymentfrequency permits deriving a monthlyaverage',()=>{
 for(const [betalingsperiode,monthly] of [['maaned',24000],['kvartal',8000],['halvaar',4000],['aar',2000]]){
  const r=normalizeClaudeLoanResponse({naesteBetaling:24000,betalingsperiode});assert.equal(r.maanedligYdelse,monthly);
 }
 assert.equal(normalizeClaudeLoanResponse({naesteBetaling:24000,betalingsperiode:'maybe quarterly'}).maanedligYdelse,null);
 assert.equal(normalizeClaudeLoanResponse({naesteBetaling:24000,betalingsperiode:'kvartal',maanedligYdelse:8100}).maanedligYdelse,8100);
});
test('metadata supports zero and rejects invalid bidragduration and calendar dates',()=>{
 const r=normalizeClaudeLoanResponse({rente:0,currentBidrag:0,afdragsfriAar:0,refinansiering:'2028-02-30'});
 assert.equal(r.currentBidrag,0);assert.equal(r.afdragsfriAar,0);assert.equal(r.refinansiering,null);
 const invalid=normalizeClaudeLoanResponse({rente:0,currentBidrag:11,afdragsfriAar:31});assert.equal(invalid.currentBidrag,null);assert.equal(invalid.afdragsfriAar,null);
});

test('provider errors classify only to fixed diagnostic categories without returning sensitive text',()=>{
 const privateValue='SYNTHETIC_PRIVATE_INPUT_NOT_FOR_LOGS';
 for(const [status,error,category]of [
  [400,{type:'invalid_request_error',message:'Your credit balance is too low to access the Anthropic API. '+privateValue},'credit_balance'],
  [401,{type:'authentication_error',message:privateValue},'auth'],
  [403,{type:'permission_error',message:privateValue},'auth'],
  [404,{type:'not_found_error',message:'model: unavailable '+privateValue},'model'],
  [400,{type:'invalid_request_error',message:'Model does not exist '+privateValue},'model'],
  [400,{type:'invalid_request_error',message:'Invalid image '+privateValue},'request'],
  [413,{type:'request_too_large',message:privateValue},'request'],
  [429,{type:'rate_limit_error',message:privateValue},'unavailable'],
  [529,{type:'overloaded_error',message:privateValue},'unavailable']
 ])assert.equal(classifyOCRProviderError(status,JSON.stringify({error,request_id:privateValue})),category);
 for(const value of ['<html>private input</html>','notJSON',null,[],{},'x'.repeat(70000)])assert.equal(classifyOCRProviderError(503,value),'unavailable');
 assert.equal(classifyOCRProviderError(400,'notJSON'),'request');
});

test('copied quarterpayment in a field namedmonthly cannot override its explicit quarterperiod',()=>{
 const r=normalizeClaudeLoanResponse({naesteBetaling:'25.030 kr.',maanedligYdelse:'25.030 kr.',betalingsperiode:'kvartal'});
 assert.equal(r.naesteBetaling,25030);assert.equal(r.maanedligYdelse,25030/3);assert.equal(r.betalingsperiode,'kvartal');
 assert.equal(Math.round(r.maanedligYdelse*100)/100,8343.33);
 const different=normalizeClaudeLoanResponse({naesteBetaling:25030,maanedligYdelse:9000,betalingsperiode:'kvartal'});assert.equal(different.maanedligYdelse,9000);
});
test('copied payments use only stated periods and unknown frequencies never divide',()=>{
 for(const [betalingsperiode,months] of [['maaned',1],['kvartal',3],['halvaar',6],['aar',12]]){
  const r=normalizeClaudeLoanResponse({naesteBetaling:25030,maanedligYdelse:25030,betalingsperiode});assert.equal(r.maanedligYdelse,25030/months);
 }
 assert.equal(normalizeClaudeLoanResponse({naesteBetaling:25030,betalingsperiode:'ukendt'}).maanedligYdelse,null);
 assert.equal(normalizeClaudeLoanResponse({naesteBetaling:0,maanedligYdelse:0,betalingsperiode:'kvartal'}).maanedligYdelse,0);
});
