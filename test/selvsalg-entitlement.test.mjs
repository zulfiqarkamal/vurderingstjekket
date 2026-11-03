import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../public/selvsalg-sag.html',import.meta.url),'utf8');
const init=html.slice(html.indexOf('function initApp()'),html.indexOf('function switchPanel('));
function fixture(paid,search){const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{style:{},hidden:true,textContent:'',addEventListener(){}});return elements.get(id)};let unlocks=0;const context={SAG:{betalt:paid,adresse:'Demovej 1'},sagId:'synthetic',checks:{},document:{getElementById:el,querySelectorAll:()=>[]},localStorage:{getItem:()=>null},location:{search,pathname:'/selvsalg/sag/synthetic'},history:{replaceState(){}},URLSearchParams,renderChecklist(){},renderExtServices(){},unlockPaid(){unlocks++},startCheckout(){},switchPanel(){}};vm.runInNewContext(init+';initApp();',context);return{elements,unlocks}}
test('unpaid Selvsalg cannot unlock from a forged successful-return parameter',()=>{const r=fixture(false,'?pakke=ok');assert.equal(r.unlocks,0);assert.equal(r.elements.get('payment-status').hidden,false);assert.match(r.elements.get('payment-status').textContent,/ikke bekræftet/)});
test('settled server case unlocks once, with or without return parameter',()=>{for(const search of ['','?pakke=ok']){const r=fixture(true,search);assert.equal(r.unlocks,1)}});
test('truthy nonboolean payment fields cannot activate Selvsalg',()=>{for(const paid of ['false','true',1,null])assert.equal(fixture(paid,'?pakke=ok').unlocks,0)});

test('brochure contains case facts, edited description and local photos as safe DOM text',()=>{
 class Element{constructor(tag){this.tag=tag;this.children=[];this.style={}}appendChild(el){this.children.push(el)}replaceChildren(...els){this.children=els}}
 const elements=new Map([['annonce-tekst',{value:'Redigeret tekst <img src=x onerror=bad>'}],['brochure-preview',new Element('div')],['brochure-print',new Element('article')]]);
 const context={SAG:{betalt:true,adresse:'Demovej 1 <b>tekst</b>',boligtype:'villa',m2bolig:150,byggeaar:1985,vaerelse:5},document:{createElement:tag=>new Element(tag),getElementById:id=>elements.get(id)},Promise};
 const code=html.slice(html.indexOf('let brochurePhotos ='),html.indexOf('\nloadSag();'));
 vm.runInNewContext(code+';brochurePhotos=["data:image/jpeg;base64,synthetic"];renderBrochure();',context);
 const sheet=elements.get('brochure-print').children[0];
 assert.equal(sheet.children[0].textContent,'Demovej 1 <b>tekst</b>');
 assert.equal(sheet.children[1].children.find(x=>x.textContent==='150 m²').tag,'dd');
 assert.equal(sheet.children[2].textContent,'Redigeret tekst <img src=x onerror=bad>');
 assert.equal(sheet.children[3].children[0].src,'data:image/jpeg;base64,synthetic');
 assert.equal(elements.get('brochure-preview').children.length,1);
});
test('unpaid case cannot print a paid brochure',async()=>{let printed=false;const context={SAG:{betalt:false},window:{print(){printed=true}}};const code=html.slice(html.indexOf('let brochurePhotos ='),html.indexOf('\nloadSag();'));vm.runInNewContext(code+';globalThis.printResult=printBrochure();',context);await context.printResult;assert.equal(printed,false)});
