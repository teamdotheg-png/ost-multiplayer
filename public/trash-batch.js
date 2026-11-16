/* Existing administrator authentication; the library itself is never rewritten. */
(()=>{
 'use strict';
 const main=document.getElementById('batchTrash150');
 const restore=document.getElementById('batchTrash150Restore');
 const backup=document.getElementById('batchTrash150Backup');
 const message=document.getElementById('batchTrash150Status');
 if(!main||!restore||!backup||!message)return;
 const base='/api/trash/admin/batch150';
 let busy=false,latest={state:'none'},uncertain=false;
 message.setAttribute('aria-live','polite');
 message.style.color='var(--ink, inherit)';
 message.style.fontWeight='600';

 function say(text){message.textContent=text;}
 function operation(data){const info=data?.operation||data?.result||data||{};return !info.state&&info.applied===true?{...info,state:'applied'}:info;}
 function cachedPassword(){return typeof playedPassword==='string'?playedPassword:'';}
 function updateButtons(){
  const blocked=uncertain||!!(latest.state&&!['none','restored','rolled_back'].includes(latest.state));
  main.disabled=busy||blocked;
  restore.hidden=latest.canRestore!==true;
  backup.hidden=latest.backupAvailable!==true;
  restore.disabled=busy||latest.canRestore!==true;
  backup.disabled=busy||latest.backupAvailable!==true;
 }
 function setBusy(value){busy=value;main.setAttribute('aria-busy',String(value));updateButtons();}
 function remember(data){latest=operation(data);uncertain=false;updateButtons();return latest;}
 function stateText(info){
  if(info.state==='applied')return `재생 차단 곡 ${Number(info.excludedCount??37)}곡이 휴지통에 있습니다. 이번 추가 ${Number(info.insertedCount??info.newCount??0)}곡 · 기존 휴지통 ${Number(info.alreadyCount??0)}곡. 원본과 출제 완료 기록은 유지했습니다.`;
  if(info.state==='restored'||info.state==='rolled_back')return '이번 일괄 이동에서 새로 추가한 항목을 되돌렸습니다. 기존 휴지통과 출제 완료 기록은 유지했습니다.';
  if(['pending','prepared','applying'].includes(info.state))return '이전 일괄 작업의 결과 확인이 필요합니다. 새 이동을 반복하지 말고 출제 이력 새로고침으로 상태를 확인하거나 제공된 되돌리기를 사용하세요.';
  if(info.state==='needs_review')return '다른 관리 작업 또는 복원 충돌이 감지됐습니다. 새 이동을 중지했습니다. 자동 백업을 보관하고 현재 휴지통 상태를 확인하세요.';
  return info.message||(info.state&&info.state!=='none'?'이전 일괄 작업 상태를 확인해야 합니다. 새 이동을 중지했으니 출제 이력 새로고침으로 다시 확인하세요.':'');
 }
 async function request(path,method='GET',body,interactive=true){
  const password=interactive?await playedAuth():cachedPassword();
  if(!password)throw Object.assign(new Error('기존 출제 이력 관리자 인증이 필요합니다.'),{status:403});
  const response=await fetch(base+path,{method,headers:{'x-admin-password':password,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let data;
  try{data=await response.json();}catch{
   throw Object.assign(new Error(response.status===404?'일괄 관리 기능 파일이 아직 배포되지 않았습니다. 필요한 파일을 함께 배포한 뒤 새로고침하세요.':'관리 서버 응답을 확인할 수 없습니다.'),{status:response.status});
  }
  if(!response.ok){
   if(response.status===403)playedPassword='';
   throw Object.assign(new Error(data.error||data.message||'일괄 관리 요청에 실패했습니다.'),{status:response.status,data});
  }
  return data;
 }
 async function refreshStatus(interactive=false){
  const info=remember(await request('/status','GET',undefined,interactive));
  const text=stateText(info);if(text)say(text);
  return info;
 }
 function collectBrowser(){
  const raw=localStorage.getItem(KEY);
  let stored;try{stored=JSON.parse(raw||'null');}catch{throw Error('저장된 문제 원본을 읽을 수 없습니다. 원본을 초기화하지 말고 백업 상태를 확인하세요.');}
  if(!Array.isArray(stored)||stored.length!==1065||!Array.isArray(questions)||questions.length!==1065)throw Error('실제 원본 1,065곡을 저장한 관리자 브라우저에서 실행하세요.');
  const memory=JSON.stringify(questions);
  if(memory!==JSON.stringify(stored))throw Error('현재 문제 목록과 저장 원본이 다릅니다. 변경 사항의 저장 상태를 확인한 뒤 다시 시도하세요.');
  const snapshot=store=>Object.fromEntries(Array.from({length:store.length},(_,i)=>store.key(i)).map(key=>[key,store.getItem(key)]));
  return {storageRaw:raw,memoryRaw:memory,browser:{questions:JSON.parse(memory),localStorage:snapshot(localStorage),sessionStorage:snapshot(sessionStorage),roomSnapshot:typeof state==='object'&&state?JSON.parse(JSON.stringify(state)):null}};
 }
 function stillCurrent(snapshot){return snapshot.storageRaw===localStorage.getItem(KEY)&&snapshot.memoryRaw===JSON.stringify(questions);}
 function checkPreview(preview){
  if(preview.matched!==37||preview.total!==1065||!Array.isArray(preview.targets)||preview.targets.length!==37||Number(preview.newCount)+Number(preview.alreadyCount)!==37||!preview.previewId||!preview.libraryHash)throw Error('37곡 대조 결과가 올바르지 않아 적용을 중지했습니다.');
  if(new Set(preview.targets.map(target=>target.videoId)).size!==37||preview.targets.some(target=>!/^[\w-]{11}$/.test(target.videoId||'')))throw Error('중복되거나 잘못된 대상 ID가 있어 적용을 중지했습니다.');
 }
 function previewDialog(preview){
  return new Promise(resolve=>{
   const dialog=document.createElement('dialog');dialog.setAttribute('aria-labelledby','batch150PreviewTitle');
   Object.assign(dialog.style,{width:'min(860px,92vw)',maxHeight:'82vh',overflow:'auto',background:'var(--paper, #102033)',color:'var(--ink, #edf6ff)',border:'1px solid var(--edge, #79a9cc)',borderRadius:'12px',padding:'20px'});
   const title=document.createElement('h3');title.id='batch150PreviewTitle';title.tabIndex=-1;title.textContent='재생 차단 37곡 휴지통 이동 미리보기';
   const summary=document.createElement('p');summary.textContent=`원본 ${preview.total}곡 대조 완료 · 신규 이동 ${preview.newCount}곡 · 기존 휴지통 ${preview.alreadyCount}곡`;
   const detail=document.createElement('p');detail.textContent='적용 전에 전체 원본·설정과 서버 데이터를 자동 백업합니다. 정상 1,028곡과 출제 완료 기록은 변경하지 않습니다. 새 선정부터 제외됩니다.';
   const table=document.createElement('table');table.style.width='100%';table.style.borderCollapse='collapse';
   const head=document.createElement('thead'),header=document.createElement('tr');
   for(const text of ['번호','작품명 / 노래 제목','영상 ID','재생 구간','변경']){const cell=document.createElement('th');cell.textContent=text;cell.style.textAlign='left';cell.style.padding='6px';header.append(cell);}
   head.append(header);table.append(head);const body=document.createElement('tbody');
   preview.targets.forEach((target,index)=>{
    const row=document.createElement('tr');
    for(const value of [index+1,`${target.gameTitle||''} / ${target.songTitle||''}`,target.videoId,`${target.startTime} ~ ${target.endTime}초`,target.alreadyTrashed?'기존 상태 유지':'휴지통에 추가']){
     const cell=document.createElement('td');cell.textContent=String(value);cell.style.padding='6px';cell.style.borderBottom='1px solid var(--edge, #36516a)';row.append(cell);
    }
    body.append(row);
   });table.append(body);
   const list=document.createElement('div');list.style.maxHeight='48vh';list.style.overflow='auto';list.append(table);
   const note=document.createElement('p');note.textContent='백업에는 설정과 재접속 정보가 포함될 수 있습니다. 다운로드한 백업은 비공개로 보관하세요.';
   const actions=document.createElement('div');actions.style.display='flex';actions.style.justifyContent='flex-end';actions.style.gap='10px';actions.style.marginTop='14px';
   const cancel=document.createElement('button');cancel.type='button';cancel.textContent='취소';
   const apply=document.createElement('button');apply.id='batch150Confirm';apply.type='button';apply.textContent='백업 후 37곡 휴지통 이동';
   actions.append(cancel,apply);dialog.append(title,summary,detail,list,note,actions);document.body.append(dialog);
   let settled=false;
   const finish=value=>{if(settled)return;settled=true;if(dialog.open&&typeof dialog.close==='function')dialog.close();dialog.remove();resolve(value);};
   cancel.addEventListener('click',()=>finish(false));
   apply.addEventListener('click',()=>{apply.disabled=true;cancel.disabled=true;finish(true);});
   dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
   dialog.addEventListener('close',()=>finish(false));
   if(typeof dialog.showModal==='function')dialog.showModal();else{dialog.setAttribute('open','');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');}
   title.focus({preventScroll:true});dialog.scrollTop=0;
  });
 }
 async function downloadBackup(interactive=true){
  const data=await request('/backup','GET',undefined,interactive);
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='ost-before-batch150-'+Date.now()+'.json';link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
 }
 async function refreshVault(){try{await refreshPlayed();return '';}catch{return ' 휴지통 목록 새로고침에 실패했습니다. 출제 이력 새로고침을 눌러 다시 확인하세요.';}}
 async function showApplied(info,automaticDownload){
  remember(info);let text=stateText(latest);text+=await refreshVault();
  if(automaticDownload&&latest.backupAvailable===true){try{await downloadBackup(false);text+=' 서버에 자동 백업을 보관했고 사본 다운로드를 요청했습니다.';}catch{text+=' 서버 자동 백업은 보관돼 있습니다. 백업 다운로드 버튼으로 사본을 받을 수 있습니다.';}}
  say(text);
 }
 async function reconcile(error){
  if(error.status===403){say('관리자 인증에 실패했습니다. 기존 출제 이력 관리자 인증을 다시 확인하세요.');return;}
  try{
   const info=await refreshStatus(false);
   if(info.state==='applied'){await showApplied(info,true);return;}
   const text=stateText(info);
   say(text||error.message);
  }catch{
   uncertain=true;updateButtons();say(error.message+' 서버 결과를 확인하지 못했습니다. 이동을 반복하지 말고 출제 이력 새로고침으로 상태를 다시 확인하세요.');
  }
 }

 main.addEventListener('click',async()=>{
  if(busy)return;setBusy(true);
  try{
   say('관리자 인증과 이전 일괄 작업 상태를 확인하는 중입니다…');
   const password=await playedAuth();if(!password){say('관리자 인증이 취소됐습니다.');return;}
   const current=await refreshStatus(false);
   if(current.state&&!['none','restored','rolled_back'].includes(current.state)){say(stateText(current));return;}
   const snapshot=collectBrowser();say('원본 1,065곡과 재생 차단 37곡을 대조하는 중입니다…');
   const preview=await request('/preview','POST',{browser:snapshot.browser},false);checkPreview(preview);
   if(!stillCurrent(snapshot))throw Error('미리보기 중 원본 문제 목록이 바뀌었습니다. 변경 없이 중지했으니 다시 대조하세요.');
   if(!await previewDialog(preview)){say('일괄 이동을 취소했습니다. 저장 데이터는 변경하지 않았습니다.');return;}
   if(!stillCurrent(snapshot))throw Error('확인 전 원본 문제 목록이 바뀌었습니다. 적용하지 않았으니 다시 대조하세요.');
   if(preview.expiresAt&&Date.now()>=new Date(preview.expiresAt).getTime())throw Error('미리보기 유효 시간이 지났습니다. 적용하지 않았으니 다시 대조하세요.');
   say('전체 데이터를 자동 백업한 뒤 휴지통에 추가하고 있습니다. 잠시 기다려 주세요…');
   const result=operation(await request('/apply','POST',{previewId:preview.previewId,libraryHash:preview.libraryHash},false));
   if(result.state==='applied'||result.applied===true)await showApplied(result,true);
   else{remember(result);say(stateText(result)||'일괄 작업 상태를 확인하세요.');}
  }catch(error){await reconcile(error);}
  finally{setBusy(false);}
 });
 restore.addEventListener('click',async()=>{
  if(busy||latest.canRestore!==true)return;
  const count=Number(latest.insertedCount??latest.newCount??0);
  if(!confirm(`이번 일괄 이동에서 새로 추가한 ${count}곡만 되돌릴까요? 기존 휴지통과 출제 완료 기록은 유지합니다.`))return;
  setBusy(true);say('이번 작업이 추가한 항목만 되돌리는 중입니다…');
  try{const info=remember(await request('/restore','POST',{}));say((stateText(info)||'복원 상태를 확인하세요.')+await refreshVault());}
  catch(error){await reconcile(error);}
  finally{setBusy(false);}
 });
 backup.addEventListener('click',async()=>{
  if(busy)return;setBusy(true);
  try{await downloadBackup();say('자동 백업 사본을 다운로드했습니다. 재접속 정보가 포함될 수 있으니 비공개로 보관하세요.');}
  catch(error){say(error.message);}
  finally{setBusy(false);}
 });
 document.getElementById('playedRefresh')?.addEventListener('click',()=>{
  setTimeout(()=>{if(!busy&&cachedPassword())refreshStatus(false).catch(error=>say(error.message));},0);
 });
 updateButtons();
})();
