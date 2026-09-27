// Minimalny DOM do testów modułów z UI (okna, pigułki, formularze) — tylko to, czego używają moduły CodeMap:
// drzewo elementów, id / klasy / atrybuty, proste selektory (#id, .klasa, tag, [atrybut], połączenia bez spacji
// oraz potomek po spacji), zdarzenia (addEventListener / dispatch), innerHTML = '' czyści dzieci.
// Nie parsuje HTML: przypisany innerHTML jest zapamiętany jako tekst (asercje na znacznikach).
import { docStub } from './harness.mjs';

function matches(el, sel) {
  if (!el || !el.tagName) return false;
  const re = /([#.]?)([\w-]+)|\[([\w-]+)(?:="?([^"\]]*)"?)?\]/g; let m, any = false;
  while ((m = re.exec(sel))) {
    any = true;
    if (m[3]) { const v = el.getAttribute(m[3]); if (v == null || (m[4] != null && String(v) !== m[4])) return false; }
    else if (m[1] === '#') { if (el.id !== m[2]) return false; }
    else if (m[1] === '.') { if (!el.classList.contains(m[2])) return false; }
    else if (el.tagName !== m[2].toUpperCase()) return false;
  }
  return any;
}
function all(root, sel) {
  const out = [], parts = sel.trim().split(/\s+/), groups = sel.split(',').map((s) => s.trim());
  if (groups.length > 1) { for (const g of groups) for (const e of all(root, g)) if (!out.includes(e)) out.push(e); return out; }
  const last = parts.pop();
  const walk = (e) => { for (const c of e.children || []) {
    if (matches(c, last)) { let ok = true, p = c.parentNode;
      for (let i = parts.length - 1; i >= 0 && ok; i--) { while (p && !matches(p, parts[i])) p = p.parentNode; if (!p) ok = false; else p = p.parentNode; }
      if (ok) out.push(c); }
    walk(c); } };
  walk(root);
  return out;
}

export function makeElement(doc, tag) {
  const listeners = {}, attrs = {}, cls = new Set();
  let html = '', text = '';
  const e = {
    tagName: String(tag).toUpperCase(), nodeType: 1, ownerDocument: doc, parentNode: null, children: [], style: {}, dataset: {},
    value: '', checked: false, disabled: false, hidden: false, title: '', options: [],
    get id() { return attrs.id || ''; }, set id(v) { attrs.id = v; },
    get className() { return [...cls].join(' '); }, set className(v) { cls.clear(); for (const c of String(v).split(/\s+/)) if (c) cls.add(c); },
    classList: { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c),
      toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; } },
    get childNodes() { return e.children; },
    get innerHTML() { return html; }, set innerHTML(v) { html = String(v); for (const c of e.children) c.parentNode = null; e.children.length = 0; text = ''; },
    get textContent() { return e.children.length ? text + e.children.map((c) => c.textContent).join('') : text || (html ? html.replace(/<[^>]*>/g, '') : ''); },
    set textContent(v) { text = String(v); html = ''; e.children.length = 0; },
    setAttribute(k, v) { if (k === 'class') { e.className = v; return; } attrs[k] = String(v);
      if (k === 'checked') e.checked = true; else if (k === 'value') e.value = String(v); },   // atrybut → stan początkowy (jak w przeglądarce)
    getAttribute(k) { return k === 'class' ? e.className : (k in attrs ? attrs[k] : null); },
    removeAttribute(k) { delete attrs[k]; }, hasAttribute: (k) => k in attrs,
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = e; e.children.push(c); if (c.tagName === 'OPTION') e.options.push(c); return c; },
    insertBefore(c, ref) { if (c.parentNode) c.parentNode.removeChild(c); const i = ref ? e.children.indexOf(ref) : -1; c.parentNode = e; if (i < 0) e.children.push(c); else e.children.splice(i, 0, c); return c; },
    removeChild(c) { const i = e.children.indexOf(c); if (i >= 0) e.children.splice(i, 1); c.parentNode = null; return c; },
    // jak w DOM: napisy → węzły tekstowe; replaceChildren czyści zawartość (także ustawioną przez innerHTML / textContent)
    append(...xs) { for (const x of xs) e.appendChild(typeof x === 'string' ? doc.createTextNode(x) : x); },
    replaceChildren(...xs) { for (const c of e.children) c.parentNode = null; e.children.length = 0; html = ''; text = ''; e.append(...xs); },
    replaceChild(n, o) { const i = e.children.indexOf(o); if (i >= 0) { e.children[i] = n; n.parentNode = e; o.parentNode = null; } return o; },
    remove() { if (e.parentNode) e.parentNode.removeChild(e); },
    get nextSibling() { const p = e.parentNode; return p ? p.children[p.children.indexOf(e) + 1] || null : null; },
    addEventListener(t, fn) { (listeners[t] || (listeners[t] = [])).push(fn); },
    removeEventListener(t, fn) { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
    dispatchEvent(ev) { ev.target = ev.target || e; for (const fn of listeners[ev.type] || []) fn(ev); const on = e['on' + ev.type]; if (typeof on === 'function') on(ev); return true; },
    click() { return e.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} }); },
    querySelector: (s) => all(e, s)[0] || null, querySelectorAll: (s) => all(e, s),
    closest(s) { let p = e; while (p && p.tagName) { if (matches(p, s)) return p; p = p.parentNode; } return null; },
    focus() { doc.activeElement = e; }, select() {}, blur() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 40, right: 100, bottom: 40 }),
    setPointerCapture() {}, get listeners() { return listeners; },
  };
  return e;
}

/** Dokument: body/head, getElementById / querySelector po całym drzewie, fabryka elementów. */
export function miniDocument() {
  const doc = docStub();
  doc.createElement = (tag) => makeElement(doc, tag);
  doc.createElementNS = (_ns, tag) => makeElement(doc, tag);
  doc.createTextNode = (t) => ({ nodeType: 3, textContent: String(t), nodeValue: String(t), parentNode: null, remove() {} });
  doc.createDocumentFragment = () => makeElement(doc, '#fragment');
  const html = makeElement(doc, 'html'), body = makeElement(doc, 'body'), head = makeElement(doc, 'head');
  html.appendChild(head); html.appendChild(body);
  Object.assign(doc, { documentElement: html, body, head, activeElement: null });
  const listeners = {};
  doc.addEventListener = (t, fn) => { (listeners[t] || (listeners[t] = [])).push(fn); };
  doc.dispatchEvent = (ev) => { for (const fn of listeners[ev.type] || []) fn(ev); return true; };
  doc.getElementById = (id) => all(html, '#' + id)[0] || null;
  doc.querySelector = (s) => all(html, s)[0] || null;
  doc.querySelectorAll = (s) => all(html, s);
  return doc;
}
