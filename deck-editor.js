/**
 * deck-editor.js — an optional in-browser WYSIWYG editor for <deck-stage> decks.
 *
 * Drop this module into a deck (inline it in a <script> so the deck stays a
 * single self-contained file). When loaded it adds a floating toolbar:
 *
 *   ✎ Edit / ✓ Done   toggle edit mode (click any text to edit in place)
 *   B  I  U  🔗        bold / italic / underline / link the current selection
 *   Aa ± font          font family + size for the focused text block
 *   A  Hi              text colour + highlight for the selection
 *   ◧ Accent  ◨ BG      recolour the whole deck's accent, or the current slide bg
 *   ＋Text ＋Image      insert a draggable text box or an embedded image
 *   ＋Video ＋Table      insert a video (URL / YouTube) or a table
 *   ＋Date              insert today's date at the cursor
 *   ⤓ Download          save the edited deck as a new self-contained .html
 *
 * Inserted images are embedded as data: URIs so the exported file stays
 * self-contained. Floating elements (text boxes, images, videos, tables) can be
 * dragged by their grip, resized from the corner, and deleted. Everything is
 * scale-aware: dragging maps screen pixels back to the 1920×1080 design stage.
 *
 * The editor UI, its runtime attributes, and edit state are stripped from the
 * downloaded copy — the export opens clean (view mode) but keeps this module,
 * so the saved deck remains editable.
 *
 * Requires: a <deck-stage> element in the page. No external dependencies.
 */
(() => {
  if (window.__deckEditorLoaded) return;
  window.__deckEditorLoaded = true;

  // Text blocks that become directly editable in edit mode.
  const EDIT_SEL = [
    'h1','h2','h3','.htitle','.kicker','.kick','.sub','.lead','.lead2',
    '.secidx','.idx','.bignum','.num','p','li','td','th','.chip','.cap',
    '.ex','.n','.l','.cite','.legend','.dhead','.foot > div','.val','.lab',
    '.stat .l','blockquote','figcaption'
  ].join(',');

  const FONTS = [
    ['Default',''],
    ['Archivo','"Archivo", sans-serif'],
    ['Space Grotesk','"Space Grotesk", sans-serif'],
    ['Inter','"Inter", sans-serif'],
    ['Fraunces','"Fraunces", serif'],
    ['IBM Plex Mono','"IBM Plex Mono", monospace'],
    ['Georgia','Georgia, serif'],
    ['Helvetica','Helvetica, Arial, sans-serif']
  ];

  let editing = false;
  let activeEl = null;      // last-focused editable block
  let selectedFloat = null; // currently selected floating element

  /* ---------- helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const stage = () => $('deck-stage');
  const activeSlide = () => $('deck-stage > section[data-deck-active]') || $('deck-stage > section');
  const editables = () => $$('deck-stage > section').flatMap(s => $$(EDIT_SEL, s));

  function slideScale() {
    const s = activeSlide();
    if (!s) return 1;
    const r = s.getBoundingClientRect();
    return r.width / (s.offsetWidth || 1920) || 1;
  }
  // Convert a screen point to design-stage (px within the 1920×1080 slide).
  function toStage(clientX, clientY) {
    const s = activeSlide(), r = s.getBoundingClientRect(), k = slideScale();
    return { x: (clientX - r.left) / k, y: (clientY - r.top) / k, k };
  }

  function h(tag, props = {}, kids = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v != null) el.setAttribute(k, v);
    }
    (Array.isArray(kids) ? kids : [kids]).forEach(k => k != null &&
      el.append(k.nodeType ? k : document.createTextNode(k)));
    return el;
  }

  /* ---------- CSS ---------- */
  function injectCSS() {
    document.head.appendChild(h('style', { id: 'deck-editor-css', html: `
      .dke-bar{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483600;
        display:flex;flex-wrap:nowrap;align-items:center;gap:4px;max-width:97vw;overflow-x:auto;overflow-y:hidden;
        background:#0b0d12;color:#fff;border-radius:12px;padding:7px 9px;
        font-family:ui-monospace,"IBM Plex Mono",Menlo,monospace;font-size:12.5px;
        box-shadow:0 8px 30px rgba(0,0,0,.35);opacity:.28;transition:opacity .18s;user-select:none;
        scrollbar-width:thin;}
      .dke-bar::-webkit-scrollbar{height:6px;} .dke-bar::-webkit-scrollbar-thumb{background:rgba(255,255,255,.25);border-radius:3px;}
      .dke-bar>*,.dke-bar .dke-grp>*{flex:0 0 auto;}
      .dke-bar:hover,body.dke-editing .dke-bar{opacity:1;}
      .dke-bar button,.dke-bar label.dke-btn{appearance:none;border:0;background:transparent;color:#e8ecf3;
        font:inherit;cursor:pointer;height:30px;min-width:30px;padding:0 9px;border-radius:7px;
        display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;}
      .dke-bar button:hover,.dke-bar label.dke-btn:hover{background:rgba(255,255,255,.12);}
      .dke-bar button.on{background:#2f6bff;color:#fff;}
      .dke-bar .dke-sep{width:1px;height:20px;background:rgba(255,255,255,.16);margin:0 3px;}
      .dke-bar select{background:#1b2130;color:#fff;border:1px solid rgba(255,255,255,.18);
        border-radius:7px;height:30px;font:inherit;padding:0 6px;cursor:pointer;}
      .dke-bar input[type=color]{width:26px;height:26px;padding:0;border:0;border-radius:6px;background:none;cursor:pointer;}
      .dke-bar .dke-grp{display:inline-flex;align-items:center;gap:2px;}
      .dke-bar .dke-primary{background:#2f6bff;color:#fff;font-weight:600;}
      .dke-bar .dke-primary.on{background:#1746c8;}
      .dke-hint{position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:2147483600;
        background:#0b0d12;color:#fff;font-family:ui-monospace,monospace;font-size:12px;
        padding:5px 12px;border-radius:8px;opacity:0;transition:opacity .18s;pointer-events:none;}
      body.dke-editing .dke-hint{opacity:.9;}

      body.dke-editing [data-dke-edit]{outline:1.5px dashed rgba(47,107,255,.4);outline-offset:4px;border-radius:2px;cursor:text;}
      body.dke-editing [data-dke-edit]:hover{outline-style:solid;outline-color:rgba(47,107,255,.65);}
      body.dke-editing [data-dke-edit]:focus{outline:2px solid #2f6bff;background:rgba(47,107,255,.06);}

      .dke-float{position:absolute;z-index:40;min-width:60px;min-height:36px;box-sizing:border-box;}
      body.dke-editing .dke-float{outline:1.5px solid rgba(47,107,255,.5);}
      .dke-float.sel{outline:2px solid #2f6bff !important;}
      .dke-float .dke-grip,.dke-float .dke-del,.dke-float .dke-rsz{position:absolute;display:none;
        z-index:5;font-family:ui-monospace,monospace;}
      body.dke-editing .dke-float .dke-grip,body.dke-editing .dke-float .dke-del,body.dke-editing .dke-float .dke-rsz{display:flex;}
      .dke-float .dke-grip{top:-26px;left:0;height:22px;padding:0 8px;align-items:center;gap:6px;
        background:#2f6bff;color:#fff;font-size:12px;border-radius:6px;cursor:grab;}
      .dke-float .dke-del{top:-26px;right:0;width:22px;height:22px;align-items:center;justify-content:center;
        background:#e5484d;color:#fff;font-size:13px;border-radius:6px;cursor:pointer;}
      .dke-float .dke-rsz{right:-7px;bottom:-7px;width:16px;height:16px;background:#fff;border:2px solid #2f6bff;
        border-radius:3px;cursor:nwse-resize;}
      .dke-float .dke-textbox{width:100%;height:100%;outline:none;color:inherit;}
      .dke-tb{color:#fff;font-family:"Inter",system-ui,sans-serif;font-size:34px;line-height:1.3;}
      .dke-float img,.dke-float video,.dke-float iframe{width:100%;height:100%;object-fit:contain;display:block;border:0;background:#0003;}
      .dke-etable{border-collapse:collapse;width:100%;height:100%;font-family:"Inter",sans-serif;color:inherit;font-size:22px;background:#00000010;}
      .dke-etable td{border:1px solid currentColor;padding:8px 12px;min-width:60px;}

      .dke-pop{position:fixed;z-index:2147483601;background:#0b0d12;color:#fff;border-radius:10px;
        padding:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);font-family:ui-monospace,monospace;font-size:13px;
        display:flex;flex-direction:column;gap:8px;min-width:240px;}
      .dke-pop input,.dke-pop select{background:#1b2130;color:#fff;border:1px solid rgba(255,255,255,.2);
        border-radius:6px;height:32px;font:inherit;padding:0 8px;}
      .dke-pop .row{display:flex;gap:8px;align-items:center;}
      .dke-pop button{background:#2f6bff;color:#fff;border:0;border-radius:6px;height:32px;padding:0 12px;cursor:pointer;font:inherit;}
      .dke-pop button.ghost{background:rgba(255,255,255,.12);}
      @media print{.dke-bar,.dke-hint,.dke-float .dke-grip,.dke-float .dke-del,.dke-float .dke-rsz{display:none !important;}
        .dke-float{outline:none !important;}}
    `}));
  }

  /* ---------- selection / focus tracking ---------- */
  document.addEventListener('focusin', e => {
    const b = e.target.closest && e.target.closest('[data-dke-edit],.dke-textbox');
    if (b) activeEl = b;
  });

  function exec(cmd, val = null) {
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, val);
    syncFormatButtons();
  }
  function syncFormatButtons() {
    try {
      bBold.classList.toggle('on', document.queryCommandState('bold'));
      bItal.classList.toggle('on', document.queryCommandState('italic'));
      bUnd.classList.toggle('on', document.queryCommandState('underline'));
    } catch (_) {}
  }
  document.addEventListener('selectionchange', () => { if (editing) syncFormatButtons(); });

  /* ---------- edit mode ---------- */
  function setEdit(on) {
    editing = on;
    document.body.classList.toggle('dke-editing', on);
    editables().forEach(el => {
      if (on) { el.setAttribute('contenteditable', 'true'); el.setAttribute('data-dke-edit', ''); el.spellcheck = false; }
      else { el.removeAttribute('contenteditable'); el.removeAttribute('data-dke-edit'); }
    });
    $$('.dke-textbox').forEach(t => t.contentEditable = on ? 'true' : 'false');
    bEdit.classList.toggle('on', on);
    bEdit.textContent = on ? '✓ Done' : '✎ Edit';
    if (!on) selectFloat(null);
  }

  /* ---------- floating elements ---------- */
  function makeFloat(inner, { x = 760, y = 440, w = 400, h: hh = 220, cls = '' } = {}) {
    const slide = activeSlide();
    const f = h('div', { class: 'dke-float ' + cls });
    f.style.left = x + 'px'; f.style.top = y + 'px'; f.style.width = w + 'px'; f.style.height = hh + 'px';
    const grip = h('div', { class: 'dke-grip', text: '⠿ drag' });
    const del = h('div', { class: 'dke-del', text: '×', title: 'Delete', onclick: (e) => { e.stopPropagation(); f.remove(); if (selectedFloat === f) selectedFloat = null; } });
    const rsz = h('div', { class: 'dke-rsz' });
    f.append(inner, grip, del, rsz);
    f.addEventListener('mousedown', () => selectFloat(f));
    dragify(f, grip, rsz);
    slide.appendChild(f);
    selectFloat(f);
    return f;
  }
  function selectFloat(f) {
    if (selectedFloat) selectedFloat.classList.remove('sel');
    selectedFloat = f;
    if (f) f.classList.add('sel');
  }
  function dragify(f, grip, rsz) {
    let mode = null, sx, sy, ox, oy, ow, oh;
    const down = (m) => (e) => {
      if (!editing) return;
      e.preventDefault(); e.stopPropagation();
      mode = m; sx = e.clientX; sy = e.clientY;
      ox = parseFloat(f.style.left); oy = parseFloat(f.style.top);
      ow = parseFloat(f.style.width); oh = parseFloat(f.style.height);
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    };
    const move = (e) => {
      const k = slideScale();
      const dx = (e.clientX - sx) / k, dy = (e.clientY - sy) / k;
      if (mode === 'move') { f.style.left = (ox + dx) + 'px'; f.style.top = (oy + dy) + 'px'; }
      else { f.style.width = Math.max(60, ow + dx) + 'px'; f.style.height = Math.max(36, oh + dy) + 'px'; }
    };
    const up = () => { mode = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    grip.addEventListener('mousedown', down('move'));
    rsz.addEventListener('mousedown', down('resize'));
  }

  /* ---------- inserts ---------- */
  function insertTextBox() {
    const tb = h('div', { class: 'dke-textbox dke-tb', contenteditable: 'true', text: 'New text' });
    makeFloat(tb, { w: 460, h: 120 });
    setTimeout(() => { tb.focus(); document.getSelection().selectAllChildren(tb); }, 0);
  }
  function insertImageFile(file, existingImg) {
    const rd = new FileReader();
    rd.onload = () => {
      if (existingImg) { existingImg.src = rd.result; return; }
      const img = h('img', { src: rd.result, alt: '' });
      makeFloat(img, { w: 520, h: 360 });
    };
    rd.readAsDataURL(file);
  }
  function insertVideo(url) {
    let node;
    const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{11})/);
    if (yt) node = h('iframe', { src: 'https://www.youtube.com/embed/' + yt[1], allow: 'fullscreen', frameborder: '0' });
    else node = h('video', { src: url, controls: '', playsinline: '' });
    makeFloat(node, { w: 640, h: 360 });
  }
  function insertTable(rows, cols) {
    const t = h('table', { class: 'dke-etable' });
    for (let r = 0; r < rows; r++) {
      const tr = h('tr');
      for (let c = 0; c < cols; c++) tr.appendChild(h('td', { contenteditable: 'true', text: r === 0 ? 'Head' : '' }));
      t.appendChild(tr);
    }
    makeFloat(t, { w: cols * 160, h: rows * 52 });
  }
  function insertDate() {
    const txt = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    if (activeEl && activeEl.isContentEditable) { activeEl.focus(); document.execCommand('insertText', false, txt); }
    else { const tb = h('div', { class: 'dke-textbox dke-tb', contenteditable: 'true', text: txt }); makeFloat(tb, { w: 360, h: 70 }); }
  }

  /* ---------- colour / font ---------- */
  function setAccent(color) {
    // Recolour common accent variables used by the skill's templates.
    ['--cobalt', '--accent', '--sc', '--verm'].forEach(v => document.documentElement.style.setProperty(v, color));
    // also recolour any slide that sets its own --accent inline is left as-is.
  }
  function setSlideBg(color) { const s = activeSlide(); if (s) s.style.background = color; }
  function setFont(fam) { if (activeEl) activeEl.style.fontFamily = fam; }
  function bumpFont(delta) {
    if (!activeEl) return;
    const cur = parseFloat(getComputedStyle(activeEl).fontSize) || 24;
    activeEl.style.fontSize = Math.max(8, cur + delta) + 'px';
  }

  /* ---------- small popovers (no window.prompt) ---------- */
  function popover(anchor, fields, onOk) {
    closePop();
    const pop = h('div', { class: 'dke-pop' });
    const inputs = fields.map(f => {
      const inp = f.options
        ? h('select', {}, f.options.map(o => h('option', { value: o[1] }, o[0])))
        : h('input', { type: f.type || 'text', placeholder: f.ph || '', value: f.value || '' });
      pop.append(h('div', { class: 'row' }, [h('span', { text: f.label }), inp]));
      return inp;
    });
    const ok = h('button', { text: 'Add', onclick: () => { onOk(inputs.map(i => i.value)); closePop(); } });
    const cancel = h('button', { class: 'ghost', text: 'Cancel', onclick: closePop });
    pop.append(h('div', { class: 'row' }, [ok, cancel]));
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = (r.bottom + 8) + 'px';
    pop.style.left = Math.min(r.left, window.innerWidth - 260) + 'px';
    window.__dkePop = pop;
    inputs[0] && inputs[0].focus();
  }
  function closePop() { if (window.__dkePop) { window.__dkePop.remove(); window.__dkePop = null; } }

  /* ---------- download ---------- */
  function download() {
    const was = editing;
    if (was) setEdit(false);
    selectFloat(null);
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('.dke-bar,.dke-hint,.dke-pop,#deck-stage-print-page').forEach(n => n.remove());
    clone.querySelectorAll('[data-deck-active],[data-deck-slide]').forEach(n => { n.removeAttribute('data-deck-active'); n.removeAttribute('data-deck-slide'); });
    clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
    clone.querySelectorAll('[data-dke-edit]').forEach(n => n.removeAttribute('data-dke-edit'));
    clone.querySelectorAll('.dke-float.sel').forEach(n => n.classList.remove('sel'));
    const out = '<!DOCTYPE html>\n' + clone.outerHTML;
    const a = h('a', { href: URL.createObjectURL(new Blob([out], { type: 'text/html' })), download: 'deck.edited.html' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    if (was) setEdit(true);
  }

  /* ---------- build toolbar ---------- */
  injectCSS();

  const bEdit = h('button', { class: 'dke-primary', text: '✎ Edit', onmousedown: e => e.preventDefault(), onclick: () => setEdit(!editing) });

  const bBold = h('button', { html: '<b>B</b>', title: 'Bold', onmousedown: e => e.preventDefault(), onclick: () => exec('bold') });
  const bItal = h('button', { html: '<i>I</i>', title: 'Italic', onmousedown: e => e.preventDefault(), onclick: () => exec('italic') });
  const bUnd = h('button', { html: '<u>U</u>', title: 'Underline', onmousedown: e => e.preventDefault(), onclick: () => exec('underline') });
  const bLink = h('button', { text: '🔗', title: 'Link selection', onmousedown: e => e.preventDefault(),
    onclick: () => popover(bLink, [{ label: 'URL', ph: 'https://…' }], ([u]) => { if (u) exec('createLink', u); }) });

  const selFont = h('select', { title: 'Font', onchange: e => setFont(e.target.value) }, FONTS.map(f => h('option', { value: f[1] }, f[0])));
  const bSzDn = h('button', { text: 'A−', title: 'Smaller', onmousedown: e => e.preventDefault(), onclick: () => bumpFont(-3) });
  const bSzUp = h('button', { text: 'A+', title: 'Larger', onmousedown: e => e.preventDefault(), onclick: () => bumpFont(3) });

  const colText = h('input', { type: 'color', title: 'Text colour', value: '#111111', oninput: e => exec('foreColor', e.target.value) });
  const colHi = h('input', { type: 'color', title: 'Highlight', value: '#ffe066', oninput: e => exec('hiliteColor', e.target.value) });
  const colAcc = h('input', { type: 'color', title: 'Deck accent', value: '#1246e0', oninput: e => setAccent(e.target.value) });
  const colBg = h('input', { type: 'color', title: 'Slide background', value: '#ffffff', oninput: e => setSlideBg(e.target.value) });

  const bText = h('button', { text: '＋Text', title: 'Add text box', onclick: insertTextBox });
  const lblImg = h('label', { class: 'dke-btn', text: '＋Image', title: 'Insert image' },
    [h('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: e => { if (e.target.files[0]) insertImageFile(e.target.files[0]); e.target.value = ''; } })]);
  const bVid = h('button', { text: '＋Video', title: 'Insert video (URL / YouTube)',
    onclick: () => popover(bVid, [{ label: 'URL', ph: 'mp4 link or YouTube URL' }], ([u]) => { if (u) insertVideo(u); }) });
  const bTable = h('button', { text: '＋Table', title: 'Insert table',
    onclick: () => popover(bTable, [{ label: 'Rows', type: 'number', value: '3' }, { label: 'Cols', type: 'number', value: '3' }], ([r, c]) => insertTable(+r || 3, +c || 3)) });
  const bDate = h('button', { text: '＋Date', title: 'Insert date', onclick: insertDate });

  const bDl = h('button', { text: '⤓ Download', onclick: download });

  const sep = () => h('span', { class: 'dke-sep' });
  const bar = h('div', { class: 'dke-bar' }, [
    bEdit, sep(),
    h('span', { class: 'dke-grp' }, [bBold, bItal, bUnd, bLink]), sep(),
    h('span', { class: 'dke-grp' }, [selFont, bSzDn, bSzUp]), sep(),
    h('span', { class: 'dke-grp' }, [h('span', { text: 'A' }), colText, h('span', { text: '🖊' }), colHi]), sep(),
    h('span', { class: 'dke-grp' }, [h('span', { text: 'Accent' }), colAcc, h('span', { text: 'BG' }), colBg]), sep(),
    h('span', { class: 'dke-grp' }, [bText, lblImg, bVid, bTable, bDate]), sep(),
    bDl
  ]);
  document.body.append(bar, h('div', { class: 'dke-hint', text: 'Click any text to edit · drag ⠿ to move · × to delete · Esc to finish' }));

  // Swap an existing deck image by clicking it in edit mode.
  document.addEventListener('click', e => {
    if (!editing) return;
    const img = e.target.closest && e.target.closest('deck-stage img');
    if (img && !img.closest('.dke-float')) {
      const inp = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: ev => { if (ev.target.files[0]) insertImageFile(ev.target.files[0], img); } });
      document.body.appendChild(inp); inp.click(); setTimeout(() => inp.remove(), 1000);
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (window.__dkePop) closePop(); else if (editing) setEdit(false); }
    if (editing && selectedFloat && (e.key === 'Delete') && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName) && !e.target.isContentEditable) {
      selectedFloat.remove(); selectedFloat = null;
    }
  }, true);
  document.addEventListener('mousedown', e => { if (!e.target.closest('.dke-float') && !e.target.closest('.dke-bar')) selectFloat(null); });
})();
