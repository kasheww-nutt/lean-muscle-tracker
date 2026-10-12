'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{outcome:'accepted'|'dismissed'}> };
let pendingInstall: InstallEvent | null = null;

export function TrackerAppSupport() {
  useEffect(()=>{
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(()=>{});
    }
  },[]);
  return null;
}

export function InstallTracker({label}:{label?:string} = {}) {
  const [installed,setInstalled] = useState(false);
  const [prompt,setPrompt] = useState<InstallEvent|null>(null);
  const [busy,setBusy] = useState(false);
  const [ios,setIos] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const standalone = window.matchMedia('(display-mode: standalone)');
    const update = ()=>setInstalled(standalone.matches || Boolean((navigator as Navigator & {standalone?:boolean}).standalone));
    update();setIos(/iPad|iPhone|iPod/.test(navigator.userAgent));
    setPrompt(pendingInstall);
    const capture = (e:Event)=>{e.preventDefault();pendingInstall=e as InstallEvent;setPrompt(pendingInstall);};
    const completed = ()=>{pendingInstall=null;setInstalled(true);setPrompt(null);dialog.current?.close();};
    window.addEventListener('beforeinstallprompt',capture);window.addEventListener('appinstalled',completed);standalone.addEventListener('change',update);
    return ()=>{window.removeEventListener('beforeinstallprompt',capture);window.removeEventListener('appinstalled',completed);standalone.removeEventListener('change',update);};
  },[]);
  async function install() {
    if (!prompt) {dialog.current?.showModal();return;}
    setBusy(true);
    try { await prompt.prompt();await prompt.userChoice; }
    catch {dialog.current?.showModal();}
    finally {pendingInstall=null;setPrompt(null);setBusy(false);}
  }
  if (installed) return null;
  return <><button className="icon-button install-button" onClick={install} disabled={busy} aria-label="Install tracker on your home screen" title="Add tracker to home screen"><Download size={18}/>{label&&<span>{label}</span>}</button><dialog ref={dialog} className="install-dialog" aria-labelledby="install-title" onClick={e=>{if(e.target===dialog.current)dialog.current.close();}}><div className="install-heading"><img src="/icons/tracker-192-v3.png" width="48" height="48" alt=""/><button className="icon-button" onClick={()=>dialog.current?.close()} aria-label="Close install instructions"><X size={18}/></button></div><p className="eyebrow">KEEP IT ONE TAP AWAY</p><h2 id="install-title">Add Lean Muscle<br/>to your home screen.</h2>{ios ? <p>Open this tracker in Safari. Tap <b>Share</b>, then <b>Add to Home Screen</b>.</p> : <p>Open this tracker in Chrome on Android. Tap the <b>⋮ menu</b>, then <b>Add to Home screen</b> or <b>Install app</b>.</p>}<a className="quiet-button install-open-link" href="/" target="_blank" rel="noopener">Open tracker in a new tab</a><p className="fine">If you’re inside ChatGPT’s browser, use its menu to open the page in your phone’s browser first. Replace an older home-screen shortcut to pick up the new icon.</p><p className="fine">This installs an app-style shortcut. For custom Android widgets, open the tracker’s profile menu and choose the widget grid icon to set up KWGT. Internet is needed to load your saved records.</p></dialog></>;
}
