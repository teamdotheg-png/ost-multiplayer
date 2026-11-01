/* The server owns phase deadlines; effects only display them. */
(()=>{
 const stage=document.getElementById('roomArea'),title=document.getElementById('videoFrameTitle');
 const opening=document.createElement('section');opening.id='gameOpening';opening.className='hidden';opening.setAttribute('aria-label','게임 시작');
 opening.innerHTML='<p class="opening-notice" aria-live="polite"></p><div class="opening-circle"><img class="opening-ring" src="/opening-ring.png" alt=""><div class="opening-digit" role="img"></div><div class="opening-orbit"><img src="/paper-plane.png" alt=""></div></div>';
 stage.append(opening);
 const notice=opening.querySelector('.opening-notice'),circle=opening.querySelector('.opening-circle'),digit=opening.querySelector('.opening-digit'),orbit=opening.querySelector('.opening-orbit');
 title.innerHTML='<span class="video-title-copy">NOW LOADING</span><span class="video-title-plane" aria-hidden="true"></span><span class="video-title-eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>';
 const copy=title.querySelector('.video-title-copy'),plane=title.querySelector('.video-title-plane');
 let openingTimer=null,openingState=null,openingKey='',beeps=new Set(),mediaPlaying=false,titleStarted=false,titleTimer=null,titleFlight=null;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 ['opening-ring.png','opening-digits.svg','paper-plane.png'].forEach(src=>{const image=new Image();image.src='/'+src;});
 function stopOpening(){clearInterval(openingTimer);openingTimer=null;openingState=null;openingKey='';beeps.clear();opening.classList.add('hidden');stage.classList.remove('opening-active');}
 function drawOpening(){
  const s=openingState;if(!s)return;
  const rem=Math.max(0,s.introUntil-serverNow());
  opening.dataset.phase=s.phase;
  notice.textContent=s.phase==='preparing'?`${s.total}곡 선정 완료`:`${s.total}곡 준비 완료`;
  circle.hidden=s.phase==='preparing';
  if(s.phase==='preparing')return;
  const n=s.phase==='starting'?Math.max(1,Math.min(5,Math.ceil(rem/1000))):'START';
  if(digit.dataset.value!==String(n)){
   digit.dataset.value=String(n);digit.setAttribute('aria-label',String(n));
   const positions={5:'0% 0%',4:'50% 0%',3:'100% 0%',2:'0% 100%',1:'50% 100%',START:'100% 100%'};
   digit.style.backgroundPosition=positions[n];
   if(!reduced.matches)digit.animate([{transform:'scale(.88)',opacity:.3},{transform:'scale(1)',opacity:1}],{duration:280,easing:'ease-out'});
  }
  if(s.phase==='starting'&&rem>0&&!beeps.has(n)){beeps.add(n);playSfx('countdown');}
  const progress=s.phase==='starting'?Math.min(1,Math.max(0,(5000-rem)/5000)):1;
  orbit.style.transform=`rotate(${progress*360}deg)`;
 }
 function syncTitle(){
  const visible=stage.classList.contains('video-open')&&!stage.classList.contains('opening-active');
  if(!visible){clearTimeout(titleTimer);titleTimer=null;titleFlight?.cancel();titleFlight=null;titleStarted=false;title.classList.remove('title-arrived','title-flying','title-playing');copy.textContent='NOW LOADING';return;}
  title.classList.toggle('title-playing',mediaPlaying);
  if(!mediaPlaying||titleStarted)return;
  titleStarted=true;title.classList.add('title-flying');
  const arrive=()=>{if(!titleStarted)return;copy.textContent='NOW PLAYING';title.classList.add('title-arrived');title.classList.remove('title-flying');};
  if(reduced.matches){arrive();return;}
  titleFlight=plane.animate([{transform:'translate(-260px,26px) rotate(-16deg)',opacity:0},{transform:'translate(-140px,-17px) rotate(4deg)',opacity:1,offset:.45},{transform:'translate(0,0) rotate(0deg)',opacity:1}],{duration:1200,easing:'cubic-bezier(.2,.65,.3,1)',fill:'both'});
  titleTimer=setTimeout(arrive,1200);
 }
 function onRoom(s){
  const me=s.players.find(p=>p.id===socket.id),input=document.getElementById('chatInput');
  const color=me?.color||'#80e8ff';input.style.setProperty('--input-player-color',color);input.style.setProperty('--input-bubble',chatBubbleBackground(color));
  const active=['preparing','starting','ready'].includes(s.phase);
  if(active){
   stage.classList.add('opening-active');opening.classList.remove('hidden');openingState=s;
   if(s.phase==='preparing'||(s.phase==='starting'&&openingKey!==s.code+':'+s.introUntil)){beeps.clear();openingKey=s.code+':'+s.introUntil;}
   document.getElementById('roundBadge').textContent=`ROUND 001 / ${s.total}`;
   document.getElementById('remaining').textContent='00:00';document.getElementById('hintCountdown').textContent='';document.getElementById('playMusic').disabled=true;
   drawOpening();if(!openingTimer)openingTimer=setInterval(drawOpening,50);
  }else if(openingState)stopOpening();
  syncTitle();
 }
 window.GameEffects={playback(playing){mediaPlaying=playing;syncTitle();},stopOpening};
 new MutationObserver(syncTitle).observe(stage,{attributes:true,attributeFilter:['class']});
 socket.on('room',onRoom);if(state)onRoom(state);
})();
