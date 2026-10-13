// Install toast + service worker: public, loaded by the app AND by the login gate,
// so the site is installable (and says how) before anyone has signed in.
(function () {
  const SNOOZE_KEY = 'presenteInstallSnooze';
  const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
  const SHARE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  const CSS = `
.install-toast{position:fixed;left:50%;bottom:max(20px,env(safe-area-inset-bottom));transform:translate(-50%,0);
  width:calc(100% - 32px);max-width:420px;display:flex;align-items:center;gap:12px;padding:12px 8px 12px 12px;
  background:#121216;border:1px solid #232226;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.55);
  animation:toast-in .45s cubic-bezier(.2,.8,.2,1);z-index:60;font-family:Inter,-apple-system,sans-serif;box-sizing:border-box}
.install-toast.hidden,#screen-dashboard:not(.active)~.install-toast{display:none}
@keyframes toast-in{from{opacity:0;transform:translate(-50%,16px)}}
.install-icon{width:44px;height:44px;border-radius:10px;flex:none}
.install-text{flex:1;min-width:0}
.install-title{white-space:nowrap;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:500;font-size:18px;color:#f5f2eb;line-height:1.2}
.install-hint{color:#8a8578;font-size:12.5px;line-height:1.45;margin-top:2px}
.install-hint b{color:#e8e4dc;font-weight:500}
.install-hint svg{width:14px;height:14px;vertical-align:-2px;color:#ffb800}
.install-btn{flex:none;padding:10px 16px;background:#ffb800;color:#0a0a0a;border:none;border-radius:4px;font:600 13px Inter,-apple-system,sans-serif;letter-spacing:.1em;text-transform:uppercase;cursor:pointer}
.install-btn.hidden{display:none}
.install-close{flex:none;align-self:flex-start;width:32px;height:32px;background:none;border:none;color:#8a8578;font-size:22px;line-height:1;cursor:pointer}`;

  let installPrompt = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function snoozed() {
    try { return Date.now() < Number(localStorage.getItem(SNOOZE_KEY) || 0); } catch (e) { return false; }
  }

  // Browsers without an install prompt still install the app: tell each one where its own button is.
  function manualInstallHint() {
    const ua = navigator.userAgent;
    // In-app browsers (a link opened inside Instagram, Facebook, TikTok, the Google app) cannot install: send to the real browser first.
    if (/Instagram|FBAN|FBAV|FB_IAB|musical_ly|BytedanceWebview|TikTok|Line\/|GSA\//.test(ua)) {
      return 'Apri il menu <b>&#8943;</b> e scegli <b>Apri nel browser</b>, poi installa da lì.';
    }
    const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (iOS) return `Tocca ${SHARE_ICON} <b>Condividi</b>, poi <b>Aggiungi alla schermata Home</b>.`;
    if (/Android/.test(ua)) {
      if (/Firefox/.test(ua)) return 'Apri il menu <b>&#8942;</b> e scegli <b>Installa</b>.';
      return 'Apri il menu <b>&#8942;</b> e scegli <b>Installa app</b> o <b>Aggiungi a schermata Home</b>.';
    }
    const safariMac = /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox|OPR/.test(ua);
    if (safariMac) return `Menu <b>File</b> &rarr; <b>Aggiungi al Dock</b>, oppure ${SHARE_ICON} &rarr; <b>Aggiungi al Dock</b>.`;
    return null; // desktop Chromium offers its own prompt; desktop Firefox cannot install
  }

  function el(id) { return document.getElementById(id); }

  function mount() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const toast = document.createElement('div');
    toast.id = 'install-toast';
    toast.className = 'install-toast hidden';
    toast.setAttribute('role', 'dialog');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-labelledby', 'install-title');
    toast.innerHTML = `<img class="install-icon" src="/icon-192.png" alt="" width="44" height="44">
      <div class="install-text"><div class="install-title" id="install-title">Installa Presente</div>
      <div class="install-hint" id="install-hint"></div></div>
      <button id="btn-install" class="install-btn hidden">Installa</button>
      <button id="btn-install-close" class="install-close" aria-label="Chiudi">&times;</button>`;
    // Inside the app it sits after the screens, so it shows on the dashboard only.
    (el('app') || document.body).appendChild(toast);
  }

  function show(hint) {
    if (isStandalone() || snoozed()) return;
    if (installPrompt) {
      el('install-hint').textContent = 'A tutto schermo, anche offline.';
      el('btn-install').classList.remove('hidden');
    } else if (hint) {
      el('install-hint').innerHTML = hint;
      el('btn-install').classList.add('hidden');
    } else {
      return;
    }
    el('install-toast').classList.remove('hidden');
  }

  function hide(snooze) {
    el('install-toast').classList.add('hidden');
    if (snooze) {
      try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch (e) {}
    }
  }

  function setup() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (isStandalone()) return;
    mount();
    if (installPrompt) show();
    window.addEventListener('appinstalled', () => {
      installPrompt = null;
      hide(false);
    });
    el('btn-install').addEventListener('click', async () => {
      if (!installPrompt) return;
      const prompt = installPrompt;
      installPrompt = null;
      prompt.prompt();
      const { outcome } = await prompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
      hide(outcome !== 'accepted');
    });
    el('btn-install-close').addEventListener('click', () => hide(true));
    // Give the native prompt a moment to arrive before falling back to written steps.
    setTimeout(() => { if (!installPrompt) show(manualInstallHint()); }, 2500);
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    if (el('install-toast')) show();
  });

  window.presenteManualInstallHint = manualInstallHint;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
