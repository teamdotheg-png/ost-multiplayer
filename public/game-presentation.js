/* Theme independent display state: hint location, winner portraits and toolbar. */
(()=>{
 const stage=document.getElementById('roomArea'),answer=document.getElementById('firstDone');
 const hint=document.getElementById('centerHint');stage.append(hint);
 const badges={};
 for(const [key,parent] of [['game',answer],['song',answer],['bonus',document.getElementById('bonusArea')]]){
  const el=document.createElement('span');el.className='avatar winner-avatar winner-'+key;el.hidden=true;parent.append(el);badges[key]=el;
 }
 let round='',revealedHint='';
 function sync(s){
  if(!s)return;
  const key=s.code+':'+s.index;
  if(key!==round||['lobby','ready','starting','finished'].includes(s.phase)){round=key;revealedHint='';}
  if(s.hint)revealedHint=s.hint;
  const active=s.phase==='playing',fallback=active&&!s.firstWinner&&stage.classList.contains('video-open');
  const central=active&&!s.firstWinner&&!fallback&&!!revealedHint;
  hint.classList.toggle('hidden',!central);hint.replaceChildren();
  hint.style.width=revealedHint.length>18?'720px':'';
  if(central){const label=document.createElement('span');label.className='center-hint-label';label.textContent='초성 힌트';const copy=document.createElement('strong');copy.textContent=revealedHint;hint.append(label,copy);}
  document.getElementById('answerHint').classList.toggle('hidden',!fallback);
  document.getElementById('answerHint').textContent=fallback?'힌트 : '+(revealedHint||'???'):'';
  answer.classList.toggle('hint-fallback',fallback);
  for(const [key,name] of [['game',s.firstWinner],['song',s.songWinner],['bonus',s.bonusWinner]]){
   const player=s.players.find(p=>p.name===name),el=badges[key];el.hidden=!player||!['playing','complete-wait','reveal'].includes(s.phase);
   if(player){paintAvatar(el,player.avatar);el.title=player.name+' · 정답';el.setAttribute('aria-label',player.name+' 정답');}
   if(key!=='bonus')document.getElementById(key==='game'?'answerMain':'songAnswerLine').classList.toggle('has-winner',!el.hidden);
   else document.getElementById('bonusAnswerInline').classList.toggle('has-winner',!el.hidden);
  }
  for(const id of ['editAnswer','trashCurrent']){const el=document.getElementById(id);el.classList.remove('hidden');el.disabled=s.host!==socket.id||!active;el.title=s.host!==socket.id?'방장 전용':!active?'다음 문제 시작 후 사용 가능':'';}
  const play=document.getElementById('playMusic');play.dataset.label=s.paused?'재생':'일시정지';
 }
 const original=setVideoVisible;setVideoVisible=function(show){original(show);sync(state);};
 socket.on('room',sync);
 socket.on('hint',text=>{revealedHint=text||'';sync(state);});
 // Preserve the original socket actions while exposing readable rectangular controls.
 document.getElementById('hostSkip').innerHTML='<span aria-hidden="true">▶|</span><span class="control-caption">다음 라운드</span>';
 const previous=stage.querySelector('.controller-prev');previous.textContent='|◀';previous.title='이전 문제';
})();
