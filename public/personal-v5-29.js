const avatarIds=[16,18,20,21,23,29,31,35,39,41,43,56,58,61,68,74,88,94,97];
const avatarNames=['시로','유키','세라','하루','미오','리나','모모','아오','아카네','레이','히나','루나','유이','스이','코하루','아야','노아','미츠키','카렌'];
const personalColors=['#80e8ff','#ffb4d9','#c8b5ff','#a6f2bc','#ffdc88','#ffa993','#9bbcff','#e0f28d','#7fdfc8','#edb0f3','#163b66','#783552','#503281','#24523b','#714c16','#853c29','#293d85','#47551b','#145951','#66346d'];
let personal={theme:'rooftop',volume:70};try{personal={...personal,...JSON.parse(localStorage.getItem('ost-personal')||'{}')};}catch{}
function paintAvatar(el,id){let i=avatarIds.indexOf(id);if(i<0)i=0;el.textContent='';el.style.setProperty('background-image','url(/avatars.webp)','important');el.style.setProperty('background-size','500% 400%','important');el.style.setProperty('background-position',`${i%5*25}% ${Math.floor(i/5)*100/3}%`,'important');el.setAttribute('aria-label',avatarNames[i]);}
function savePersonal(){personal.volume=Math.max(0,Math.min(100,Number(personal.volume)||0));try{localStorage.setItem('ost-personal',JSON.stringify(personal));}catch{}document.body.dataset.theme=['cafe','rooftop','retro'].includes(personal.theme)?personal.theme:'cafe';try{yt?.setVolume(personal.volume);}catch{}try{Object.values(sfxCache).forEach(a=>a.volume=personal.volume/100);}catch{}}
savePersonal();
const personalDialog=document.createElement('dialog');personalDialog.id='personalDialog';personalDialog.innerHTML='<header><button id="personalTab">개인 설정</button><button id="roomTab">방 설정</button><button id="personalClose" aria-label="닫기">×</button></header><section id="personalPane"><h3>테마</h3><div id="themeChoices"></div><h3>SD 캐릭터</h3><div id="avatarChoices"></div><h3>닉네임 · 채팅 색상</h3><div id="colorChoices"></div><h3>음량 <output id="volumeValue"></output></h3><input id="personalVolume" aria-label="음량" type="range" min="0" max="100"><p>캐릭터와 색상은 다른 참가자와 같게 선택해도 됩니다.</p></section>';
document.body.append(personalDialog);
// Group existing controls for the P-S06 layout without changing their handlers.
const settingsPane=document.getElementById('personalPane')||personalDialog.querySelector('#personalPane');
for(const [id,items] of [['personalThemeGroup',['themeChoices']],['personalCharacterGroup',['avatarChoices']],['personalColorGroup',['colorChoices']],['personalVolumeGroup',['personalVolume']]]){
 const group=document.createElement('section');group.id=id;group.className='personal-group';
 for(const itemId of items){const item=personalDialog.querySelector('#'+itemId);group.append(item.previousElementSibling,item);}
 settingsPane.append(group);
}
const selectedPreview=document.createElement('aside');selectedPreview.id='personalSelectedPreview';selectedPreview.innerHTML='<button id="selectedAvatar" type="button" aria-label="선택한 캐릭터 크게 보기"></button><strong id="selectedAvatarName"></strong><span>클릭하면 크게 볼 수 있어요</span>';settingsPane.append(selectedPreview);
const personalNote=settingsPane.querySelector('p');personalNote.className='personal-note';settingsPane.append(personalNote);
function refreshSelectedPortrait(id){if(!avatarIds.includes(id))id=avatarIds[0];paintAvatar(document.getElementById('selectedAvatar'),id);document.getElementById('selectedAvatarName').textContent=avatarNames[avatarIds.indexOf(id)];document.getElementById('selectedAvatar').dataset.value=id;}
document.getElementById('selectedAvatar').onclick=()=>previewAvatar(Number(document.getElementById('selectedAvatar').dataset.value));

for(const [id,title] of [['cafe','07 카페 세레나데'],['rooftop','08 노을 옥상'],['retro','13 레트로 연애편지']]){const b=document.createElement('button');b.className='theme-choice';b.textContent=title;b.style.backgroundImage=`linear-gradient(transparent,#151521),url(/${id==='rooftop'?'roof-scene':'skin-'+id}.png)`;b.onclick=()=>{personal.theme=id;savePersonal();refreshPersonal();};b.dataset.value=id;document.getElementById('themeChoices').append(b);}
for(const id of avatarIds){const b=document.createElement('button');b.title=avatarNames[avatarIds.indexOf(id)];b.dataset.value=id;paintAvatar(b,id);b.dataset.name=avatarNames[avatarIds.indexOf(id)];b.onclick=()=>{refreshSelectedPortrait(id);previewAvatar(id);};document.getElementById('avatarChoices').append(b);}
for(const color of personalColors){const b=document.createElement('button');b.style.background=color;b.title=color;b.dataset.value=color;b.onclick=()=>send('appearance',{color},r=>{if(r?.ok){personal.color=color;savePersonal();refreshPersonal();}});document.getElementById('colorChoices').append(b);}
function refreshPersonal(){const me=state?.players.find(p=>p.id===socket.id);refreshSelectedPortrait(me?.avatar||personal.avatar||avatarIds[0]);document.getElementById('roomTab').hidden=state?.host!==socket.id;for(const b of document.querySelectorAll('#themeChoices button'))b.setAttribute('aria-pressed',b.dataset.value===personal.theme);for(const b of document.querySelectorAll('#avatarChoices button'))b.setAttribute('aria-pressed',Number(b.dataset.value)===me?.avatar);for(const b of document.querySelectorAll('#colorChoices button'))b.setAttribute('aria-pressed',b.dataset.value===me?.color);document.getElementById('personalVolume').value=personal.volume;document.getElementById('volumeValue').textContent=personal.volume+'%';}
const hostPane=document.getElementById('lobby');personalDialog.append(hostPane);
function selectSettingsTab(room=false){if(room&&state?.host!==socket.id)return;document.getElementById('personalPane').hidden=room;hostPane.classList.toggle('settings-open',room);hostPane.classList.toggle('hidden',!room);hostPane.style.display=room?'block':'none';document.getElementById('personalTab').setAttribute('aria-pressed',!room);document.getElementById('roomTab').setAttribute('aria-pressed',room);if(room)renderVaultBrowser();}
document.getElementById('settings').onclick=()=>{refreshPersonal();selectSettingsTab(false);personalDialog.showModal();};
document.getElementById('personalClose').onclick=()=>personalDialog.close();
document.getElementById('personalTab').onclick=()=>selectSettingsTab(false);
document.getElementById('roomTab').onclick=()=>selectSettingsTab(true);
document.getElementById('closeSettings').onclick=()=>selectSettingsTab(false);
document.getElementById('personalVolume').oninput=e=>{personal.volume=Number(e.target.value);savePersonal();refreshPersonal();};
personalDialog.addEventListener('close',()=>selectSettingsTab(false));
let appearanceRoom='';socket.on('room',s=>{if(['preparing','starting','finished'].includes(s.phase))personalDialog.close();if(s.host!==socket.id)selectSettingsTab(false);if(appearanceRoom!==s.code){appearanceRoom=s.code;if(personal.avatar||personal.color)send('appearance',{avatar:personal.avatar,color:personal.color});}refreshPersonal();});
const hintNode=document.getElementById('hintCountdown');document.getElementById('roundBadge').after(hintNode);

const rankIcon=document.querySelector('.crown-mark');rankIcon.classList.add('avatar');paintAvatar(rankIcon,23);

// Keep meaningful placeholders in the lobby and during the five-second ready phase.
socket.on('room',s=>{if(['lobby','ready'].includes(s.phase)){document.getElementById('answerMain').textContent='게임제목 : ???';document.getElementById('songAnswerLine').textContent='노래제목 : ???';document.getElementById('answerHint').textContent='힌트 : ???';}});

const avatarPreview=document.createElement('dialog');avatarPreview.id='avatarPreview';avatarPreview.innerHTML='<div id="largeAvatar"></div><p id="avatarNumber"></p><button id="confirmAvatar">이 캐릭터 선택</button><button id="closeAvatar">닫기</button>';document.body.append(avatarPreview);let previewId;
function previewAvatar(id){previewId=id;paintAvatar(document.getElementById('largeAvatar'),id);document.getElementById('avatarNumber').textContent=avatarNames[avatarIds.indexOf(id)]+' · '+String(id).padStart(3,'0');avatarPreview.showModal();}
document.getElementById('closeAvatar').onclick=()=>avatarPreview.close();document.getElementById('confirmAvatar').onclick=()=>send('appearance',{avatar:previewId},r=>{if(r?.ok){personal.avatar=previewId;savePersonal();refreshPersonal();avatarPreview.close();}});
const swatches=document.getElementById('colorChoices');for(const [index,label] of [[0,'밝은색 10종'],[10,'어두운색 10종']]){const heading=document.createElement('div');heading.className='palette-label';heading.textContent=label;swatches.insertBefore(heading,swatches.querySelectorAll('button')[index]);}
