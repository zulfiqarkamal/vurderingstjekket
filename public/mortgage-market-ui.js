/* Only the redacted teaser is requested before a verified purchase. */
let blrMarketRequest=0,blrPaidMarketRequest=0,blrPaidMarketAccess=null;
const blrMarketEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const blrMarketMoney=value=>typeof value==='number'&&Number.isFinite(value)?Math.round(value).toLocaleString('da-DK')+' kr.':'Ikke bekræftet';
function blrMarketLink(url,label){
 try {const parsed=new URL(url);if(parsed.protocol!=='https:'||!['jyskebank.dk','www.jyskebank.dk','nordea.dk','www.nordea.dk','rd.dk','www.rd.dk','totalkredit.dk','www.totalkredit.dk','nykredit.dk','www.nykredit.dk','danskebank.dk','www.danskebank.dk'].includes(parsed.hostname))return blrMarketEscape(label);return '<a href="'+blrMarketEscape(parsed.href)+'" target="_blank" rel="noopener noreferrer">'+blrMarketEscape(label)+'</a>';}catch{return blrMarketEscape(label);}
}
function blrMarketShell(current={}){return '<section class="blr-scenario-card" id="blrMarketCard" aria-labelledby="blrMarketHeading"><h3 id="blrMarketHeading">Hvad viser markedssammenligningen?</h3><p>Offentliggjorte priser fra flere udbydere. Den fulde sammenligning følger med bankpakken og abonnementet.</p><label for="blrMarketYears">Løbetid på de nye lån, der sammenlignes</label><select id="blrMarketYears" onchange="blrLoadMarketPreview()" style="display:block;max-width:100%;padding:8px;margin:8px 0">'+[...new Set([Number(current.loeb)||30,10,15,20,25,30])].sort((a,b)=>a-b).filter(y=>y>=1&&y<=30).map(y=>'<option value="'+y+'"'+(y===30?' selected':'')+'>'+y+' år</option>').join('')+'</select><div id="blrMarketTeaser" role="status" aria-live="polite">Sammenligningen hentes…</div></section>';}
function blrMarketTeaserMarkup(teaser={}){
 const period=Number(teaser.horizonMonths)&&Number(teaser.horizonMonths)!==60?teaser.horizonMonths+' måneder':'5 år';
 let title='Sammenligningen kræver flere oplysninger',metric='',note='Vi viser ikke en besparelse, når grundlaget mangler.';
 if(teaser.status==='net_benefit'&&teaser.netBenefit5YearsRounded>0){title='Beregnet mulighed over '+period;metric=blrMarketMoney(teaser.netBenefit5YearsRounded);note='Beregnet fordel mod dit oplyste lån efter de medregnede skifteomkostninger. Kræver bankens bekræftelse.';}
 else if(teaser.modelPriceSpread5YearsRounded>0){title='Beregnet prisforskel over '+period;metric=blrMarketMoney(teaser.modelPriceSpread5YearsRounded);note='Forskel mellem de undersøgte, sammenlignelige lån. Det er ikke en besparelse mod dit nuværende lån.';}
 else if(teaser.annualContributionSpreadRounded>0){title='Forskel i årligt bidrag';metric=blrMarketMoney(teaser.annualContributionSpreadRounded)+'/år';note='Forskel i bidrag ved samme lånebeløb før kursforskelle. Før skifteomkostninger; ikke en samlet omlægningsbesparelse.';}
 else if(teaser.eligibleCount>0){title=teaser.eligibleCount+' lånemuligheder med offentlige priser';note='Se udbydere, beregnede ydelser og hvilke omkostninger der mangler at blive bekræftet.';}
 else if(teaser.status==='no_match'){title='Ingen sammenlignelige priser for dette valg';note='Prøv en anden løbetid. Vi bruger ikke en anden udbyders rente som erstatning for manglende priser.';}
 return (teaser.scopeLabel?'<p>'+blrMarketEscape(teaser.scopeLabel)+'</p>':'')+'<div style="padding:16px;background:#eef7f1;border-radius:12px"><strong>'+blrMarketEscape(title)+'</strong>'+(metric?'<div style="font-size:1.7rem;font-weight:700;margin:8px 0">'+blrMarketEscape(metric)+'</div>':'')+'<p>'+blrMarketEscape(note)+'</p></div><p style="font-size:.85rem">'+Number(teaser.eligibleCount||0)+' sammenlignelige produkter · '+blrMarketEscape(teaser.asOf?String(teaser.asOf).slice(0,10):'Kildedato mangler')+'. Udvalgte udbydere, ikke en garanti for markedets billigste lån.</p>'+(Number(teaser.eligibleCount)>0?'<p>Bankpakken til 99 kr. giver et øjebliksbillede. Abonnementet til 49 kr./md. eller 399 kr./år holder sammenligningen opdateret.</p><button type="button" class="btn btn-primary" onclick="goToPanel8()">Se abonnement og overvågning</button><button type="button" class="btn btn-ghost" onclick="startBankpakke()">Få sammenligningen i bankpakken — 99 kr.</button>':'<p>Der er ikke dokumenteret en sammenligning for dette valg. Referenceberegningen kan stadig bruges.</p>')+'<p><button type="button" class="btn btn-ghost" onclick="blrOpenStoredMarket()">Jeg har allerede købt</button></p>';
}
async function blrLoadMarketPreview(){
 const target=document.getElementById('blrMarketTeaser');if(!target)return;
 const version=++blrMarketRequest;target.textContent='Henter offentliggjorte priser…';
 try{
  const d=window._beregningState||{},context=mortgageSubscriptionContext('maaned');
  const response=await fetch('/api/mortgage-market-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({loan:{...context,propertyValue:d.markedsEjd||d.ejd,productClass:'fixed',newTermYears:Number(document.getElementById('blrMarketYears')?.value)||30},goal:'refinance'}),signal:AbortSignal.timeout(45000)});
  const data=await response.json();if(version!==blrMarketRequest||document.getElementById('blrMarketTeaser')!==target)return;
  if(!response.ok)throw Error(data.error||'Markedssammenligningen kunne ikke hentes.');
  target.innerHTML=blrMarketTeaserMarkup(data.teaser||{});
 }catch(error){if(version===blrMarketRequest&&document.getElementById('blrMarketTeaser')===target)target.textContent=error.message||'Markedssammenligningen er midlertidigt utilgængelig. Referenceberegningen ovenfor kan stadig bruges.';}
}
function blrMarketFullMarkup(result={},context={},accessType=''){
 const rows=Array.isArray(result.rankedRows)?result.rankedRows:[];
 const scope=blrMarketEscape(result.scopeLabel||result.teaser?.scopeLabel||'Udvalgte offentlige lånepriser');
 const period=Number(result.horizonMonths)&&Number(result.horizonMonths)!==60?result.horizonMonths+' måneder':'5 år';
 const headers=['Udbyder og lån','Rente / bidrag','Ydelse/md.','Omkostninger over '+period,'Restgæld efter '+period,'Skifteomkostninger'];
 const table=rows.length?'<table class="blr-scenario-table blr-responsive"><thead><tr>'+headers.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+[
   '<strong>'+blrMarketEscape(row.providerName)+'</strong><br>'+blrMarketLink(row.contactUrl,row.productName)+'<br>'+blrMarketEscape(row.termYears)+' år · '+blrMarketEscape(row.repayment==='amortizing'?'med afdrag':row.repayment==='interestOnly'?'afdragsfrit':row.repayment)+'<br>Kurs '+blrMarketEscape(row.price??'—')+' · Ny gæld '+blrMarketMoney(row.loanAmount),
   blrMarketEscape(row.nominalRate)+'% / '+(typeof row.bidragRate==='number'?row.bidragRate.toLocaleString('da-DK',{maximumFractionDigits:4}):'—')+'%',
   blrMarketMoney(row.monthlyPayment),blrMarketMoney(row.totalCost5Years??row.modelCostBeforeUnknownFees)+(row.costsKnown===false?'<br><small>Ufuldstændige omkostninger: før skiftegebyrer</small>':''),blrMarketMoney(row.remainingDebt5Years),blrMarketMoney(row.switchCosts)
 ].map((cell,i)=>'<td data-label="'+headers[i]+'"><span class="blr-market-cell">'+cell+'</span></td>').join('')+'</tr>').join('')+'</tbody></table>':'<p>Der er ingen tilstrækkeligt dokumenterede priser for de valgte vilkår. Manglende priser bliver ikke opfundet.</p>';
 const rowNotes=rows.flatMap(row=>[...(row.assumptions||[]).map(note=>row.providerName+': '+note),...(row.publishedFeeComponents||[]).map(fee=>row.providerName+' · '+fee.name+': '+(fee.kind==='maximum'?'op til ':'')+(fee.estimatedAmount===null?'se prisbladets beregningsregel':blrMarketMoney(fee.estimatedAmount)))]);
 const assumptions=[...(Array.isArray(result.assumptions)?result.assumptions:[]),...new Set(rowNotes)].map(note=>'<li>'+blrMarketEscape(typeof note==='string'?note:JSON.stringify(note))+'</li>').join('');
 const sources=rows.flatMap(row=>row.sources||[]).map(source=>typeof source==='string'?{url:source,label:'Priskilde'}:source);
 const unique=[...new Map(sources.map(source=>[source.url,source])).values()];
 return '<h2>Din markedssammenligning</h2><p>'+scope+'</p><p><strong>'+blrMarketEscape(context.adresse||context.address||'Din gemte ejendom')+'</strong></p><p>'+(accessType==='bankpakke'?'Dit købte øjebliksbillede. Nye markedsopdateringer kræver abonnement.':'Opdateret sammenligning til dit abonnement.')+'</p><p>Offentliggjorte prisvilkår og modelberegninger — ikke personlige lånetilbud. Forskellig renterisiko er ikke det samme produkt. Sammenlign altid restgæld og samlede omkostninger, ikke kun ydelsen.</p>'+table+'<details><summary>Forudsætninger og manglende oplysninger</summary><ul>'+assumptions+'</ul></details><details><summary>Priskilder</summary><ul>'+unique.map(source=>'<li>'+blrMarketLink(source.url,source.label||source.name||source.url)+(source.effectiveDate?' · gældende '+blrMarketEscape(source.effectiveDate):'')+'</li>').join('')+'</ul></details>';
}
async function blrOpenPaidMarket(access,options={}){
 const requestVersion=++blrPaidMarketRequest;
 let target=document.getElementById('blrPaidMarket');
 if(!target){target=document.createElement('section');target.id='blrPaidMarket';target.className='blr-scenario-card';target.style.cssText='max-width:1200px;margin:24px auto;padding:20px';document.body.append(target);}
 target.textContent='Kontrollerer din købsadgang og henter sammenligningen…';target.scrollIntoView?.({behavior:'smooth'});
 try{const response=await fetch('/api/mortgage-market-comparison',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access,productClass:'fixed',goal:options.goal||'refinance',newTermYears:options.newTermYears||Number(document.getElementById('blrMarketYears')?.value)||30,...(options.scenario?{scenario:options.scenario}:{})}),signal:AbortSignal.timeout(45000)});const data=await response.json();if(requestVersion!==blrPaidMarketRequest)return;if(!response.ok)throw Error(data.error||'Købsadgangen kunne ikke bekræftes. Åbn dit personlige link fra mailen.');blrPaidMarketAccess=access;target.innerHTML=(data.accessType==='subscription'?blrMarketControls(data.context||{},options):'')+blrMarketFullMarkup(data.comparison||{},data.context||{},data.accessType);}
 catch(error){if(requestVersion===blrPaidMarketRequest)target.textContent=error.message||'Sammenligningen kunne ikke hentes.';}
}
function blrMarketControls(context,options={}){
 const selected=options.goal||'refinance',debt=Number(options.scenario?.newDebt||context.restgaeld)||0,term=Number(options.newTermYears)||30;
 return '<fieldset style="padding:16px;margin-bottom:20px;border:1px solid #dce7e1;border-radius:12px"><legend>Undersøg dine muligheder</legend><label for="blrPaidGoal">Formål</label><select id="blrPaidGoal" style="display:block;max-width:100%;padding:8px;margin:8px 0">'+[['refinance','Omlæg nuværende lån'],['borrow','Lån op'],['repay','Betal ned']].map(([key,label])=>'<option value="'+key+'"'+(key===selected?' selected':'')+'>'+label+'</option>').join('')+'</select><label for="blrPaidDebt">Ønsket lånebeløb før kurs og omkostninger (kr.)</label><input type="number" id="blrPaidDebt" min="0" max="100000000" value="'+debt+'" style="display:block;width:100%;max-width:320px;padding:8px;margin:8px 0"><label for="blrPaidYears">Løbetid på det nye lån</label><select id="blrPaidYears" style="display:block;padding:8px;margin:8px 0">'+[...new Set([Number(context.loebetid)||30,10,15,20,25,30])].filter(y=>y>=1&&y<=30).sort((a,b)=>a-b).map(y=>'<option value="'+y+'"'+(y===term?' selected':'')+'>'+y+' år</option>').join('')+'</select><p>Ved lån op eller nedbetaling sammenlignes udbyderne ved samme nye lånebeløb. Det er ikke en besparelse mod et uændret lån. Kurstab kan øge den faktiske hovedstol.</p><button type="button" class="btn btn-primary" onclick="blrRefreshPaidMarket()">Opdatér sammenligningen</button></fieldset>';
}
function blrRefreshPaidMarket(){
 const goal=document.getElementById('blrPaidGoal')?.value||'refinance';
 const newTermYears=Number(document.getElementById('blrPaidYears')?.value)||30;
 const newDebt=Number(document.getElementById('blrPaidDebt')?.value);
 if(!blrPaidMarketAccess)return;
 return blrOpenPaidMarket(blrPaidMarketAccess,{goal,newTermYears,...(goal==='refinance'?{}:{scenario:{newDebt}})});
}
function blrOpenStoredMarket(){const id=sessionStorage.getItem('blrMarketCheckout')||sessionStorage.getItem('blrBankpakkeCheckout');if(!id){alert('Åbn dit personlige link fra købsbekræftelsen eller overvågningsmailen.');return;}return blrOpenPaidMarket({checkoutId:id});}
window.addEventListener('DOMContentLoaded',()=>{const params=new URLSearchParams(location.search),token=params.get('market_token'),checkout=params.get('market_checkout');if(token||checkout){history.replaceState(null,'',location.pathname);blrOpenPaidMarket(token?{managementToken:token}:{checkoutId:checkout});}});
