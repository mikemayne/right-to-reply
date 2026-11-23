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
  style.textContent = "*{box-sizing:border-box}\nsection{width:min(380px,calc(100vw - 16px));max-height:min(72vh,520px);overflow:auto;padding:0;border:2px solid #202124;border-radius:12px;background:#f4f4f2;color:#202124;color-scheme:light;box-shadow:0 8px 28px #0005,0 0 0 3px #fff;font:14px/1.5 system-ui,sans-serif}\nheader{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:10px;padding:12px;background:#202124;color:#fff}\n.logo{width:34px;height:34px;padding:3px;background:#fff;color:#202124;border-radius:5px;flex:none;object-fit:contain;font:700 10px/28px system-ui}\n.brand{flex:1;min-width:0}\n.brand strong{display:block;font:700 12px/1.35 system-ui,sans-serif;letter-spacing:.055em;text-transform:uppercase}\n.brand small{display:block;margin-top:3px;font:400 11px/1.35 system-ui,sans-serif;color:#e4e4e4}\nbutton{flex:none;border:1px solid #777;background:transparent;color:#fff;font:24px/1 system-ui;cursor:pointer;width:32px;height:32px;border-radius:5px;padding:0}\nbutton:hover{background:#454545}\n.disclaimer{padding:12px;border-bottom:1px solid #d3d3d3;background:#fff;font:400 12px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}\n.disclaimer p{margin:0;white-space:pre-wrap}\n.disclaimer a{display:inline-block;color:inherit;text-decoration:underline;margin-top:4px}\n.disclaimer a:focus-visible{outline:2px solid currentColor;outline-offset:2px}\n.body{padding:10px;display:grid;gap:8px}\narticle{border:1px solid #d3d3d3;border-radius:7px;background:#fff}\narticle>p{margin:12px}\nsummary{cursor:pointer;color:#202124;font-weight:600;overflow-wrap:anywhere;padding:12px;min-height:44px}\nsummary:hover{background:#f3f3f3;border-radius:6px;text-decoration:underline}\nsummary:focus-visible,button:focus-visible{outline:2px solid currentColor;outline-offset:-4px}\n.detail{margin:0 12px;padding:10px 0 12px;border-top:1px solid #ddd;color:#202124}\n.detail strong{font-size:12px;display:block}\n.detail p{overflow-wrap:anywhere;margin:4px 0 0}\n@media(forced-colors:active){section,header,article,summary,.detail,button,.disclaimer{background:Canvas;color:CanvasText;border-color:CanvasText;box-shadow:none}.brand small{color:CanvasText}}";
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

  function revealDetail(detail) {
    // Scroll only the panel, accounting for its sticky header.
    const panel = popup.getBoundingClientRect();
    const header = popup.querySelector('header').getBoundingClientRect();
    const top = Math.max(panel.top + popup.clientTop, header.bottom) + 8;
    const bottom = panel.top + popup.clientTop + popup.clientHeight - 8;
    const rect = detail.getBoundingClientRect();
    if (rect.height > bottom - top || rect.top < top) {
      popup.scrollTop += rect.top - top;
    } else if (rect.bottom > bottom) {
      popup.scrollTop += rect.bottom - bottom;
    }
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
    popup.scrollTop = 0;
    const header = add('header', '');
    const logo = add('img', '', header);
    logo.className = 'logo';
    logo.alt = 'R2R';
    logo.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwAgMAAAAqbBEUAAAADFBMVEX////7+/uSkpIEBASgfnrjAAABK0lEQVR42nWSMUtCURiGn6M3QWy4KkW0NLW06E+4wcXFKfBCBUJ7Q0u7DjYE/Ysmdekf6NSsU2tulRAJFbcb+TZ47z3XoDN9D+/hOR8vB/6crTXykqEifSVzDij0MolmNhlStQm199jgQLDLWmJhoMU/NrjNbuAGrQQ6oZesV9Hej3ved2NoqiH1YsEmJ9CO4YUJVL0V5EfuZ9cBwARsjaa10AMcDZnP77MlOJ0w7SE40kcamJKm9taFfAADUH6NdnzmYwCaelw1AFCT3xgMDgHYGElzaWUvS/qWlm4uFr6BqSfgRsf4BjB9WLSLy6vk3VJo1HMAAiiYU7t3U5KXs6xJBqJUjbgepxBxRgqmW7UC3RVtQt1kbE/mMh+Ps/2bg+e1P5QkpvUQbP8CSaNuXP0jovIAAAAASUVORK5CYII=';
    const brand = add('div', '', header);
    brand.className = 'brand';
    add('strong', 'Independent browser extension', brand);
    add('small', 'Not supplied by this publication', brand);
    const button = add('button', '×', header);
    button.type = 'button';
    button.setAttribute('aria-label', 'Close response');
    button.addEventListener('click', () => close(true));
    popup.setAttribute('aria-label', 'Right to Reply');
    popup.removeAttribute('aria-labelledby');
    // Only the extension package supplies this configuration, never a party feed.
    const disclaimer = typeof RightToReplyDisclaimer === 'undefined' ? {} : RightToReplyDisclaimer;
    if (disclaimer.message || disclaimer.link) {
      const notice = add('div', '');
      notice.className = 'disclaimer';
      if (disclaimer.message) add('p', disclaimer.message, notice);
      if (disclaimer.link) {
        const link = add('a', disclaimer.linkText || disclaimer.link, notice);
        link.href = disclaimer.link;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.referrerPolicy = 'no-referrer';
      }
    }
    const body = add('div', '');
    body.className = 'body';
    for (const policy of group.candidates) {
      const card = add('article', '', body);
      const status = add('p', 'Loading response…', card);
      status.setAttribute('role', 'status');
      api.runtime.sendMessage({ type: 'load-reply', repository: policy.repository, keyword: policy.keyword })
        .then(result => {
          if (active !== anchor || !card.isConnected) return;
          if (!result) {
            status.textContent = 'Response currently unavailable.';
          } else {
            status.remove();
            const details = add('details', '', card);
            add('summary', result.response, details);
            const detail = add('div', '', details);
            detail.className = 'detail';
            add('strong', policy.partyName, detail);
            add('p', result.description, detail);
            details.addEventListener('toggle', () => {
              if (active !== anchor || !card.isConnected) return;
              position();
              if (details.open) revealDetail(detail);
            });
            details.addEventListener('click', () => { pinned = true; clearTimeout(leaveTimer); });
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
