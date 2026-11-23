'use strict';

(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const reply = globalThis.RightToReplyMatcher;
  const feed = globalThis.RightToReplyFeed;
  const selector = 'p,li,blockquote,h1,h2,h3,h4,h5,h6,[data-testid="tweetText"]';
  const article = 'article,[role="article"],[data-testid="tweet"]';
  const articleBody = '[itemprop="articleBody"]';
  const main = 'main,[role="main"]';
  const editorial = article + ',' + articleBody + ',' + main;
  const ignored = 'nav,aside,footer,.site-nav,.navigation,.breadcrumb,.breadcrumbs,svg,math,[role="navigation"],[role="menu"],[role="menubar"],[role="complementary"],[role="banner"],[role="contentinfo"],[aria-hidden="true"],[hidden],button,label,input,textarea,select,code,pre,script,style,[contenteditable]:not([contenteditable="false"]),[role="button"]';
  const groups = new WeakMap();
  const dirty = new Set();
  let settings = { enabled: false };
  let matcher;
  let scheduled = false;
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
      if (owner(parent) !== block || parent.closest(ignored) || !visible(parent)) {
        text += ' ';
        continue;
      }
      if (text.length + node.length > 10000) return null;
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
        span.dataset.rightToReplyMark = '';
        if (match.color) span.style.setProperty('--right-to-reply-color', match.color);
        else {
          const stops = match.colors.map((color, index) =>
            color + ' ' + (100 * index / match.colors.length) + '% ' +
            (100 * (index + 1) / match.colors.length) + '%');
          span.dataset.replySegments = '';
          span.style.setProperty('--reply-segments', 'linear-gradient(to right,' + stops.join(',') + ')');
        }
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
        button.dataset.rightToReplyControl = '';
        button.textContent = 'i';
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-haspopup', 'dialog');
        if (match.color) button.style.setProperty('--right-to-reply-color', match.color);
        group.anchor = button;
        groups.set(button, group);
        links.at(-1).after(button);
      }
    }
  }

  function articleRoot(element) {
    return element?.closest(article) ?? element?.closest(articleBody) ??
      element?.closest(main) ?? document.body;
  }

  function visible(element) {
    return element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible';
  }

  function explicitRoot(root) {
    return root.matches(article + ',' + articleBody);
  }

  function queueRoot(root) {
    if (root?.isConnected) dirty.add(root);
  }

  function queueSubtree(element) {
    if (!element?.isConnected) return;
    queueRoot(articleRoot(element));
    for (const child of element.querySelectorAll(editorial)) queueRoot(articleRoot(child));
  }

  function handleMutations(records) {
    if (!settings.enabled) return;
    for (const record of records) {
      const element = record.target.nodeType === Node.ELEMENT_NODE ?
        record.target : record.target.parentElement;
      if (!element || element === host || host.contains(element)) continue;
      if (record.type === 'childList') {
        const changed = [...record.addedNodes, ...record.removedNodes].filter(node => node !== host);
        if (!changed.length || element.closest(ignored)) continue;
        queueRoot(articleRoot(element));
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && node !== host) queueSubtree(node);
        }
      } else if (record.type === 'attributes') {
        // Visibility or semantic boundary changes can affect both the old
        // containing article and the new one.
        queueRoot(articleRoot(element.parentElement));
        queueSubtree(element);
      } else if (!element.closest(ignored)) {
        queueRoot(articleRoot(element));
      }
    }
    if (active && !active.isConnected) close(false);
    schedule();
  }

  const observer = new MutationObserver(handleMutations);

  function unwrap(root, scoped = false) {
    for (const item of root.querySelectorAll('[data-right-to-reply-mark],[data-right-to-reply-control]')) {
      if (!groups.has(item) || (scoped && articleRoot(item) !== root)) continue;
      groups.delete(item);
      if (item.hasAttribute('data-right-to-reply-control')) item.remove();
      else item.replaceWith(...item.childNodes);
    }
  }

  function observe() {
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'role', 'itemprop', 'data-testid']
    });
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

  function scanRoot(root) {
    if (!root.isConnected) return;
    writeDOM(() => {
      if (active && (!active.isConnected || articleRoot(active) === root)) close(false);
      unwrap(root, true);
      if (root.closest(ignored) || !visible(root)) return;
      // A page-level fallback must not absorb headlines, navigation or
      // recommendations belonging to separately identified articles.
      if (!explicitRoot(root) && root.querySelector(article + ',' + articleBody)) return;
      if (root === document.body && root.querySelector(main)) return;
      const texts = new Map();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let previousBlock;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!node.data || articleRoot(parent) !== root || parent.closest(ignored) || !visible(parent)) {
          previousBlock = undefined;
          continue;
        }
        const block = owner(parent) ?? parent.closest('div,section,header') ?? parent;
        const previous = texts.get(block) ?? '';
        texts.set(block, previous + (previous && previousBlock !== block ? ' ' : '') + node.data);
        previousBlock = block;
      }
      const eligible = matcher.identify(texts.values());
      if (!eligible.size) return;

      const blocks = new Set();
      for (const element of root.querySelectorAll(selector + ',a[href]')) {
        const block = owner(element);
        if (block && articleRoot(block) === root && !block.closest(ignored) && visible(block)) blocks.add(block);
      }
      for (const block of blocks) {
        const snapshot = collect(block);
        if (!snapshot) continue;
        const matches = matcher.find(snapshot.text, eligible);
        if (matches.length) addMarks(block, snapshot, matches);
      }
    });
  }

  function schedule() {
    if (scheduled || !settings.enabled || !dirty.size || document.hidden) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!settings.enabled || document.hidden) return;
      // Drain only dirty article roots, one per frame. Other articles and
      // their open popups/marks are left untouched.
      const root = dirty.values().next().value;
      dirty.delete(root);
      try {
        if (root) scanRoot(root);
      } catch (error) {
        console.warn('Right to Reply could not scan an article', error);
      } finally {
        schedule();
      }
    });
  }

  const host = document.createElement('div');
  host.style.cssText = 'all:initial!important;position:fixed!important;z-index:2147483647!important;top:0!important;left:0!important';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = 'section{box-sizing:border-box;width:min(360px,calc(100vw - 16px));max-height:min(65vh,470px);overflow:auto;padding:14px;border:1px solid GrayText;border-radius:8px;background:Canvas;color:CanvasText;color-scheme:light dark;box-shadow:0 4px 20px #0004;font:14px/1.45 system-ui} h2{font-size:1.1em;margin:0 32px 8px 0} p{margin:5px 0} article+article{border-top:1px solid GrayText;margin-top:10px;padding-top:10px} button{float:right;font:inherit} a{color:LinkText} blockquote{margin:6px 0}';
  const popup = document.createElement('section');
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-labelledby', 'right-to-reply-title');
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
    add('h2', 'Right to Reply').id = 'right-to-reply-title';
    for (const policy of group.candidates) {
      const card = add('article', '');
      add('strong', policy.partyName, card);
      const status = add('p', 'Loading response…', card);
      status.setAttribute('role', 'status');
      api.runtime.sendMessage({ type: 'load-reply', repository: policy.repository, keyword: policy.keyword })
        .then(result => {
          if (active !== anchor || !card.isConnected) return;
          if (!result) {
            status.textContent = 'Response currently unavailable.';
          } else {
            status.remove();
            add('p', result.response, card);
            add('p', result.description, card);
          }
          position();
        }, () => {
          if (card.isConnected) status.textContent = 'Response currently unavailable.';
        });
    }
    document.body.append(host);
    position();
    if (pin) button.focus({ preventScroll: true });
  }

  const getMark = event => {
    if (!event.isTrusted) return null;
    const mark = event.target.closest?.('[data-right-to-reply-mark],[data-right-to-reply-control]');
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
    dirty.clear();
    observer.disconnect();
    close(false);
    unwrap(document.body);
    if (settings.enabled) {
      queueSubtree(document.body);
      observe();
      schedule();
    }
  }

  function configure(saved) {
    const data = saved.snapshot?.data;
    const enabled = data?.schemaVersion === 2 && Boolean(data.parties.some(party => party.keywords.length)) &&
      saved.enabled !== false && saved.sites?.[location.hostname] !== false;
    const updated = saved.snapshot?.version;
    if (settings.enabled === enabled &&
        settings.updated === updated) return;
    settings = { enabled, updated };
    if (enabled) matcher = feed.matcher(data, reply);
    reset();
  }

  let refreshSequence = 0;
  async function refresh() {
    const request = ++refreshSequence;
    const saved = await api.storage.local.get(['enabled', 'sites', 'snapshot']);
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
