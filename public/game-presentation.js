/* Theme independent display state: hint location, winner portraits and toolbar. */
(()=>{
 const stage=document.getElementById('roomArea'),answer=document.getElementById('firstDone');
 const hint=document.getElementById('centerHint');stage.append(hint);
 const videoTitle=document.createElement('div');videoTitle.id='videoFrameTitle';videoTitle.innerHTML='<span>NOW LOADING</span>';document.getElementById('videoFrame').append(videoTitle);
 const badges={};
 for(const [key,parent] of [['game',answer],['song',answer],['bonus',document.getElementById('bonusArea')]]){
  const el=document.createElement('span');el.className='avatar winner-avatar winner-'+key;el.hidden=true;parent.append(el);badges[key]=el;
 }
 const lockMessage=document.createElement('p');lockMessage.id='hiddenLockMessage';lockMessage.textContent='게임제목을 맞히면 공개됩니다';document.getElementById('bonusArea').append(lockMessage);
 let round='',revealedHint='';
 function fitCentralHint(){
  if(hint.classList.contains('hidden'))return;
  const copy=hint.querySelector('strong');if(!copy)return;
  copy.style.fontSize='34px';hint.style.width='384px';
  const maxWidth=Math.max(384,Math.floor(stage.clientWidth*.423));
  hint.style.width=Math.min(maxWidth,Math.max(384,copy.scrollWidth+134))+'px';
  for(let size=34;size>18&&copy.scrollWidth>copy.clientWidth+1;size--)copy.style.fontSize=(size-1)+'px';
 }
 document.fonts.ready.then(fitCentralHint);
 function sync(s){
  if(!s)return;
  const key=s.code+':'+s.index;
  if(key!==round||['lobby','preparing','ready','starting','finished'].includes(s.phase)){round=key;revealedHint='';}
  if(s.hint&&!revealedHint)revealedHint=s.hint;
  const active=s.phase==='playing',fallback=active&&!s.firstWinner&&stage.classList.contains('video-open');
  const central=active&&!s.firstWinner&&!fallback&&!!revealedHint;
  hint.classList.toggle('hidden',!central);hint.replaceChildren();
  hint.style.width='384px';
  if(central){const label=document.createElement('span');label.className='center-hint-label';label.textContent='초성 힌트';const copy=document.createElement('strong');copy.textContent=revealedHint;const line=document.createElement('div');line.className='center-hint-line';const icon=document.createElement('span');icon.className='center-hint-icon';icon.setAttribute('aria-hidden','true');line.append(icon,copy);hint.append(label,line);requestAnimationFrame(fitCentralHint);}
  document.getElementById('answerHint').classList.toggle('hidden',!fallback);
  document.getElementById('answerHint').textContent=fallback?'힌트 : '+(revealedHint||'???'):'';
  answer.classList.toggle('hint-fallback',fallback);
  for(const [key,name] of [['game',s.firstWinner],['song',s.songWinner],['bonus',s.bonusWinner]]){
   const player=s.players.find(p=>p.name===name),el=badges[key];el.hidden=!player||!['playing','complete-wait','reveal'].includes(s.phase);
   if(player){paintAvatar(el,player.avatar);el.title=player.name+' · 정답';el.setAttribute('aria-label',player.name+' 정답');}
   if(key!=='bonus')document.getElementById(key==='game'?'answerMain':'songAnswerLine').classList.toggle('has-winner',!el.hidden);
   else document.getElementById('bonusAnswerInline').classList.remove('has-winner');
  }
  for(const id of ['editAnswer','trashCurrent']){const el=document.getElementById(id);el.classList.remove('hidden');el.disabled=s.host!==socket.id||!active;el.title=s.host!==socket.id?'방장 전용':!active?'다음 문제 시작 후 사용 가능':'';}
  if(!['playing','complete-wait','reveal'].includes(s.phase))document.getElementById('bonusAnswerInline').textContent='정답 : ???';
  const play=document.getElementById('playMusic');play.dataset.label=s.paused?'재생':'일시정지';
 }
 const original=setVideoVisible;setVideoVisible=function(show){original(show);sync(state);};
 socket.on('room',sync);
 socket.on('hint',text=>{revealedHint=text||'';sync(state);});
 // Preserve the original socket actions while exposing readable rectangular controls.
 document.getElementById('hostSkip').innerHTML='<span aria-hidden="true">▶|</span><span class="control-caption">다음 라운드</span>';
 // Keep the invite code handler available to old integrations, but remove its toolbar slot.
 const invite=document.getElementById('copyCode');invite.hidden=false;invite.textContent='초대 코드 복사';document.getElementById('roomTab').after(invite);stage.querySelector('.controller-prev').remove();
})();
