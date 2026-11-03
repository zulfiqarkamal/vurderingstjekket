// One property lookup shared by autocomplete, typed addresses and the VT entry.
let dawaTimer=null, dawaCursor=-1, dawaResults=[], sourceMode='manuel';
let propertyVersion=0, searchVersion=0, selectedProperty=null;
window._propertyPromise=null;
const propertyElement=id=>document.getElementById(id);
const propertyKey=text=>String(text||'').trim().toLocaleLowerCase('da-DK').replace(/\s+/g,' ');
function propertyMessage(text, manual=false) {
  const badge=propertyElement('markedsBadge'); if(badge)badge.style.display='flex';
  const message=propertyElement('markedsBadgeText'); if(message)message.textContent=text;
  const fallback=propertyElement('manuelEvFallback'); if(fallback)fallback.style.display=manual?'':'none';
}
function resetMortgageProperty() {
  propertyVersion++;
  selectedProperty=null;
  window._propertyPromise=null;
  window._markedsvaerdi=null; window._markedsKilde=null;
  window._markedsCompsCount=0; window._markedsAktiveAnnoncer=0; window._markedsHandler=[];
  window._adresseId=null;window._adressePostnr=null;window._adresseM2=null;window._adresseAnvKode=null;
  window._mortgageProperty={status:'empty'};
  for(const id of ['ejendomsvaerdi','boligarealM','officielEVFallback']) {const field=propertyElement(id);if(field)field.value='';}
  for(const id of ['bbrBadge','markedsBadge']) {const badge=propertyElement(id);if(badge)badge.style.display='none';}
}
async function mortgageAddressSuggestions(query) {
  const response=await fetch('/api/adresse?q='+encodeURIComponent(query),{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('Adresseopslag utilgængeligt');
  const raw=await response.json();
  return (Array.isArray(raw)?raw:raw.suggestions||[]).map(item=>({
    ...item,label:item.label||item.tekst||'',postnr:String(item.postnr?.nr||item.postnr||''),
  }));
}
function renderMortgageSuggestions() {
  const drop=propertyElement('dawaDrop'); drop.replaceChildren();
  dawaResults.forEach((item,index)=>{
    const row=document.createElement('div');row.className='dawa-item';row.dataset.i=index;
    row.setAttribute('role','option');
    const strong=document.createElement('strong');strong.textContent=item.label.split(',')[0];
    const sub=document.createElement('span');sub.textContent=[item.postnr,item.by].filter(Boolean).join(' ');
    row.append(strong,sub);row.onmousedown=event=>{event.preventDefault();dawaPick(index);};drop.append(row);
  });
  drop.style.display=dawaResults.length?'block':'none';
}
function dawaSearch(query) {
  clearTimeout(dawaTimer);const version=++searchVersion;
  if(!selectedProperty || propertyKey(query)!==propertyKey(selectedProperty.label))resetMortgageProperty();
  const drop=propertyElement('dawaDrop');if(query.length<3){drop.style.display='none';return;}
  dawaTimer=setTimeout(async()=>{
    try {const results=await mortgageAddressSuggestions(query);if(version!==searchVersion)return;dawaResults=results;dawaCursor=-1;renderMortgageSuggestions();}
    catch(_){if(version===searchVersion){drop.style.display='none';propertyMessage('Adresseopslag utilgængeligt. Indtast boligareal og boligtype for at prøve markedsopslaget.',true);}}
  },180);
}
function selectMortgageProperty(item) {
  resetMortgageProperty();selectedProperty=item;
  propertyElement('adresseM').value=item.label;propertyElement('adresse').value=item.label;
  propertyElement('dawaDrop').style.display='none';
  window._adresseId=item.adresseId||null;window._adressePostnr=item.postnr||null;
  window._mortgageProperty={status:'loading',address:item.label};
  const version=propertyVersion;
  const pending=lookupBBRForLoan(item.husnummerId,item.adresseId,item.kommunekode,version);
  window._propertyPromise=pending;
  return pending;
}
function dawaPick(index) {
  const item=dawaResults[index];if(!item)return;
  clearTimeout(dawaTimer);searchVersion++;dawaCursor=-1;
  return selectMortgageProperty(item);
}
async function lookupBBRForLoan(husnummerId,adresseId,kommunekode,version=propertyVersion) {
  propertyMessage('Henter boligareal og derefter markedsværdi…');
  const badge=propertyElement('bbrBadge');if(badge)badge.style.display='flex';
  let data={};
  try {
    if(!husnummerId)throw new Error('Intet adresse-id');
    const params=new URLSearchParams({husnummerId,adresseId:adresseId||'',kommunekode:kommunekode||''});
    const response=await fetch('/api/bbr?'+params,{signal:AbortSignal.timeout(25000)});
    if(!response.ok)throw new Error('BBR utilgængeligt');data=await response.json();
  } catch(_){ /* A manual area can still support a market lookup. */ }
  if(version!==propertyVersion)return false;
  window._mortgageProperty.kommunekode=data.kommunekode||kommunekode||'';
  const text=propertyElement('bbrBadgeText');
  if(data.found && data.m2>0 && !data.areaUncertain) {
    window._adresseM2=+data.m2;window._adresseAnvKode=data.anvKode||'120';
    propertyElement('boligarealM').value=data.m2;propertyElement('boligtypeM').value=window._adresseAnvKode;
    propertyElement('bbrBadgeIcon').textContent='🏠';if(text)text.textContent=`${data.boligtypeLabel||'Bolig'} · ${data.m2} m²`;
    return fetchMarkedsvaerdi(window._adressePostnr,data.m2,data.anvKode,adresseId,window._mortgageProperty.kommunekode,version,data.opfoeretAar);
  }
  if(text)text.textContent=data.areaUncertain?'BBR-arealet dækker muligvis flere boliger. Bekræft din boligs eget areal.':'Boligareal kunne ikke hentes. Indtast areal og boligtype nedenfor.';
  propertyElement('bbrBadgeIcon').textContent='ℹ️';
  window._mortgageProperty.status='needs-area';propertyMessage('Indtast boligareal og boligtype, så prøver vi markedsopslaget.',true);
  return false;
}
async function fetchMarkedsvaerdi(postnr,m2,anvKode,adresseId,kommunekode,version=propertyVersion,year) {
  if(!postnr || !(m2>0))return false;
  propertyMessage('Henter sammenlignelige salg og udbud…');
  window._mortgageProperty.status='loading';
  try {
    const params=new URLSearchParams({postnr,m2,anvKode:anvKode||'120',adresseId:adresseId||'',kommunekode:kommunekode||'',address:selectedProperty?.label||'',year:year||''});
    const response=await fetch('/api/markedsvaerdi?'+params,{signal:AbortSignal.timeout(90000)});
    if(response.status===429){
      const limit=await response.json();
      if(version!==propertyVersion)return false;
      window._mortgageProperty={...window._mortgageProperty,status:'limited',reason:limit.error||'Du har brugt dagens 5 boligopslag. Prøv igen i morgen.'};
      propertyMessage(window._mortgageProperty.reason,false);return false;
    }
    if(!response.ok)throw new Error('Markedsopslag utilgængeligt');const data=await response.json();
    if(version!==propertyVersion)return false;
    if(!(data.markedsvaerdi>0))throw new Error(data.reason||'Ingen sammenlignelige markedsdata fundet.');
    window._markedsvaerdi=+data.markedsvaerdi;window._markedsKilde=data.kilde;
    window._markedsCompsCount=data.compsCount||0;window._markedsAktiveAnnoncer=data.aktiveAnnoncer||0;
    window._markedsHandler=data.sammenligninger||data.handler||[];
    window._mortgageProperty={...window._mortgageProperty,...data,status:'ready',address:selectedProperty?.label};
    propertyElement('ejendomsvaerdi').value=data.markedsvaerdi;
    const label=['boliga-udbud','boliga-omraade-udbud','boligsiden-udbud','boligsiden-omraade-udbud'].includes(data.kilde)?`${data.aktiveAnnoncer} boliger til salg (udbudspriser)`:
      data.kilde==='dst'?`regionalt DST-estimat, ${data.periode}`:data.kilde==='boliga-omraade'?`${data.compsCount} lokale salg · områdebaseret m²-estimat`:`${data.compsCount} sammenlignelige salg`;
    propertyMessage(`Estimeret værdi: ${Math.round(data.markedsvaerdi).toLocaleString('da-DK')} kr · ${label}`);
    return true;
  } catch(error) {
    if(version!==propertyVersion)return false;
    window._mortgageProperty={...window._mortgageProperty,status:'unavailable',reason:error.message};
    propertyMessage(`${error.message} Kontrollér adresse, boligareal og boligtype, eller oplys EV som sidste reserve.`,true);
    return false;
  }
}
async function ensureMortgageProperty(address) {
  clearTimeout(dawaTimer);searchVersion++;
  if(selectedProperty && propertyKey(address)===propertyKey(selectedProperty.label)) {
    if(window._propertyPromise)await window._propertyPromise;
    if(window._markedsvaerdi>0)return true;
    if(window._mortgageProperty.status==='limited'){propertyMessage(window._mortgageProperty.reason,false);return false;}
  } else {
    const version=propertyVersion;propertyMessage('Slår adressen op…');
    try {
      const results=await mortgageAddressSuggestions(address);
      if(version!==propertyVersion)return false;
      const exact=results.filter(item=>propertyKey(item.label)===propertyKey(address));
      const match=exact.length===1?exact[0]:results.length===1?results[0]:null;
      if(match){await selectMortgageProperty(match);if(window._markedsvaerdi>0)return true;}
      else if(results.length>1){dawaResults=results;renderMortgageSuggestions();propertyMessage('Vælg din præcise adresse i forslagene.',true);return false;}
      else {selectedProperty={label:address,postnr:address.match(/\b(\d{4})\b/)?.[1]||''};window._adressePostnr=selectedProperty.postnr;}
    } catch(_){selectedProperty={label:address,postnr:address.match(/\b(\d{4})\b/)?.[1]||''};window._adressePostnr=selectedProperty.postnr;}
  }
  if(window._mortgageProperty.status==='limited'){propertyMessage(window._mortgageProperty.reason,false);return false;}
  const area=+propertyElement('boligarealM').value,type=propertyElement('boligtypeM').value;
  if(area>=20 && type && window._adressePostnr && !window._markedsvaerdi &&
    (window._mortgageProperty.status==='needs-area' || area!==window._adresseM2 || type!==window._adresseAnvKode)) {
    window._adresseM2=area;window._adresseAnvKode=type;
    window._propertyPromise=fetchMarkedsvaerdi(window._adressePostnr,area,type,window._adresseId,window._mortgageProperty?.kommunekode);
    await window._propertyPromise;if(window._markedsvaerdi>0)return true;
    if(window._mortgageProperty.status==='limited'){propertyMessage(window._mortgageProperty.reason,false);return false;}
  }
  const knownEV=window._mortgageEV?.address===propertyKey(address)?window._mortgageEV.value:0;
  const reserve=+propertyElement('officielEVFallback').value||knownEV;
  if(reserve>=100000 && reserve<=50000000 && window._mortgageProperty.status==='unavailable') {
    window._markedsvaerdi=reserve;window._markedsKilde='ev';propertyElement('ejendomsvaerdi').value=reserve;
    window._mortgageProperty={...window._mortgageProperty,status:'ready',kilde:'ev',markedsvaerdi:reserve,note:'Skats vurdering — handelsprisen kan være højere. Bruges kun som reserve, fordi lokale markedsdata mangler eller er utilgængelige.'};
    return true;
  }
  propertyMessage('Kontrollér boligareal og boligtype for at finde lokale markedspriser. Hvis der ikke er brugbare markedsdata, oplys den faktiske offentlige EV som reserve. Vi opfinder ikke en boligværdi.',true);
  return false;
}
function dawaKey(event) {
  const items=document.querySelectorAll('#dawaDrop .dawa-item');if(!items.length)return;
  if(event.key==='ArrowDown'||event.key==='ArrowUp') {
    event.preventDefault();dawaCursor=Math.max(0,Math.min(items.length-1,dawaCursor+(event.key==='ArrowDown'?1:-1)));
    items.forEach((item,index)=>item.classList.toggle('active',index===dawaCursor));
  } else if(event.key==='Enter' && dawaCursor>=0){event.preventDefault();dawaPick(dawaCursor);}
  else if(event.key==='Escape')propertyElement('dawaDrop').style.display='none';
}
function setSource(mode) {
  sourceMode=mode;
  propertyElement('srcVt').classList.toggle('active',mode==='vt');propertyElement('srcManuel').classList.toggle('active',mode==='manuel');
  propertyElement('vtCard').style.display=mode==='vt'?'':'none';propertyElement('manuelCard').style.display=mode==='manuel'?'':'none';
}
function syncManuel() {}
async function confirmMortgageSource(mode) {
  const address=propertyElement(mode==='vt'?'adresse':'adresseM').value.trim();
  if(!address){alert('Indtast din adresse og vælg den i forslagene.');return;}
  const ready=await ensureMortgageProperty(address);
  if(!ready){setSource('manuel');propertyElement('adresseM').value=address;return;}
  propertyElement('adresse').value=selectedProperty?.label||address;
  goTo(2);
}
async function confirmVT(){return confirmMortgageSource('vt');}
async function confirmManuel(){return confirmMortgageSource('manuel');}
window._mortgageProperty={status:'empty'};
document.addEventListener('click',event=>{
  if(!event.target.closest('#adresseM')&&!event.target.closest('#dawaDrop'))propertyElement('dawaDrop').style.display='none';
});
