// Dependency-free, inert A4 PDF. Standard Helvetica fonts use WinAnsi encoding.
const W=595.28,H=841.89,M=42,BOTTOM=H-52;
const EXTRA=new Map([[8364,128],[8218,130],[402,131],[8222,132],[8230,133],[8224,134],[8225,135],[710,136],[8240,137],[352,138],[8249,139],[338,140],[381,142],[8216,145],[8217,146],[8220,147],[8221,148],[8226,149],[8211,150],[8212,151],[732,152],[8482,153],[353,154],[8250,155],[339,156],[382,158],[376,159]]);
function clean(value){return Array.from(String(value??'').normalize('NFC')).map(c=>{
 const code=c.codePointAt(0);if(c==='\n')return '\n';if(code<32||code===127)return ' ';
 if((code>=32&&code<=126)||(code>=160&&code<=255)||EXTRA.has(code))return c;
 const ascii=c.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');return /^[\x20-\x7e]+$/.test(ascii)?ascii:'?';
}).join('');}
function literal(value){return '('+Array.from(clean(value)).map(c=>{
 const n=EXTRA.get(c.codePointAt(0))??c.charCodeAt(0);
 return n>126?'\\'+n.toString(8).padStart(3,'0'):c==='\\'||c==='('||c===')'?'\\'+c:c==='\n'?' ':c;
}).join('')+')';}
const ASCII=[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
function width(value,size,bold=false){return Array.from(value).reduce((sum,c)=>sum+(ASCII[c.charCodeAt(0)-32]??({'æ':889,'Æ':1000,'ø':556,'Ø':778,'å':556,'Å':667}[c]??700)),0)*size/1000*(bold?1.08:1);}
function wrap(value,max,size=10,bold=false){
 const result=[];
 for(const paragraph of clean(value).split('\n')){
  if(!paragraph.trim()){result.push('');continue;}
  let line='';
  for(const word of paragraph.trim().split(/\s+/)){
   if(width(line+(line?' ':'')+word,size,bold)<=max){line+=(line?' ':'')+word;continue;}
   if(line){result.push(line);line='';}
   for(const character of word){if(width(line+character,size,bold)>max&&line){result.push(line);line='';}line+=character;}
  }
  if(line)result.push(line);
 }
 return result.length?result:[''];
}
export function renderBankPackagePdf(report={}){
 if(!report||typeof report!=='object')report={};
 const pages=[];let commands=[],y=0;
 const emit=s=>commands.push(s);
 const rect=(x,top,w,h,color)=>emit(`${color} rg ${x.toFixed(2)} ${(H-top-h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
 const draw=(value,x,top,size=10,bold=false,color='.10 .18 .23')=>emit(`BT /${bold?'F2':'F1'} ${size} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${(H-top-size).toFixed(2)} Tm ${literal(value)} Tj ET`);
 function page(){if(commands.length)pages.push(commands.join('\n'));commands=[];const first=pages.length===0;rect(0,0,W,first?76:54,'.10 .30 .23');draw('VURDERINGSTJEKKET',M,first?18:12,10,true,'1 1 1');draw('Din personlige bankpakke',M,first?36:28,first?20:14,true,'1 1 1');y=first?96:72;}
 const need=height=>{if(y+height>BOTTOM)page();};
 function paragraph(value,size=10,bold=false){
  const lines=wrap(value,W-2*M,size,bold),leading=size*1.35;
  if(lines.length*leading+6<BOTTOM-96)need(lines.length*leading+6);
  for(const line of lines){need(leading);draw(line,M,y,size,bold);y+=leading;}y+=4;
 }
 function heading(value){need(42);y+=8;paragraph(value,14,true);}
 function table(headers,rows){
  const cols=Math.max(headers.length,...rows.map(r=>Array.isArray(r)?r.length:0));if(!cols)return;
  const cw=(W-2*M)/cols,padding=6,leading=12;
  function header(){if(!headers.length)return;
   const lines=headers.map(h=>wrap(h,cw-2*padding,8,true));const height=Math.max(...lines.map(v=>v.length))*11+12;need(height+24);rect(M,y,W-2*M,height,'.88 .94 .90');
   lines.forEach((cell,col)=>cell.forEach((line,i)=>draw(line,M+col*cw+padding,y+6+i*11,8,true)));y+=height;
  }
  header();
  rows.forEach((row,rowIndex)=>{
   const cells=Array.from({length:cols},(_,i)=>wrap(Array.isArray(row)?row[i]:'',cw-2*padding,9));const count=Math.max(...cells.map(c=>c.length));let offset=0;
   while(offset<count){
    let available=Math.floor((BOTTOM-y-12)/leading);
    if(available<1){page();header();available=Math.floor((BOTTOM-y-12)/leading);}
    const take=Math.min(count-offset,available),height=take*leading+12;
    rect(M,y,W-2*M,height,rowIndex%2?'.96 .97 .96':'1 1 1');
    cells.forEach((cell,col)=>cell.slice(offset,offset+take).forEach((line,i)=>draw(line,M+col*cw+padding,y+6+i*leading,9)));
    y+=height;offset+=take;
    if(offset<count){page();header();}
   }
  });y+=12;
 }
 page();
 if(report.address)paragraph(report.address,12,true);
 if(report.summary)paragraph(report.summary);
 const facts=Array.isArray(report.facts)?report.facts.filter(r=>Array.isArray(r)&&r.length>=2):[];
 for(let i=0;i<Math.min(facts.length,4);i+=2){
  const pair=facts.slice(i,i+2),cw=(W-2*M-12)/2;
  const cards=pair.map(([label,value])=>({label:wrap(label,cw-20,9,true),value:wrap(value,cw-20,14,true)}));
  const height=Math.max(...cards.map(c=>c.label.length*12+c.value.length*18+22));
  if(height>BOTTOM-110){pair.forEach(([label,value])=>{paragraph(label,10,true);paragraph(value,12,true);});continue;}
  need(height+10);
  cards.forEach((card,col)=>{const x=M+col*(cw+12);rect(x,y,cw,height,'.92 .96 .93');card.label.forEach((line,k)=>draw(line,x+10,y+9+k*12,9,true));card.value.forEach((line,k)=>draw(line,x+10,y+12+card.label.length*12+k*18,14,true));});y+=height+10;
 }
 if(facts.length>4)table([],facts.slice(4));
 for(const section of Array.isArray(report.sections)?report.sections:[]){
  if(!section||typeof section!=='object')continue;
  if(section.title){
   const first=Array.isArray(section.paragraphs)?section.paragraphs[0]:null;
   const nextHeight=first?Math.min(wrap(first,W-2*M,10).length*13.5+4,BOTTOM-150):Array.isArray(section.rows)&&section.rows.length?70:0;
   need(8+wrap(section.title,W-2*M,14,true).length*18.9+4+nextHeight);
   heading(section.title);
  }
  for(const p of Array.isArray(section.paragraphs)?section.paragraphs:[])paragraph(p);
  if(Array.isArray(section.rows)&&section.rows.length)table(Array.isArray(section.headers)?section.headers:[],section.rows);
 }
 pages.push(commands.join('\n'));
 const streams=pages.map((stream,i)=>stream+`\nBT /F1 8 Tf .35 .42 .39 rg 1 0 0 1 ${M} 24 Tm ${literal('Vurderingstjekket | Vejledende analyse')} Tj ET\nBT /F1 8 Tf .35 .42 .39 rg 1 0 0 1 ${W-M-70} 24 Tm ${literal('Side '+(i+1)+' af '+pages.length)} Tj ET`);
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
 const kids=[];
 streams.forEach(stream=>{const pageId=objects.length+1,contentId=pageId+1;kids.push(`${pageId} 0 R`);objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);objects.push(`<< /Length ${Buffer.byteLength(stream,'ascii')} >>\nstream\n${stream}\nendstream`);});
 objects[1]=`<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>`;
 const parts=[Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','latin1')],offsets=[0];let length=parts[0].length;
 objects.forEach((object,i)=>{offsets.push(length);const block=Buffer.from(`${i+1} 0 obj\n${object}\nendobj\n`,'ascii');parts.push(block);length+=block.length;});
 const xref=length;
 parts.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,'ascii'));
 return Buffer.concat(parts);
}
