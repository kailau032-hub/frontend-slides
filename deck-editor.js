/**
 * deck-editor.js — an optional in-browser WYSIWYG editor for <deck-stage> decks.
 *
 * Drop this module into a deck (inline it in a <script> so the deck stays a
 * single self-contained file). When loaded it adds a floating toolbar:
 *
 *   ✎ Edit / ✓ Done   toggle edit mode (click any text to edit in place)
 *   ↶ ↷               undo / redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z)
 *   B I U 🔗           bold / italic / underline / link — 🔗 links a text selection,
 *                     the selected floating box, or the focused block/module, to a URL/path
 *                     — or to another slide in the deck (in-deck jump)
 *   Aa  ##px  ↕lh      font family, numeric size, and line-height for the focused block
 *   A  Hi              text colour + highlight for the selection
 *   Accent  BG         recolour the whole deck's accent, or the current slide bg
 *   ⌗ Snap             toggle snap-to-grid + centre/edge alignment guides
 *   ＋Text ＋Image      insert a draggable text box or an embedded image
 *   ＋Video ＋Table     insert a video (URL / YouTube) or a table
 *   ＋Date             insert today's date
 *   ＋Slide ⧉ ⌫         add a blank slide / duplicate / delete the current slide
 *   ⚙ FX               presentation effects — page-turn (fade/slide/flip), reveal
 *                     motion, hover effect, pointer (laser/spotlight), and turn speed
 *   ⤓ Download         save the edited deck as a new self-contained .html
 *
 * Inserted images are embedded as data: URIs so the exported file stays
 * self-contained. Floating elements can be dragged by their grip, resized from
 * the corner, and deleted. Everything is scale-aware: dragging maps screen
 * pixels back to the 1920×1080 design stage.
 *
 * The editor UI, its runtime attributes, and edit state are stripped from the
 * downloaded copy — the export opens clean (view mode) but keeps this module,
 * so the saved deck remains editable. For an audience-facing output (deployed
 * URL, PDF, shared file), add data-deck-locked to <html>: the module then loads
 * the chosen effects but builds no control bar at all.
 *
 * Requires: a <deck-stage> element in the page. No external dependencies.
 */
(() => {
  if (window.__deckEditorLoaded) return;
  window.__deckEditorLoaded = true;

  // Output/publish mode: when <html> has data-deck-locked, the module still applies
  // the chosen FX/effects (transitions, hover, pointer) but builds NO editor control
  // bar — so deployed URLs, PDFs, and shared files never show the toolbar.
  const LOCKED = document.documentElement.hasAttribute('data-deck-locked');

  const EDIT_SEL = [
    'h1','h2','h3','.htitle','.kicker','.kick','.sub','.lead','.lead2',
    '.secidx','.idx','.bignum','.num','p','li','td','th','.chip','.cap',
    '.ex','.n','.l','.cite','.legend','.dhead','.foot > div','.val','.lab',
    'blockquote','figcaption'
  ].join(',');

  const FONTS = [
    ['Font',''],['Archivo','"Archivo", sans-serif'],['Space Grotesk','"Space Grotesk", sans-serif'],
    ['Inter','"Inter", sans-serif'],['Fraunces','"Fraunces", serif'],
    ['IBM Plex Mono','"IBM Plex Mono", monospace'],['Georgia','Georgia, serif'],['Helvetica','Helvetica, Arial, sans-serif']
  ];
  const GRID = 20, SNAP_TH = 11;

  let editing = false, activeEl = null, selectedFloat = null, snapOn = true;
  let pendingPre = null, textDirty = false;

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const stage = () => $('deck-stage');
  const sections = () => $$('deck-stage > section');
  const activeSlide = () => $('deck-stage > section[data-deck-active]') || sections()[0];
  const editables = () => sections().flatMap(s => $$(EDIT_SEL, s));
  const slideScale = () => { const s = activeSlide(); if (!s) return 1; return (s.getBoundingClientRect().width / (s.offsetWidth || 1920)) || 1; };

  function h(tag, props = {}, kids = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v != null) el.setAttribute(k, v);
    }
    (Array.isArray(kids) ? kids : [kids]).forEach(c => c != null && el.append(c.nodeType ? c : document.createTextNode(c)));
    return el;
  }
  const gotoSlide = (i) => { const s = stage(); if (s && s.goTo) s.goTo(i); else if (s && s._go) s._go(i); };
  const slideCount = () => sections().length;
  const activeIndex = () => { const i = sections().findIndex(x => x.hasAttribute('data-deck-active')); return i < 0 ? 0 : i; };

  /* ---------- history (undo / redo) ---------- */
  const undoStack = [], redoStack = [], CAP = 40;
  const snapshot = () => ({ html: stage().innerHTML, root: document.documentElement.getAttribute('style') || '', active: activeIndex() });
  function record() { redoStack.length = 0; undoStack.push(snapshot()); if (undoStack.length > CAP) undoStack.shift(); refreshUndo(); }
  function armPre() { pendingPre = snapshot(); textDirty = false; }
  function commitPre() { if (pendingPre) { redoStack.length = 0; undoStack.push(pendingPre); if (undoStack.length > CAP) undoStack.shift(); pendingPre = null; refreshUndo(); } }
  function restore(s) {
    stage().innerHTML = s.html;
    document.documentElement.setAttribute('style', s.root);
    selectedFloat = null; activeEl = null;
    setTimeout(() => { rehydrateFloats(); applyEditables(editing); gotoSlide(s.active); }, 0);
  }
  function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); refreshUndo(); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); refreshUndo(); }
  function refreshUndo() { if (bUndo) { bUndo.disabled = !undoStack.length; bRedo.disabled = !redoStack.length; bUndo.style.opacity = undoStack.length ? 1 : .4; bRedo.style.opacity = redoStack.length ? 1 : .4; } }

  /* ---------- edit mode ---------- */
  function applyEditables(on) {
    editables().forEach(el => {
      if (on) { el.setAttribute('contenteditable', 'true'); el.setAttribute('data-dke-edit', ''); el.spellcheck = false; }
      else { el.removeAttribute('contenteditable'); el.removeAttribute('data-dke-edit'); }
    });
    $$('.dke-textbox').forEach(t => t.contentEditable = on ? 'true' : 'false');
  }
  function setEdit(on) {
    editing = on;
    document.body.classList.toggle('dke-editing', on);
    applyEditables(on);
    bEdit.classList.toggle('on', on);
    bEdit.textContent = on ? '✓ Done' : '✎ Edit';
    if (!on) selectFloat(null);
  }

  /* ---------- selection / focus tracking ---------- */
  document.addEventListener('focusin', e => {
    const b = e.target.closest && e.target.closest('[data-dke-edit],.dke-textbox');
    if (b) { activeEl = b; armPre(); syncType(); }
  });
  document.addEventListener('input', e => {
    if (e.target.closest && e.target.closest('[data-dke-edit],.dke-textbox') && !textDirty) { commitPre(); textDirty = true; }
  });
  document.addEventListener('selectionchange', () => { if (editing) { syncFormatButtons(); syncType(); } });

  function exec(cmd, val = null) { armPre(); commitPre(); document.execCommand('styleWithCSS', false, true); document.execCommand(cmd, false, val); syncFormatButtons(); }
  function syncFormatButtons() { try {
    bB.classList.toggle('on', document.queryCommandState('bold'));
    bI.classList.toggle('on', document.queryCommandState('italic'));
    bU.classList.toggle('on', document.queryCommandState('underline'));
  } catch (_) {} }
  function syncType() {
    if (!activeEl) return;
    const cs = getComputedStyle(activeEl);
    if (document.activeElement !== szIn) szIn.value = Math.round(parseFloat(cs.fontSize));
    if (document.activeElement !== lhIn) { const lh = parseFloat(cs.lineHeight); lhIn.value = isNaN(lh) ? '' : (lh / parseFloat(cs.fontSize)).toFixed(2); }
  }

  /* ---------- floating elements ---------- */
  function bindFloat(f) {
    if (f.__bound) return; f.__bound = true;
    let grip = f.querySelector('.dke-grip'), del = f.querySelector('.dke-del'), rsz = f.querySelector('.dke-rsz');
    if (!grip) { grip = h('div', { class: 'dke-grip', text: '⠿ drag' }); f.appendChild(grip); }
    if (!del) { del = h('div', { class: 'dke-del', text: '×', title: 'Delete' }); f.appendChild(del); }
    if (!rsz) { rsz = h('div', { class: 'dke-rsz' }); f.appendChild(rsz); }
    del.onclick = (e) => { e.stopPropagation(); record(); f.remove(); if (selectedFloat === f) selectedFloat = null; };
    f.addEventListener('mousedown', () => selectFloat(f));
    dragify(f, grip, rsz);
  }
  function makeFloat(inner, { x = 760, y = 440, w = 400, h: hh = 220, cls = '' } = {}) {
    record();
    const f = h('div', { class: 'dke-float ' + cls, style: `left:${x}px;top:${y}px;width:${w}px;height:${hh}px` });
    f.append(inner);
    activeSlide().appendChild(f);
    bindFloat(f); selectFloat(f);
    return f;
  }
  function rehydrateFloats() { $$('.dke-float').forEach(bindFloat); }
  function selectFloat(f) { if (selectedFloat) selectedFloat.classList.remove('sel'); selectedFloat = f; if (f) f.classList.add('sel'); }

  function guide(kind, pos) { const g = h('div', { class: 'dke-guide ' + kind }); if (kind === 'v') g.style.left = pos + 'px'; else g.style.top = pos + 'px'; activeSlide().appendChild(g); }
  function clearGuides() { $$('.dke-guide', activeSlide()).forEach(g => g.remove()); }

  function dragify(f, grip, rsz) {
    let mode = null, sx, sy, ox, oy, ow, oh;
    const down = (m) => (e) => {
      if (!editing) return;
      e.preventDefault(); e.stopPropagation(); record();
      mode = m; sx = e.clientX; sy = e.clientY;
      ox = parseFloat(f.style.left); oy = parseFloat(f.style.top); ow = parseFloat(f.style.width); oh = parseFloat(f.style.height);
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    };
    const move = (e) => {
      const k = slideScale(), dx = (e.clientX - sx) / k, dy = (e.clientY - sy) / k;
      clearGuides();
      if (mode === 'move') {
        let L = ox + dx, T = oy + dy; const w = parseFloat(f.style.width), hh = parseFloat(f.style.height);
        if (snapOn) { L = Math.round(L / GRID) * GRID; T = Math.round(T / GRID) * GRID; }
        const cx = L + w / 2, cy = T + hh / 2;
        if (Math.abs(cx - 960) < SNAP_TH) { L = 960 - w / 2; guide('v', 960); }
        if (Math.abs(cy - 540) < SNAP_TH) { T = 540 - hh / 2; guide('h', 540); }
        if (Math.abs(L - 130) < SNAP_TH) { L = 130; guide('v', 130); }
        if (Math.abs((L + w) - 1790) < SNAP_TH) { L = 1790 - w; guide('v', 1790); }
        f.style.left = L + 'px'; f.style.top = T + 'px';
      } else {
        let W = Math.max(60, ow + dx), H = Math.max(36, oh + dy);
        if (snapOn) { W = Math.round(W / GRID) * GRID; H = Math.round(H / GRID) * GRID; }
        f.style.width = W + 'px'; f.style.height = H + 'px';
      }
    };
    const up = () => { mode = null; clearGuides(); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    grip.addEventListener('mousedown', down('move'));
    rsz.addEventListener('mousedown', down('resize'));
  }

  /* ---------- inserts ---------- */
  function insertTextBox() { const tb = h('div', { class: 'dke-textbox dke-tb', contenteditable: 'true', text: 'New text' }); makeFloat(tb, { w: 460, h: 120 }); setTimeout(() => { tb.focus(); document.getSelection().selectAllChildren(tb); }, 0); }
  function insertImageFile(file, existing) { const rd = new FileReader(); rd.onload = () => { if (existing) { record(); existing.src = rd.result; } else makeFloat(h('img', { src: rd.result, alt: '' }), { w: 520, h: 360 }); }; rd.readAsDataURL(file); }
  function insertVideo(url) { const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{11})/); const node = yt ? h('iframe', { src: 'https://www.youtube.com/embed/' + yt[1], allow: 'fullscreen', frameborder: '0' }) : h('video', { src: url, controls: '', playsinline: '' }); makeFloat(node, { w: 640, h: 360 }); }
  function insertTable(rows, cols) { const t = h('table', { class: 'dke-etable' }); for (let r = 0; r < rows; r++) { const tr = h('tr'); for (let c = 0; c < cols; c++) tr.appendChild(h('td', { contenteditable: 'true', text: r === 0 ? 'Head' : '' })); t.appendChild(tr); } makeFloat(t, { w: cols * 160, h: rows * 52 }); }
  function insertDate() { const txt = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); if (activeEl && activeEl.isContentEditable) { armPre(); commitPre(); activeEl.focus(); document.execCommand('insertText', false, txt); } else { makeFloat(h('div', { class: 'dke-textbox dke-tb', contenteditable: 'true', text: txt }), { w: 360, h: 70 }); } }

  /* ---------- colour / font ---------- */
  function setAccent(c) { ['--cobalt', '--accent', '--sc', '--verm'].forEach(v => document.documentElement.style.setProperty(v, c)); }
  function setSlideBg(c) { const s = activeSlide(); if (s) s.style.background = c; }
  function setFont(fam) { if (activeEl && fam) { record(); activeEl.style.fontFamily = fam; } }
  function setSize(px) { if (activeEl && px) { record(); activeEl.style.fontSize = px + 'px'; } }
  function setLine(v) { if (activeEl && v) { record(); activeEl.style.lineHeight = v; } }

  /* ---------- linking (text selection, a whole module/block, or a floating box) ---------- */
  // target is {url:'…'} for an external link, or {slide:N} for an in-deck jump.
  function applyAnchorAttrs(a, t) {
    if (!a) return;
    if (t.slide) { a.setAttribute('href', '#' + t.slide); a.setAttribute('data-deck-goto', String(t.slide)); a.classList.add('dke-slidelink'); a.removeAttribute('target'); a.removeAttribute('rel'); }
    else { a.setAttribute('href', t.url); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); a.removeAttribute('data-deck-goto'); a.classList.remove('dke-slidelink'); }
  }
  function linkTarget(t, savedRange) {
    record();
    const href = t.slide ? '#' + t.slide : t.url;
    if (savedRange) {                             // link just the selected text
      const anc = savedRange.commonAncestorContainer;
      const host = (anc.nodeType === 1 ? anc : anc.parentElement).closest('[contenteditable="true"],.dke-textbox');
      if (host) host.focus();
      const s = document.getSelection(); s.removeAllRanges(); s.addRange(savedRange);
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('createLink', false, href);
      applyAnchorAttrs(s.anchorNode && s.anchorNode.parentElement && s.anchorNode.parentElement.closest('a'), t);
      return;
    }
    if (selectedFloat) {                          // link the whole floating box
      const skip = c => c.classList && (c.classList.contains('dke-grip') || c.classList.contains('dke-del') || c.classList.contains('dke-rsz'));
      let a = selectedFloat.querySelector(':scope > a.dke-link');
      if (!a) { a = h('a', { class: 'dke-link', style: 'display:block;width:100%;height:100%;color:inherit;text-decoration:none' });
        [...selectedFloat.children].filter(c => !skip(c)).forEach(c => a.appendChild(c)); selectedFloat.insertBefore(a, selectedFloat.firstChild); }
      applyAnchorAttrs(a, t);
    } else if (activeEl) {                         // link the focused block/module
      const p = activeEl.parentNode;
      let a;
      if (p && p.tagName === 'A' && p.classList.contains('dke-link')) a = p;
      else { a = h('a', { class: 'dke-link', style: 'display:contents;color:inherit' }); p.insertBefore(a, activeEl); a.appendChild(activeEl); }
      applyAnchorAttrs(a, t);
    }
  }

  /* ---------- slide operations ---------- */
  function afterSlideOp(idx) { setTimeout(() => { rehydrateFloats(); applyEditables(editing); gotoSlide(Math.max(0, Math.min(slideCount() - 1, idx))); }, 0); }
  function dupSlide() { const s = activeSlide(); if (!s) return; record(); const i = activeIndex(); const c = s.cloneNode(true); c.removeAttribute('data-deck-active'); c.removeAttribute('data-deck-slide'); s.after(c); afterSlideOp(i + 1); }
  function delSlide() { if (slideCount() <= 1) return; record(); const i = activeIndex(); activeSlide().remove(); afterSlideOp(i); }
  function commonSlideClass() { const secs = sections(); if (!secs.length) return 'slide'; let c = [...secs[0].classList]; secs.forEach(s => { const cl = [...s.classList]; c = c.filter(x => cl.includes(x)); }); return c.join(' ') || 'slide'; }
  function addBlankSlide() { record(); const i = activeIndex(); const s = h('section', { class: commonSlideClass() }); s.innerHTML = '<div class="pad"><h2 data-anim>New slide</h2></div>'; const a = activeSlide(); if (a) a.after(s); else stage().appendChild(s); afterSlideOp(i + 1); }

  /* ---------- popover (no window.prompt) ---------- */
  function popover(anchor, fields, onOk) {
    closePop();
    const pop = h('div', { class: 'dke-pop' });
    const inputs = fields.map(f => { const inp = h('input', { type: f.type || 'text', placeholder: f.ph || '', value: f.value || '' }); pop.append(h('div', { class: 'row' }, [h('span', { text: f.label }), inp])); return inp; });
    pop.append(h('div', { class: 'row' }, [h('button', { text: 'Add', onclick: () => { onOk(inputs.map(i => i.value)); closePop(); } }), h('button', { class: 'ghost', text: 'Cancel', onclick: closePop })]));
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect(); pop.style.top = (r.bottom + 8) + 'px'; pop.style.left = Math.min(r.left, innerWidth - 260) + 'px';
    window.__dkePop = pop; inputs[0] && inputs[0].focus();
  }
  function closePop() { if (window.__dkePop) { window.__dkePop.remove(); window.__dkePop = null; } }

  /* ---------- download ---------- */
  function download() {
    const was = editing; if (was) setEdit(false); selectFloat(null); clearGuides();
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('.dke-bar,.dke-hint,.dke-pop,.dke-guide,.dke-fx-pointer,.dke-fx-spot,#deck-stage-print-page').forEach(n => n.remove());
    clone.querySelectorAll('[data-deck-active],[data-deck-slide]').forEach(n => { n.removeAttribute('data-deck-active'); n.removeAttribute('data-deck-slide'); });
    clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
    clone.querySelectorAll('[data-dke-edit]').forEach(n => n.removeAttribute('data-dke-edit'));
    clone.querySelectorAll('.dke-float.sel').forEach(n => n.classList.remove('sel'));
    const out = '<!DOCTYPE html>\n' + clone.outerHTML;
    const a = h('a', { href: URL.createObjectURL(new Blob([out], { type: 'text/html' })), download: 'deck.edited.html' });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    if (was) setEdit(true);
  }

  /* ---------- CSS ---------- */
  document.head.appendChild(h('style', { id: 'deck-editor-css', html: `
    .dke-bar{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483600;
      display:flex;flex-wrap:nowrap;align-items:center;gap:4px;max-width:97vw;overflow-x:auto;overflow-y:hidden;
      background:#0b0d12;color:#fff;border-radius:12px;padding:7px 9px;scrollbar-width:thin;
      font-family:ui-monospace,"IBM Plex Mono",Menlo,monospace;font-size:12.5px;
      box-shadow:0 8px 30px rgba(0,0,0,.35);opacity:.28;transition:opacity .18s;user-select:none;}
    .dke-bar:hover,body.dke-editing .dke-bar{opacity:1;}
    .dke-bar::-webkit-scrollbar{height:6px;}.dke-bar::-webkit-scrollbar-thumb{background:rgba(255,255,255,.25);border-radius:3px;}
    .dke-bar>*,.dke-bar .dke-grp>*{flex:0 0 auto;}
    .dke-bar button,.dke-bar label.dke-btn{appearance:none;border:0;background:transparent;color:#e8ecf3;font:inherit;cursor:pointer;
      height:30px;min-width:30px;padding:0 9px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;}
    .dke-bar button:hover,.dke-bar label.dke-btn:hover{background:rgba(255,255,255,.12);}
    .dke-bar button.on{background:#2f6bff;color:#fff;}
    .dke-bar button:disabled{cursor:default;}
    .dke-bar .dke-sep{width:1px;height:20px;background:rgba(255,255,255,.16);margin:0 3px;}
    .dke-bar select{background:#1b2130;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:7px;height:30px;font:inherit;padding:0 6px;cursor:pointer;}
    .dke-bar input[type=number]{width:52px;background:#1b2130;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:7px;height:30px;font:inherit;padding:0 6px;}
    .dke-bar input[type=color]{width:26px;height:26px;padding:0;border:0;border-radius:6px;background:none;cursor:pointer;}
    .dke-bar .dke-grp{display:inline-flex;align-items:center;gap:2px;}
    .dke-bar .dke-primary{background:#2f6bff;color:#fff;font-weight:600;}
    .dke-hint{position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:2147483600;background:#0b0d12;color:#fff;
      font-family:ui-monospace,monospace;font-size:12px;padding:5px 12px;border-radius:8px;opacity:0;transition:opacity .18s;pointer-events:none;}
    body.dke-editing .dke-hint{opacity:.9;}
    body.dke-editing [data-dke-edit]{outline:1.5px dashed rgba(47,107,255,.4);outline-offset:4px;border-radius:2px;cursor:text;}
    body.dke-editing [data-dke-edit]:hover{outline-style:solid;outline-color:rgba(47,107,255,.65);}
    body.dke-editing [data-dke-edit]:focus{outline:2px solid #2f6bff;background:rgba(47,107,255,.06);}
    .dke-float{position:absolute;z-index:40;min-width:60px;min-height:36px;box-sizing:border-box;}
    body.dke-editing .dke-float{outline:1.5px solid rgba(47,107,255,.5);}
    .dke-float.sel{outline:2px solid #2f6bff !important;}
    .dke-float .dke-grip,.dke-float .dke-del,.dke-float .dke-rsz{position:absolute;display:none;z-index:5;font-family:ui-monospace,monospace;}
    body.dke-editing .dke-float .dke-grip,body.dke-editing .dke-float .dke-del,body.dke-editing .dke-float .dke-rsz{display:flex;}
    .dke-float .dke-grip{top:-26px;left:0;height:22px;padding:0 8px;align-items:center;gap:6px;background:#2f6bff;color:#fff;font-size:12px;border-radius:6px;cursor:grab;}
    .dke-float .dke-del{top:-26px;right:0;width:22px;height:22px;align-items:center;justify-content:center;background:#e5484d;color:#fff;font-size:13px;border-radius:6px;cursor:pointer;}
    .dke-float .dke-rsz{right:-7px;bottom:-7px;width:16px;height:16px;background:#fff;border:2px solid #2f6bff;border-radius:3px;cursor:nwse-resize;}
    .dke-float .dke-textbox{width:100%;height:100%;outline:none;color:inherit;}
    .dke-tb{color:#fff;font-family:"Inter",system-ui,sans-serif;font-size:34px;line-height:1.3;}
    .dke-float img,.dke-float video,.dke-float iframe{width:100%;height:100%;object-fit:contain;display:block;border:0;background:#0003;}
    .dke-etable{border-collapse:collapse;width:100%;height:100%;font-family:"Inter",sans-serif;color:inherit;font-size:22px;background:#00000010;}
    .dke-etable td{border:1px solid currentColor;padding:8px 12px;min-width:60px;}
    .dke-guide{position:absolute;background:#2f6bff;z-index:60;pointer-events:none;box-shadow:0 0 0 .5px rgba(47,107,255,.4);}
    .dke-guide.v{width:1px;top:0;bottom:0;} .dke-guide.h{height:1px;left:0;right:0;}
    .dke-pop{position:fixed;z-index:2147483601;background:#0b0d12;color:#fff;border-radius:10px;padding:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);
      font-family:ui-monospace,monospace;font-size:13px;display:flex;flex-direction:column;gap:8px;min-width:240px;}
    .dke-pop input{background:#1b2130;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:6px;height:32px;font:inherit;padding:0 8px;}
    .dke-pop .row{display:flex;gap:8px;align-items:center;}
    .dke-pop button{background:#2f6bff;color:#fff;border:0;border-radius:6px;height:32px;padding:0 12px;cursor:pointer;font:inherit;}
    .dke-pop button.ghost{background:rgba(255,255,255,.12);}
    @media print{.dke-bar,.dke-hint,.dke-guide,.dke-float .dke-grip,.dke-float .dke-del,.dke-float .dke-rsz{display:none !important;}.dke-float{outline:none !important;}}
  ` }));

  /* ---------- presentation effects: page-turn / motion / hover / pointer ---------- */
  document.head.appendChild(h('style', { id: 'dke-fx-css', html: `
    html[data-fx-transition="fade"] deck-stage>section{transition:opacity var(--fx-td,.45s) ease;}
    html[data-fx-transition="slide"] deck-stage>section{transition:opacity var(--fx-td,.45s) ease, transform var(--fx-td,.45s) ease;}
    html[data-fx-transition="slide"] deck-stage>section:not([data-deck-active]){transform:translateX(64px);}
    html[data-fx-transition="flip"] deck-stage>section{transition:opacity var(--fx-td,.5s) ease, transform var(--fx-td,.5s) ease;transform-origin:50% 50%;backface-visibility:hidden;}
    html[data-fx-transition="flip"] deck-stage>section:not([data-deck-active]){transform:perspective(1600px) rotateY(14deg) scale(.97);}
    html[data-fx-hover="lift"] deck-stage .card,html[data-fx-hover="lift"] deck-stage .stat{transition:transform .2s ease,box-shadow .2s ease;}
    html[data-fx-hover="lift"] deck-stage .card:hover,html[data-fx-hover="lift"] deck-stage .stat:hover{transform:translateY(-6px);box-shadow:0 16px 34px rgba(0,0,0,.20);}
    html[data-fx-hover="glow"] deck-stage .card:hover,html[data-fx-hover="glow"] deck-stage .stat:hover{box-shadow:0 0 0 2px var(--cobalt,#2f6bff),0 0 28px rgba(47,107,255,.4);transition:box-shadow .2s ease;}
    html[data-fx-motion="off"] [data-anim]{animation:none !important;opacity:1 !important;transform:none !important;}
    html[data-fx-motion="dynamic"] [data-deck-active] [data-anim]{animation-duration:var(--fx-rd,.9s);}
    .dke-fx-pointer{position:fixed;z-index:2147483000;pointer-events:none;width:22px;height:22px;border-radius:50%;transform:translate(-50%,-50%);display:none;background:radial-gradient(circle,#ff3b3b,rgba(255,59,59,.2) 55%,transparent 70%);box-shadow:0 0 14px 4px rgba(255,59,59,.5);}
    .dke-fx-spot{position:fixed;inset:0;z-index:2147482990;pointer-events:none;display:none;background:radial-gradient(260px circle at var(--mx,50%) var(--my,50%),transparent 0,transparent 190px,rgba(0,0,0,.6) 480px);}
    .dke-pop select{background:#1b2130;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:6px;height:32px;font:inherit;padding:0 8px;flex:1;}
    .dke-pop input[type=range]{flex:1;}
    @media print{.dke-fx-pointer,.dke-fx-spot{display:none !important;}}
  ` }));
  const fxDot = h('div', { class: 'dke-fx-pointer' }), fxSpot = h('div', { class: 'dke-fx-spot' });
  document.body.append(fxDot, fxSpot);
  function applyPointer() { const m = document.documentElement.dataset.fxPointer || 'off'; fxDot.style.display = m === 'laser' ? 'block' : 'none'; fxSpot.style.display = m === 'spotlight' ? 'block' : 'none'; }
  window.addEventListener('mousemove', e => { const m = document.documentElement.dataset.fxPointer; if (m === 'laser') { fxDot.style.left = e.clientX + 'px'; fxDot.style.top = e.clientY + 'px'; } else if (m === 'spotlight') { fxSpot.style.setProperty('--mx', e.clientX + 'px'); fxSpot.style.setProperty('--my', e.clientY + 'px'); } }, { passive: true });
  function fxPanel(anchor) {
    closePop();
    const R = document.documentElement;
    const row = (label, attr, opts, after) => { const s = h('select', { onchange: e => { e.target.value ? R.setAttribute(attr, e.target.value) : R.removeAttribute(attr); after && after(); } }, opts.map(o => h('option', { value: o[1] }, o[0]))); s.value = R.getAttribute(attr) || opts[0][1]; return h('div', { class: 'row' }, [h('span', { text: label, style: 'min-width:104px' }), s]); };
    const pop = h('div', { class: 'dke-pop', style: 'min-width:320px' });
    pop.append(
      row('Page-turn', 'data-fx-transition', [['None', 'none'], ['Fade', 'fade'], ['Slide', 'slide'], ['Flip', 'flip']]),
      row('Reveal motion', 'data-fx-motion', [['Default', ''], ['Off', 'off'], ['Dynamic', 'dynamic']]),
      row('Hover effect', 'data-fx-hover', [['Off', ''], ['Lift', 'lift'], ['Glow', 'glow']]),
      row('Pointer mode', 'data-fx-pointer', [['Off', 'off'], ['Laser', 'laser'], ['Spotlight', 'spotlight']], applyPointer)
    );
    const dur = h('input', { type: 'range', min: '150', max: '1200', step: '50', value: String((parseFloat(getComputedStyle(R).getPropertyValue('--fx-td')) || .45) * 1000), oninput: e => R.style.setProperty('--fx-td', (e.target.value / 1000) + 's') });
    pop.append(h('div', { class: 'row' }, [h('span', { text: 'Turn speed (ms)', style: 'min-width:104px' }), dur]));

    pop.append(h('div', { class: 'row' }, [h('button', { class: 'ghost', text: 'Close', onclick: closePop })]));
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect(); pop.style.top = (r.bottom + 8) + 'px'; pop.style.left = Math.min(r.left, innerWidth - 340) + 'px';
    window.__dkePop = pop;
  }

  /* ---------- build toolbar ---------- */
  const nP = e => e.preventDefault();
  const bEdit = h('button', { class: 'dke-primary', text: '✎ Edit', onmousedown: nP, onclick: () => setEdit(!editing) });
  const bUndo = h('button', { text: '↶', title: 'Undo (Ctrl/Cmd+Z)', onmousedown: nP, onclick: undo });
  const bRedo = h('button', { text: '↷', title: 'Redo (Ctrl/Cmd+Shift+Z)', onmousedown: nP, onclick: redo });
  const bB = h('button', { html: '<b>B</b>', title: 'Bold', onmousedown: nP, onclick: () => exec('bold') });
  const bI = h('button', { html: '<i>I</i>', title: 'Italic', onmousedown: nP, onclick: () => exec('italic') });
  const bU = h('button', { html: '<u>U</u>', title: 'Underline', onmousedown: nP, onclick: () => exec('underline') });
  const bLink = h('button', { text: '🔗', title: 'Link text / module / box → URL or slide', onmousedown: nP, onclick: () => {
    const g = document.getSelection(); const rng = (g && g.rangeCount && !g.isCollapsed && g.toString().trim()) ? g.getRangeAt(0).cloneRange() : null;
    popover(bLink, [{ label: 'URL / path', ph: 'https://… or /path' }, { label: 'or → slide #', type: 'number', ph: 'e.g. 7' }], ([u, sl]) => {
      const t = (sl && +sl > 0) ? { slide: +sl } : (u ? { url: u } : null); if (t) linkTarget(t, rng);
    }); } });
  const selFont = h('select', { title: 'Font', onmousedown: nP, onchange: e => setFont(e.target.value) }, FONTS.map(f => h('option', { value: f[1] }, f[0])));
  const szIn = h('input', { type: 'number', title: 'Font size (px)', min: '6', max: '400', onmousedown: e => e.stopPropagation(), onchange: e => setSize(+e.target.value) });
  const lhIn = h('input', { type: 'number', title: 'Line height', min: '0.6', max: '4', step: '0.05', onmousedown: e => e.stopPropagation(), onchange: e => setLine(e.target.value) });
  const colText = h('input', { type: 'color', title: 'Text colour', value: '#111111', onfocus: armPre, oninput: e => document.execCommand('foreColor', false, e.target.value), onchange: commitPre });
  const colHi = h('input', { type: 'color', title: 'Highlight', value: '#ffe066', onfocus: armPre, oninput: e => { document.execCommand('styleWithCSS', false, true); document.execCommand('hiliteColor', false, e.target.value); }, onchange: commitPre });
  const colAcc = h('input', { type: 'color', title: 'Deck accent', value: '#1246e0', onfocus: armPre, oninput: e => setAccent(e.target.value), onchange: commitPre });
  const colBg = h('input', { type: 'color', title: 'Slide background', value: '#ffffff', onfocus: armPre, oninput: e => setSlideBg(e.target.value), onchange: commitPre });
  const bSnap = h('button', { text: '⌗ Snap', title: 'Snap to grid + guides', onmousedown: nP, onclick: () => { snapOn = !snapOn; bSnap.classList.toggle('on', snapOn); } });
  bSnap.classList.add('on');
  const bText = h('button', { text: '＋Text', onclick: insertTextBox });
  const lblImg = h('label', { class: 'dke-btn', text: '＋Image' }, [h('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: e => { if (e.target.files[0]) insertImageFile(e.target.files[0]); e.target.value = ''; } })]);
  const bVid = h('button', { text: '＋Video', onclick: () => popover(bVid, [{ label: 'URL', ph: 'mp4 link or YouTube URL' }], ([u]) => u && insertVideo(u)) });
  const bTable = h('button', { text: '＋Table', onclick: () => popover(bTable, [{ label: 'Rows', type: 'number', value: '3' }, { label: 'Cols', type: 'number', value: '3' }], ([r, c]) => insertTable(+r || 3, +c || 3)) });
  const bDate = h('button', { text: '＋Date', onclick: insertDate });
  const bBlank = h('button', { text: '＋Slide', title: 'Add blank slide', onmousedown: nP, onclick: addBlankSlide });
  const bDup = h('button', { text: '⧉', title: 'Duplicate slide', onmousedown: nP, onclick: dupSlide });
  const bDel = h('button', { text: '⌫', title: 'Delete slide', onmousedown: nP, onclick: delSlide });
  const bFX = h('button', { text: '⚙ FX', title: 'Presentation effects (page-turn, motion, hover, pointer)', onmousedown: nP, onclick: () => fxPanel(bFX) });
  const bDl = h('button', { text: '⤓ Download', onclick: download });
  const sep = () => h('span', { class: 'dke-sep' });

  const bar = h('div', { class: 'dke-bar' }, [
    bEdit, sep(), h('span', { class: 'dke-grp' }, [bUndo, bRedo]), sep(),
    h('span', { class: 'dke-grp' }, [bB, bI, bU, bLink]), sep(),
    h('span', { class: 'dke-grp' }, [selFont, szIn, h('span', { text: 'lh' }), lhIn]), sep(),
    h('span', { class: 'dke-grp' }, [h('span', { text: 'A' }), colText, h('span', { text: '🖊' }), colHi]), sep(),
    h('span', { class: 'dke-grp' }, [h('span', { text: 'Acc' }), colAcc, h('span', { text: 'BG' }), colBg]), sep(),
    bSnap, sep(),
    h('span', { class: 'dke-grp' }, [bText, lblImg, bVid, bTable, bDate]), sep(),
    h('span', { class: 'dke-grp' }, [bBlank, bDup, bDel]), sep(),
    bFX, sep(),
    bDl
  ]);
  if (!LOCKED) document.body.append(bar, h('div', { class: 'dke-hint', text: 'Click text to edit · drag ⠿ · × delete · Ctrl+Z undo · Esc to finish' }));
  refreshUndo();
  rehydrateFloats();
  applyPointer();   // restore pointer overlay if the (exported) deck had one set

  /* click an existing deck image to swap it */
  // In-deck slide links (data-deck-goto) navigate to that slide — works in view
  // mode and in the exported deck (this module ships with it). Registered before
  // the edit handler so it runs in both; it only acts when NOT editing.
  document.addEventListener('click', e => {
    if (editing) return;
    const a = e.target.closest && e.target.closest('a[data-deck-goto]');
    if (a && a.closest('deck-stage')) { e.preventDefault(); const n = parseInt(a.getAttribute('data-deck-goto'), 10); if (n >= 1) gotoSlide(n - 1); }
  }, true);
  document.addEventListener('click', e => {
    if (!editing) return;
    const lnk = e.target.closest && e.target.closest('a');
    if (lnk && lnk.closest('deck-stage')) e.preventDefault();   // don't navigate while editing
    const img = e.target.closest && e.target.closest('deck-stage img');
    if (img && !img.closest('.dke-float')) { const inp = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: ev => ev.target.files[0] && insertImageFile(ev.target.files[0], img) }); document.body.appendChild(inp); inp.click(); setTimeout(() => inp.remove(), 1000); }
  });
  document.addEventListener('mousedown', e => { if (!e.target.closest('.dke-float') && !e.target.closest('.dke-bar')) selectFloat(null); });
  document.addEventListener('keydown', e => {
    const t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { if (!/^(INPUT|TEXTAREA)$/.test(t.tagName)) { e.preventDefault(); e.shiftKey ? redo() : undo(); } return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
    if (e.key === 'Escape') { if (window.__dkePop) closePop(); else if (editing) setEdit(false); }
    if (editing && selectedFloat && e.key === 'Delete' && !typing) { record(); selectedFloat.remove(); selectedFloat = null; }
  }, true);
})();
