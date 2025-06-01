/* ---------- PDF.js setup ---------- */
import * as pdfjsLib from 'https://unpkg.com/pdfjs-dist@4.3.136/build/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://unpkg.com/pdfjs-dist@4.3.136/build/pdf.worker.min.mjs';

/* ---------- DOM refs ---------- */
const fileInput = document.getElementById('fileInput');
const pageInput = document.getElementById('pageInput');
const applyBtn  = document.getElementById('applyPages');
const sliceBtn  = document.getElementById('sliceSelected');
const rowInput  = document.getElementById('rowInput');
const colInput  = document.getElementById('colInput');
const expectedInput = document.getElementById('expectedCount');
const thumbs    = document.getElementById('cardsContainer');
const output    = document.getElementById('slicedContainer');
const nameLbl   = document.getElementById('fileNameDisplay');

/* ---------- selection state ---------- */
const selected = new Set(); let lastSel=null;
const hilite = () =>
  document.querySelectorAll('.page-container')
    .forEach(d => d.classList.toggle('selected', selected.has(+d.dataset.page)));

/* ---------- helper: decide rows × cols ---------- */
function decideGrid(n){
  const rIn=+rowInput.value||0, cIn=+colInput.value||0;
  if(rIn&&cIn) return {rows:rIn, cols:cIn};
  let best=[1,n],score=1e9;
  for(let r=1;r<=Math.sqrt(n);r++){
    if(n%r) continue;
    const c=n/r, s=Math.abs(r-c);
    if(s<score){best=[r,c];score=s;}
  }
  return {rows:best[0], cols:best[1]};
}

/* ---------- OpenCV card finder ---------- */
function largestQuadRect(mat){
  const gray=new cv.Mat(); cv.cvtColor(mat,gray,cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray,gray,new cv.Size(5,5),0);
  const edge=new cv.Mat(); cv.Canny(gray,edge,30,100);

  const contours=new cv.MatVector(), hier=new cv.Mat();
  cv.findContours(edge,contours,hier,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);

  let best=null, area=0;
  for(let i=0;i<contours.size();i++){
    const cnt=contours.get(i), peri=cv.arcLength(cnt,true);
    const approx=new cv.Mat(); cv.approxPolyDP(cnt,approx,0.02*peri,true);
    if(approx.rows===4&&cv.isContourConvex(approx)){
      const r=cv.boundingRect(approx), a=r.width*r.height;
      if(a>area){area=a; best=r;}
    }
    approx.delete(); cnt.delete();
  }
  contours.delete(); hier.delete(); gray.delete(); edge.delete();
  return best;
}

/* ---------- PDF load & thumbnails ---------- */
fileInput.onchange = e =>{
  const f=e.target.files[0]; if(!f) return;
  new Response(f).arrayBuffer().then(async buf=>{
    const pdf=await pdfjsLib.getDocument(new Uint8Array(buf)).promise;
    thumbs.innerHTML=''; output.innerHTML=''; selected.clear(); lastSel=null;

    for(let p=1;p<=pdf.numPages;p++){
      const pg=await pdf.getPage(p), v=pg.getViewport({scale:1.5});
      const cv=document.createElement('canvas'); cv.width=v.width; cv.height=v.height;
      await pg.render({canvasContext:cv.getContext('2d'),viewport:v}).promise;
      const div=document.createElement('div'); div.className='page-container'; div.dataset.page=p;
      const img=document.createElement('img'); img.src=cv.toDataURL(); img.dataset.page=p;
      const lbl=document.createElement('div'); lbl.textContent=`Page ${p}`; lbl.style.fontSize='0.8em';

      img.onclick=ev=>{
        const n=+img.dataset.page;
        if(ev.shiftKey&&lastSel!==null){
          const[a,b]=[Math.min(n,lastSel),Math.max(n,lastSel)];
          for(let i=a;i<=b;i++) selected.add(i);
        }else if(ev.ctrlKey||ev.metaKey){
          selected.has(n)?selected.delete(n):selected.add(n); lastSel=n;
        }else{selected.clear();selected.add(n); lastSel=n;}
        hilite();
      };

      div.append(img,lbl); thumbs.appendChild(div);
    }
    hilite(); nameLbl.textContent=`Loaded: ${f.name}`;
  });
};

/* ---------- manual page list ---------- */
applyBtn.onclick=()=>{
  selected.clear();
  pageInput.value.split(',').map(s=>s.trim()).forEach(seg=>{
    if(!seg) return;
    if(seg.includes('-')){const[a,b]=seg.split('-').map(Number);
      if(!isNaN(a)&&!isNaN(b))for(let p=Math.min(a,b);p<=Math.max(a,b);p++)selected.add(p);}
    else{const n=+seg;if(!isNaN(n)) selected.add(n);}
  });
  lastSel=null; hilite();
};

/* ---------- Slice button ---------- */
sliceBtn.onclick=()=>{
  output.innerHTML='';
  const first=[...selected][0]; if(!first) return;

  const thumb=document.querySelector(`.page-container[data-page="${first}"] img`);
  const img=new Image(); img.src=thumb.src;

  img.onload=()=>{
    const pageMat=cv.imread(img);
    const reportLines=[];
    /* ---- Outer border: try OpenCV ---- */
    let outerRect=largestQuadRect(pageMat);
    let method='OpenCV contour';
    if(!outerRect){
      /* fallback projection */
      method='projection thresholds';
      const ctx=document.createElement('canvas').getContext('2d');
      ctx.canvas.width=img.width; ctx.canvas.height=img.height;
      ctx.drawImage(img,0,0);
      const {data}=ctx.getImageData(0,0,img.width,img.height);
      const col=new Uint32Array(img.width), row=new Uint32Array(img.height);
      for(let y=0,p=0;y<img.height;y++){
        for(let x=0;x<img.width;x++,p+=4){
          const v=255-data[p]; col[x]+=v; row[y]+=v;
        }
      }
      const cT=Math.max(...col)*0.05, rT=Math.max(...row)*0.20;
      let L=0; while(L<img.width&&col[L]<cT)L++;
      let R=img.width-1; while(R>L&&col[R]<cT)R--;
      let T=0; while(T<img.height&&row[T]<rT)T++;
      let B=img.height-1; while(B>T&&row[B]<rT)B--;
      outerRect={x:L,y:T,width:R-L,height:B-T};
    }
    reportLines.push(`Outer border via: ${method}`);
    reportLines.push(`Outer rect: ${outerRect.width}×${outerRect.height}`);

    const {rows,cols}=decideGrid(+expectedInput.value||1);
    reportLines.push(`Grid: ${rows} rows × ${cols} cols`);
    const cellW=outerRect.width/cols, cellH=outerRect.height/rows;
    const infl=0.05;

    const dbg=document.createElement('canvas'); dbg.width=img.width; dbg.height=img.height;
    const dctx=dbg.getContext('2d'); dctx.drawImage(img,0,0);
    dctx.strokeStyle='red'; dctx.lineWidth=2;

    let idx=0;
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++,idx++){
        const bx=outerRect.x+c*cellW, by=outerRect.y+r*cellH;
        let ix=bx-cellW*infl/2, iy=by-cellH*infl/2,
            iw=cellW*(1+infl), ih=cellH*(1+infl);
        ix=Math.max(0,ix); iy=Math.max(0,iy);
        if(ix+iw>img.width)  iw=img.width-ix;
        if(iy+ih>img.height) ih=img.height-iy;

        const roi=pageMat.roi(new cv.Rect(ix,iy,iw,ih));
        const found=largestQuadRect(roi);
        if(found){
          dctx.strokeRect(ix+found.x, iy+found.y, found.width, found.height);
          reportLines.push(`Card ${idx}: ${found.width}×${found.height} (OpenCV)`);
        }else{
          dctx.strokeRect(bx,by,cellW,cellH);
          reportLines.push(`Card ${idx}: ${Math.round(cellW)}×${Math.round(cellH)} (fallback)`);
        }
        roi.delete();
      }
    }
    pageMat.delete();

    /* ---- build side report ---- */
    const wrapper=document.createElement('div');
    wrapper.style.display='flex'; wrapper.style.gap='12px';
    dbg.style.maxWidth='60%';
    const info=document.createElement('pre');
    info.textContent=reportLines.join('\\n');
    info.style.margin='0'; info.style.fontSize='0.85em';

    wrapper.appendChild(dbg); wrapper.appendChild(info);
    output.appendChild(wrapper);
  };
};