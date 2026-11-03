import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../public/',import.meta.url);
const html=fs.readFileSync(new URL('selvsalg-sag.html',root),'utf8');
const source=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n').replace(/\bloadSag\(\);\s*$/,'');
function fixture(sag={},storage=new Map(),id='fiction-a'){
 const elements=new Map();const element=key=>{if(!elements.has(key))elements.set(key,{value:'',checked:false,textContent:'',style:{}});return elements.get(key);};
 const c=vm.createContext({location:{pathname:'/selvsalg/sag/'+id,search:''},document:{getElementById:element},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},URLSearchParams,console});
 vm.runInContext(source,c);c.caseData=sag;vm.runInContext('SAG=caseData; renderBrochure=()=>{};',c);
 return {c,element,storage};
}
const row={adresse:'Fiktivvej 17, 9999 Eksempelby',boligtype:'raekkehus',m2bolig:144,vaerelse:5,byggeaar:1987,betalt:true};
test('ad uses actualcasefacts without invented condition or neighbourhoodclaims',()=>{
 const {c}=fixture(row);const text=c.selvsalgAnnonceDraft(row);
 for(const expected of ['Rækkehus til salg','Fiktivvej 17','144 m²','5','1987'])assert.ok(text.includes(expected));
 assert.doesNotMatch(text,/lys og|velholdt|smuk|roligt kvarter|gode forbindelser|gode materialer|familieliv|renoveret|udsigt/i);
 const condo=c.selvsalgAnnonceDraft({...row,boligtype:'ejerlejlighed',m2bolig:78,vaerelse:3,byggeaar:2004});assert.match(condo,/Ejerlejlighed til salg/);assert.match(condo,/78 m²/);assert.doesNotMatch(condo,/144|1987/);
});
test('unknown or invalid facts never become fabricated propertynumbers',()=>{
 const {c}=fixture();const text=c.selvsalgAnnonceDraft({adresse:'Ukendtvej',boligtype:'unknown',m2bolig:null,vaerelse:0,byggeaar:NaN});assert.match(text,/Bolig til salg/);assert.doesNotMatch(text,/m²|Byggeår|Antal værelser|NaN|undefined|null/);
 assert.equal(c.selvsalgPropertyProfile({m2bolig:true}).area,null);
});
test('photo/checklist/documentguidance depends on actualtype and knownroomcount',()=>{
 const {c}=fixture(row);
 const rowPhoto=c.selvsalgPhotoGuide(row).join(' '),condoPhoto=c.selvsalgPhotoGuide({...row,boligtype:'ejerlejlighed'}).join(' '),summerPhoto=c.selvsalgPhotoGuide({...row,boligtype:'sommerhus'}).join(' ');
 assert.match(rowPhoto,/rækkehusets egen facade/);assert.match(rowPhoto,/5 værelser/);assert.match(condoPhoto,/fællesarealer|Fællesarealer/);assert.match(condoPhoto,/brugsrettigheder/);assert.match(summerPhoto,/helårsbrug må ikke antydes/);
 assert.notEqual(rowPhoto,condoPhoto);
 assert.match(c.selvsalgChecklist({...row,boligtype:'ejerlejlighed'}).map(x=>x.label).join(' '),/ejerforening/i);
 assert.match(c.selvsalgChecklist(row).map(x=>x.label).join(' '),/private og fælles arealer/);
 assert.ok(c.selvsalgDocuments({...row,boligtype:'ejerlejlighed'}).some(x=>x.label.startsWith('Ejerforenings')));
 assert.ok(!c.selvsalgDocuments(row).some(x=>x.label.startsWith('Ejerforenings')));
 assert.match(c.selvsalgPhotoGuide({}).join(' '),/Boligtypen er ikke oplyst/);
});
test('ownerhighlights require confirmation and regenerate preserves previousedit otherwise',()=>{
 const {c,element}=fixture(row);c.generateAnnonceText();const before=element('annonce-tekst').value;
 element('owner-highlights').value='Tag udskiftet i 2022 ifølge mine dokumenter.';c.generateAnnonceText(true);assert.equal(element('annonce-tekst').value,before);assert.match(element('annonce-status').textContent,/Bekræft først/);
 element('owner-highlights-confirmed').checked=true;c.generateAnnonceText(true);assert.match(element('annonce-tekst').value,/Sælgers kontrollerede oplysninger/);assert.match(element('annonce-tekst').value,/Tag udskiftet i 2022/);
});
test('localdraft is case-specific and preserves edits onreload without paidguardbypass',()=>{
 const storage=new Map(),a=fixture(row,storage);a.c.generateAnnonceText();a.element('annonce-tekst').value='Min kontrollerede og redigerede tekst';a.c.saveAnnonceDraft();
 const again=fixture(row,storage);again.c.generateAnnonceText();assert.equal(again.element('annonce-tekst').value,'Min kontrollerede og redigerede tekst');
 const other=fixture({...row,adresse:'Andenvej 2'},storage,'fiction-b');other.c.generateAnnonceText();assert.doesNotMatch(other.element('annonce-tekst').value,/Min kontrollerede/);
 const unpaid=fixture({...row,betalt:false},storage);unpaid.c.generateAnnonceText();assert.equal(unpaid.element('annonce-tekst').value,'');unpaid.c.saveAnnonceDraft();
});
test('allownedpages show199price and keep paymentproof and brochurefeatures',()=>{
 for(const name of ['selvsalg.html','selvsalg-sag.html','selvsalg-start.html']){const page=fs.readFileSync(new URL(name,root),'utf8');assert.doesNotMatch(page,/799/);assert.match(page,/199 kr/);}
 assert.match(html,/SAG\.betalt === true/);assert.match(html,/if \(SAG\?\.betalt !== true\) return/);assert.match(html,/function printBrochure/);assert.match(html,/image\.decode/);assert.match(html,/function selectBrochurePhotos/);
 const landing=fs.readFileSync(new URL('selvsalg.html',root),'utf8');assert.match(landing,/checkout aktiveres, når vilkår er godkendt/);
 assert.doesNotMatch(captureDraft(),/Lys og velholdt/);
 function captureDraft(){return fixture(row).c.selvsalgAnnonceDraft(row);}
});
test('HTML-like ownertext remains plaintextarea content rather than generatedmarkup',()=>{
 const {c,element}=fixture(row);element('owner-highlights').value='<img src=x onerror=alert(1)>';element('owner-highlights-confirmed').checked=true;c.generateAnnonceText(true);assert.match(element('annonce-tekst').value,/<img/);assert.match(html,/description\.textContent/);assert.match(html,/li\.textContent=text/);
});
