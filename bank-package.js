import { renderBankPackagePdf } from './bank-package-pdf.js';
import { CONTRIBUTION_SOURCES } from './mortgage-contribution.js';
const clean = (value, max = 240) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max).trim() : '';
const escape = value => clean(value, 4000).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number = (value, min = 0, max = 100000000) => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) return null;
  const n = Number(value); return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const money = value => value === null ? 'Ikke oplyst' : Math.round(value).toLocaleString('da-DK') + ' kr.';
const date = value => {
  const text = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) ? value.slice(0, 10) : '';
  if (!text) return '';
  try { return new Date(text).toISOString().slice(0, 10) === text ? text : ''; } catch { return ''; }
};
const institutions = new Map([['nordea','Nordea'],['nordea kredit','Nordea'],['nykredit','Nykredit'],['totalkredit','Totalkredit'],['realkredit danmark','Realkredit Danmark'],['jyske','Jyske Realkredit'],['jyske realkredit','Jyske Realkredit']]);
const bidragText = value => value.toLocaleString('da-DK',{minimumFractionDigits:4,maximumFractionDigits:4});
const sources = new Set(['boliga','boliga-udbud','boliga-omraade','boliga-omraade-udbud','boligsiden-udbud','boligsiden-omraade-udbud','ev']);

// Pure customer deliverable: no mail, payments, external resources or inferred loan calculations.
// Canonical context: {adresse,restgaeld,rente,loebetid,laantype,currentPayment,asOf,market}.
// market uses the existing mortgage-market.js result shape, including sammenligninger.
export function buildCustomerBankPackage(context = {}) {
  if (!context || typeof context !== 'object') context = {};
  const market = context.market && typeof context.market === 'object' ? context.market : {};
  const source = sources.has(market.kilde) ? market.kilde : '';
  const asking = source.includes('udbud');
  const sourceName = source === 'ev' ? 'Skats vurdering (EV-reserve)' : source.startsWith('boligsiden') ? 'Boligsiden' : source.startsWith('boliga') ? 'Boliga' : 'Kilde ikke oplyst';
  const address = clean(context.adresse) || 'Adresse ikke oplyst';
  const institution = institutions.get(clean(context.institution,80).toLocaleLowerCase('da-DK').replace(/\s+/g,' ')) || '';
  const afdragsfriAar = number(context.afdragsfriAar,0,30);
  const refinansieringISO = date(context.refinansieringISO);
  const debt = number(context.restgaeld, 0, 100000000);
  const payment = number(context.currentPayment, 0, 1000000);
  const rate = number(context.rente, 0, 100);
  const years = number(context.loebetid, 1, 50);
  const value = source ? number(market.markedsvaerdi, 100000, 500000000) : null;
  const equity = value !== null && debt !== null ? value - debt : null;
  const ltv = value !== null && debt !== null ? (debt / value * 100).toLocaleString('da-DK', {maximumFractionDigits:1}) + ' %' : 'Ikke beregnet';
  const basis = context.laantype === 'afdragsfri' ? 'uden afdrag' : ['fastforrentet','F1','F3','F5'].includes(context.laantype) ? 'Afdragsform ikke oplyst' : 'Afdragsform ikke oplyst';
  const displayedValue = value === null ? 'Ikke oplyst' : source === 'ev' ? money(value) : 'ca. ' + (value / 1000000).toLocaleString('da-DK', {minimumFractionDigits:1,maximumFractionDigits:1}) + ' mio. kr.';
  const sourceNote = source === 'ev' ? 'Skats vurdering — handelsprisen kan være højere. Der foreligger ikke et markedsestimat i dette udtræk.' : asking ? 'Udbudspriser, ikke gennemførte salg. En udbudspris er ikke dokumentation for en opnået handelspris.' : source ? 'Gennemførte salg som oplyst i datagrundlaget. Banken foretager sin egen vurdering.' : 'Markedsdata og kilde er ikke oplyst. Der er ikke indsat et skøn som erstatning.';
  const raw = source && source !== 'ev' ? (Array.isArray(market.sammenligninger) ? market.sammenligninger : !asking && Array.isArray(market.handler) ? market.handler : []) : [];
  const comparisons = raw.slice(0, 8).filter(row => row && typeof row === 'object').map(row => ({
    address: clean(row.adresse) || 'Adresse ikke oplyst', price:number(row.pris, 1, 500000000), area:number(row.m2, 1, 10000), date:date(row.dato)
  })).filter(row => row.price !== null && row.area !== null);
  const count = source ? number(asking ? market.aktiveAnnoncer : market.compsCount, 0, 100000) : null;
  const evidenceText = comparisons.length ? `${comparisons.length} ${comparisons.length===1?'konkret':'konkrete'} ${asking ? 'udbud' : comparisons.length===1?'handel':'handler'} nedenfor${count !== null ? ' · oplyst datagrundlag: ' + Math.floor(count) : ''}.` : 'Ingen konkrete sammenligninger med gyldig pris og areal oplyst i dette udtræk.';
  const facts = [
    ['Ejendom',address], ['Værdi',displayedValue], ['Restgæld',money(debt)], ['Friværdi, beregnet af ovenstående tal',money(equity)],
    ['Belåningsgrad',ltv], ['Nuværende månedlige betaling',money(payment)], ['Nuværende betalingsgrundlag',basis],
    ['Oplyst rente',rate === null ? 'Ikke oplyst' : rate.toLocaleString('da-DK') + ' %'], ['Resterende løbetid',years === null ? 'Ikke oplyst' : years + ' år'],
    ['Datakilde',sourceName], ['Udtræksdato',date(context.asOf) || 'Ikke oplyst']
  ];
  const ltvNumber = value !== null && debt !== null ? debt/value*100 : null;
  const threshold = ltvNumber === null ? null : ltvNumber > 80 ? 80 : ltvNumber > 60 ? 60 : ltvNumber > 40 ? 40 : null;
  const thresholdPayment = threshold === null ? null : Math.max(0, Math.round(debt-value*threshold/100));
  const thresholdNote = ltvNumber === null ? 'Bed banken om at fastlægge en aktuel vurdering og belåningsgrad, før I drøfter bidragstrin.' : threshold === null ? 'Din beregnede belåning er højst 40 %. Bed banken bekræfte, hvilke priser og vilkår der gælder for din låntype ved dette niveau; lav belåning giver ikke automatisk ret til bestemte vilkår.' : `Ved den viste modelværdi kræver ${threshold} % belåning cirka ${money(thresholdPayment)} i nedbringelse af gælden før omkostninger. Spørg banken, om dette trin ændrer bidrag eller lånemuligheder, og få et samlet tilbud før du betaler ned. Banken kan bruge en anden vurdering eller andre bidragstrin.`;
  const monitoring = context.monitoring && typeof context.monitoring === 'object' ? context.monitoring : null;
  const kinds = [['F1','F1 Flekslån'],['F3','F3'],['F5','F5'],['fastforrentet','Fast rente']];
  const signed = amount => (amount>0?'+':amount<0?'−':'')+money(Math.abs(amount));
  const scenarioRows = kinds.map(([key,label]) => {
    const candidate = Array.isArray(monitoring?.scenarios) ? monitoring.scenarios.find(row => row && row.rateKey === key) : null;
    const monthly = candidate ? number(candidate.newPayment,0,1000000) : null;
    const candidateRate = candidate ? number(candidate.rate,0,30) : null;
    const valid = monthly !== null && candidateRate !== null;
    return {label,rate:valid?candidateRate:null,monthly:valid?monthly:null,delta:valid&&payment!==null?monthly-payment:null};
  });
  const scenarioFee = number(monitoring?.fee,0,1000000);
  const scenarioNote = `Modelberegninger med afdrag og anslået bidrag${years!==null?' over '+years+' år':''}. Ændring pr. måned sammenlignes med din oplyste nuværende betaling${context.laantype==='afdragsfri'?' uden afdrag':''}. Plus betyder højere betaling, minus lavere. Afdrag er gældsafvikling, ikke en renteudgift. ${scenarioFee!==null?'Anslåede engangsomkostninger: '+money(scenarioFee)+' De er ikke lagt ind i den viste månedlige betaling.':'Engangsomkostninger er ikke oplyst.'} Satser og bidrag er vejledende, ikke et banktilbud.${monitoring?.fallbackRates===true?' Rentesatserne er reservesatser, ikke verificerede aktuelle tilbud.':''}`;
  const contribution = context.contribution && typeof context.contribution === 'object' ? context.contribution : null;
  const currentBidrag = number(contribution?.currentBidrag,0,10), targetBidrag = number(contribution?.targetBidrag,0,10);
  const currentContributionCost = currentBidrag!==null && debt!==null ? debt*currentBidrag/1200 : null;
  const currentContributionNote = currentBidrag===null ? '' : `Dit oplyste bidrag${institution?' hos '+institution:''}: ${bidragText(currentBidrag)} % p.a.${currentContributionCost!==null?' Det svarer illustrativt til '+money(currentContributionCost)+' pr. måned før skat på den oplyste restgæld.':''} Dette er nuværende omkostning, ikke en mulig besparelse.`;
  if(institution) facts.push(['Realkreditinstitut (oplyst)',institution]);
  if(currentBidrag!==null) facts.push(['Nuværende bidragssats (oplyst)',bidragText(currentBidrag)+' % p.a.']);
  if(currentContributionCost!==null) facts.push(['Nuværende bidrag pr. måned (illustration før skat)',money(currentContributionCost)]);
  if(afdragsfriAar!==null) facts.push(['Afdragsfrihed tilbage (oplyst)',afdragsfriAar.toLocaleString('da-DK')+' år']);
  if(refinansieringISO) facts.push(['Næste refinansiering (oplyst)',refinansieringISO]);
  const contributionScenario = row => {
    if (!row || typeof row !== 'object' || debt===null) return null;
    const cut=number(row.cutPercentagePoints,0,10),monthly=number(row.monthly,0,1000000),yearly=number(row.yearly,0,12000000);
    if(cut===null||cut<=0||monthly===null||yearly===null||Math.abs(monthly-debt*cut/1200)>.01||Math.abs(yearly-monthly*12)>.01)return null;
    return {cut,monthly,yearly};
  };
  const actualContribution = contributionScenario(contribution?.actualScenario);
  const actualCut = currentBidrag!==null&&targetBidrag!==null&&currentBidrag>targetBidrag?currentBidrag-targetBidrag:null;
  const actualContributionKnown = actualContribution&&actualCut!==null&&Math.abs(actualContribution.cut-actualCut)<.0000001;
  const contributionExamples = (Array.isArray(contribution?.illustrations)?contribution.illustrations:[]).slice(0,3)
    .map(contributionScenario).filter(row=>row&&[.1,.2,.3].some(cut=>Math.abs(row.cut-cut)<.0000001)&&(currentBidrag===null||row.cut<=currentBidrag));
  const contributionBasis = actualContributionKnown ? 'Regneeksempel med dine oplyste nuværende og mulige nye bidragssatser. Den nye sats er ikke verificeret som et bindende tilbud.' : 'Hypotetiske fald på 0,10 / 0,20 / 0,30 procentpoint. Dette er ikke en faktisk besparelse eller bestemte långiveres priser.';
  const contributionLines = actualContributionKnown ? [actualContribution] : contributionExamples;
  const contributionNotes = [
    contributionBasis,
    currentBidrag===null?'Din nuværende bidragssats er ikke oplyst; en faktisk besparelse kan ikke fastslås.':`Oplyst nuværende bidragssats: ${bidragText(currentBidrag)} %${targetBidrag!==null?'; mulig ny sats: '+bidragText(targetBidrag)+' %':''}.`,
    'Alle beløb er før skat og beregnes som restgæld × fald i procentpoint / 1.200 pr. måned. Engangsomkostninger og ændringer i andre vilkår er ikke trukket fra.',
    contribution?.thresholdPercent===60?'Under 60 % belåning kan være et relevant tidspunkt at drøfte bidrag med banken, men giver ikke automatisk en lavere sats på et eksisterende lån. Låntype, afdragsfrihed, intervaller og aftalevilkår afgør det konkrete tilbud.':'Belåningsgrænser afhænger af boligtypen og instituttet. Der er ikke fastslået en fælles grænse for denne boligtype.',
    String(context.anvKode)==='510'?'Sommerhuse har andre grænser, der varierer mellem institutter; 60 % er ikke en fælles sommerhusgrænse.':null
  ].filter(Boolean);
  const budgetSpec = [
    ['b_loen','Løn efter skat',true],['b_anden','Andre indtægter efter skat',true],['b_bolig','Boliglån og bidrag'],['b_faelles','Ejendomsskatter og fællesudgifter'],
    ['b_el','El'],['b_varme','Varme'],['b_vand','Vand'],['b_forsikring','Forsikringer'],['b_bil','Bilbetaling'],['b_benzin','Brændstof'],['b_bilfors','Bilforsikring'],
    ['b_transport','Øvrig transport'],['b_mad','Mad og dagligvarer'],['b_born','Børn og institution'],['b_fritid','Fritid og sport'],['b_mobil','Mobiltelefon'],
    ['b_net','Internet'],['b_stream','Streaming'],['b_linser','Kontaktlinser og briller'],['b_helbred','Medicin og tandlæge'],['b_toej','Tøj og personlig pleje'],
    ['b_laan','Øvrige lån'],['b_kk','Kreditkort'],['b_opsp','Opsparing og vedligehold']
  ];
  const suppliedBudget = context.budget && typeof context.budget === 'object' && !Array.isArray(context.budget) ? context.budget : {};
  const budgetItems = budgetSpec.map(([id,label,income])=>({id,label,income:!!income,value:number(Object.hasOwn(suppliedBudget,id)?suppliedBudget[id]:null,0,1000000)}));
  const filled = budgetItems.filter(row=>row.value!==null);
  const complete = filled.length===budgetItems.length;
  const knownIncome = budgetItems.filter(row=>row.income&&row.value!==null);
  const knownExpenses = budgetItems.filter(row=>!row.income&&row.value!==null);
  const incomeSum = knownIncome.length?knownIncome.reduce((sum,row)=>sum+row.value,0):null;
  const expenseSum = knownExpenses.length?knownExpenses.reduce((sum,row)=>sum+row.value,0):null;
  const available = complete ? incomeSum-expenseSum : null;
  const budgetNote = complete ? 'Alle budgetposter er udfyldt med dine oplyste beløb. Kontrollér, at de er aktuelle og dækker alle udgifter; arket regner ikke automatisk om efter dine ændringer.' : `Budgettet er ufuldstændigt: ${filled.length} af ${budgetItems.length} poster er oplyst. Manglende felter er ikke nul. Summer omfatter kun kendte beløb; et samlet rådighedsbeløb kan ikke beregnes endnu.`;
  const budgetTotals = [
    ['incomeTotal',complete?'Indtægter i alt':'Oplyste indtægter (delvist)',incomeSum],
    ['costTotal',complete?'Udgifter inkl. opsparing i alt':'Oplyste udgifter inkl. opsparing (delvist)',expenseSum],
    ['available','Rådighedsbeløb (kun ved fuldt udfyldt budget)',available]
  ];
  const budgetRows = [...budgetItems.map(row=>[row.id,row.label,row.value]),...budgetTotals];
  const personalLoan = debt!==null?money(debt):'min oplyste restgæld';
  const personalYears = years!==null?years+' år':'den resterende løbetid';
  const personalPayment = payment!==null?money(payment):'min oplyste betaling';
  const loanIdentity = institution ? 'Mit '+institution+'-lån' : 'Mit lån';
  const bidragQuestion = currentBidrag!==null ? `${loanIdentity} har oplyst bidrag ${bidragText(currentBidrag)} % p.a. Hvad kan I tilbyde uden unødvendig omlægning? ` : institution ? loanIdentity+': ' : '';
  const timingQuestion = [afdragsfriAar!==null?'Min oplyste afdragsfrihed udløber om '+afdragsfriAar.toLocaleString('da-DK')+' år.':'',refinansieringISO?'Næste oplyste refinansiering er '+refinansieringISO+'.':''].filter(Boolean).join(' ');
  const questionList = [
    value!==null&&debt!==null ? `Mit estimat er ${displayedValue}, restgælden ${personalLoan} og belåningen ${ltv}. Hvilken værdi vil I acceptere, og kan mit nuværende bidrag sættes ned${ltvNumber<=60?' uden ekstra indbetaling':''}?` : 'Hvilken aktuel værdi vil I acceptere for min bolig, og hvad betyder den for bidraget på mit nuværende lån?',
    context.laantype==='afdragsfri' ? `${bidragQuestion}Jeg betaler ${personalPayment} om måneden uden afdrag. Hvad kan I tilbyde med samme afdragsfrihed? Vis rente og bidrag hver for sig, så jeg kan sammenligne med i dag.` : `${bidragQuestion}Jeg betaler ${personalPayment} om måneden. Hvor meget er rente, bidrag og afdrag, og hvad kan I ændre uden at forlænge løbetiden?`,
    `På ${personalLoan} med ${personalYears} tilbage: vis F1, F3, F5 og fast rente med samme løbetid. Hvilke typer tilbyder I, og hvilke kræver et tilbud fra en anden udbyder? Hvad bliver samlet betaling med afdrag, og hvor meget gæld afvikler jeg det første år?`,
    threshold!==null ? `Hvis jeg betaler cirka ${money(thresholdPayment)} ned til ${threshold} % belåning, hvor meget falder bidraget og betalingen? Vis omkostninger og likviditetsbehov, før jeg binder pengene i boligen.` : ltvNumber!==null ? `Min belåning er ${ltv}. Hvilke bedre vilkår kan I tilbyde ved dette niveau, og hvad kræver det at bevare eller få afdragsfrihed?` : 'Hvilken belåningsgrænse er relevant for min boligtype, og hvad koster det samlet at komme ned til den?',
    `${timingQuestion?timingQuestion+' Hvilke frister skal jeg overholde? ':''}For jeres bedste tilbud: hvad skal jeg betale nu i indfrielse, kurs og gebyrer, og hvornår er de dækket af en lavere betaling? Vis også budgettet, hvis renten stiger${context.laantype==='afdragsfri'?' eller afdragsfriheden ophører':''}.`
  ];
  const actions = ['Åbn PDF’en og kontrollér tallene mod dit seneste låneoverblik.',
    'Udfyld budgetarket i Excel eller et andet regneark. Tomme felter er ukendte, ikke nul. Årsudgifter deles med 12.',
    'Tag PDF og budget med til banken. Bed om skriftlige tilbud på de fem spørgsmål; del selv kun de dokumenter, du ønsker.'];
  const disclaimerText = 'Vejledende beregninger før skat, ikke et bindende tilbud eller personlig finansiel rådgivning. Banken fastlægger vurdering, vilkår og kreditgodkendelse.';
  const statRows = [['Boligværdi',displayedValue],['Friværdi',money(equity)],['Belåningsgrad',ltv],['Betaling nu',money(payment)+'/md']];
  const formattedScenarios = scenarioRows.map(row=>({label:row.label,rate:row.rate===null?'—':row.rate.toLocaleString('da-DK')+' %',monthly:row.monthly===null?'Ikke beregnet':money(row.monthly),delta:row.delta===null?'—':signed(row.delta)}));
  const formattedContributions = contributionLines.map(row=>({cut:row.cut.toLocaleString('da-DK',{minimumFractionDigits:2,maximumFractionDigits:2}),monthly:money(row.monthly),yearly:money(row.yearly)}));
  const shortScenarioNote = `Med afdrag og anslået bidrag${years!==null?' over '+years+' år':''}; ændring mod ${personalPayment}${context.laantype==='afdragsfri'?' uden afdrag':''}. + er højere betaling, − lavere.${scenarioFee!==null?' Engangsomkostninger: '+money(scenarioFee):' Engangsomkostninger er ikke oplyst.'}${monitoring?.fallbackRates===true?' Beregnet med reservesatser.':''} Ikke alle banker tilbyder alle lånetyper. Renter og bidrag er referenceestimater; banken skal bekræfte et personligt tilbud.`;
  const shortContributionNote = actualContributionKnown ? `Dine oplyste satser: ${bidragText(currentBidrag)} % → ${bidragText(targetBidrag)} %. Regneeksempel før skat, uden omkostninger.` : 'Hypotetiske fald i bidrag før skat, uden omkostninger. Din faktiske besparelse kræver din bidragssats og bankens tilbud.';
  const under60Note = contribution?.thresholdPercent===60 ? (ltvNumber!==null&&ltvNumber<=60 ? `Du ligger under 60 %. Spørg om lavere bidrag på det eksisterende lån; det ændres ikke automatisk.` : 'En ny vurdering eller nedbetaling kan åbne en dialog om 60 %-grænsen; en lavere sats er ikke automatisk.') : 'Relevante bidragsgrænser afhænger af boligtypen og instituttet.';
  const contributionIntro=contribution?.actualScenario?'Beregnet forskel ud fra dine oplyste satser; den nye sats er ikke et verificeret tilbud.':'Hypotetiske fald på 0,10 / 0,20 / 0,30 procentpoint. Din nuværende bidragssats er ikke oplyst, hvis du ikke har angivet den.';
  const reportData = {address,summary:'Dit beslutningsgrundlag til bankmødet — ingen banker kontaktes.',facts:[facts[1],facts[3],facts[4],facts[5],facts[2],...facts.slice(6)],
    sections:[
      {title:'Dine omlægningsscenarier',paragraphs:[scenarioNote],headers:['Lån','Rente','Betaling/md','Ændring/md'],rows:formattedScenarios.map(row=>[row.label,row.rate,row.monthly,row.delta])},
      {title:'Mulighed for lavere bidrag',paragraphs:contribution?[currentContributionNote,contributionIntro,under60Note,'Beløb før skat, uden omkostninger. Fald i bidrag er regneeksempler, medmindre dine egne satser er oplyst. En faktisk besparelse kræver bankens tilbud.']:['Bidragsgrundlaget er ikke oplyst.'],headers:['Fald (procentpoint)','Pr. måned','Pr. år'],rows:formattedContributions.map(row=>[row.cut,row.monthly,row.yearly])},
      {title:'Fem spørgsmål til din bank',paragraphs:questionList.map((question,index)=>(index+1)+'. '+question)},
      {title:'Sådan bruger du pakken',paragraphs:actions.map((action,index)=>(index+1)+'. '+action)},
      {title:'Boliggrundlag og sammenligninger',paragraphs:[sourceNote,evidenceText,clean(market.note,600)].filter(Boolean),headers:['Adresse',asking?'Udbudspris':'Handelspris','Areal',asking?'Observationsdato':'Handelsdato'],rows:comparisons.map(row=>[row.address,money(row.price),row.area.toLocaleString('da-DK')+' m²',row.date||'Dato ikke oplyst'])},
      {title:'Forudsætninger og kilder',paragraphs:[thresholdNote,...(contribution?CONTRIBUTION_SOURCES.map(source=>source.name+': '+source.url+' — gældende fra '+source.effective+', kontrolleret '+source.assessed):[]),disclaimerText]}
    ]};
  reportData.sections[0].paragraphs.push('Rentegrundlag: '+clean(monitoring?.rateSource||'Illustrative modelrenter',180)+(monitoring?.rateObservationDate?' · kildedato '+clean(monitoring?.rateObservationDate,20):'')+'. Referencerne er ikke personlige lånetilbud.');
  const pdf = renderBankPackagePdf(reportData);
  const csv = '﻿' + ['Post;Beløb pr. måned (kr.);Note',...budgetRows.map(([,label,value]) => '"' + label.replaceAll('"','""') + '";'+(value===null?'':String(value).replace('.',','))+';'+(value===null?'Udfyld selv':'Oplyst eller beregnet af kendte poster')), 'Budgetstatus;;"'+budgetNote.replaceAll('"','""')+'"','Noter;;Ingen automatisk beregning. Kontrollér summer efter ændringer.'].join('\n');
  const heading = (icon,title) => `<h2 style="font-size:19px;line-height:1.3;color:#194d3b;margin:25px 0 10px">${icon} ${title}</h2>`;
  const table = (headers,rows) => '<table style="width:100%;border-collapse:collapse;font-size:14px;table-layout:fixed"><thead><tr>'+headers.map(header=>'<th style="text-align:left;padding:8px 4px;border-bottom:2px solid #dce7e1;color:#597067;font-size:12px">'+escape(header)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td style="padding:10px 4px;border-bottom:1px solid #e5ece8;vertical-align:top;overflow-wrap:anywhere">'+escape(cell)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
  const cards = '<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:5px;table-layout:fixed">'+[0,2].map(offset=>'<tr>'+statRows.slice(offset,offset+2).map(([label,value])=>`<td style="width:50%;padding:12px;background:#eef6f1;border-radius:10px;vertical-align:top"><div style="font-size:12px;color:#5e7367">${escape(label)}</div><div style="font-size:20px;font-weight:700;color:#173e30;margin-top:4px;overflow-wrap:anywhere">${escape(value)}</div></td>`).join('')+'</tr>').join('')+'</table>';
  const intro = `Restgæld ${personalLoan} · ${years!==null?years+' år tilbage':'løbetid ikke oplyst'}${rate!==null?' · rente '+rate.toLocaleString('da-DK')+' %':''}${context.laantype==='afdragsfri'?' · afdragsfrit':''}.`;
  const sourceShort = `${sourceName}${count!==null?' · '+Math.floor(count)+(asking?' aktuelle udbud':' handler'):''}. ${asking?'Udbudspriser, ikke gennemførte salg.':source==='ev'?'Skats vurdering — handelsprisen kan være højere.':'Detaljer og datoer i PDF’en.'}`;
  const html = `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f1f5f2;font-family:Arial,sans-serif;color:#20362b;line-height:1.5"><div style="max-width:680px;margin:0 auto;background:#fff"><div style="background:#194d3b;color:#fff;padding:24px 20px"><div style="font-size:12px;letter-spacing:1px;color:#cbe4d5">BOLIGLÅNSRADAR</div><h1 style="font-size:25px;margin:6px 0 4px;line-height:1.2">Din bankpakke er klar</h1><div style="font-size:14px;color:#e4efe8">${escape(address)}</div></div><div style="padding:8px 16px 22px"><p style="margin:16px 0;color:#52665a">Her er dine vigtigste tal og spørgsmål. Din fulde PDF og dit redigerbare budgetark er vedhæftet.</p>${heading('🏠','Dit udgangspunkt')}${cards}<p style="font-size:14px;margin:10px 5px">${escape(intro)}</p><p style="font-size:12px;color:#64766b;margin:0 5px">${escape(sourceShort)}</p>${heading('↔','Dine lånemuligheder')}${table(['Lån','Rente','Ydelse/md','+/− pr. md'],formattedScenarios.map(row=>[row.label,row.rate,row.monthly,row.delta]))}<p style="font-size:12px;color:#64766b">${escape(shortScenarioNote)}</p>${heading('↓','Kan bidraget blive lavere?')}${currentContributionNote?'<p style="font-size:14px;margin:0 0 10px">'+escape(currentContributionNote)+'</p>':''}<p style="font-size:14px;margin:0 0 10px">${escape(under60Note)}</p>${formattedContributions.length?table(['Fald (pp)','Pr. måned','Pr. år'],formattedContributions.map(row=>[row.cut,row.monthly,row.yearly])):'<p style="font-size:14px">Bidragssatsen mangler. Bed banken om et konkret regnestykke.</p>'}<p style="font-size:12px;color:#64766b">${escape(shortContributionNote)}</p>${heading('💬','Dine fem spørgsmål til banken')}<ol style="padding-left:22px;margin:8px 0;font-size:14px">${questionList.map(question=>'<li style="padding:0 0 12px 3px">'+escape(question)+'</li>').join('')}</ol>${heading('✓','Sådan bruger du pakken')}<ol style="padding-left:22px;font-size:14px">${actions.map(action=>'<li style="padding:0 0 8px 3px">'+escape(action)+'</li>').join('')}</ol><p style="font-size:12px;color:#6d7d73;border-top:1px solid #e5ece8;padding-top:14px">${escape(disclaimerText)} Pakken sendes kun til dig; vi kontakter ingen banker.</p></div></div></body></html>`;
  const text = ['BOLIGLÅNSRADAR — Din bankpakke er klar',address,'Fuld rapport: vedhæftede PDF. Budget: vedhæftede CSV.','',...statRows.map(([label,value])=>label+': '+value),intro,sourceShort,'','Dine lånemuligheder',...formattedScenarios.map(row=>`${row.label}: ${row.rate} | ${row.monthly}/md | ${row.delta}/md`),shortScenarioNote,'','Kan bidraget blive lavere?',currentContributionNote,under60Note,...formattedContributions.map(row=>`${row.cut} procentpoint: ${row.monthly}/md; ${row.yearly}/år`),shortContributionNote,'','Dine fem spørgsmål til banken',...questionList.map((q,index)=>(index+1)+'. '+q),'','Sådan bruger du pakken',...actions.map((action,index)=>(index+1)+'. '+action),'',disclaimerText,'Pakken sendes kun til dig; vi kontakter ingen banker.'].join('\n');
  return {subject:'Din bankpakke: dine tal og fem spørgsmål til banken',text,html,attachments:[{filename:'din-bankpakke.pdf',content:pdf.toString('base64')},{filename:'budgetark.csv',content:Buffer.from(csv,'utf8').toString('base64')}]};
}
