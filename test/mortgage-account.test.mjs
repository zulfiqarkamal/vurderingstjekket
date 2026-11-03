import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createManagementToken,verifyManagementToken,renderMortgageAccount,parseMonitoringUpdate} from '../mortgage-account.js';
const secret='synthetic-only-secret',now=new Date('2026-11-03T12:00:00Z');
const body={adresse:'Demovej 1',postnr:'9999',anvKode:'120',m2:'150',restgaeld:'2400000',rente:'0',loebetid:'21',currentPayment:'10800',officialEV:''};
test('signed management token resolves only with correct secret before expiry',()=>{
 const token=createManagementToken('fixture-id',secret,now);
 assert.equal(verifyManagementToken(token,secret,now),'fixture-id');
 assert.equal(verifyManagementToken(token,'wrong',now),null);
 assert.equal(verifyManagementToken('fixture-id',secret,now),null);
 assert.equal(verifyManagementToken(token,secret,new Date(+now+30*86400000)),null);
 assert.equal(verifyManagementToken(token,secret,new Date(+now+30*86400000-1)),'fixture-id');
});
test('tampering, malformed tokens and missing secret or token fail closed',()=>{
 const token=createManagementToken('fixture',secret,now);
 const [payload,sig]=token.split('.');const altered=Buffer.from(JSON.stringify({id:'other',expires:+now+86400000})).toString('base64url');
 for(const t of [altered+'.'+sig,payload+'.a',token+'.extra','',null,'%%%.'+sig,token+'='])assert.equal(verifyManagementToken(t,secret,now),null);
 assert.equal(verifyManagementToken(token,'',now),null);assert.equal(createManagementToken('fixture','',now),null);
 assert.equal(createManagementToken('',secret,now),null);
});
test('validated updates allow only editable fields and preserve real zero and emptyEV',()=>{
 const update=parseMonitoringUpdate({...body,id:'victim',email:'evil@example.invalid',stripeCustomerId:'cus_evil',token:'locator',status:'active'});
 assert.deepEqual(update,{adresse:'Demovej 1',postnr:'9999',anvKode:'120',m2:150,restgaeld:2400000,rente:0,loebetid:21,currentPayment:10800,officialEV:null});
 assert.equal(parseMonitoringUpdate({...body,restgaeld:'0',currentPayment:'0',officialEV:'0'}).officialEV,0);
});
test('invalid numeric coercion, bounds, properties and addresses are rejected',()=>{
 for(const patch of [{m2:''},{m2:true},{m2:Infinity},{rente:'NaN'},{rente:-1},{loebetid:0},{m2:19},{m2:2001},{postnr:'999'},{anvKode:'160'},{adresse:'x'.repeat(251)},{adresse:'test\nsecond'},{officialEV:'invalid'},{restgaeld:[]}])assert.equal(parseMonitoringUpdate({...body,...patch}),null,JSON.stringify(patch));
 assert.equal(parseMonitoringUpdate(null),null);assert.equal(parseMonitoringUpdate([]),null);
});
test('account page escapes values, uses signed hidden token and exposes no mutable recipient or billing fields',()=>{
 const token=createManagementToken('fixture',secret,now);const html=renderMortgageAccount({...body,adresse:'<script>alert(1)</script>'},token);
 assert.match(html,/method="post" action="\/overvagning"/);assert.match(html,/name="token"/);assert.match(html,/&lt;script/);
 assert.doesNotMatch(html,/<script|<link|https?:|name="(?:email|id|stripeCustomerId|status)"/i);
 assert.match(html,new RegExp('/afmeld\\?id='+encodeURIComponent(token).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 assert.match(html,/Opsigelse stopper fremtidig fornyelse/);assert.match(html,/name="officialEV"/);
 assert.doesNotMatch(renderMortgageAccount(body,''),/<form/);
});
