// OffGrid Connect - minimal offline-first logic
const DB_NAME = 'offgrid-db';
const DB_VERSION = 1;
let db;
var uhjbv = 0

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('msgs')) {
        const store = db.createObjectStore('msgs', { keyPath: 'id' });
        store.createIndex('by_to', 'to');
        store.createIndex('by_inbox', 'inbox');
      }
      if (!db.objectStoreNames.contains('acks')) db.createObjectStore('acks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('seen')) db.createObjectStore('seen', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getMeta(key, fallback=null){
  const tx = db.transaction('meta','readonly');
  const r = await tx.objectStore('meta').get(key);
  return r?.value ?? fallback;
}
async function setMeta(key, value){
  const tx = db.transaction('meta','readwrite');
  tx.objectStore('meta').put({key, value});
  return tx.complete;
}

function rand64() {
  const a = crypto.getRandomValues(new Uint32Array(2));
  return (BigInt(a[0]) << 32n) | BigInt(a[1]);
}
function now(){ return Math.floor(Date.now()/1000); }

const TYPE_TEXT = 0, TYPE_SOS = 1, TYPE_ACK = 2;

async function myId(){
  let id = await getMeta('deviceId', null);
  if(!id){
    id = (rand64() & 0xffffffffn).toString(16);
    await setMeta('deviceId', id);
  }
  return id;
}

const sosText = document.getElementById('sosText');
const sendSOSBtn = document.getElementById('sendSOSBtn');
const toIdEl = document.getElementById('toId');
const prioEl = document.getElementById('prio');
const msgBody = document.getElementById('msgBody');
const sendMsgBtn = document.getElementById('sendMsgBtn');
const inboxEl = document.getElementById('inbox');
const outboxEl = document.getElementById('outbox');
const deviceIdEl = document.getElementById('deviceId');
const teamPinEl = document.getElementById('teamPin');
const resetBtn = document.getElementById('resetBtn');
const exportBtn = document.getElementById('exportBundleBtn');
const exportText = document.getElementById('exportText');
const importText = document.getElementById('importText');
const importBtn = document.getElementById('importBundleBtn');

function renderList(el, items){
  el.innerHTML = '';
  for(const m of items){
    const li = document.createElement('li');
    const tag = m.type===TYPE_SOS?'[SOS]':m.type===TYPE_ACK?'[ACK]':'';
    li.innerHTML = `<strong>${tag}</strong> <small>${new Date(m.ts*1000).toLocaleString()}</small><br>${escapeHtml(m.body || '')}<br><small>from:${m.from} → to:${m.to} • id:${m.id}</small>`;
    el.appendChild(li);
  }
}
function escapeHtml(s){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function loadLists(){
  const tx = db.transaction('msgs','readonly');
  const store = tx.objectStore('msgs');
  const req = store.getAll();
  const all = await new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);});
  const me = await myId();
  const inbox = all.filter(m => m.to===me || m.to==='0').filter(m=>m.inbox).sort((a,b)=>b.ts-a.ts);
  const outbox = all.filter(m => !m.inbox && m.type!==TYPE_ACK).sort((a,b)=>b.ts-a.ts);
  renderList(inboxEl, inbox);
  renderList(outboxEl, outbox);
}

async function saveMsg(m){
  const tx = db.transaction(['msgs','seen'],'readwrite');
  tx.objectStore('msgs').put(m);
  tx.objectStore('seen').put({id: m.id});
  await tx.complete;
  await loadLists();
}

async function queueSOS(){
  const me = await myId();
  const m = {
    id: (rand64()).toString(),
    from: me, to: '0', ts: now(), ttl: 6, prio: 2, type: TYPE_SOS,
    body: (sosText.value||'').slice(0,280),
    inbox: false
  };
  await saveMsg(m);
  sosText.value='';
}

async function queueMsg(){
  const me = await myId();
  const to = (toIdEl.value||'0').trim() || '0';
  const m = {
    id: (rand64()).toString(),
    from: me, to, ts: now(), ttl: 6, prio: parseInt(prioEl.value,10), type: TYPE_TEXT,
    body: (msgBody.value||'').slice(0,280),
    inbox: false
  };
  await saveMsg(m);
  msgBody.value='';
}

async function exportBundle(){
  try {
    const me = await myId();

    // open tx and issue requests
    const tx = db.transaction(['msgs','acks'], 'readonly');
    const msgsReq = tx.objectStore('msgs').getAll();
    const acksReq = tx.objectStore('acks').getAll();

    // wrap IDBRequest -> Promise
    const msgs = await new Promise((res, rej) => {
      msgsReq.onsuccess = () => res(msgsReq.result || []);
      msgsReq.onerror   = () => rej(msgsReq.error);
    });
    const acks = await new Promise((res, rej) => {
      acksReq.onsuccess = () => res(acksReq.result || []);
      acksReq.onerror   = () => rej(acksReq.error);
    });

    const bundle = {
      from: me,
      ts: now(),
      msgs: msgs.filter(m => !m.inbox || m.type === TYPE_SOS), // 1 = SOS
      acks: acks.map(a => a.id)
    };

    // show + copy encoded bundle
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(bundle))));
    exportText.value = encoded;
    exportText.select();
    try { document.execCommand('copy'); } catch(_) {}
    alert('Bundle exported (copied).');
  } catch (err) {
    console.error('exportBundle error:', err);
    alert('Export failed. See console.');
  }
}

async function importBundle(){
  try{
    const raw = importText.value.trim();
    if(!raw) return;
    const json = JSON.parse(decodeURIComponent(escape(atob(raw))));
    await mergeBundle(json);
    importText.value='';
    await loadLists();
    alert('Bundle imported.');
  }catch(e){
    console.error(e);
    alert('Invalid bundle.');
  }
}

async function mergeBundle(bundle){
  const me = await myId();
  const tx = db.transaction(['msgs','acks','seen'],'readwrite');
  const seenStore = tx.objectStore('seen');
  const msgsStore = tx.objectStore('msgs');
  const acksStore = tx.objectStore('acks');

  for(const id of (bundle.acks||[])){
    acksStore.put({id});
  }

  for(const m of (bundle.msgs||[])){
    const seen = await seenStore.get(m.id);
    if(seen) continue;
    m.ttl = Math.max(0, (m.ttl||0)-1);
    if(m.to===me || m.to==='0'){
      m.inbox = true;
      if(m.to===me && m.type!==TYPE_ACK){
        acksStore.put({id: m.id});
      }
    }else{
      m.inbox = false;
    }
    msgsStore.put(m);
    seenStore.put({id: m.id});
  }
  await tx.complete;
}

async function resetAll(){
  indexedDB.deleteDatabase(DB_NAME);
  location.reload();
}

async function init(){
  db = await openDB();
  deviceIdEl.value = await myId();
  sendSOSBtn.onclick = queueSOS;
  sendMsgBtn.onclick = queueMsg;
  exportBtn.onclick = exportBundle;
  importBtn.onclick = importBundle;
  resetBtn.onclick = resetAll;
  await loadLists();
}
init();
