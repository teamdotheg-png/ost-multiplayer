/* Theme reference artboards scale as a whole, including their bottom toolbar. */
(()=>{
 'use strict';
 const stage=document.getElementById('roomArea');
 const bottom=document.createElement('nav');bottom.id='bottomBar';bottom.setAttribute('aria-label','게임 조작');
 bottom.append(document.getElementById('roomFixedActions'),stage.querySelector('.controls'));stage.append(bottom);
 socket.on('room',s=>stage.classList.toggle('is-host',s.host===socket.id));
 const viewport=document.createElement('div');viewport.id='gameViewport';
 stage.before(viewport);viewport.append(stage);
 function fitStage(){
  const height=document.body.dataset.theme==='rooftop'?868:900;
  const scale=Math.min(window.innerWidth/1920,window.innerHeight/height);
  stage.style.setProperty('--stage-height',height+'px');
  stage.style.setProperty('--stage-scale',String(scale));
  viewport.classList.toggle('in-game',!stage.classList.contains('hidden'));
 }
 window.addEventListener('resize',fitStage);
 document.addEventListener('fullscreenchange',fitStage);
 new MutationObserver(fitStage).observe(stage,{attributes:true,attributeFilter:['class']});
 fitStage();
 const optimize=document.createElement('button');optimize.id='optimizeScreen';optimize.type='button';
 optimize.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg><span>화면 최적화</span>';optimize.title='전체 화면에서 비율을 유지해 최대 크기로 표시';
 document.getElementById('personalClose').before(optimize);
 optimize.onclick=async()=>{
  document.getElementById('personalDialog').close();
  optimize.disabled=true;
  try{
   if(!document.fullscreenElement&&document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();
   fitStage();
  }catch{status('전체 화면이 제한되어 현재 창 크기에 맞췄습니다. F11로도 전체 화면을 사용할 수 있습니다.');fitStage();}
  finally{optimize.disabled=false;}
 };
 const expand=document.createElement('dialog');expand.id='textDetail';
 const fullText=document.createElement('p'),close=document.createElement('button');
 close.textContent='닫기';close.onclick=()=>expand.close();expand.append(fullText,close);document.body.append(expand);
 // Measure with the browser's text layout, matching the live font's spacing exactly.
 const measureProbe=document.createElement('span');
 measureProbe.setAttribute('aria-hidden','true');
 measureProbe.style.cssText='position:fixed;left:-10000px;top:0;display:inline-block;white-space:nowrap;visibility:hidden;width:max-content;max-width:none;';
 document.body.append(measureProbe);
 let cache=new WeakMap();
 const ids=['answerHint','answerMain','songAnswerLine','bonusPrompt','bonusAnswerInline'];
 function fitCopy(el){
  if(!el||!el.getClientRects().length)return;
  let text=el.textContent.replace(/\s+/g,' ').trim();
  if(el.id==='bonusAnswerInline'&&text&&!/^정답\s*:/.test(text))text='정답 : '+text;
  const style=getComputedStyle(el),before=getComputedStyle(el,'::before');
  let width=el.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
  if(before.content!=='none'&&before.display!=='none'&&el.classList.contains('answer-line'))width-=parseFloat(before.width)||0,width-=parseFloat(style.columnGap)||0;
  const height=el.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
  if(width<1||height<1)return;
  const key=text+'|'+width+'|'+height+'|'+document.body.dataset.theme;
  if(cache.get(el)===key)return;cache.set(el,key);
  if(!text){el.replaceChildren();el.classList.remove('has-copy');return;}
  el.classList.add('has-copy');
  const isPrompt=el.id==='bonusPrompt',maxLines=isPrompt?4:2;
  const base=parseFloat(style.fontSize)||22,min=isPrompt?18:20,lineHeight=1.34;
  const words=text.split(' ');
  function measure(s,size){
   measureProbe.style.font=`${style.fontWeight} ${size}px ${style.fontFamily}`;
   measureProbe.style.letterSpacing=style.letterSpacing;
   measureProbe.textContent=s;
   return measureProbe.getBoundingClientRect().width+1;
  }
  function layout(size){
   if(measure(text,size)<=width)return [text];
   if(maxLines===2){
    let best=null,cost=Infinity;
    for(let i=2;i<words.length;i++){
     const a=words.slice(0,i).join(' '),b=words.slice(i).join(' '),wa=measure(a,size),wb=measure(b,size);
     const c=Math.max(wa,wb)+Math.abs(wa-wb)*.25;
     if(wa<=width&&wb<=width&&c<cost){best=[a,b];cost=c;}
    }
    return best;
   }
   const lines=[];let line='';
   for(const word of words){
    if(measure(word,size)>width)return null;
    const next=line?line+' '+word:word;
    if(line&&measure(next,size)>width){lines.push(line);line=word;}else line=next;
   }
   if(line)lines.push(line);return lines.length<=maxLines?lines:null;
  }
  let result=null,size=base;
  for(;size>=min;size--){const lines=layout(size);if(lines&&lines.length*size*lineHeight<=height){result=lines;break;}}
  const copy=document.createElement('span');copy.className='fit-copy';copy.style.fontSize=Math.max(size,min)+'px';copy.style.lineHeight=String(lineHeight);
  copy.style.maxHeight=height+'px';copy.style.width=width+'px';
  if(result)copy.textContent=result.join('\n');else{copy.textContent=text;copy.classList.add('overflow-copy');}
  el.replaceChildren(copy);el.title=text;el.dataset.fullText=text;el.tabIndex=0;
  el.onclick=()=>{fullText.textContent=el.dataset.fullText;expand.showModal();};
  el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}};
 }
 let frame=0;
 function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>ids.forEach(id=>fitCopy(document.getElementById(id))));}
 const observer=new MutationObserver(schedule);
 ids.forEach(id=>observer.observe(document.getElementById(id),{childList:true,subtree:true,characterData:true}));
 new MutationObserver(()=>{fitStage();schedule();}).observe(document.body,{attributes:true,attributeFilter:['data-theme']});
 function fontsLoaded(){cache=new WeakMap();schedule();}
 document.fonts.ready.then(fontsLoaded);document.fonts.addEventListener('loadingdone',fontsLoaded);
 window.addEventListener('resize',schedule);schedule();
})();
