const API = 'https://api.spotify.com/v1';
const ACCOUNTS = 'https://accounts.spotify.com';
const SCOPES = 'playlist-modify-private playlist-modify-public';
const $ = (id) => document.getElementById(id);
const state = { token: null, expiresAt: 0 };

function redirectUri() {
  return location.origin + location.pathname;
}
function randomString(length=64) {
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes=crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes,b=>chars[b%chars.length]).join('');
}
async function sha256(text){return crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));}
function base64url(buffer){return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}

async function login(){
  const clientId=window.APP_CONFIG?.SPOTIFY_CLIENT_ID?.trim();
  if(!clientId || clientId.includes('VUL_HIER')) return alert('Vul eerst je Spotify Client ID in config.js in.');
  const verifier=randomString();
  const oauthState=randomString(24);
  sessionStorage.setItem('pkce_verifier',verifier);
  sessionStorage.setItem('oauth_state',oauthState);
  const challenge=base64url(await sha256(verifier));
  const params=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:redirectUri(),scope:SCOPES,code_challenge_method:'S256',code_challenge:challenge,state:oauthState});
  location.href=`${ACCOUNTS}/authorize?${params}`;
}
async function handleCallback(){
  const p=new URLSearchParams(location.search);
  const code=p.get('code');
  if(p.get('error')) throw new Error(`Spotify-login geweigerd: ${p.get('error')}`);
  if(!code) return restoreToken();
  if(p.get('state')!==sessionStorage.getItem('oauth_state')) throw new Error('Ongeldige OAuth state. Start de login opnieuw.');
  const body=new URLSearchParams({client_id:window.APP_CONFIG.SPOTIFY_CLIENT_ID,grant_type:'authorization_code',code,redirect_uri:redirectUri(),code_verifier:sessionStorage.getItem('pkce_verifier')||''});
  const r=await fetch(`${ACCOUNTS}/api/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  const data=await r.json();
  if(!r.ok) throw new Error(data.error_description||'Token ophalen mislukt.');
  saveToken(data);
  history.replaceState({},document.title,redirectUri());
}
function saveToken(data){
  state.token=data.access_token; state.expiresAt=Date.now()+data.expires_in*1000-30000;
  sessionStorage.setItem('spotify_token',state.token); sessionStorage.setItem('spotify_expires',String(state.expiresAt));
}
function restoreToken(){
  const token=sessionStorage.getItem('spotify_token'); const expires=Number(sessionStorage.getItem('spotify_expires')||0);
  if(token && expires>Date.now()){state.token=token;state.expiresAt=expires;}
  updateAuthUI();
}
function logout(){sessionStorage.clear();state.token=null;state.expiresAt=0;updateAuthUI();}
function updateAuthUI(){
  const on=!!state.token && state.expiresAt>Date.now();
  $('authDot').classList.toggle('online',on); $('authText').textContent=on?'Verbonden met Spotify':'Niet verbonden met Spotify';
  $('loginBtn').classList.toggle('hidden',on); $('logoutBtn').classList.toggle('hidden',!on); $('buildBtn').disabled=!on;
}
async function spotify(path,options={},retry=true){
  if(!state.token || state.expiresAt<=Date.now()){logout();throw new Error('Je sessie is verlopen. Verbind opnieuw met Spotify.');}
  const headers={Authorization:`Bearer ${state.token}`,...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})};
  const r=await fetch(API+path,{...options,headers});
  if(r.status===429 && retry){
    const wait=Math.min(Number(r.headers.get('Retry-After')||2),30);
    log(`Spotify-limiet bereikt. ${wait} seconden wachten en nog één keer proberen...`,'warn');
    await new Promise(x=>setTimeout(x,wait*1000));
    return spotify(path,options,false);
  }
  if(r.status===204) return null;
  const data=await r.json().catch(()=>({}));
  if(!r.ok){
    const error=new Error(data?.error?.message||`Spotify-fout ${r.status}`);
    error.status=r.status;
    error.code=r.status===429?'QUOTA_EXCEEDED':'SPOTIFY_ERROR';
    throw error;
  }
  return data;
}
function isQuotaError(error){
  const text=String(error?.message||'').toLowerCase();
  return error?.status===429 || error?.code==='QUOTA_EXCEEDED' || text.includes('quota exceeded') || text.includes('rate limit');
}
function normalize(s){return (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ').trim();}
function similarity(a,b){
  a=normalize(a);b=normalize(b);if(a===b)return 100;if(a.includes(b)||b.includes(a))return 70;
  const A=new Set(a.split(' ')),B=new Set(b.split(' '));const hit=[...A].filter(x=>B.has(x)).length;return 50*hit/Math.max(A.size,B.size,1);
}
function parseLine(line){
  const trimmed=line.trim();
  const match=trimmed.match(/open\.spotify\.com\/album\/([A-Za-z0-9]+)/);
  if(match)return {raw:trimmed,albumId:match[1]};
  const parts=trimmed.split(/\s+-\s+/);
  if(parts.length<2)throw new Error(`Ongeldig formaat: “${trimmed}”`);
  return {raw:trimmed,artist:parts.shift().trim(),release:parts.join(' - ').trim()};
}
async function fetchAllAlbumTracks(albumId){
  let path=`/albums/${encodeURIComponent(albumId)}/tracks?limit=50`;const items=[];
  while(path){const d=await spotify(path.replace(API,''));items.push(...d.items);path=d.next;}
  return items;
}
async function resolveByLink(item){
  const album=await spotify(`/albums/${item.albumId}`);
  const simple=await fetchAllAlbumTracks(item.albumId);
  // Trackdetails bevatten de popularity-score. In recente API-modi kan deze endpoint beperkt zijn.
  const full=[];
  for(let i=0;i<simple.length;i+=50){
    const ids=simple.slice(i,i+50).map(t=>t.id).filter(Boolean).join(',');
    const d=await spotify(`/tracks?ids=${encodeURIComponent(ids)}`);full.push(...(d.tracks||[]).filter(Boolean));
  }
  return {label:`${album.artists?.[0]?.name||''} - ${album.name}`,tracks:full};
}
async function resolveBySearch(item){
  const q=`album:${item.release} artist:${item.artist}`;
  let d;
  try{d=await spotify(`/search?type=track&limit=50&q=${encodeURIComponent(q)}`);}catch(e){
    if(!/limit|400/i.test(e.message))throw e;
    d=await spotify(`/search?type=track&limit=10&q=${encodeURIComponent(q)}`);
  }
  const tracks=d.tracks?.items||[];
  if(!tracks.length)throw new Error(`Geen tracks gevonden voor ${item.raw}`);
  const groups=new Map();
  for(const t of tracks){
    const id=t.album?.id;if(!id)continue;
    if(!groups.has(id))groups.set(id,{album:t.album,tracks:[]});groups.get(id).tracks.push(t);
  }
  const ranked=[...groups.values()].map(g=>{
    const albumArtist=g.album.artists?.map(a=>a.name).join(' ')||'';
    const score=similarity(g.album.name,item.release)*2+similarity(albumArtist,item.artist)+Math.min(g.tracks.length,20);
    return {...g,score};
  }).sort((a,b)=>b.score-a.score);
  const best=ranked[0];
  if(!best || best.score<100)throw new Error(`Geen voldoende betrouwbare match voor ${item.raw}`);
  return {label:`${best.album.artists?.[0]?.name||item.artist} - ${best.album.name}`,tracks:best.tracks};
}
function trackKey(t){return t.external_ids?.isrc||`${normalize(t.artists?.[0]?.name)}|${normalize(t.name).replace(/\b(remaster(ed)?|radio edit|single version)\b/g,'').trim()}`;}
function log(text,type=''){const row=document.createElement('div');row.textContent=text;if(type)row.className=type;$('log').appendChild(row);$('log').scrollTop=$('log').scrollHeight;}
function progress(done,total,title){$('progressTitle').textContent=title;$('progressCount').textContent=`${done}/${total}`;$('barFill').style.width=`${total?done/total*100:0}%`;}

async function build(){
  const lines=$('releases').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const n=Math.max(1,Math.min(50,Number($('trackCount').value)||1));
  if(!lines.length)return alert('Geef minstens één release op.');

  const items=lines.map(parseLine);
  const selected=[];
  const failures=[];
  let processed=0;
  let quotaReached=false;
  let quotaMessage='';

  $('buildBtn').disabled=true;
  $('resultCard').classList.add('hidden');
  $('progressCard').classList.remove('hidden');
  $('log').innerHTML='';
  progress(0,items.length,'Releases verwerken');

  for(let i=0;i<items.length;i++){
    const item=items[i];
    try{
      const found=item.albumId?await resolveByLink(item):await resolveBySearch(item);
      const top=found.tracks
        .filter(t=>t?.uri && t.is_playable!==false)
        .sort((a,b)=>(b.popularity??-1)-(a.popularity??-1))
        .slice(0,n);
      selected.push(...top);
      processed++;
      log(`✓ ${found.label}: ${top.length} track(s)`,'ok');
    }catch(e){
      if(isQuotaError(e)){
        quotaReached=true;
        quotaMessage=e.message;
        log(`⚠ Spotify-limiet bereikt bij “${item.raw}”. Verdere releases worden overgeslagen.`,'warn');
        log('De app probeert nu een playlist te maken met alle reeds gevonden tracks.','warn');
        break;
      }
      failures.push(`${item.raw}: ${e.message}`);
      processed++;
      log(`✗ ${item.raw}: ${e.message}`,'error');
    }
    progress(processed,items.length,'Releases verwerken');
  }

  let finalTracks=selected;
  if($('dedupe').checked){
    const seen=new Set();
    finalTracks=selected.filter(t=>{
      const k=trackKey(t);
      if(seen.has(k))return false;
      seen.add(k);
      return true;
    });
  }

  if(!finalTracks.length){
    $('buildBtn').disabled=false;
    const reason=quotaReached
      ? 'De Spotify-limiet werd bereikt voordat er tracks gevonden waren. Er kon geen playlist worden aangemaakt.'
      : 'Geen tracks gevonden. Er is geen playlist aangemaakt.';
    throw new Error(reason);
  }

  progress(processed,items.length,quotaReached?'Gedeeltelijke playlist aanmaken':'Playlist aanmaken');

  let playlist;
  try{
    playlist=await spotify('/me/playlists',{
      method:'POST',
      body:JSON.stringify({
        name:$('playlistName').value.trim()||'Release Top Tracks',
        public:$('makePublic').checked,
        description:quotaReached
          ? `Gedeeltelijke playlist: Spotify-limiet bereikt na ${processed} van ${items.length} verwerkte releases.`
          : `Top ${n} tracks per opgegeven release. Gemaakt met Release Top Tracks.`
      })
    });

    for(let i=0;i<finalTracks.length;i+=100){
      await spotify(`/playlists/${playlist.id}/items`,{
        method:'POST',
        body:JSON.stringify({uris:finalTracks.slice(i,i+100).map(t=>t.uri)})
      });
    }
  }catch(e){
    if(isQuotaError(e)){
      throw new Error('De limiet bleef actief tijdens het aanmaken of vullen van de playlist. Spotify liet de opslag daardoor niet toe. Probeer het later opnieuw.');
    }
    throw e;
  }

  const skipped=items.length-processed;
  if(quotaReached){
    $('resultText').textContent=`Spotify-limiet bereikt. De gedeeltelijke playlist bevat ${finalTracks.length} tracks uit ${processed} verwerkte releases. ${skipped} release(s) werden niet meer verwerkt.`;
    log(`Gedeeltelijke playlist opgeslagen: ${finalTracks.length} tracks uit ${processed} van ${items.length} verwerkte releases.`,'warn');
    if(quotaMessage)log(`Spotify-melding: ${quotaMessage}`,'warn');
  }else{
    $('resultText').textContent=`${finalTracks.length} tracks toegevoegd uit ${items.length-failures.length} van de ${items.length} releases.${failures.length?` ${failures.length} release(s) konden niet worden verwerkt.`:''}`;
    log(`Playlist aangemaakt met ${finalTracks.length} tracks.`,'ok');
  }

  $('playlistLink').href=playlist.external_urls.spotify;
  $('resultCard').classList.remove('hidden');
  $('buildBtn').disabled=false;
}

$('loginBtn').addEventListener('click',()=>login().catch(e=>alert(e.message)));
$('logoutBtn').addEventListener('click',logout);
$('buildBtn').addEventListener('click',()=>build().catch(e=>{log(e.message,'error');alert(e.message);$('buildBtn').disabled=false;}));
handleCallback().then(updateAuthUI).catch(e=>{alert(e.message);history.replaceState({},document.title,redirectUri());restoreToken();});
