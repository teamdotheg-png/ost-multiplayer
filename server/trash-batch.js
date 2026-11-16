'use strict';

const crypto = require('node:crypto');

const STORAGE_BUCKET = 'ost-admin-backups';
const STORAGE_KEY = 'ost-multi-questions-v1';
const PREVIEW_TTL = 15 * 60 * 1000;
const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function failure(message, status = 409, code = 'batch_conflict', extra = {}) {
  return Object.assign(new Error(message), {status, code, ...extra});
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function hash(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
}

function videoId(raw) {
  if (VIDEO_ID.test(String(raw))) return String(raw);
  try {
    const url = new URL(raw);
    const allowed = ['youtu.be', 'www.youtu.be', 'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];
    if (!allowed.includes(url.hostname)) return null;
    const id = url.hostname.endsWith('youtu.be')
      ? url.pathname.split('/')[1]
      : url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1];
    return VIDEO_ID.test(id || '') ? id : null;
  } catch { return null; }
}

// PostgREST normalizes Z to +00:00 and may trim fractional zeros. Keep microseconds.
function timestampKey(raw) {
  const match = String(raw || '').match(/^(\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/);
  if (!match) return null;
  const second = Date.parse(match[1] + match[3]);
  if (!Number.isFinite(second)) return null;
  return new Date(second).toISOString().slice(0, 19) + '.' + (match[2] || '').padEnd(6, '0') + 'Z';
}

function validateManifest(manifest) {
  if (!manifest || !/^[a-zA-Z0-9_-]{1,100}$/.test(manifest.batchId || '')) throw failure('일괄 이동 명세가 올바르지 않습니다.', 503, 'invalid_manifest');
  const targets = manifest.targets || [];
  const normal = manifest.normalVideoIds || [];
  const ids = [...targets.map(item => item.videoId), ...normal];
  if (targets.length !== 37 || normal.length !== 1028 || new Set(ids).size !== 1065 || ids.some(id => !VIDEO_ID.test(id))) {
    throw failure('37곡 명세의 고유 ID를 확인할 수 없습니다.', 503, 'invalid_manifest');
  }
  if (targets.some(item => item.confirmedError !== 150 || item.confirmedAttempts !== 2)) throw failure('재생 차단 검증값이 일치하지 않습니다.', 503, 'invalid_manifest');
}

function validateBrowser(browser, manifest) {
  if (!browser || !Array.isArray(browser.questions) || browser.questions.length !== 1065) throw failure('이 관리자 브라우저에 저장된 전체 1,065곡이 필요합니다.', 400, 'library_mismatch');
  if (browser.origin && browser.origin !== manifest.origin) throw failure('운영 게임 주소가 일치하지 않습니다.', 400, 'origin_mismatch');
  for (const storage of [browser.localStorage, browser.sessionStorage]) {
    if (!storage || typeof storage !== 'object' || Array.isArray(storage) || Object.values(storage).some(value => typeof value !== 'string')) throw failure('브라우저 저장 데이터 형식을 확인해 주세요.', 400, 'invalid_backup');
  }
  let stored;
  try { stored = JSON.parse(browser.localStorage[STORAGE_KEY]); } catch { throw failure('원본 문제 저장 데이터를 읽을 수 없습니다.', 400, 'library_mismatch'); }
  if (stable(stored) !== stable(browser.questions)) throw failure('화면의 문제 목록과 실제 저장 원본이 다릅니다. 저장 상태를 확인해 주세요.', 409, 'library_changed');
  const byId = new Map();
  for (const question of browser.questions) {
    const id = videoId(question.videoUrl);
    if (!id || byId.has(id)) throw failure('유효하지 않거나 중복된 영상 ID가 있습니다.', 400, 'library_mismatch');
    byId.set(id, question);
  }
  const expected = [...manifest.targets.map(item => item.videoId), ...manifest.normalVideoIds];
  if (expected.some(id => !byId.has(id))) throw failure('재생 검사 당시의 1,065곡과 현재 목록의 고유 ID가 다릅니다.', 409, 'library_mismatch');
  for (const target of manifest.targets) {
    const question = byId.get(target.videoId);
    if (question.videoUrl !== target.videoUrl || Number(question.startTime) !== Number(target.startTime) || Number(question.endTime) !== Number(target.endTime) || question.answer !== target.gameTitle || question.songName !== target.songTitle) {
      throw failure('대상 곡의 ID·구간·제목·URL이 다릅니다. ' + target.videoId, 409, 'target_mismatch');
    }
  }
  return hash(JSON.stringify(browser.questions));
}

function createService({manifest, store, repository, roomsSnapshot = () => [], now = () => Date.now(), uuid = () => crypto.randomUUID()}) {
  validateManifest(manifest);
  const manifestHash = hash(manifest);
  const targetIds = manifest.targets.map(item => item.videoId);
  const intentKey = manifest.batchId + '/intent.json';
  const previews = new Map();
  let busy = false;

  async function exclusive(action) {
    if (busy) throw failure('일괄 작업을 처리하고 있습니다. 잠시 후 상태를 확인해 주세요.', 409, 'batch_busy');
    busy = true;
    try { return await action(); } finally { busy = false; }
  }

  async function loadOperation() {
    let intent = await store.get(intentKey);
    if (!intent) return null;
    let generation = 0;
    // New immutable claims permit explicitly confirmed retries after undo.
    for (;;) {
      if (generation >= 100) throw failure('일괄 작업 이력을 확인해 주세요.', 409, 'history_limit');
      const next = await store.get(manifest.batchId + '/intent-' + String(generation + 1).padStart(6, '0') + '.json');
      if (!next) break;
      if (next.previousOperationId !== intent.operationId || next.generation !== generation + 1) throw failure('일괄 작업 연결 이력이 다릅니다.', 409, 'history_conflict');
      intent = next;generation++;
    }
    if (intent.manifestHash !== manifestHash || intent.batchId !== manifest.batchId) throw failure('저장된 일괄 작업의 명세가 다릅니다.', 409, 'manifest_changed');
    const prefix = manifest.batchId + '/';
    const folder = String(intent.backupKey || '').slice(prefix.length).split('/')[0];
    if (!/^[a-f0-9]{32}$/.test(folder) || intent.backupKey !== prefix + folder + '/backup.json' || intent.resultKey !== prefix + folder + '/result.json'
      || !timestampKey(intent.stamp) || !Array.isArray(intent.candidateIds) || new Set(intent.candidateIds).size !== intent.candidateIds.length
      || intent.candidateIds.some(id => !targetIds.includes(id))) throw failure('저장된 작업의 대상·백업 경로를 확인할 수 없습니다.', 409, 'invalid_intent');
    const backup = await store.get(intent.backupKey);
    if (!backup || hash(backup) !== intent.backupHash) throw failure('적용 전 백업의 무결성을 확인할 수 없습니다.', 503, 'backup_unavailable', {recoverable: true});
    if (!Array.isArray(backup.database?.ost_trash_songs) || !Array.isArray(backup.database?.ost_played_songs)
      || validateBrowser(backup.browser, manifest) !== intent.libraryHash) throw failure('저장된 원본 백업을 확인할 수 없습니다.', 409, 'invalid_backup');
    const beforeIds = new Set(backup.database.ost_trash_songs.map(row => row.video_id));
    if (stable(intent.candidateIds.slice().sort()) !== stable(targetIds.filter(id => !beforeIds.has(id)).sort())) throw failure('백업과 복원 대상이 일치하지 않습니다.', 409, 'invalid_intent');
    const result = await store.get(intent.resultKey);
    return {intent, backup, result, generation};
  }

  function ownedRows(intent, trash) {
    const candidateIds = new Set(intent.candidateIds);
    return trash.filter(row => candidateIds.has(row.video_id) && timestampKey(row.trashed_at) === timestampKey(intent.stamp));
  }

  function conflicts(operation, trash) {
    const {intent, result} = operation;
    const current = new Map(trash.map(row => [row.video_id, row]));
    return (result?.insertedIds || []).filter(id => current.has(id) && timestampKey(current.get(id).trashed_at) !== timestampKey(intent.stamp));
  }

  function publicStatus(operation, trash) {
    const {intent, result} = operation;
    const owned = ownedRows(intent, trash);
    const currentIds = new Set(trash.map(row => row.video_id));
    const excludedCount = targetIds.filter(id => currentIds.has(id)).length;
    const conflictIds = conflicts(operation, trash);
    let state = result?.state || 'pending';
    if (conflictIds.length) state = 'needs_review';
    else if (state === 'applied' && excludedCount !== 37) state = 'needs_review';
    else if (['restored', 'rolled_back'].includes(state) && owned.length) state = 'needs_review';
    else if (!result && excludedCount === 37) state = 'applied';
    const canRestore = !['restored', 'rolled_back'].includes(state) && conflictIds.length === 0 && (owned.length > 0 || state === 'pending' || state === 'needs_review');
    return {state, batchId: manifest.batchId, operationId: intent.operationId, matched: 37, total: 1065,
      excludedCount, insertedCount: owned.length, alreadyCount: 37 - intent.candidateIds.length,
      canRestore, backupAvailable: true, conflictIds, createdAt: intent.createdAt,
      finishedAt: result?.finishedAt || null, message: result?.message || null};
  }

  async function status() {
    const operation = await loadOperation();
    if (!operation) return {state: 'none', matched: 37, total: 1065, excludedCount: 0, insertedCount: 0, alreadyCount: 0, canRestore: false, backupAvailable: false};
    return publicStatus(operation, await repository.readTable('ost_trash_songs'));
  }

  async function preview({browser} = {}) {
    const libraryHash = validateBrowser(browser, manifest);
    const operation = await loadOperation();
    const trash = await repository.readTable('ost_trash_songs');
    const ids = new Set(trash.map(row => row.video_id));
    const previewId = String(uuid());
    const expires = now() + PREVIEW_TTL;
    const targets = manifest.targets.map(item => ({...item, alreadyTrashed: ids.has(item.videoId)}));
    for (const [id, entry] of previews) if (entry.expires < now()) previews.delete(id);
    while (previews.size >= 8) previews.delete(previews.keys().next().value);
    previews.set(previewId, {browser: clone(browser), libraryHash, expires, expectedOperationId: operation?.intent.operationId || null, appliedOperationId: null, targetMembership: targets.filter(item => item.alreadyTrashed).map(item => item.videoId).sort()});
    for (const [id, entry] of previews) if (entry.expires < now()) previews.delete(id);
    return {previewId, libraryHash, matched: 37, total: 1065, newCount: targets.filter(item => !item.alreadyTrashed).length,
      alreadyCount: targets.filter(item => item.alreadyTrashed).length, targets, expiresAt: new Date(expires).toISOString()};
  }

  async function captureBackup(browser) {
    const names = [...new Set(await repository.readTableNames())].sort();
    if (!names.includes('ost_trash_songs') || !names.includes('ost_played_songs')) throw failure('휴지통·출제 기록 테이블의 전체 백업 경로를 확인할 수 없습니다.', 503, 'backup_incomplete');
    const tables = {};let bytes = Buffer.byteLength(JSON.stringify(browser));
    for (const name of names) {
      if (!/^ost_[A-Za-z0-9_]+$/.test(name)) throw failure('백업 테이블 이름이 올바르지 않습니다.', 503, 'backup_incomplete');
      tables[name] = clone(await repository.readTable(name));
      bytes += Buffer.byteLength(JSON.stringify(tables[name]));
      if (bytes > MAX_BACKUP_BYTES) throw failure('전체 자동 백업 용량이 안전 한도를 넘었습니다. 데이터는 변경하지 않았습니다.', 503, 'backup_too_large');
    }
    const result = {format: 'ost-admin-batch-backup-v1', batchId: manifest.batchId, manifestHash,
      createdAt: new Date(now()).toISOString(), browser: clone(browser), database: tables,
      roomScores: clone(await roomsSnapshot()), scope: 'browser storage and all exposed public ost_* tables before trash insertion'};
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_BACKUP_BYTES) throw failure('전체 자동 백업 용량이 안전 한도를 넘었습니다. 데이터는 변경하지 않았습니다.', 503, 'backup_too_large');
    return result;
  }

  async function saveResult(operation, state, insertedIds, message) {
    const result = {state, insertedIds, message, finishedAt: new Date(now()).toISOString()};
    const saved = await store.put(operation.intent.resultKey, result, {createOnly: false});
    if (!saved) throw failure('일괄 작업 결과 저장을 확인할 수 없습니다.', 503, 'backup_unavailable', {recoverable: true});
    operation.result = result;
    return result;
  }

  async function protectedRowsUnchanged(operation, trash) {
    const current = new Map(trash.map(row => [row.video_id, row]));
    for (const row of operation.backup.database.ost_trash_songs) {
      if (stable(current.get(row.video_id)) !== stable(row)) throw failure('기존 휴지통 항목에 다른 변경이 감지됐습니다.', 409, 'trash_changed');
    }
    const currentPlayed = new Set((await repository.readTable('ost_played_songs')).map(row => row.video_id));
    if (operation.backup.database.ost_played_songs.some(row => !currentPlayed.has(row.video_id))) throw failure('기존 출제 완료 기록의 변경이 감지됐습니다.', 409, 'played_changed');
  }

  async function undoOwned(operation, automatic) {
    let trash = await repository.readTable('ost_trash_songs');
    const conflictIds = conflicts(operation, trash);
    if (!automatic && conflictIds.length) throw failure('이후 다시 휴지통 처리된 곡이 있습니다. 해당 변경을 보호하기 위해 복원을 중지했습니다.', 409, 'restore_conflict', {conflictIds});
    const ours = ownedRows(operation.intent, trash).map(row => row.video_id);
    if (ours.length) {
      try { await repository.deleteTrash(ours, operation.intent.stamp); }
      catch (error) {
        // The DELETE may have committed before a connection failed.
        const reconciled = await repository.readTable('ost_trash_songs');
        if (ownedRows(operation.intent, reconciled).length) throw error;
      }
    }
    trash = await repository.readTable('ost_trash_songs');
    if (ownedRows(operation.intent, trash).length) throw failure('복원이 아직 확인되지 않았습니다. 저장된 백업으로 상태를 다시 확인해 주세요.', 503, 'rollback_unverified', {recoverable: true});
    if (conflicts(operation, trash).length) throw failure('다른 관리 작업과 겹친 곡이 있어 확인이 필요합니다.', 409, 'restore_conflict', {recoverable: true});
    await saveResult(operation, automatic ? 'rolled_back' : 'restored', operation.result?.insertedIds || ours,
      automatic ? '오류가 발생해 이번 작업이 추가한 휴지통 항목을 되돌렸습니다.' : '이번 일괄 이동이 새로 추가한 항목을 복원했습니다.');
    return publicStatus(operation, trash);
  }

  async function apply({previewId, libraryHash} = {}) {
    return exclusive(async () => {
      const plan = previews.get(previewId);
      if (!plan || plan.expires < now()) throw failure('미리보기 시간이 지났습니다. 목록을 다시 확인해 주세요.', 409, 'preview_expired');
      if (plan.libraryHash !== libraryHash) throw failure('확인한 문제 원본과 요청이 다릅니다.', 409, 'library_changed');
      let operation = await loadOperation();
      const closed = operation && ['restored', 'rolled_back'].includes(operation.result?.state);
      if (closed && (plan.appliedOperationId || plan.expectedOperationId !== operation.intent.operationId)) throw failure('이전 확인 요청은 다시 실행할 수 없습니다. 새 미리보기에서 확인해 주세요.', 409, 'batch_restored');
      if (operation && !closed && plan.appliedOperationId !== operation.intent.operationId) throw failure('다른 일괄 작업이 시작됐습니다. 현재 상태를 다시 확인해 주세요.', 409, 'preview_stale', {recoverable:true});
      if (operation && !closed && operation.intent.libraryHash !== libraryHash) throw failure('기존 일괄 작업의 원본 백업과 현재 목록이 다릅니다.', 409, 'library_changed');
      if (!operation && (plan.expectedOperationId || plan.appliedOperationId)) throw failure('이전 작업을 확인할 수 없습니다.', 409, 'history_conflict');
      let createdHere = false;
      if (!operation || closed) {
        const previousOperation = operation;
        const backup = await captureBackup(plan.browser);
        const beforeTrashIds = new Set(backup.database.ost_trash_songs.map(row => row.video_id));
        await store.ensurePrivate();
        const operationId = String(uuid());
        const suffix = String(1 + parseInt(hash(operationId).slice(0,6), 16) % 999).padStart(3, '0');
        const stamp = new Date(now()).toISOString().replace(/Z$/, suffix + 'Z');
        const safeId = hash(operationId).slice(0, 32);
        const backupKey = manifest.batchId + '/' + safeId + '/backup.json';
        const backupHash = hash(backup);
        const saved = await store.put(backupKey, backup, {createOnly: true});
        if (!saved || hash(await store.get(backupKey)) !== backupHash) throw failure('적용 전 자동 백업 저장을 확인할 수 없습니다.', 503, 'backup_unavailable');
        const intent = {version:1, batchId:manifest.batchId, operationId, manifestHash, libraryHash,
          createdAt: new Date(now()).toISOString(), stamp, backupKey, backupHash,
          resultKey: manifest.batchId + '/' + safeId + '/result.json', candidateIds: targetIds.filter(id => !beforeTrashIds.has(id)),
          previousOperationId: previousOperation?.intent.operationId || null, generation: previousOperation ? previousOperation.generation + 1 : 0};
        const claimKey = previousOperation ? manifest.batchId + '/intent-' + String(intent.generation).padStart(6, '0') + '.json' : intentKey;
        const claimed = await store.put(claimKey, intent, {createOnly: true});
        operation = await loadOperation();
        if (!operation || operation.intent.libraryHash !== libraryHash) throw failure('기존 일괄 작업을 확인할 수 없습니다.', 409, 'batch_conflict');
        if (!claimed || operation.intent.operationId !== operationId) throw failure('다른 확인 요청이 먼저 처리됐습니다. 현재 상태를 확인해 주세요.', 409, 'preview_stale', {recoverable:true});
        plan.appliedOperationId = operationId;createdHere = true;
      }
      let trash = await repository.readTable('ost_trash_songs');
      const prior = publicStatus(operation, trash);
      if (prior.state === 'needs_review') throw failure('저장된 작업의 휴지통 상태를 먼저 확인해 주세요.', 409, 'batch_changed', {recoverable: true});
      if (prior.state === 'applied') {
        if (!operation.result) await saveResult(operation, 'applied', ownedRows(operation.intent, trash).map(row => row.video_id), '37곡 제외를 확인했습니다.');
        return publicStatus(operation, trash);
      }
      if (!createdHere) throw failure('이전 작업의 결과 확인 또는 복원이 필요합니다.', 409, 'recovery_required', {recoverable:true});
      try {
        if (operation.intent.candidateIds.length) await repository.insertTrash(operation.intent.candidateIds, operation.intent.stamp);
        trash = await repository.readTable('ost_trash_songs');
        if (targetIds.some(id => !trash.some(row => row.video_id === id))) throw failure('37곡 전체의 휴지통 반영을 확인할 수 없습니다.', 503, 'apply_unverified');
        await protectedRowsUnchanged(operation, trash);
        const insertedIds = ownedRows(operation.intent, trash).map(row => row.video_id);
        await saveResult(operation, 'applied', insertedIds, '37곡이 기존 휴지통에 등록됐습니다.');
        return publicStatus(operation, trash);
      } catch (error) {
        try {
          await undoOwned(operation, true);
          throw failure('일괄 이동이 완료되지 않아 이번에 추가한 항목을 되돌렸습니다. ' + error.message, 503, 'apply_rolled_back', {recoverable: true});
        } catch (rollbackError) {
          if (rollbackError.code === 'apply_rolled_back') throw rollbackError;
          throw failure('일괄 이동 결과를 확인해야 합니다. 자동 백업이 저장돼 있으며 상태 확인 또는 복원을 사용할 수 있습니다.', 503, 'recovery_required', {recoverable: true, operationId: operation.intent.operationId});
        }
      }
    });
  }

  async function restore() {
    return exclusive(async () => {
      const operation = await loadOperation();
      if (!operation) throw failure('복원할 일괄 이동 기록이 없습니다.', 404, 'batch_missing');
      if (['restored', 'rolled_back'].includes(operation.result?.state)) return publicStatus(operation, await repository.readTable('ost_trash_songs'));
      return undoOwned(operation, false);
    });
  }

  async function backup() {
    const operation = await loadOperation();
    if (!operation) throw failure('저장된 일괄 이동 백업이 없습니다.', 404, 'backup_missing');
    return operation.backup;
  }

  return {preview, apply, status, restore, backup};
}

function createSupabaseAdapters({url, secret, fetchFn = globalThis.fetch}) {
  const base = String(url || '').replace(/\/$/, '');
  const headers = {apikey: secret, Authorization: 'Bearer ' + secret};
  const orders = new Map();
  function configured() {
    if (!base || !secret) throw failure('서버의 Supabase 연결 설정을 확인해 주세요.', 503, 'storage_unconfigured');
  }
  async function request(path, options = {}) {
    configured();
    try { return await fetchFn(base + path, {...options, headers: {...headers, ...options.headers}, signal: AbortSignal.timeout(30000)}); }
    catch { throw failure('저장소 연결이 지연됐습니다. 작업 상태를 확인해 주세요.', 503, 'repository_unavailable', {recoverable: true}); }
  }
  async function body(response) {
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { throw failure('저장소 응답을 읽을 수 없습니다.', 503, 'repository_response'); }
  }
  function missing(response, data) {
    return response.status === 404 || String(data?.statusCode) === '404'
      || ['not_found', 'NoSuchKey', 'NoSuchBucket'].includes(data?.error || data?.code)
      || (response.status === 400 && /^(?:bucket|object) not found$/i.test(data?.message || data?.error || ''));
  }
  async function storageGet(key) {
    const bucketResponse = await request('/storage/v1/bucket/' + STORAGE_BUCKET);
    const bucket = await body(bucketResponse);
    if (missing(bucketResponse, bucket)) return null;
    if (!bucketResponse.ok || bucket?.public !== false) throw failure('자동 백업 저장소의 비공개 상태를 확인할 수 없습니다.', 503, 'backup_not_private');
    const path = '/storage/v1/object/authenticated/' + STORAGE_BUCKET + '/' + key.split('/').map(encodeURIComponent).join('/') + '?read=' + crypto.randomUUID();
    const response = await request(path, {headers:{'Cache-Control':'no-cache'}});
    const data = await body(response);
    if (missing(response, data)) return null;
    if (!response.ok) throw failure('비공개 자동 백업을 읽을 수 없습니다. 서버 Storage 권한을 확인해 주세요.', 503, 'backup_unavailable');
    return data;
  }
  const store = {
    async ensurePrivate() {
      const path = '/storage/v1/bucket/' + STORAGE_BUCKET;
      let response = await request(path), data = await body(response);
      if (missing(response, data)) {
        const created = await request('/storage/v1/bucket', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:STORAGE_BUCKET,name:STORAGE_BUCKET,public:false})});
        if (!created.ok) {
          const detail = await body(created);
          if (created.status !== 409 && String(detail?.statusCode) !== '409' && !/already exists|duplicate/i.test(detail?.message || detail?.error || '')) throw failure('자동 백업 저장소를 만들 수 없습니다. 서버 Storage 권한을 확인해 주세요.', 503, 'backup_unavailable');
        }
        response = await request(path);data = await body(response);
      }
      if (!response.ok || data?.public !== false) throw failure('자동 백업 저장소의 비공개 설정을 확인할 수 없습니다.', 503, 'backup_not_private');
    },
    get: storageGet,
    async put(key, json, {createOnly = false} = {}) {
      const response = await request('/storage/v1/object/' + STORAGE_BUCKET + '/' + key.split('/').map(encodeURIComponent).join('/'), {
        method:'POST',headers:{'Content-Type':'application/json','x-upsert':String(!createOnly)},body:JSON.stringify(json)
      });
      if (response.ok) return true;
      const detail = await body(response);
      if (createOnly && (response.status === 409 || String(detail?.statusCode) === '409' || /already exists|duplicate/i.test(detail?.message || detail?.error || ''))) return false;
      throw failure('자동 백업 저장을 완료할 수 없습니다.', 503, 'backup_unavailable', {recoverable:true});
    }
  };
  const repository = {
    async readTableNames() {
      const response = await request('/rest/v1/', {headers:{Accept:'application/openapi+json'}});
      const schema = await body(response);
      if (!response.ok || !schema?.paths) throw failure('전체 앱 데이터 백업 목록을 읽을 수 없습니다.', 503, 'backup_incomplete');
      const names = Object.keys(schema.paths).filter(name => /^\/ost_[A-Za-z0-9_]+$/.test(name)).map(name => name.slice(1));
      for (const name of names) {
        const properties = schema.definitions?.[name]?.properties || {};
        const key = Object.hasOwn(properties, 'id') ? 'id' : Object.hasOwn(properties, 'video_id') ? 'video_id' : null;
        if (!key) throw failure('백업 테이블의 정렬 기준을 확인할 수 없습니다. ' + name, 503, 'backup_incomplete');
        orders.set(name, key);
      }
      return names;
    },
    async readTable(name) {
      if (!/^ost_[A-Za-z0-9_]+$/.test(name)) throw failure('테이블 이름 오류', 400, 'invalid_table');
      const order = orders.get(name) || (['ost_trash_songs','ost_played_songs','ost_audio_fingerprints'].includes(name) ? 'video_id' : 'id');
      const rows = [];let offset = 0,total = null,bytes = 0;
      do {
        const query = new URLSearchParams({select:'*',order:order + '.asc',limit:'1000',offset:String(offset)});
        const response = await request('/rest/v1/' + name + '?' + query, {headers:{Prefer:'count=exact'}});
        const page = await body(response);
        const match = response.headers.get('content-range')?.match(/\/(\d+)$/);
        if (!response.ok || !Array.isArray(page) || !match) throw failure('전체 테이블 백업 수량을 확인할 수 없습니다. ' + name, 503, 'backup_incomplete');
        const count = Number(match[1]);
        if (total !== null && count !== total) throw failure('백업 도중 데이터 수량이 바뀌었습니다. 다시 시도해 주세요.', 409, 'backup_changed');
        total = count;
        bytes += Buffer.byteLength(JSON.stringify(page));
        if (bytes > MAX_BACKUP_BYTES) throw failure('전체 데이터를 안전하게 백업할 수 없습니다. ' + name, 503, 'backup_too_large');
        if (total > 100000 || (!page.length && offset < total)) throw failure('전체 데이터를 안전하게 백업할 수 없습니다. ' + name, 503, 'backup_incomplete');
        rows.push(...page);offset += page.length;
      } while (offset < total);
      if (rows.length !== total || new Set(rows.map(row => row[order])).size !== rows.length) throw failure('테이블 백업이 완전하지 않습니다. ' + name, 503, 'backup_incomplete');
      return rows;
    },
    async insertTrash(ids, stamp) {
      if (!ids.length) return [];
      if (ids.length > 37 || ids.some(id => !VIDEO_ID.test(id)) || !timestampKey(stamp)) throw failure('휴지통 요청값 오류', 400, 'invalid_targets');
      const query = new URLSearchParams({on_conflict:'video_id',select:'video_id,trashed_at'});
      const response = await request('/rest/v1/ost_trash_songs?' + query, {method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(ids.map(video_id=>({video_id,trashed_at:stamp})))});
      const data = await body(response);
      if (!response.ok || !Array.isArray(data)) throw failure('휴지통 추가 결과를 확인할 수 없습니다.', 503, 'apply_unverified', {recoverable:true});
      return data;
    },
    async deleteTrash(ids, stamp) {
      if (!ids.length) return [];
      if (ids.length > 37 || ids.some(id => !VIDEO_ID.test(id)) || !timestampKey(stamp)) throw failure('휴지통 복원 요청값 오류', 400, 'invalid_targets');
      const query = new URLSearchParams({video_id:'in.(' + ids.join(',') + ')',trashed_at:'eq.' + stamp,select:'video_id,trashed_at'});
      const response = await request('/rest/v1/ost_trash_songs?' + query, {method:'DELETE',headers:{Prefer:'return=representation'}});
      const data = await body(response);
      if (!response.ok || !Array.isArray(data)) throw failure('휴지통 복원 결과를 확인할 수 없습니다.', 503, 'rollback_unverified', {recoverable:true});
      return data;
    }
  };
  return {store, repository};
}

function registerTrashBatch({app, express, isAdmin, config, roomsSnapshot, service: injectedService}) {
  let service = injectedService;
  if (!service) {
    const manifest = require('../data_import/youtube-playback-exclusion/targets.json');
    const adapters = createSupabaseAdapters(config || {});
    service = createService({manifest,...adapters,roomsSnapshot});
  }
  const base = '/api/trash/admin/batch150';
  const admin = (req,res,next) => {
    res.set?.('Cache-Control','no-store');
    if (!isAdmin(req)) return res.status(403).json({error:'관리자 인증 실패'});
    next();
  };
  const route = action => async(req,res) => {
    try { res.json(await action(req)); }
    catch(error) { res.status(error.status || 503).json({error:error.message || '일괄 작업에 실패했습니다.',code:error.code || 'batch_failed',recoverable:!!error.recoverable,operationId:error.operationId}); }
  };
  app.post(base+'/preview',admin,express.json({limit:'12mb'}),route(req=>service.preview(req.body)));
  app.post(base+'/apply',admin,express.json({limit:'10kb'}),route(req=>service.apply(req.body)));
  app.get(base+'/status',admin,route(()=>service.status()));
  app.post(base+'/restore',admin,express.json({limit:'2kb'}),route(()=>service.restore()));
  app.get(base+'/backup',admin,async(req,res)=>{
    try { const data=await service.backup();res.set('Content-Disposition','attachment; filename="ost-before-batch150.json"');res.json(data); }
    catch(error){res.status(error.status||503).json({error:error.message,code:error.code});}
  });
  return service;
}

module.exports={createService,createSupabaseAdapters,registerTrashBatch,timestampKey};
