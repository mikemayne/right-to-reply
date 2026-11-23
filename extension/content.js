'use strict';

(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const reply = globalThis.CheckPolicyReply;
  const feed = globalThis.RightToReplyFeed;
  const selector = 'p,li,blockquote,h1,h2,h3,h4,h5,h6,[data-testid="tweetText"]';
  const editorial = 'article,main,[role="main"],[role="article"],[itemprop="articleBody"]';
  const ignored = 'nav,aside,footer,.site-nav,.navigation,.breadcrumb,.breadcrumbs,svg,math,[role="navigation"],[role="menu"],[role="menubar"],[role="complementary"],[role="banner"],[role="contentinfo"],[aria-hidden="true"],[hidden],button,label,input,textarea,select,code,pre,script,style,[contenteditable]:not([contenteditable="false"]),[role="button"]';
  const groups = new WeakMap();
  const controls = new WeakMap();
  const pending = new Set();
  const processed = new WeakSet();
  let settings = { enabled: false, demo: false };
  let matcher;
  let eligibleByRoot = new Map();
  let singleArticle;
  let rescanPending = false;
  let revision = 0;
  let scheduled = false;
  let running = false;
  let queue = [];
  let working;
  let active;
  let origin;
  let pinned = false;
  let leaveTimer;

  function owner(element) {
    return element?.closest(selector) ??
      (element?.closest('header') && !element.closest(editorial) ? null : element?.closest('a[href]')) ?? null;
  }

  function collect(block) {
    if (block.closest(ignored)) return null;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = '';
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (owner(parent) !== block || parent.closest(ignored)) {
        text += ' ';
        continue;
      }
      nodes.push({ node, start: text.length });
      text += node.data;
    }
    return text.length > 10000 ? null : { nodes, text };
  }

  function addMarks(block, { nodes, text }, matches) {
    for (const match of matches.reverse()) {
      const pieces = nodes.filter(({ node, start }) => start < match.end && start + node.length > match.start);
      if (!pieces.length) continue;
      const links = pieces.map(({ node }) => node.parentElement.closest('a[href]')).filter(Boolean);
      const label = text.slice(match.start, match.end).trim() + ' — show party response';
      const group = { candidates: match.candidates, anchor: null };
      for (const [i, { node, start }] of pieces.entries()) {
        const from = Math.max(0, match.start - start);
        const to = Math.min(node.length, match.end - start);
        if (to < node.length) node.splitText(to);
        const target = from ? node.splitText(from) : node;
        const span = document.createElement('span');
        span.dataset.checkPolicyMark = '';
        if (match.color) span.style.setProperty('--check-policy-color', match.color);
        groups.set(span, group);
        if (i === 0 && !links.length) {
          group.anchor = span;
          span.tabIndex = 0;
          span.setAttribute('role', 'button');
          span.setAttribute('aria-label', label);
          span.setAttribute('aria-haspopup', 'dialog');
        }
        target.replaceWith(span);
        span.append(target);
      }
      if (links.length) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.checkPolicyControl = '';
        button.textContent = 'i';
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-haspopup', 'dialog');
        if (match.color) button.style.setProperty('--check-policy-color', match.color);
        group.anchor = button;
        groups.set(button, group);
        links.at(-1).after(button);
        const existing = controls.get(block) ?? [];
        existing.push(button);
        controls.set(block, existing);
      }
    }
  }

  function articleRoot(block) {
    return block.closest('article,[role="article"]') ?? singleArticle ?? block.closest(editorial) ?? document.body;
  }

  function rebuild() {
    const articles = [...document.querySelectorAll('article,[role="article"]')]
      .filter(element => !element.parentElement.closest('article,[role="article"]') &&
        !element.closest(ignored) && element.getClientRects().length);
    singleArticle = articles.length === 1 ? articles[0] : undefined;
    for (const block of document.body.querySelectorAll(selector + ',a[href]')) {
      const ownerBlock = owner(block);
      if (ownerBlock && !ownerBlock.closest(ignored)) pending.add(ownerBlock);
    }
    const texts = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!node.data || parent.closest(ignored) || !parent.getClientRects().length ||
          getComputedStyle(parent).visibility !== 'visible') continue;
      const root = articleRoot(parent);
      if (!texts.has(root)) texts.set(root, new Map());
      const blocks = texts.get(root);
      const block = owner(parent) ?? parent.closest('div,section,header') ?? parent;
      blocks.set(block, (blocks.get(block) ?? '') + node.data);
    }
    eligibleByRoot = new Map([...texts].map(([root, blocks]) => [root, matcher.identify(blocks.values())]));
    for (const block of pending) processed.delete(block);
  }

  function handleMutations(records) {
    if (!settings.enabled || rescanPending || !records.some(record => {
      if (record.type === 'characterData') return true;
      return [...record.addedNodes, ...record.removedNodes].some(node => node !== host);
    })) return;
    rescanPending = true;
    requestAnimationFrame(() => {
      rescanPending = false;
      if (settings.enabled) reset();
    });
  }

  const observer = new MutationObserver(handleMutations);

  function unwrap(root) {
    for (const button of controls.get(root) ?? []) button.remove();
    controls.delete(root);
    for (const item of root.querySelectorAll('[data-check-policy-mark],[data-check-policy-control]')) {
      if (!groups.has(item)) continue;
      if (root !== document.body && owner(item.parentElement) !== root) continue;
      groups.delete(item);
      if (item.hasAttribute('data-check-policy-control')) item.remove();
      else item.replaceWith(...item.childNodes);
    }
  }

  function observe() {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function writeDOM(write) {
    const waiting = observer.takeRecords();
    if (waiting.length) handleMutations(waiting);
    observer.disconnect();
    try {
      write();
    } finally {
      if (settings.enabled) observe();
    }
  }

  const indicator = document.createElement('div');
  indicator.setAttribute('aria-hidden', 'true');
  indicator.dataset.checkPolicyProgress = '';
  indicator.style.cssText = 'all:initial!important;position:fixed!important;z-index:2147483646!important;width:7px!important;height:7px!important;border-radius:50%!important;background:#64748b!important;box-shadow:0 0 0 1px Canvas!important;pointer-events:none!important;';

  function moveIndicator() {
    if (!working?.isConnected || !working.matches('p,blockquote,li')) {
      indicator.remove();
      return;
    }
    const edge = working.getBoundingClientRect();
    if (edge.bottom < 0 || edge.top >= innerHeight || !edge.width) {
      indicator.remove();
      return;
    }
    indicator.style.setProperty('left', Math.max(0, Math.min(edge.right + 6, innerWidth - 9)) + 'px', 'important');
    indicator.style.setProperty('top', Math.max(1, edge.top + 7) + 'px', 'important');
    if (!indicator.isConnected) document.documentElement.append(indicator);
  }

  function schedule() {
    if (scheduled || running || !settings.enabled || !pending.size || document.hidden) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      processNext().catch(error => console.warn('Right to Reply could not scan a passage', error));
    });
  }

  async function processNext() {
    if (!settings.enabled || document.hidden) return;
    running = true;
    const run = revision;
    try {
      if (!queue.length) {
        queue = [...pending].sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      }
      const block = queue.pop();
      if (!block) return;
      pending.delete(block);
      if (!block.isConnected || processed.has(block) || !block.getClientRects().length) return;
      working = block;
      moveIndicator();
      writeDOM(() => {
        if (block.contains(active) || controls.get(block)?.includes(active)) close(false);
        unwrap(block);
      });
      const snapshot = collect(block);
      if (!snapshot) return;
      const matches = matcher.find(snapshot.text, eligibleByRoot.get(articleRoot(block)) ?? new Set());
      if (!settings.enabled || run !== revision || !block.isConnected) return;
      writeDOM(() => {
        if (pending.has(block)) return;
        processed.add(block);
        addMarks(block, snapshot, matches);
      });
    } finally {
      running = false;
      working = null;
      if (pending.size) schedule();
      else requestAnimationFrame(() => { if (!working) indicator.remove(); });
    }
  }

  const host = document.createElement('div');
  host.style.cssText = 'all:initial!important;position:fixed!important;z-index:2147483647!important;top:0!important;left:0!important';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = 'section{box-sizing:border-box;width:min(360px,calc(100vw - 16px));max-height:min(65vh,470px);overflow:auto;padding:14px;border:1px solid GrayText;border-radius:8px;background:Canvas;color:CanvasText;color-scheme:light dark;box-shadow:0 4px 20px #0004;font:14px/1.45 system-ui} h2{font-size:1.1em;margin:0 32px 8px 0} p{margin:5px 0} article+article{border-top:1px solid GrayText;margin-top:10px;padding-top:10px} button{float:right;font:inherit} a{color:LinkText} blockquote{margin:6px 0}';
  const popup = document.createElement('section');
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-labelledby', 'cp-title');
  popup.addEventListener('pointerenter', () => clearTimeout(leaveTimer));
  popup.addEventListener('pointerleave', delayClose);
  shadow.append(style, popup);

  function add(tag, value, parent = popup) {
    const node = document.createElement(tag);
    node.textContent = value;
    parent.append(node);
    return node;
  }

  function close(restore) {
    clearTimeout(leaveTimer);
    if (!active) return;
    const previous = active;
    active = undefined;
    origin = undefined;
    pinned = false;
    host.remove();
    if (restore) previous.focus({ preventScroll: true });
  }

  function delayClose() {
    clearTimeout(leaveTimer);
    if (!pinned) leaveTimer = setTimeout(() => close(false), 220);
  }

  function position() {
    moveIndicator();
    if (!origin?.isConnected) return;
    const anchor = origin.getBoundingClientRect();
    const { width, height } = popup.getBoundingClientRect();
    const x = Math.max(8, Math.min(anchor.left, innerWidth - width - 8));
    const below = anchor.bottom + 6;
    const y = below + height > innerHeight && anchor.top > height + 6 ? anchor.top - height - 6 : below;
    host.style.setProperty('left', x + 'px', 'important');
    host.style.setProperty('top', Math.max(8, Math.min(y, innerHeight - height - 8)) + 'px', 'important');
  }

  function open(mark, pin) {
    const group = groups.get(mark);
    const anchor = group?.anchor;
    if (!anchor?.isConnected || (pinned && !pin)) return;
    clearTimeout(leaveTimer);
    if (active === anchor && !pin) return;
    active = anchor;
    origin = pin ? anchor : mark;
    pinned = pin;
    popup.replaceChildren();
    const button = add('button', 'Close');
    button.type = 'button';
    button.addEventListener('click', () => close(true));
    add('h2', settings.demo ? 'Right to Reply · fictional demo' : 'Right to Reply').id = 'cp-title';
    for (const policy of group.candidates) {
      const card = add('article', '');
      add('strong', policy.partyName, card);
      add('p', policy.response, card);
      add('p', policy.description, card);
    }
    document.body.append(host);
    position();
    if (pin) button.focus({ preventScroll: true });
  }

  const getMark = event => {
    const mark = event.target.closest?.('[data-check-policy-mark],[data-check-policy-control]');
    return groups.has(mark) ? mark : null;
  };
  document.addEventListener('pointerover', event => {
    const mark = getMark(event);
    if (mark && event.pointerType === 'mouse') open(mark, false);
  });
  document.addEventListener('pointerout', event => {
    if (getMark(event)) delayClose();
  });
  document.addEventListener('click', event => {
    const mark = getMark(event);
    if (mark && !mark.closest('a[href]') && !window.getSelection()?.toString()) open(mark, true);
    else if (!event.composedPath().includes(host)) close(false);
  });
  document.addEventListener('keydown', event => {
    const mark = getMark(event);
    if (active && event.key === 'Escape') close(pinned);
    if (mark?.matches('span[role="button"]') && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      open(mark, true);
    }
  });
  document.addEventListener('focusin', event => {
    if (pinned && !event.composedPath().includes(host) && event.target !== active) close(false);
  });
  document.addEventListener('visibilitychange', schedule);
  addEventListener('resize', position);
  addEventListener('scroll', position, { passive: true, capture: true });

  function reset() {
    revision++;
    pending.clear();
    queue = [];
    observer.disconnect();
    close(false);
    indicator.remove();
    working = null;
    unwrap(document.body);
    if (settings.enabled) {
      rebuild();
      observe();
      schedule();
    }
  }

  function configure(saved) {
    const demo = saved.demo === true && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    const data = demo ? globalThis.RightToReplyDemo : saved.snapshot?.data;
    const enabled = Boolean(data?.parties.some(party => party.responses.length)) &&
      saved.enabled !== false && saved.sites?.[location.hostname] !== false;
    const updated = demo ? undefined : saved.snapshot?.version;
    if (settings.enabled === enabled && settings.demo === demo &&
        settings.updated === updated) return;
    settings = { enabled, demo, updated };
    if (enabled) matcher = feed.matcher(data, reply);
    reset();
  }

  let refreshSequence = 0;
  async function refresh() {
    const request = ++refreshSequence;
    const saved = await api.storage.local.get(['enabled', 'sites', 'demo', 'snapshot']);
    if (request === refreshSequence) configure(saved);
  }
  api.storage.onChanged.addListener(refresh);
  refresh();
  const syncSources = () => api.runtime.sendMessage({ type: 'refresh-responses' }).catch(() => {});
  const syncWhenVisible = () => {
    if (!document.hidden) syncSources();
  };
  document.addEventListener('visibilitychange', syncWhenVisible);
  setInterval(syncWhenVisible, 15 * 60 * 1000);
  syncSources();
})();
