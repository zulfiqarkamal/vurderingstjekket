import {createHmac,timingSafeEqual} from 'node:crypto';
const TTL=30*24*60*60*1000;
const time=value=>value instanceof Date?value.getTime():Number(value);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=128;
const validSecret=secret=>typeof secret==='string'&&secret.trim().length>0;

export function createManagementToken(id,secret,now=new Date()) {
  const issued=time(now);
  if(!validId(id)||!validSecret(secret)||!Number.isFinite(issued))return null;
  const payload=Buffer.from(JSON.stringify({id,expires:issued+TTL})).toString('base64url');
  return payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');
}
export function verifyManagementToken(token,secret,now=new Date()) {
  if(typeof token!=='string'||token.length>2048||!validSecret(secret)||!Number.isFinite(time(now)))return null;
  const parts=token.split('.');
  if(parts.length!==2||!parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)))return null;
  try{
    const expected=createHmac('sha256',secret).update(parts[0]).digest();
    const supplied=Buffer.from(parts[1],'base64url');
    if(supplied.length!==expected.length||supplied.toString('base64url')!==parts[1]||!timingSafeEqual(expected,supplied))return null;
    const data=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    return validId(data?.id)&&Number.isFinite(data.expires)&&data.expires>time(now)?data.id:null;
  }catch{return null;}
}
const number=(value,min,max)=>{
  if(typeof value!=='number'&&!(typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value.trim())))return null;
  const n=Number(value);return Number.isFinite(n)&&n>=min&&n<=max?n:null;
};
export function parseMonitoringUpdate(body) {
  if(!body||typeof body!=='object'||Array.isArray(body))return null;
  const adresse=typeof body.adresse==='string'?body.adresse.trim():'';
  const postnr=typeof body.postnr==='string'?body.postnr.trim():'';
  const anvKode=String(body.anvKode??'');
  if(!adresse||adresse.length>250||/[\u0000-\u001f\u007f]/.test(adresse)||!/^\d{4}$/.test(postnr)||!['120','130','140','510'].includes(anvKode))return null;
  const fields={m2:[20,2000],restgaeld:[0,100000000],rente:[0,30],loebetid:[1,50],currentPayment:[0,1000000]};
  const result={adresse,postnr,anvKode};
  for(const [key,[min,max]] of Object.entries(fields)){
    const n=number(body[key],min,max);if(n===null)return null;result[key]=n;
  }
  const empty=body.officialEV===undefined||body.officialEV===null||body.officialEV==='';
  const ev=empty?null:number(body.officialEV,0,50000000);
  if(!empty&&ev===null)return null;
  for(const field of ['refinansiering','afdragsfriSlut','opsigelsesfrist','redemptionPriceDate']){
   if(body[field]===undefined)continue;
   if(body[field]===null||body[field]===''){result[field]=null;continue;}
   const value=body[field];if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
   const d=new Date(value+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==value)return null;
   result[field]=value;
  }
  if(body.redemptionPrice!==undefined){const empty=body.redemptionPrice===null||body.redemptionPrice==='';result.redemptionPrice=empty?null:number(body.redemptionPrice,1,120);if(!empty&&result.redemptionPrice===null)return null;}
  result.officialEV=ev;
  return result;
}
export function renderMortgageAccount(ab={},token) {
  if(typeof token!=='string'||!token)return '<!doctype html><html lang="da"><meta charset="utf-8"><title>Adgang mangler</title><p>Åbn det personlige link fra din seneste statusmail.</p></html>';
  const input=(name,label,min,max,step='1')=>`<label for="${name}">${label}</label><input id="${name}" name="${name}" type="number" min="${min}" max="${max}" step="${step}" value="${escape(ab[name]??'')}" required>`;
  const dateInput=(name,label)=>`<label for="${name}">${label}</label><input id="${name}" name="${name}" type="date" value="${escape(ab[name]??'')}">`;
  const dates=dateInput('refinansiering','Næste refinansiering (hvis kendt)')+dateInput('afdragsfriSlut','Afdragsfrihed udløber (hvis kendt)')+dateInput('opsigelsesfrist','Bankens ændrings-/opsigelsesfrist (hvis oplyst)')+`<label for="redemptionPrice">Aktuel indfrielseskurs fra banken (valgfrit)</label><input id="redemptionPrice" name="redemptionPrice" type="number" min="1" max="120" step="0.0001" value="${escape(ab.redemptionPrice??'')}">`+dateInput('redemptionPriceDate','Dato for indfrielseskursen');
  const types=[['120','Villa'],['130','Rækkehus'],['140','Ejerlejlighed'],['510','Sommerhus']];
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Min låneovervågning</title><style>body{font:16px/1.5 Arial,sans-serif;color:#18322a;max-width:650px;margin:24px auto;padding:0 18px}label{display:block;margin-top:16px;font-weight:bold}input,select,button{box-sizing:border-box;width:100%;font:inherit;padding:10px;border:1px solid #74877e;border-radius:6px}button{background:#194d3b;color:white;margin:24px 0}a{color:#194d3b;overflow-wrap:anywhere}p{overflow-wrap:anywhere}</style></head><body><h1>Min låneovervågning</h1><p>Opdatér dine faktiske bolig- og låneoplysninger. De bruges ved næste månedlige kontrol. Oplysningerne sendes ikke til banken.</p><p>Dit personlige link gælder i 30 dage. Del det ikke med andre.</p><form method="post" action="/overvagning"><input type="hidden" name="token" value="${escape(token)}"><label for="adresse">Boligens adresse</label><input id="adresse" name="adresse" maxlength="250" value="${escape(ab.adresse)}" required><label for="postnr">Postnummer</label><input id="postnr" name="postnr" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" value="${escape(ab.postnr)}" required><label for="anvKode">Boligtype</label><select id="anvKode" name="anvKode">${types.map(([code,label])=>`<option value="${code}"${String(ab.anvKode)===code?' selected':''}>${label}</option>`).join('')}</select>${input('m2','Boligareal i m²',20,2000,'0.1')}${input('restgaeld','Aktuel restgæld (kr.)',0,100000000)}${input('rente','Nuværende årlig rente (%)',0,30,'0.01')}${input('loebetid','Resterende løbetid (år)',1,50,'0.1')}${input('currentPayment','Faktisk nuværende betaling pr. måned (kr.)',0,1000000)}<label for="officialEV">Offentlig EV, kun som reserve (valgfrit, kr.)</label><input id="officialEV" name="officialEV" type="number" min="0" max="50000000" step="1" value="${escape(ab.officialEV??'')}"><p>Markedsestimatet hentes på ny ud fra adressen og boligoplysningerne. EV bruges kun som reserve, hvis markedsdata mangler.</p>${dates}<p>Vi sender mulighedsbeskeder ved beregnet mindst 3.000 kr. lavere betaling pr. måned eller mindst 200.000 kr. lavere gæld før ukendte omkostninger. Gældsberegningen kræver en indfrielseskurs fra højst syv dage siden. Datoer og frister skal bekræftes af banken.</p><button type="submit">Gem mine oplysninger</button></form><h2>Opsig eller administrér betaling</h2><p>Opsigelse stopper fremtidig fornyelse. Åbn betalingsportalen og bekræft opsigelsen dér. Kontrollér portalens oplysning om, hvornår den træder i kraft.</p><p><a href="/afmeld?id=${escape(encodeURIComponent(token))}">Åbn betalingsportalen</a></p><footer><a href="/vigtig-information">Vigtig information om beregninger og produktgrænser</a></footer></body></html>`;
}
