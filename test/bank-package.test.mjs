import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCustomerBankPackage} from '../bank-package.js';
import {estimateContributionOpportunity} from '../mortgage-contribution.js';
const sample = () => ({adresse:'Demovej 1, 9999 Testby',anvKode:'130',restgaeld:2400000,rente:4,loebetid:21,laantype:'afdragsfri',currentPayment:10800,asOf:'2026-11-03',market:{markedsvaerdi:4730572,kilde:'boligsiden-udbud',aktiveAnnoncer:8,sammenligninger:[{adresse:'Eksempelvej 2',pris:4995000,m2:150,dato:'2026-10-01'}]}});
const pdf = value => Buffer.from(value.attachments.find(a=>a.filename.endsWith('.pdf')).content,'base64');
const csv = value => Buffer.from(value.attachments.find(a=>a.filename.endsWith('.csv')).content,'base64').toString('utf8');
const full = () => {const s=sample();s.monitoring={fee:27000,scenarios:[{rateKey:'F1',rate:3.2,newPayment:14000},{rateKey:'F3',rate:3.5,newPayment:15000},{rateKey:'F5',rate:3.75,newPayment:10000},{rateKey:'fastforrentet',rate:4.5,newPayment:16000}]};s.contribution=estimateContributionOpportunity({restgaeld:s.restgaeld,value:s.market.markedsvaerdi,anvKode:s.anvKode});return s;};
test('personal summary includes four key facts and actual baseline without contacting banks',()=>{
 const p=buildCustomerBankPackage(sample());assert.match(p.html,/2\.400\.000 kr/);assert.match(p.html,/10\.800 kr/);assert.match(p.html,/ca\. 4,7 mio/);assert.match(p.html,/50,7 %/);assert.match(p.html,/2\.330\.572 kr/);assert.match(p.html,/vi kontakter ingen banker/);assert.equal(p.attachments.length,2);
});
test('compact branded mail has five tailored questions, howto and stays under650words',()=>{
 const p=buildCustomerBankPackage(full());assert.match(p.html,/BOLIGLÅNSRADAR/);assert.match(p.html,/background:#194d3b/);assert.match(p.html,/Dine fem spørgsmål/);assert.match(p.html,/Sådan bruger du pakken/);
 const list=p.html.match(/<ol[^>]*>(.*?)<\/ol>/s)[1];assert.equal((list.match(/<li /g)||[]).length,5);assert.match(list,/10\.800 kr\. om måneden uden afdrag/);assert.match(list,/2\.400\.000 kr\. med 21 år tilbage/);assert.match(list,/50,7 %/);assert.match(list,/507\.771 kr/);
 assert.ok(p.html.replace(/<[^>]*>/g,' ').split(/\s+/).filter(Boolean).length<650);
});
test('principal comparison basis is explicit beside interestonly baseline',()=>{
 const p=buildCustomerBankPackage(full());assert.match(p.html,/Med afdrag og anslået bidrag over 21 år/);assert.match(p.html,/10\.800 kr\. uden afdrag/);assert.match(p.html,/\+ er højere betaling/);
});
test('plain loan type does not invent interestonly status',()=>{
 const s=sample();s.laantype='F1';assert.doesNotMatch(buildCustomerBankPackage(s).html,/Jeg betaler 10\.800 kr\. om måneden uden afdrag/);
});
test('EV reserve is labelled tax valuation and has no manufactured comparisons',()=>{
 const s=sample();s.market.kilde='ev';const p=buildCustomerBankPackage(s);assert.match(p.html,/Skats vurdering/);assert.match(p.html,/handelsprisen kan være højere/);assert.doesNotMatch(pdf(p).toString('latin1'),/Eksempelvej 2/);
});
test('evidence dates and asking prices stay in realPDF, not a long mail table',()=>{
 const p=buildCustomerBankPackage(sample());const content=pdf(p).toString('latin1');assert.match(content,/Eksempelvej 2/);assert.match(content,/2026-10-01/);assert.match(content,/Udbudspris/);assert.doesNotMatch(p.html,/Eksempelvej 2/);assert.match(p.html,/Udbudspriser, ikke gennemførte salg/);
});
test('sales and asking prices remain distinct',()=>{
 const s=sample();s.market.kilde='boliga';s.market.compsCount=1;const content=pdf(buildCustomerBankPackage(s)).toString('latin1');assert.match(content,/Handelspris/);assert.match(content,/Handelsdato/);assert.doesNotMatch(content,/Udbudspris/);
});
test('missing data stays missing rather than creating default property or loan',()=>{
 const p=buildCustomerBankPackage();assert.match(p.html,/Adresse ikke oplyst/);assert.match(p.html,/Ikke oplyst/);assert.doesNotMatch(p.html,/3\.692|10\.800|2\.400/);assert.match(csv(p),/"Løn efter skat";;Udfyld selv/);
});
test('untrusted HTML input is escaped and cannot become active emailmarkup',()=>{
 const s=sample();s.adresse='<img src=x onerror="alert(1)">';s.market.note='</p><script>alert(2)</script>';s.market.sammenligninger[0].adresse='<svg onload=alert(3)>';
 const p=buildCustomerBankPackage(s);assert.doesNotMatch(p.html,/<script|<img|<svg/);assert.match(p.html,/&lt;img/);assert.doesNotMatch(p.subject,/img|alert/);assert.equal(pdf(p).subarray(0,5).toString(),'%PDF-');
});
test('rejects nonnumeric and outofbounds money inputs',()=>{
 const s=sample();Object.assign(s,{restgaeld:true,currentPayment:Infinity,rente:'=2+2',loebetid:-1});s.market.markedsvaerdi=1e100;
 const p=buildCustomerBankPackage(s);assert.doesNotMatch(p.html,/NaN|Infinity|=2\+2/);assert.match(p.html,/Ikke beregnet/);
});
test('invalid comparison amounts and dates are not presented as known data',()=>{
 const s=sample();s.market.sammenligninger.push({adresse:'Bad Comparison',pris:-1,m2:150});s.market.sammenligninger[0].dato='2026-02-30';const content=pdf(buildCustomerBankPackage(s)).toString('latin1');assert.doesNotMatch(content,/Bad Comparison|2026-02-30/);assert.match(content,/Dato ikke oplyst/);
});
test('attachments are genuine PDF plus editableCSV, no HTMLcode file',()=>{
 const p=buildCustomerBankPackage(full());assert.deepEqual(p.attachments.map(a=>a.filename),['din-bankpakke.pdf','budgetark.csv']);const bytes=pdf(p);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.match(bytes.toString('latin1'),/%%EOF/);assert.doesNotMatch(p.html,/<script|<form|\bsrc=|url\(/i);
});
test('CSV has UTF8BOM and blank editable fields, no userformula injection',()=>{
 const s=sample();s.adresse='=HYPERLINK("evil")';s.budget={b_loen:'=HYPERLINK("evil")'};const data=csv(buildCustomerBankPackage(s));assert.equal(data.charCodeAt(0),0xfeff);assert.match(data,/Post;Beløb/);assert.match(data,/;;Udfyld selv/);assert.doesNotMatch(data,/HYPERLINK|^[=+@-]/m);
});
test('budget appears ONLY inCSV, including actualprovided values and incomplete notice',()=>{
 const s=full();s.budget={b_loen:134567,b_mad:'5500',b_el:0,b_bolig:null,b_anden:'',b_opsp:-1,unknown:999999,b_bil:'=HYPERLINK("x")'};const p=buildCustomerBankPackage(s);const data=csv(p);
 assert.match(data,/3 af 24 poster/);assert.match(data,/"Løn efter skat";134567;/);assert.match(data,/"Mad og dagligvarer";5500;/);assert.match(data,/"El";0;/);assert.doesNotMatch(data,/999999|HYPERLINK/);
 for(const output of [p.html,p.text,pdf(p).toString('latin1')])assert.doesNotMatch(output,/134567|134\.567|Mad og dagligvarer|Oplyste indtægter|Budgettet er ufuldstændigt/);
});
test('complete budget totals are retained only inCSV and no missing field becomes zero',()=>{
 const keys=['b_loen','b_anden','b_bolig','b_faelles','b_el','b_varme','b_vand','b_forsikring','b_bil','b_benzin','b_bilfors','b_transport','b_mad','b_born','b_fritid','b_mobil','b_net','b_stream','b_linser','b_helbred','b_toej','b_laan','b_kk','b_opsp'];
 const s=sample();s.budget=Object.fromEntries(keys.map(key=>[key,0]));Object.assign(s.budget,{b_loen:30000,b_anden:4000,b_bolig:10000,b_mad:6000,b_opsp:2000});const data=csv(buildCustomerBankPackage(s));assert.match(data,/"Indtægter i alt";34000;/);assert.match(data,/"Udgifter inkl. opsparing i alt";18000;/);assert.match(data,/"Rådighedsbeløb \(kun ved fuldt udfyldt budget\)";16000;/);
 delete s.budget.b_el;assert.match(csv(buildCustomerBankPackage(s)),/"Rådighedsbeløb \(kun ved fuldt udfyldt budget\)";;Udfyld selv/);
});
test('budget field limits reject booleans objects huge and inherited values',()=>{
 const s=sample();s.budget=Object.assign(Object.create({b_loen:999999}),{b_anden:true,b_mad:1000001,b_bil:Infinity,b_el:{valueOf:()=>100}});const data=csv(buildCustomerBankPackage(s));assert.match(data,/0 af 24 poster/);assert.doesNotMatch(data,/999999|1000001|Infinity/);
});
test('four scenarios retain signed baseline and one fee note',()=>{
 const p=buildCustomerBankPackage(full());assert.match(p.html,/14\.000 kr/);assert.match(p.html,/\+3\.200 kr/);assert.match(p.html,/−800 kr/);assert.equal((p.html.match(/27\.000 kr/g)||[]).length,1);assert.match(p.text,/F5: 3,75 % \| 10\.000 kr/);
});
test('invalid scenario numbers or labels cannot appear as real amounts',()=>{
 const s=sample();s.monitoring={fee:'<script>x</script>',scenarios:[{rateKey:'F1',rate:Infinity,newPayment:12000},{rateKey:'F3',rate:3.5,newPayment:-1},{rateKey:'F5',rate:3,newPayment:1000001},{rateKey:'<svg>',rate:3,newPayment:5000}]};const p=buildCustomerBankPackage(s);assert.doesNotMatch(p.html,/Infinity|<script|<svg|>12\.000 kr|>5\.000 kr/);
});
test('hypothetical contribution examples are conditional under60 and fullsources remain inPDF',()=>{
 const p=buildCustomerBankPackage(full());assert.match(p.html,/Hypotetiske fald/);assert.match(p.html,/under 60 %/);assert.match(p.html,/ikke automatisk/);assert.match(p.html,/>200 kr\.</);assert.match(p.html,/>400 kr\.</);assert.match(p.html,/>600 kr\.</);assert.match(pdf(p).toString('latin1'),/rd\.dk\/PDF\/Privat\/Prisblad-privat.pdf/);
});
test('provided bidrag rates produce transparent unverified difference, malformed figures rejected',()=>{
 const s=full();s.contribution=estimateContributionOpportunity({restgaeld:s.restgaeld,value:s.market.markedsvaerdi,anvKode:s.anvKode,currentBidrag:.85,targetBidrag:.55});let p=buildCustomerBankPackage(s);assert.match(p.html,/0,8500 % → 0,5500 %/);assert.match(p.html,/>600 kr\.</);
 s.contribution.actualScenario.monthly=999999;s.contribution.illustrations=[];p=buildCustomerBankPackage(s);assert.doesNotMatch(p.html,/999\.999/);
});
test('builder is deterministic and does not mutate source inputs',()=>{
 const s=full();s.budget={b_loen:30000};const before=structuredClone(s);assert.deepEqual(buildCustomerBankPackage(s),buildCustomerBankPackage(s));assert.deepEqual(s,before);
});

test('known lender and actual annual bidrag keep four decimals and show current cost separately',()=>{
 const s=full();Object.assign(s,{institution:'Nordea Kredit',restgaeld:1800000,currentPayment:7300,loebetid:18});s.contribution=estimateContributionOpportunity({restgaeld:s.restgaeld,value:s.market.markedsvaerdi,anvKode:s.anvKode,currentBidrag:.6789});
 const p=buildCustomerBankPackage(s);assert.match(p.html,/Dit oplyste bidrag hos Nordea: 0,6789 % p.a./);assert.match(p.html,/1\.018 kr\. pr. måned før skat/);assert.match(p.html,/nuværende omkostning, ikke en mulig besparelse/);assert.match(p.html,/Mit Nordea-lån har oplyst bidrag 0,6789 % p.a./);assert.match(p.html,/uden unødvendig omlægning/);assert.match(pdf(p).toString('latin1'),/0,6789 % p.a./);assert.match(p.text,/1\.018 kr/);
});
test('all allowed lender names normalize and no unrecognized issuer is invented',()=>{
 for(const [input,label] of [['nordea','Nordea'],['Nykredit','Nykredit'],['Totalkredit','Totalkredit'],[' Realkredit   Danmark ','Realkredit Danmark'],['Jyske','Jyske Realkredit']]){const s=full();s.institution=input;s.contribution=estimateContributionOpportunity({restgaeld:s.restgaeld,value:s.market.markedsvaerdi,currentBidrag:.4321});assert.ok(buildCustomerBankPackage(s).text.includes('hos '+label+': 0,4321 % p.a.'));}
 const s=full();s.institution='<img src=x onerror=alert(1)>Fake Bank';const p=buildCustomerBankPackage(s);assert.doesNotMatch(p.html,/Fake Bank|src=x|Mit Nordea-lån/);
});
test('optional verified term and refinance date enter PDF and fifth question without guessing',()=>{
 const s=sample();s.afdragsfriAar=3.5;s.refinansieringISO='2029-07-01';const p=buildCustomerBankPackage(s);assert.match(p.html,/afdragsfrihed udløber om 3,5 år/);assert.match(p.html,/Næste oplyste refinansiering er 2029-07-01/);assert.match(p.html,/Hvilke frister skal jeg overholde/);assert.match(pdf(p).toString('latin1'),/2029-07-01/);
 const absent=sample();absent.afdragsfriAar=-1;absent.refinansieringISO='2029-02-30';const bad=buildCustomerBankPackage(absent);assert.doesNotMatch(bad.html,/udløber om|2029-02-30|Næste oplyste refinansiering/);
});
test('missing contribution rate never creates current lender cost from hypothetical cuts',()=>{
 const s=full();s.institution='Nordea';const p=buildCustomerBankPackage(s);assert.doesNotMatch(p.html,/Dit oplyste bidrag hos|nuværende omkostning/);assert.match(p.html,/Hypotetiske fald/);
});

test('F1 is presented as a market alternative with provider availability requiring confirmation',()=>{
 const p=buildCustomerBankPackage(full());assert.match(p.text,/F1 Flekslån/);assert.match(p.text,/vis F1, F3, F5 og fast rente/);
 assert.match(p.text,/Hvilke typer tilbyder I/);assert.match(p.text,/anden udbyder/);
 assert.doesNotMatch(p.text,/ikke et nyt lånevalg|F1 — eksisterende\/profilskifte/);
 assert.match(pdf(p).toString('latin1'),/F1/);
});
