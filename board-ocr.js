/* Free local OCR. Images are processed in the phone's browser, never uploaded. */
(function(root){
'use strict';
const wordsOf=data=>{
 const out=[];
 for(const b of data?.blocks||[])for(const p of b.paragraphs||[])for(const line of p.lines||[])for(const w of line.words||[])if(w.text&&w.bbox)out.push({text:String(w.text).trim(),bbox:w.bbox});
 return out.length?out:(data?.words||[]).filter(w=>w.text&&w.bbox);
};
const cx=w=>(w.bbox.x0+w.bbox.x1)/2,cy=w=>(w.bbox.y0+w.bbox.y1)/2;
const clean=s=>String(s||'').replace(/[\r\n\t]+/g,' ').replace(/\s{2,}/g,' ').trim();
const med=xs=>{const a=xs.filter(Number.isFinite).sort((a,b)=>a-b);return a[Math.floor(a.length/2)]||0;};
const number=s=>{const m=String(s).match(/^\s*(\d{1,2})[.)]?\s*$/);return m?+m[1]:0;};
function detectCount(data){
 const m=String(data?.text||'').replace(/\s+/g,' ').match(/(?:no\.?\s*(?:of)?\s*pupils?|number\s+of\s+pupils?)\s*:?\s*(\d{1,2})(?!\d)/i);
 return m&&+m[1]>=1&&+m[1]<=40?+m[1]:null;
}
function findRows(data,width,height,count){
 const words=wordsOf(data);
 const columns={names:[width*.347,width*.554],addresses:[width*.557,width*.881],contacts:[width*.008,width*.278]};
 const headers=words.filter(w=>/^(child|childs|name)$/i.test(w.text.replace(/[^a-z]/gi,''))&&cx(w)>width*.30&&cx(w)<width*.62&&cy(w)<height*.58).sort((a,b)=>cy(b)-cy(a));
 const head=headers.length?cy(headers[0]):height*.235;
 const footer=words.filter(w=>/^(vehicle|contractor|mileage)$/i.test(w.text)&&cy(w)>head+height*.05).sort((a,b)=>cy(a)-cy(b))[0];
 const bottom=footer?cy(footer):height*.74;
 const anchors=new Map();
 for(const w of words){
  const n=number(w.text),y=cy(w);
  if(n>=1&&n<=count&&cx(w)>width*.282&&cx(w)<width*.352&&y>head+height*.015&&y<bottom&&!anchors.has(n))anchors.set(n,y);
 }
 const known=[...anchors].sort((a,b)=>a[0]-b[0]).filter(([n,y],i,a)=>!i||y>a[i-1][1]);
 let pitch=height*.012;
 const slopes=[];
 for(let i=0;i<known.length;i++)for(let j=i+1;j<known.length;j++){
  const s=(known[j][1]-known[i][1])/(known[j][0]-known[i][0]);
  if(s>Math.max(5,height*.004)&&s<height*.25)slopes.push(s);
 }
 if(slopes.length)pitch=med(slopes);
 let first=known.length?med(known.map(([n,y])=>y-(n-1)*pitch)):null;
 if(first===null){
  const names=words.filter(w=>cx(w)>columns.names[0]&&cx(w)<columns.names[1]&&cy(w)>head+height*.023&&cy(w)<bottom&&!/^(escort|school|pupil|child|name|mon|fri)$/i.test(w.text)).map(cy).sort((a,b)=>a-b);
  first=names[0]||head+height*.047;
 }
 const centres=Array.from({length:count},(_,i)=>{
  if(anchors.has(i+1))return anchors.get(i+1);
  const before=known.filter(([n])=>n<=i+1).at(-1),after=known.find(([n])=>n>i+1);
  if(before&&after)return before[1]+(after[1]-before[1])*(i+1-before[0])/(after[0]-before[0]);
  if(before)return before[1]+(i+1-before[0])*pitch;
  if(after)return after[1]-(after[0]-(i+1))*pitch;
  return first+i*pitch;
 });
 return {centres,pitch,columns,anchorCount:known.length};
}
function parseContacts(text){
 let s=clean(text);
 const pat=/\b0(?:[\s-]?\d){8,9}(?!\d)/g;
 const matches=[...s.matchAll(pat)].map(m=>m[0].replace(/\D/g,''));
 const names=clean(s.replace(pat,'').replace(/\s*[,;/]\s*$/,'')).replace(/^[^\p{L}]+/u,'').replace(/[^\p{L}]+$/u,'');
 const parts=names.split(/\s*[,/&]\s*/).filter(Boolean);
 if(matches.length===2&&parts.length===2)return matches.map((phone,i)=>({name:parts[i],phone}));
 if(matches.length>1)return matches.map((phone,i)=>({name:i===0?names:'',phone}));
 return [{name:names,phone:matches[0]||''}];
}
const cleanName=s=>clean(s).replace(/\((?:w\/?c|wc)\s*user\)/gi,'').replace(/[^\p{L}'\-\s]/gu,'').replace(/\s+/g,' ').trim();
// Crop inside the printed borders and add a white margin, so table lines
// aren't mistaken for a child's first or last letters.
function crop(img,range,y,pitch,contrast=1.6,asName=false){
 const inset=asName?Math.max(2,Math.min(4,img.width*.004)):0;
 const x0=Math.max(0,Math.floor(range[0]+inset));
 const x1=Math.min(img.width,Math.ceil(range[1]-(asName?Math.max(3,img.width*.006):0)));
 const half=Math.max(8,Math.min(18,pitch*(asName?.46:.49)));
 const y0=Math.max(0,Math.round(y-half));
 const y1=Math.min(img.height,Math.round(y+half));
 const c=document.createElement('canvas'),w=Math.max(1,x1-x0),h=Math.max(1,y1-y0);
 const scale=asName?5:3,margin=asName?12:0;
 c.width=w*scale+margin*2;c.height=h*scale+margin*2;
 const ctx=c.getContext('2d');if(!ctx)throw Error('Photo processing is unavailable');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
 ctx.imageSmoothingEnabled=true;
 ctx.filter='grayscale(1) contrast('+contrast+')';
 ctx.drawImage(img,x0,y0,w,h,margin,margin,w*scale,h*scale);
 return c;
}
function evaluateName(result){
 const data=result?.data||{};
 const raw=clean(data.text||'');
 let value=cleanName(raw).replace(/([\p{Ll}])([\p{Lu}])/gu,'$1 $2')
  .replace(/^[^\p{L}]+|[^\p{L}]+$/gu,'').replace(/\s+/g,' ').trim();
 const words=value.split(/\s+/).filter(Boolean);
 const confidences=(data.words||[]).filter(w=>/[\p{L}]/u.test(String(w.text||'')))
  .map(w=>Number(w.confidence)).filter(Number.isFinite);
 const confidence=confidences.length?
  confidences.reduce((a,b)=>a+b,0)/confidences.length:(Number(data.confidence)||0);
 const plausible=words.length>=2&&words.length<=4&&value.length>=5&&value.length<=60
  &&words.every(w=>w.length<=22);
 // Garbled multi-word strings are not valid names. Do not invent a replacement.
 if(!plausible||raw.length>90)value='';
 const score=value?confidence+(words.length===2?15:words.length===3?0:-20):-100;
 return {value,score,confidence,uncertain:!value||confidence<68||words.length!==2};
}
let loading;
async function engine(update){
 if(root.Tesseract?.createWorker)return root.Tesseract;
 if(!navigator.onLine)throw Error('First-time photo reading requires internet to load the free OCR engine.');
 if(!loading)loading=new Promise((ok,fail)=>{
  const s=document.createElement('script');s.async=true;
  s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  s.onload=()=>root.Tesseract?.createWorker?ok(root.Tesseract):fail(Error('Text reader did not start'));
  s.onerror=()=>fail(Error('Text reader could not download. Check your internet connection.'));
  document.head.appendChild(s);
 }).catch(e=>{loading=null;throw e;});
 update('Loading free text reader…');
 return loading;
}
async function readPhoto(photo,expected,update=()=>{}){
 if(!/^data:image\//.test(photo||''))throw Error('Choose an operating-board photo first');
 if(!Number.isInteger(expected)||expected<1||expected>40)throw Error('Enter the board pupil count first');
 const img=new Image();img.src=photo;await img.decode();
 const t=await engine(update);
 update('Loading English OCR model (first use needs internet)…');
 let worker;
 try{
  worker=await t.createWorker('eng',1,{logger:m=>{
   if(/loading (?:language|tesseract)/.test(m.status||''))update('Loading OCR model: '+Math.round(100*(m.progress||0))+'%');
  }});
  update('Locating numbered pupil rows…');
  const first=await worker.recognize(img,{}, {text:true,blocks:true});
  const count=detectCount(first.data);
  const geom=findRows(first.data,img.width,img.height,expected);
  if(geom.centres.some(y=>!Number.isFinite(y)||y<0||y>img.height))throw Error('Could not locate pupil rows. Use a clearer close-up photo.');
  await worker.setParameters({tessedit_pageseg_mode:'7',preserve_interword_spaces:'1'});
  const rows=[];
  await worker.setParameters({tessedit_pageseg_mode:'7',preserve_interword_spaces:'1'});
  for(let i=0;i<expected;i++){
   const values={};
   for(const field of ['addresses','contacts']){
    update('Reading pupil '+(i+1)+' of '+expected+' — '+(field==='addresses'?'address':'guardian contacts'));
    const res=await worker.recognize(crop(img,geom.columns[field],geom.centres[i],geom.pitch));
    values[field]=clean(res.data.text);
   }
   update('Checking name for pupil '+(i+1)+' of '+expected+'…');
   const printedName=crop(img,geom.columns.names,geom.centres[i],geom.pitch,1.5,true);
   const firstResult=await worker.recognize(printedName);
   const primary=evaluateName(firstResult);
   let best=primary;
   if(primary.score<84||primary.uncertain){
    update('Rechecking name for pupil '+(i+1)+'…');
    const second=crop(img,geom.columns.names,geom.centres[i]-1,geom.pitch,1.15,true);
    const candidate=evaluateName(await worker.recognize(second));
    if(candidate.score>best.score)best=candidate;
   }
   rows.push({
    name:best.value,
    nameNeedsReview:best.uncertain||best.score<75,
    nameCrop:printedName.toDataURL('image/jpeg',.82),
    address:values.addresses,stop:values.addresses,
    contacts:parseContacts(values.contacts),
    notes:/w\/?c\s*user/i.test(String(firstResult.data.text||''))?'Wheelchair user (verify board)':''
   });
  }
  return {rows,count:expected,detectedCount:count,anchorCount:geom.anchorCount};
 }finally{if(worker)await worker.terminate();}
}
root.BoardOCR={readPhoto,detectCount,findRows,parseContacts,cleanName};
})(window);