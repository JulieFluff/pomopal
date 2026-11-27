// PomoPal browser version: the notes editor (Val 2026-11-24). Bold, underline and bullets
// with a small B U • row, Cmd/Ctrl+B and +U, and "- " at the start of a line for a bullet.
// The text is kept as light Markdown (see noteToHtml / noteToPlain in web-log.js), so the
// editor reads and writes `.value` like the plain box it replaces.
(function initWebNotes(globalScope) {
  const BLOCKS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);

  function styleOf(node) {
    return node.style || {};
  }

  function boldOf(node, inherited) {
    if (node.tagName === 'B' || node.tagName === 'STRONG') return true;
    const weight = String(styleOf(node).fontWeight || '');
    if (/^(bold|bolder|[6-9]00)$/.test(weight)) return true;
    if (/^(normal|lighter|[1-4]00)$/.test(weight)) return false;
    return inherited;
  }

  function underlineOf(node, inherited) {
    if (node.tagName === 'U') return true;
    const deco = `${styleOf(node).textDecoration || ''} ${styleOf(node).textDecorationLine || ''}`;
    if (/underline/.test(deco)) return true;
    return inherited;
  }

  // Wraps text in the marks, keeping spaces outside them ("** bold**" isn't Markdown).
  function marked(text, fmt) {
    const [, lead, core, tail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!core) return text;
    let out = core;
    if (fmt.underline) out = `<u>${out}</u>`;
    if (fmt.bold) out = `**${out}**`;
    return `${lead}${out}${tail}`;
  }

  // The editor's contents → the note's text.
  function htmlToNote(root) {
    const lines = [];
    let line = null; // null = nothing started on this line yet
    const add = (text) => { line = (line ?? '') + text; };
    const end = () => { lines.push(line ?? ''); line = null; };
    const walk = (node, fmt) => {
      node.childNodes.forEach((child) => {
        if (child.nodeType === 3) {
          const text = child.textContent.replace(/ /g, ' ').replace(/\n/g, ' ');
          if (text) add(marked(text, fmt));
          return;
        }
        if (child.nodeType !== 1) return;
        if (child.tagName === 'BR') { end(); return; }
        // A Planner screenshot is its own line: ![screenshot](pomopal-image:<id>).
        if (child.tagName === 'IMG') {
          const id = child.getAttribute('data-img');
          if (id) { if (line !== null) end(); add(`![screenshot](pomopal-image:${id})`); end(); }
          return;
        }
        const block = BLOCKS.has(child.tagName);
        if (block && line !== null) end();
        if (child.tagName === 'LI') add('- ');
        walk(child, { bold: boldOf(child, fmt.bold), underline: underlineOf(child, fmt.underline) });
        if (block && line !== null) end();
      });
    };
    walk(root, { bold: false, underline: false });
    if (line !== null) end();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines
      .map((l) => l.replace(/\*\*\*\*/g, '').replace(/<\/u><u>/g, '').replace(/\s+$/, ''))
      .map((l) => (l === '-' ? '- ' : l))
      .join('\n');
  }

  function caretToEnd(node) {
    const doc = node.ownerDocument;
    node.focus();
    try {
      const range = doc.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      const selection = doc.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } catch { /* focus alone is fine */ }
  }

  function run(node, command) {
    const doc = node.ownerDocument;
    if (doc.activeElement !== node) caretToEnd(node);
    try { doc.execCommand(command, false, null); } catch { /* not supported: nothing changes */ }
    node.dispatchEvent(new (doc.defaultView || globalScope).Event('input', { bubbles: true }));
  }

  // The text on the caret's line before the caret, when that line starts in this text node.
  function lineStartText(node) {
    const selection = node.ownerDocument.getSelection?.();
    if (!selection || !selection.isCollapsed || !selection.anchorNode) return null;
    const text = selection.anchorNode;
    if (text.nodeType !== 3 || !node.contains(text)) return null;
    const before = text.previousSibling;
    if (before && before.tagName !== 'BR') return null;
    const parent = text.parentNode;
    if (parent !== node && !BLOCKS.has(parent.tagName)) return null;
    if (parent.tagName === 'LI') return null;
    return text.textContent.slice(0, selection.anchorOffset);
  }

  // Turns a contenteditable element into a notes editor, with its B U • row before it.
  function makeEditor(node, { tools = true } = {}) {
    const log = globalScope.PomoWebLog;
    const doc = node.ownerDocument;
    node.setAttribute('contenteditable', 'true');
    node.setAttribute('role', 'textbox');
    node.setAttribute('aria-multiline', 'true');
    node.classList.add('rich');
    const update = () => node.classList.toggle('empty', !node.textContent.trim() && !node.querySelector('li'));
    Object.defineProperty(node, 'value', {
      configurable: true,
      get: () => htmlToNote(node),
      set: (text) => { node.innerHTML = log.noteToHtml(text); update(); },
    });
    node.addEventListener('input', update);

    const buttons = [];
    if (tools) {
      const row = doc.createElement('div');
      row.className = 'rich-tools';
      row.setAttribute('role', 'toolbar');
      row.setAttribute('aria-label', 'Formatting');
      [['bold', 'B', 'Bold (⌘B)'], ['underline', 'U', 'Underline (⌘U)'], ['insertUnorderedList', '•', 'Bullets (type - and a space)']].forEach(([command, text, label]) => {
        const button = doc.createElement('button');
        button.type = 'button';
        button.tabIndex = -1;
        button.className = `rich-${command === 'insertUnorderedList' ? 'list' : command}`;
        button.textContent = text;
        button.title = label;
        button.setAttribute('aria-label', label.replace(/ \(.*\)$/, ''));
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('mousedown', (event) => event.preventDefault()); // keeps the selection
        button.addEventListener('click', () => { run(node, command); showState(); });
        buttons.push([command, button]);
        row.append(button);
      });
      node.before(row);
    }
    // B, U and • look pressed when the caret is in bold, underlined or bulleted text.
    function showState() {
      const d = node.ownerDocument;
      buttons.forEach(([command, button]) => {
        let on = false;
        try { on = d.activeElement === node && d.queryCommandState(command); } catch { on = false; }
        button.setAttribute('aria-pressed', String(Boolean(on)));
      });
    }
    ['keyup', 'mouseup', 'focus', 'blur'].forEach((type) => node.addEventListener(type, showState));

    node.addEventListener('keydown', (event) => {
      event.stopPropagation(); // typing never reaches the timer's shortcuts (Space, Escape, N)
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && !event.altKey && (key === 'b' || key === 'u')) {
        event.preventDefault();
        run(node, key === 'b' ? 'bold' : 'underline');
        showState();
      } else if (mod && key === 'i') {
        event.preventDefault(); // no italics: notes keep bold, underline and bullets only
      } else if (event.key === ' ' && !mod && /^[-*]$/.test(lineStartText(node) || '')) {
        event.preventDefault();
        try { node.ownerDocument.execCommand('delete', false, null); } catch { /* ignore */ }
        run(node, 'insertUnorderedList');
      }
    });
    // Pasted text comes in as plain text (a note keeps its own formatting only).
    node.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text/plain');
      event.preventDefault();
      if (!text) return;
      try { node.ownerDocument.execCommand('insertText', false, text); } catch { /* ignore */ }
    });
    node.addEventListener('drop', (event) => event.preventDefault());
    update();
    return node;
  }

  const exportsObject = { makeEditor, htmlToNote, caretToEnd };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObject;
  globalScope.PomoNotes = exportsObject;
})(typeof window !== 'undefined' ? window : globalThis);
