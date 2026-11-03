import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderBankPackagePdf} from '../bank-package-pdf.js';
const sample={address:'Demovej 1, 2635 Ishøj',summary:'Et personligt overblik, før du taler med banken.',facts:[['Markedsværdi','ca. 4,7 mio. kr.'],['Friværdi','2.330.572 kr.'],['Restgæld','2.400.000 kr.'],['Betaling','10.800 kr./md']],sections:[{title:'Dine muligheder',paragraphs:['Ærlig afdragsfrihed: æøå ÆØÅ.'],headers:['Lån','Rente','Ydelse'],rows:[['F1','3,1 %','14.000 kr.'],['F3','3,3 %','14.200 kr.']]},{title:'Spørgsmål til banken',paragraphs:['Hvordan påvirker en ny vurdering mit bidrag?']}]};
test('validbinaryPDF contains correctxref byteoffsets and declared streamlengths',()=>{
 const b=renderBankPackagePdf(sample),s=b.toString('latin1');assert.ok(Buffer.isBuffer(b));assert.ok(s.startsWith('%PDF-1.4'));assert.ok(s.endsWith('%%EOF\n'));
 const xref=Number(s.match(/startxref\n(\d+)\n%%EOF/)[1]);assert.equal(b.subarray(xref,xref+4).toString(),'xref');
 const entries=s.slice(xref).match(/\d{10} 00000 n /g);entries.forEach((entry,i)=>assert.equal(b.subarray(Number(entry.slice(0,10)),Number(entry.slice(0,10))+String(i+1).length+6).toString(),`${i+1} 0 obj`));
 for(const m of s.matchAll(/\/Length (\d+) >>\nstream\n/g)){const start=m.index+m[0].length;assert.equal(s.slice(start+Number(m[1]),start+Number(m[1])+10),'\nendstream');}
});
test('Danishletters useWinAnsioctals and inertescapedtext, no activePDFfeatures',()=>{
 const s=renderBankPackagePdf({...sample,address:'ÆØÅ æøå (test) \\ /JavaScript <b>text</b>'}).toString('latin1');
 assert.match(s,/\/Encoding \/WinAnsiEncoding/);assert.match(s,/\\306\\330\\305/);assert.match(s,/\\346\\370\\345/);assert.match(s,/\\\(test\\\)/);assert.match(s,/\\\\ \/JavaScript/);
 assert.doesNotMatch(s,/\/Type \/Action|\/OpenAction|\/AcroForm|\/Annots|\/Subtype \/Image|\/S \/JavaScript/);
});
test('longparagraphs and longtablerows paginate without losing finalcontent',()=>{
 const s=renderBankPackagePdf({sections:[{title:'Langt indhold',paragraphs:['En lang lokal handelsforklaring. '.repeat(400)],headers:['Adresse','Begrundelse'],rows:[['Demovej','Dine muligheder og forudsætninger. '.repeat(350)+' SLUTMARKER9237']]}]}).toString('latin1');
 const count=Number(s.match(/\/Type \/Pages \/Count (\d+)/)[1]);assert.ok(count>3);assert.match(s,/SLUTMARKER9237/);assert.match(s,new RegExp('Side '+count+' af '+count));
});
test('unsupportedUnicode is sanitized rather than emitted as missingglyphs',()=>{
 const s=renderBankPackagePdf({summary:'🔔 🏠 汉字 𝒜 coöperation'}).toString('latin1');assert.doesNotMatch(s,/🔔|🏠|汉|字|𝒜/);assert.match(s,/\?/);assert.match(s,/co\\366peration/);
});
test('blankinput and oversizedfactvalues produce validpaginateddocuments',()=>{
 assert.ok(renderBankPackagePdf({}).subarray(0,8).toString().startsWith('%PDF'));
 const s=renderBankPackagePdf({facts:[['Lang post','Data '.repeat(1200)+' FACTEND7']]}).toString('latin1');assert.match(s,/FACTEND7/);assert.ok(Number(s.match(/\/Type \/Pages \/Count (\d+)/)[1])>1);
});
