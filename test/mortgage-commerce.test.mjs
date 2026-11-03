import test from 'node:test';
import assert from 'node:assert/strict';
import { bankPackageAnnualCredit, CommerceError } from '../mortgage-commerce.js';
function fixture(change = {}) {
  const purchase = { id: 'cs_test_purchase123456', mode:'payment', status:'complete', payment_status:'paid', currency:'dkk',
    metadata:{type:'bankpakke'}, amount_total:29900, customer:'cus_owned123', payment_intent:{ status:'succeeded',currency:'dkk',amount_received:29900,
      latest_charge:{paid:true,refunded:false,disputed:false,amount_refunded:0} }, ...change };
  let coupon; let creates=0;
  return { purchase, get coupon(){return coupon;}, set coupon(c){coupon=c;}, get creates(){return creates;},
    stripe:{checkout:{sessions:{retrieve:async()=>purchase}}, coupons:{
      retrieve:async()=>{if(!coupon) throw Object.assign(new Error('not found'),{code:'resource_missing',statusCode:404}); return coupon;},
      create:async params=>{creates++; coupon={...params,times_redeemed:0,valid:true}; return coupon;}
    }} };
}
test('paid owned bank purchase credits first annual invoice while recurring renewal stays399',async()=>{
 const f=fixture();const c=await bankPackageAnnualCredit(f.stripe,f.purchase.id);
 assert.equal(c.firstYearAmount,10000);assert.equal(c.renewalAmount,39900);assert.equal(c.customer,'cus_owned123');
 assert.equal(f.coupon.duration,'once');assert.equal(f.coupon.max_redemptions,1);assert.equal(c.discounts[0].coupon,f.coupon.id);
});
test('retries reuse stable coupon without another discount object',async()=>{
 const f=fixture();const a=await bankPackageAnnualCredit(f.stripe,f.purchase.id); const b=await bankPackageAnnualCredit(f.stripe,f.purchase.id);
 assert.deepEqual(a,b);assert.equal(f.creates,1);
});
test('actual smaller purchase is only credited by paid amount',async()=>{
 const f=fixture({amount_total:8900});assert.equal((await bankPackageAnnualCredit(f.stripe,f.purchase.id)).firstYearAmount,31000);
});
for(const [name,patch] of Object.entries({unpaid:{payment_status:'unpaid'},open:{status:'open'},wrongproduct:{metadata:{type:'other'}},currency:{currency:'eur'},customerless:{customer:null},subscription:{mode:'subscription'},badamount:{amount_total:-1},mismatchedid:{id:'cs_test_other123456'}}))
 test('reject '+name,async()=>{const f=fixture(patch);await assert.rejects(bankPackageAnnualCredit(f.stripe,'cs_test_purchase123456'),CommerceError);assert.equal(f.creates,0);});
for(const [name,patch] of Object.entries({refund:{refunded:true},partialrefund:{amount_refunded:1},dispute:{disputed:true},unpaidcharge:{paid:false}}))
 test('reject '+name,async()=>{const f=fixture();Object.assign(f.purchase.payment_intent.latest_charge,patch);await assert.rejects(bankPackageAnnualCredit(f.stripe,f.purchase.id),CommerceError);});
test('reject payment not settled or insufficient',async()=>{
 const f=fixture();f.purchase.payment_intent.amount_received=1;await assert.rejects(bankPackageAnnualCredit(f.stripe,f.purchase.id),CommerceError);
 f.purchase.payment_intent.amount_received=29900;f.purchase.payment_intent.status='processing';await assert.rejects(bankPackageAnnualCredit(f.stripe,f.purchase.id),CommerceError);
});
test('reject spent or altered coupon instead of replacing it',async()=>{
 const f=fixture();await bankPackageAnnualCredit(f.stripe,f.purchase.id);f.coupon.times_redeemed=1;
 await assert.rejects(bankPackageAnnualCredit(f.stripe,f.purchase.id),CommerceError);assert.equal(f.creates,1);
 f.coupon.times_redeemed=0;f.coupon.duration='forever';await assert.rejects(bankPackageAnnualCredit(f.stripe,f.purchase.id),CommerceError);
});
test('Stripe auth/network failures fail closed rather than minting coupons',async()=>{
 const f=fixture();f.stripe.coupons.retrieve=async()=>{throw Object.assign(new Error('auth'),{statusCode:401});};
 await assert.rejects(bankPackageAnnualCredit(f.stripe,f.purchase.id),/auth/);assert.equal(f.creates,0);
});
test('invalid bearer proof rejected before provider call',async()=>{
 const f=fixture();for(const value of ['',null,'email@example.invalid','cs_fake'])await assert.rejects(bankPackageAnnualCredit(f.stripe,value),CommerceError);
});
