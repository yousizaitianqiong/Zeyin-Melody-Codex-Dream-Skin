import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const GENERIC_INPUT_SELECTOR = 'textarea, [contenteditable="true"], [role="textbox"]';
const GENERIC_COMPOSER_SELECTOR =
  '[data-testid*="composer" i], [data-testid*="prompt" i], ' +
  '[class*="composer" i], [class*="prompt" i]';
const EXCLUDED_COMPOSER_OWNER_SELECTOR =
  '[role="dialog"], [aria-modal="true"], [data-codex-approval-surface], ' +
  '[data-codex-composer-request-navigation]';
const MODERN_COMPOSER_ROOT_SELECTOR = '[data-codex-composer-root]';
const MODERN_COMPOSER_SURFACE_SELECTOR =
  '[data-codex-composer-root] [data-composer-surface-variant]';
const MODERN_COMPOSER_TOOLBAR_SELECTOR =
  '[data-codex-composer-root] [data-composer-footer-responsive]';
const LEGACY_COMPOSER_SURFACE_SELECTOR = '.composer-surface-chrome';
const LEGACY_COMPOSER_TOOLBAR_SELECTOR = '.composer-surface-chrome [class*="_footer_"]';

function styleDeclaration() {
  const values = new Map();
  return {
    values,
    getPropertyValue(name) { return values.get(name) || ""; },
    setProperty(name, value) { values.set(name, String(value)); },
    removeProperty(name) { values.delete(name); },
    [Symbol.iterator]() { return values.keys(); },
  };
}

function classList(initial) {
  const values = new Set(initial);
  const writes = [];
  return {
    values,
    writes,
    contains(value) { return values.has(value); },
    add(...names) { writes.push(["add", ...names]); names.forEach((name) => values.add(name)); },
    remove(...names) { writes.push(["remove", ...names]); names.forEach((name) => values.delete(name)); },
    toggle(name, enabled) { writes.push(["toggle", name, enabled]); if (enabled) values.add(name); else values.delete(name); },
  };
}

function makeFixture({
  nativeAppearance = "dark", settings = false, settingsPanel = false, adopted = true,
  generic = false, genericComposer = true, genericHome = false, genericSearch = false,
  modernMessages = false, composerKind = "legacy", threadOnly = false,
  excludedComposerSurfaces = false, legacyShadow = false,
} = {}) {
  const attrs = new Map();
  const rootStyle = styleDeclaration();
  const rootClasses = classList([nativeAppearance === "dark" ? "electron-dark" : "electron-light"]);
  const nodes = new Map();
  const domNodes = new Set();
  const selectorNodes = new Map();
  const observers = [];
  const timers = new Map();
  const intervals = new Map();
  const listeners = new Map();
  const revoked = [];
  let nextId = 0;
  let nextBlob = 0;
  const attributesFor = (values) => [...values].map(([name, value]) => ({ name, value }));
  const makeDomNode = (name, parentElement = null, values = new Map(), matchedSelectors = []) => {
    const selectorMatches = new Set(matchedSelectors);
    const node = {
      name,
      parentElement,
      get attributes() { return attributesFor(values); },
      getAttribute(attribute) { return values.get(attribute) ?? null; },
      setAttribute(attribute, value) { values.set(attribute, String(value)); },
      removeAttribute(attribute) { values.delete(attribute); },
      appendChild(child) { child.parentElement = node; return child; },
      matches(selector) { return selectorMatches.has(selector); },
      closest(selector) {
        let current = node;
        while (current) {
          if (current.matches?.(selector)) return current;
          current = current.parentElement;
        }
        return null;
      },
      contains(candidate) {
        let current = candidate;
        while (current) {
          if (current === node) return true;
          current = current.parentElement;
        }
        return false;
      },
    };
    domNodes.add(node);
    return node;
  };
  const root = makeDomNode("root", null, attrs);
  root.classList = rootClasses;
  root.style = rootStyle;
  root.appendChild = (node) => {
    node.parentElement = root;
    if (node.id) nodes.set(node.id, node);
    return node;
  };
  const body = makeDomNode("body", root);
  body.appendChild = (node) => {
    node.parentElement = body;
    if (node.id) nodes.set(node.id, node);
    return node;
  };
  const register = (selector, node) => {
    const current = selectorNodes.get(selector) || [];
    current.push(node);
    selectorNodes.set(selector, current);
  };
  const partFixtures = {};
  if (!settings && !settingsPanel && generic) {
    const mainSelector = 'main, [role="main"]';
    const sidebarSelector = 'aside, nav[aria-label]';
    partFixtures.shell = makeDomNode("generic-shell", body);
    partFixtures.sidebar = makeDomNode("generic-sidebar", partFixtures.shell, new Map(), [sidebarSelector]);
    partFixtures.main = makeDomNode("generic-main", partFixtures.shell, new Map(), [mainSelector]);
    if (genericComposer) {
      partFixtures.composer = makeDomNode(
        "generic-composer", partFixtures.main, new Map(), [GENERIC_COMPOSER_SELECTOR],
      );
      partFixtures.input = makeDomNode(
        "generic-input", partFixtures.composer, new Map(), [GENERIC_INPUT_SELECTOR],
      );
    }
    partFixtures.unrelatedAside = makeDomNode(
      "generic-content-aside", partFixtures.main, new Map(), [sidebarSelector],
    );
    partFixtures.dialog = makeDomNode(
      "generic-dialog", partFixtures.main, new Map(), [EXCLUDED_COMPOSER_OWNER_SELECTOR],
    );
    partFixtures.dialogInput = makeDomNode(
      "generic-dialog-input", partFixtures.dialog, new Map(), [GENERIC_INPUT_SELECTOR],
    );
    if (genericSearch) {
      partFixtures.searchForm = makeDomNode("generic-search-form", partFixtures.main, new Map(), ["form"]);
      partFixtures.searchInput = makeDomNode(
        "generic-search-input", partFixtures.searchForm, new Map(), [GENERIC_INPUT_SELECTOR],
      );
    }
    register(mainSelector, partFixtures.main);
    if (genericSearch) register(GENERIC_INPUT_SELECTOR, partFixtures.searchInput);
    if (genericComposer) register(GENERIC_INPUT_SELECTOR, partFixtures.input);
    register(GENERIC_INPUT_SELECTOR, partFixtures.dialogInput);
    register(sidebarSelector, partFixtures.sidebar);
    register(sidebarSelector, partFixtures.unrelatedAside);
    if (genericHome) {
      partFixtures.homeIcon = makeDomNode("generic-home-icon", partFixtures.main);
      register('[data-testid="home-icon"]', partFixtures.homeIcon);
      register('[role="main"]:has([data-testid="home-icon"])', partFixtures.main);
      register('[role="main"]', partFixtures.main);
    }
  } else if (!settings && !settingsPanel) {
    partFixtures.sidebar = makeDomNode("sidebar", body);
    partFixtures.main = makeDomNode("main", body);
    partFixtures.header = makeDomNode("header", body);
    partFixtures.home = makeDomNode("home", partFixtures.main);
    partFixtures.homeHero = makeDomNode("home-hero", partFixtures.home);
    partFixtures.homeIcon = makeDomNode("home-icon", partFixtures.homeHero);
    partFixtures.projectList = makeDomNode("project-list", partFixtures.home);
    partFixtures.thread = makeDomNode("thread", partFixtures.main);
    partFixtures.legacyMessage = makeDomNode("legacy-message", partFixtures.thread);
    partFixtures.userMessage = makeDomNode("user-message", partFixtures.thread);
    partFixtures.assistantMessage = makeDomNode("assistant-message", partFixtures.thread);
    partFixtures.composer = makeDomNode("composer", partFixtures.main);
    partFixtures.composerToolbar = makeDomNode("composer-toolbar", partFixtures.composer);
    register("aside.app-shell-left-panel", partFixtures.sidebar);
    register("main:is(.main-surface, [data-app-shell-main-surface], [class*=\"_MainContentSurface_\"])", partFixtures.main);
    register("header:is(.app-header-tint, [data-app-shell-header-edge-scroll], [class*=\"_Header_\"])", partFixtures.header);
    if (!threadOnly) {
      register('[data-testid="home-icon"]', partFixtures.homeIcon);
      register('[data-feature="game-source"]', partFixtures.homeHero);
      register('[role="main"]:has([data-testid="home-icon"])', partFixtures.home);
      register('[role="main"]', partFixtures.home);
    }
    register(".group\\/project-selector", partFixtures.projectList);
    register(".thread-scroll-container", partFixtures.thread);
    const messageSelector =
      ':is([data-message-author-role], [data-local-conversation-user-anchor], [data-local-conversation-final-assistant])';
    register(messageSelector, partFixtures.legacyMessage);
    if (modernMessages) {
      register(messageSelector, partFixtures.userMessage);
      register(messageSelector, partFixtures.assistantMessage);
    }
    if (composerKind === "modern") {
      partFixtures.composerRoot = makeDomNode(
        "modern-composer-root", partFixtures.main, new Map(), [MODERN_COMPOSER_ROOT_SELECTOR],
      );
      partFixtures.composer = makeDomNode(
        "modern-composer-surface", partFixtures.composerRoot,
        new Map(), ['[data-composer-surface-variant]'],
      );
      partFixtures.input = makeDomNode(
        "modern-composer-input", partFixtures.composer, new Map(), [GENERIC_INPUT_SELECTOR],
      );
      partFixtures.composerToolbar = makeDomNode(
        "modern-composer-toolbar", partFixtures.composer,
        new Map(), ['[data-composer-footer-responsive]'],
      );
      register(MODERN_COMPOSER_ROOT_SELECTOR, partFixtures.composerRoot);
      register(MODERN_COMPOSER_SURFACE_SELECTOR, partFixtures.composer);
      register(MODERN_COMPOSER_TOOLBAR_SELECTOR, partFixtures.composerToolbar);
      register(GENERIC_INPUT_SELECTOR, partFixtures.input);
      if (legacyShadow) {
        partFixtures.legacyComposerShadow = makeDomNode("legacy-composer-shadow", partFixtures.main);
        partFixtures.legacyToolbarShadow = makeDomNode(
          "legacy-toolbar-shadow", partFixtures.legacyComposerShadow,
        );
        register(LEGACY_COMPOSER_SURFACE_SELECTOR, partFixtures.legacyComposerShadow);
        register(LEGACY_COMPOSER_TOOLBAR_SELECTOR, partFixtures.legacyToolbarShadow);
      }
    } else if (composerKind === "legacy") {
      register(LEGACY_COMPOSER_SURFACE_SELECTOR, partFixtures.composer);
      register(LEGACY_COMPOSER_TOOLBAR_SELECTOR, partFixtures.composerToolbar);
    }

    if (excludedComposerSurfaces) {
      partFixtures.approvalSurface = makeDomNode(
        "approval-surface", partFixtures.main, new Map(), [EXCLUDED_COMPOSER_OWNER_SELECTOR],
      );
      partFixtures.approvalComposer = makeDomNode(
        "approval-composer-like", partFixtures.approvalSurface,
        new Map(), [GENERIC_COMPOSER_SELECTOR],
      );
      partFixtures.approvalInput = makeDomNode(
        "approval-input", partFixtures.approvalComposer, new Map(), [GENERIC_INPUT_SELECTOR],
      );
      partFixtures.requestNavigation = makeDomNode(
        "request-navigation", partFixtures.main, new Map(), [EXCLUDED_COMPOSER_OWNER_SELECTOR],
      );
      partFixtures.requestInput = makeDomNode(
        "request-input", partFixtures.requestNavigation,
        new Map(), [GENERIC_INPUT_SELECTOR, GENERIC_COMPOSER_SELECTOR],
      );
      register(GENERIC_INPUT_SELECTOR, partFixtures.approvalInput);
      register(GENERIC_INPUT_SELECTOR, partFixtures.requestInput);
    }
  }
  const makeStyleNode = () => {
    const node = {
      id: "",
      textContent: "",
      parentElement: null,
      dataset: {},
      remove() { if (node.id) nodes.delete(node.id); node.parentElement = null; },
    };
    return node;
  };
  const document = {
    documentElement: root,
    head: root,
    body,
    adoptedStyleSheets: adopted ? [] : undefined,
    createElement(tag) { return tag === "style" ? makeStyleNode() : { tagName: tag }; },
    getElementById(id) { return nodes.get(id) || null; },
    querySelector(selector) {
      if (settingsPanel && selector === '[data-settings-panel-slug="general-settings"]') {
        return makeDomNode("settings:general-settings", body);
      }
      if (settings && (selector.includes("appearance-theme") || selector.includes("theme-preview"))) {
        return makeDomNode(`settings:${selector}`, body);
      }
      return (selectorNodes.get(selector) || [])[0] || null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-ds-part]") {
        return [...domNodes].filter((node) => node.getAttribute?.("data-ds-part") !== null);
      }
      return [...(selectorNodes.get(selector) || [])];
    },
  };
  const navigation = {
    addEventListener(type, callback) { listeners.set(`navigation:${type}`, callback); },
    removeEventListener(type) { listeners.delete(`navigation:${type}`); },
  };
  class MockMutationObserver {
    constructor(callback) { this.callback = callback; this.options = null; this.observations = []; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; this.observations.push({ target, options }); }
    disconnect() { this.disconnected = true; }
  }
  class MockSheet {
    replaceSync(text) { this.text = text; }
  }
  const window = {
    navigation,
    matchMedia() {
      return {
        matches: nativeAppearance === "dark",
        addEventListener(type, callback) { listeners.set(`media:${type}`, callback); },
        removeEventListener(type) { listeners.delete(`media:${type}`); },
      };
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const context = {
    window,
    document,
    MutationObserver: MockMutationObserver,
    CSSStyleSheet: adopted ? MockSheet : undefined,
    Blob,
    Uint8Array,
    atob,
    URL: {
      createObjectURL() { nextBlob += 1; return `blob:fixture-${nextBlob}`; },
      revokeObjectURL(value) { revoked.push(value); },
    },
    performance: { now: () => 1 },
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback, delay) { const id = ++nextId; intervals.set(id, { callback, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
    console,
  };
  const payloadFor = (theme = {}) => {
    const template = fixture.template;
    return template
      .replace("__DREAM_SKIN_CSS_JSON__", JSON.stringify(".fixture { color: red; }"))
      .replace("__DREAM_SKIN_ART_JSON__", JSON.stringify("data:image/png;base64,AA=="))
      .replace("__DREAM_SKIN_THEME_JSON__", JSON.stringify({ id: "fixture", appearance: "auto", ...theme }))
      .replace("__DREAM_SKIN_VERSION_JSON__", JSON.stringify("test"))
      .replace("__DREAM_SKIN_STYLE_REVISION_JSON__", JSON.stringify("css-rev"))
      .replace("__DREAM_SKIN_PAYLOAD_REVISION_JSON__", JSON.stringify("payload-rev"));
  };
  const flushTimers = (maximumDelay = Infinity) => {
    for (const [id, timer] of [...timers]) {
      if (timer.delay <= maximumDelay) { timers.delete(id); timer.callback(); }
    }
  };
  const addDynamicMessage = () => {
    const messageSelector = [...selectorNodes.keys()].find((selector) =>
      selector.includes("data-message-author-role"),
    ) || '[data-message-author-role]';
    const node = makeDomNode(`message-${(selectorNodes.get(messageSelector) || []).length + 1}`, partFixtures.thread || body);
    register(messageSelector, node);
    return node;
  };
  const replaceWithDynamicModernComposer = (placement = "thread") => {
    const composerRoot = makeDomNode(
      `dynamic-${placement}-composer-root`, partFixtures.main || body,
      new Map(), [MODERN_COMPOSER_ROOT_SELECTOR],
    );
    const composer = makeDomNode(
      `dynamic-${placement}-composer-surface`, composerRoot,
      new Map(), ['[data-composer-surface-variant]'],
    );
    const composerToolbar = makeDomNode(
      `dynamic-${placement}-composer-toolbar`, composer,
      new Map(), ['[data-composer-footer-responsive]'],
    );
    selectorNodes.set(MODERN_COMPOSER_ROOT_SELECTOR, [composerRoot]);
    selectorNodes.set(MODERN_COMPOSER_SURFACE_SELECTOR, [composer]);
    selectorNodes.set(MODERN_COMPOSER_TOOLBAR_SELECTOR, [composerToolbar]);
    selectorNodes.set(LEGACY_COMPOSER_SURFACE_SELECTOR, []);
    selectorNodes.set(LEGACY_COMPOSER_TOOLBAR_SELECTOR, []);
    if (placement === "thread") {
      selectorNodes.set('[data-testid="home-icon"]', []);
      selectorNodes.set('[data-feature="game-source"]', []);
      selectorNodes.set('[role="main"]:has([data-testid="home-icon"])', []);
      selectorNodes.set('[role="main"]', []);
    }
    return { composerRoot, composer, composerToolbar };
  };
  return {
    addDynamicMessage, attrs, context, document, domNodes, flushTimers, intervals, listeners,
    nodes, observers, partFixtures, payloadFor, replaceWithDynamicModernComposer, revoked, root,
    rootClasses, rootStyle, timers, window,
  };
}

function unscopedCssRules(css) {
  const rules = [];
  let start = 0;
  let quote = null;
  let index = 0;
  while (index < css.length) {
    if (!quote && css.startsWith("/*", index)) {
      const end = css.indexOf("*/", index + 2);
      index = end < 0 ? css.length : end + 2;
      continue;
    }
    const character = css[index];
    if (quote) {
      if (character === "\\") index += 2;
      else { if (character === quote) quote = null; index += 1; }
      continue;
    }
    if (character === "\"" || character === "'") { quote = character; index += 1; continue; }
    if (character === "{") {
      const prelude = css.slice(start, index).trim();
      if (prelude && !prelude.startsWith("@") &&
        !prelude.includes('html[data-dream-skin="active"]') &&
        !prelude.includes(':root[data-dream-skin="active"]')) {
        rules.push(prelude);
      }
      start = index + 1;
    } else if (character === "}") {
      start = index + 1;
    }
    index += 1;
  }
  return rules;
}

export async function runRendererRuntimeTest(assetRoot) {
  const template = await fs.readFile(path.join(assetRoot, "renderer-inject.js"), "utf8");
  const css = await fs.readFile(path.join(assetRoot, "dream-skin.css"), "utf8");
  fixture.template = template;

  assert.match(template, /adoptedStyleSheets/);
  assert.match(template, /CSSStyleSheet/);
  assert.match(template, /window\.navigation/);
  assert.match(template, /electron-dark/);
  assert.match(template, /\[data-codex-composer-root\] \[data-composer-surface-variant\]/);
  assert.match(template, /\[data-codex-composer-root\] \[data-composer-footer-responsive\]/);
  assert.match(template, /composer-chrome-legacy/);
  assert.doesNotMatch(template, /electron-opaque|home-suggestion-list-item/,
    "Runtime payload must not carry retired selector documentation/fossils.");
  assert.doesNotMatch(template, /classList\.(add|remove|toggle)/);
  assert.doesNotMatch(template, /getBoundingClientRect|ResizeObserver/);
  assert.match(template, /childList:\s*true/);
  assert.match(template, /subtree:\s*true/);
  // The new contract intentionally keeps the `data-dream-*` attribute names
  // and `--dream-*` custom properties.  Only the retired DOM marker classes
  // and the measured fossil selector must be absent from the canonical CSS.
  assert.doesNotMatch(css, /(?:^|[.#\s])(?:codex-dream-skin|dream-skin-home|dream-home|dream-task)(?:[\s.#:{>]|$)|home-suggestion-list-item/);
  assert.match(css, /html\[data-dream-skin="active"\]/);
  // Home gating must stay single-level: CSS forbids :has() inside :has(),
  // and Chromium drops any rule that nests it (the v1.3.1 regression).  The
  // canonical CSS therefore gates on the :has()-free home-route-css alias.
  assert.match(css, /main:is\(\.main-surface, \[data-app-shell-main-surface\], \[class\*=\"_MainContentSurface_\"\]\):has\(\[role="main"\]\)/);
  assert.match(css, /main:is\(\.main-surface, \[data-app-shell-main-surface\], \[class\*=\"_MainContentSurface_\"\]\):not\(:has\(\[role="main"\]\)\)/);
  assert.match(css, /header:is\(\.app-header-tint, \[data-app-shell-header-edge-scroll\], \[class\*=\"_Header_\"\]\)/);
  assert.match(css, /:is\(\.app-shell-main-content-top-fade, \[data-app-shell-main-content-top-fade\], \[class\*=\"_MainContentTopFade_\"\]\)/);
  assert.doesNotMatch(css, /:has\([^()]*:has\(/);
  assert.match(css, /content:\s*var\(--dream-skin-name[\s\S]{0,180}var\(--dream-skin-brand-subtitle/);
  assert.match(css, /content:\s*var\(--dream-skin-status/);
  assert.match(css, /content:\s*var\(--dream-skin-quote/);
  assert.match(
    css,
    /\[data-codex-composer-root\]\[data-composer-placement="home"\]::after/,
    "Codex 26.803 Home must anchor the quote outside the semantic composer root.",
  );
  const modernHomeRootRule = css.match(
    /\[data-codex-composer-root\]\[data-composer-placement="home"\]\s*\{([\s\S]*?)\}/,
  )?.[1] ?? "";
  assert.match(modernHomeRootRule, /position:\s*relative;/,
    "Codex 26.803 Home must position the semantic composer root for the quote overlay.");
  assert.match(modernHomeRootRule, /isolation:\s*isolate;/,
    "Codex 26.803 Home must isolate the quote and native composer layers.");
  const modernHomeChildRule = css.match(
    /\[data-codex-composer-root\]\[data-composer-placement="home"\]\s*>\s*\*\s*\{([\s\S]*?)\}/,
  )?.[1] ?? "";
  assert.match(modernHomeChildRule, /position:\s*relative;/,
    "Native Home composer children must remain positioned inside the isolated root.");
  assert.match(modernHomeChildRule, /z-index:\s*1;/,
    "Native Home composer children must paint below the decorative quote.");
  const quoteRuleBodies = [...css.matchAll(
    /::after\s*\{\s*content:\s*var\(--dream-skin-quote,[^;]+;([\s\S]*?)\}/g,
  )].map((match) => match[1]);
  assert.equal(quoteRuleBodies.length, 2,
    "Legacy and Codex 26.803 Home quote rules must both remain available.");
  for (const quoteRuleBody of quoteRuleBodies) {
    assert.match(quoteRuleBody, /pointer-events:\s*none;/,
      "Decorative quotes must never intercept native controls.");
    assert.match(quoteRuleBody, /color:\s*rgb\(var\(--ds-text-rgb\) \/ \.94\);/,
      "Home quotes must use the theme text color for stable image contrast.");
    assert.match(quoteRuleBody,
      /font:\s*italic 600 14px\/1\.2 "Segoe Print", "Comic Sans MS", cursive;/,
      "Home quotes must retain the handwriting treatment at a readable weight.");
    assert.match(quoteRuleBody,
      /text-shadow:\s*0 1px 3px rgb\(var\(--ds-bg-rgb\) \/ \.92\),\s*0 0 12px rgb\(var\(--ds-accent-rgb\) \/ \.42\);/,
      "Home quotes must combine a dark outline with a theme-accent glow.");
  }
  const modernQuoteRule = css.match(
    /\[data-codex-composer-root\]\[data-composer-placement="home"\]::after\s*\{([\s\S]*?)\}/,
  )?.[1] ?? "";
  assert.match(modernQuoteRule, /right:\s*clamp\(52px, 4vw, 64px\);/,
    "Codex 26.803 Home must anchor the quote near the composer's right edge.");
  assert.match(modernQuoteRule, /bottom:\s*calc\(100% - 50px\);/,
    "Codex 26.803 Home must straddle only the input surface's top edge.");
  assert.match(modernQuoteRule, /z-index:\s*3;/,
    "The overlapping Home quote must paint above the composer surface.");
  assert.match(modernQuoteRule, /transform:\s*rotate\(-3deg\);/,
    "The right-side Home quote must preserve its handwriting rotation.");
  assert.match(modernQuoteRule, /transform-origin:\s*right bottom;/,
    "The right-side Home quote must rotate around its anchored edge.");
  assert.match(
    css,
    /@media \(max-width: 1120px\)\s*\{[\s\S]*?\[data-codex-composer-root\]\[data-composer-placement="home"\]::after\s*\{\s*content:\s*none;\s*\}/,
    "Narrow Home layouts must hide the decorative quote.",
  );
  assert.match(
    css,
    /@media \(max-height: 760px\)\s*\{[\s\S]*?\[data-codex-composer-root\]\[data-composer-placement="home"\]::after\s*\{\s*content:\s*none;\s*\}/,
    "Short Home layouts must hide the decorative quote.",
  );
  assert.match(css, /--ds-task-full-veil/);
  assert.match(css, /data-dream-task-mode="full"/);
  assert.match(css, /background-image:\s*var\(--ds-task-full-veil\),\s*var\(--dream-skin-art\)/);
  assert.match(
    css,
    /:not\(:has\(main:is\(\.main-surface, \[data-app-shell-main-surface\], \[class\*=\"_MainContentSurface_\"\]\)\)\)[\s\S]{0,120}\[data-ds-part="sidebar"\]/,
    "Core CSS must style the validated generic sidebar when the exact shell selector is absent.",
  );
  assert.match(
    css,
    /:not\(:has\(main:is\(\.main-surface, \[data-app-shell-main-surface\], \[class\*=\"_MainContentSurface_\"\]\)\)\)[\s\S]{0,180}\[data-ds-part="main"\]/,
    "Core CSS must paint a validated generic main surface.",
  );
  assert.match(
    css,
    /html\[data-dream-skin="active"\] \[data-ds-part="composer"\]\s*\{/,
    "Core CSS must style the final public composer part on exact and fallback shells.",
  );
  assert.match(
    css,
    /\[role="main"\]:has\(\[data-testid="home-icon"\]\):not\(:has\(\[data-codex-composer-root\]\)\)\s*\{[\s\S]{0,120}--thread-content-max-width/,
    "Legacy Home width stretching must be disabled when the 26.803 composer root exists.",
  );
  // Every home/project selector must stay behind the root skin gate.  A
  // marker-class-to-:has() conversion must never leave native layout rules
  // active after pause/restore.
  const unscoped = unscopedCssRules(css).join("\n");
  assert.doesNotMatch(unscoped, /\[role="main"\]:has\(\[data-testid="home-icon"\]\)/);
  assert.doesNotMatch(unscoped, /\.group\\\/project-selector/);

  const home = makeFixture({ nativeAppearance: "dark" });
  vm.runInNewContext(home.payloadFor({ art: { safeArea: "left", taskMode: "banner" } }), home.context);
  const state = home.window.__CODEX_DREAM_SKIN_STATE__;
  assert.equal(home.attrs.get("data-dream-skin"), "active");
  assert.equal(home.attrs.get("data-dream-shell"), "dark");
  assert.equal(home.attrs.get("data-ds-part"), "root");
  assert.equal(state.styleMode, "adopted");
  assert.equal(home.document.adoptedStyleSheets.length, 1);
  assert.equal(state.scope.baseState, "home");
  assert.equal(state.scope.level, "L1");
  assert.equal(home.rootStyle.values.get("--dream-skin-brand-subtitle"), '"CODEX DREAM SKIN"');
  assert.equal(home.rootStyle.values.get("--dream-skin-status"), '"DREAM SKIN ONLINE"');
  assert.equal(home.rootStyle.values.get("--ds-theme-surface-radius"), "12px");
  assert.equal(home.rootStyle.values.get("--ds-theme-surface-opacity"), "1");
  assert.equal(home.rootStyle.values.get("--ds-theme-surface-blur"), "0px");
  const publicDefaults = {
    "--ds-theme-font-family": "system",
    "--ds-theme-font-scale": "1",
    "--ds-theme-surface-border-alpha": "0.14",
    "--ds-theme-surface-shadow": "soft",
    "--ds-theme-image-zoom": "1",
    "--ds-theme-image-dim": "0",
    "--ds-theme-image-task-intensity": "0.35",
    "--ds-theme-density-scale": "standard",
    "--ds-theme-motion-level": "standard",
  };
  for (const [variable, expected] of Object.entries(publicDefaults)) {
    assert.equal(home.rootStyle.values.get(variable), expected);
  }
  assert.equal(home.rootStyle.values.get("--ds-theme-image-focus-x"), "0.72");
  assert.equal(home.rootStyle.values.get("--ds-theme-image-focus-y"), "0.5");
  assert.equal(state.metrics.routePasses, 1);
  assert.equal(state.metrics.partPasses, 1);
  assert.equal(state.metrics.layoutReads, 0, "Runtime must not perform layout reads");
  assert.equal(home.rootClasses.writes.length, 0, "Runtime must not write classes");
  const partObserver = home.observers.find((observer) => observer.options?.childList);
  const rootObserver = home.observers.find((observer) => observer.options?.attributes);
  assert.ok(partObserver?.options?.subtree, "Dynamic parts require one subtree child-list observer");
  assert.ok(rootObserver && !rootObserver.options?.childList && !rootObserver.options?.subtree);
  const expectedParts = {
    sidebar: "sidebar",
    main: "main",
    header: "header",
    home: "home",
    homeHero: "home-hero",
    projectList: "project-list",
    thread: "thread",
    legacyMessage: "message",
    composer: "composer",
    composerToolbar: "composer-toolbar",
  };
  for (const [fixtureKey, part] of Object.entries(expectedParts)) {
    assert.equal(home.partFixtures[fixtureKey].getAttribute("data-ds-part"), part,
      `${part} must be exposed through the public Safe CSS bridge`);
  }
  const dynamicMessage = home.addDynamicMessage();
  partObserver.callback([{ type: "childList" }]);
  home.flushTimers(80);
  assert.equal(dynamicMessage.getAttribute("data-ds-part"), "message");
  assert.equal(state.metrics.routePasses, 2,
    "DOM mutations must refresh SPA route scope alongside public parts");

  const modernMessages = makeFixture({ nativeAppearance: "dark", modernMessages: true });
  vm.runInNewContext(modernMessages.payloadFor(), modernMessages.context);
  assert.equal(modernMessages.partFixtures.legacyMessage.getAttribute("data-ds-part"), "message",
    "The legacy message role attribute must remain supported.");
  assert.equal(modernMessages.partFixtures.userMessage.getAttribute("data-ds-part"), "message",
    "Codex 26.727 user message anchors must expose the public message part.");
  assert.equal(modernMessages.partFixtures.assistantMessage.getAttribute("data-ds-part"), "message",
    "Codex 26.727 assistant message containers must expose the public message part.");

  const modernHome = makeFixture({
    nativeAppearance: "dark", composerKind: "modern", legacyShadow: true,
  });
  vm.runInNewContext(modernHome.payloadFor(), modernHome.context);
  assert.equal(modernHome.window.__CODEX_DREAM_SKIN_STATE__.scope.baseState, "home");
  assert.equal(modernHome.partFixtures.composer.getAttribute("data-ds-part"), "composer",
    "Codex 26.803 Home must expose its semantic surface as composer.");
  assert.equal(
    modernHome.partFixtures.composerToolbar.getAttribute("data-ds-part"), "composer-toolbar",
    "Codex 26.803 Home must expose its responsive footer as composer-toolbar.",
  );
  assert.equal(modernHome.partFixtures.composerRoot.getAttribute("data-ds-part"), null,
    "The semantic root must keep native layout; only its visual surface is themed.");
  assert.equal(modernHome.partFixtures.input.getAttribute("data-ds-part"), null,
    "The editable node must not receive the composer surface part.");
  assert.equal(modernHome.partFixtures.legacyComposerShadow.getAttribute("data-ds-part"), null,
    "A modern semantic composer must win over any incidental legacy chrome match.");

  const oldModernSurface = modernHome.partFixtures.composer;
  const dynamicThreadComposer = modernHome.replaceWithDynamicModernComposer("thread");
  const modernPartObserver = modernHome.observers.find((observer) => observer.options?.childList);
  modernPartObserver.callback([{ type: "childList" }]);
  modernHome.flushTimers(80);
  assert.equal(oldModernSurface.getAttribute("data-ds-part"), null,
    "SPA navigation must clean the public part from a removed Home composer.");
  assert.equal(dynamicThreadComposer.composer.getAttribute("data-ds-part"), "composer");
  assert.equal(
    dynamicThreadComposer.composerToolbar.getAttribute("data-ds-part"), "composer-toolbar",
  );
  assert.equal(modernHome.window.__CODEX_DREAM_SKIN_STATE__.scope.baseState, "thread",
    "SPA navigation must refresh scope together with composer parts.");

  const modernThread = makeFixture({
    nativeAppearance: "dark", composerKind: "modern", threadOnly: true,
  });
  vm.runInNewContext(modernThread.payloadFor(), modernThread.context);
  assert.equal(modernThread.window.__CODEX_DREAM_SKIN_STATE__.scope.baseState, "thread");
  assert.equal(modernThread.partFixtures.composer.getAttribute("data-ds-part"), "composer",
    "Codex 26.803 ordinary threads must expose the semantic composer surface.");
  assert.equal(
    modernThread.partFixtures.composerToolbar.getAttribute("data-ds-part"), "composer-toolbar",
  );

  const requestCards = makeFixture({
    nativeAppearance: "dark", composerKind: "none", threadOnly: true,
    excludedComposerSurfaces: true,
  });
  vm.runInNewContext(requestCards.payloadFor(), requestCards.context);
  for (const key of [
    "approvalSurface", "approvalComposer", "approvalInput", "requestNavigation", "requestInput",
  ]) {
    assert.equal(requestCards.partFixtures[key].getAttribute("data-ds-part"), null,
      key + " must not be exposed as the app composer.");
  }

  const generic = makeFixture({ nativeAppearance: "dark", generic: true });
  vm.runInNewContext(generic.payloadFor(), generic.context);
  assert.equal(generic.partFixtures.sidebar.getAttribute("data-ds-part"), "sidebar");
  assert.equal(generic.partFixtures.main.getAttribute("data-ds-part"), "main");
  assert.equal(generic.partFixtures.composer.getAttribute("data-ds-part"), "composer");
  assert.equal(generic.partFixtures.input.getAttribute("data-ds-part"), null,
    "The composer wrapper, not its input, should receive the public part when available.");
  assert.equal(generic.partFixtures.unrelatedAside.getAttribute("data-ds-part"), null,
    "An aside inside the main content must not be exposed as the app sidebar.");
  assert.equal(generic.partFixtures.dialogInput.getAttribute("data-ds-part"), null,
    "Dialog inputs must not be mistaken for the app composer.");

  const genericSearch = makeFixture({
    nativeAppearance: "dark", generic: true, genericComposer: false, genericSearch: true,
  });
  vm.runInNewContext(genericSearch.payloadFor(), genericSearch.context);
  assert.equal(genericSearch.partFixtures.searchForm.getAttribute("data-ds-part"), null,
    "A generic search form must not be exposed as the app composer.");
  assert.equal(genericSearch.partFixtures.searchInput.getAttribute("data-ds-part"), null,
    "A generic search textbox must not be exposed as the app composer.");

  const genericSearchBeforeComposer = makeFixture({
    nativeAppearance: "dark", generic: true, genericComposer: true, genericSearch: true,
  });
  vm.runInNewContext(
    genericSearchBeforeComposer.payloadFor(), genericSearchBeforeComposer.context,
  );
  assert.equal(
    genericSearchBeforeComposer.partFixtures.searchInput.getAttribute("data-ds-part"), null,
    "A preceding search textbox must remain unmarked.",
  );
  assert.equal(
    genericSearchBeforeComposer.partFixtures.composer.getAttribute("data-ds-part"), "composer",
    "A preceding search textbox must not hide the real semantic composer.",
  );

  const genericHome = makeFixture({ nativeAppearance: "dark", generic: true, genericHome: true });
  vm.runInNewContext(genericHome.payloadFor(), genericHome.context);
  assert.equal(genericHome.partFixtures.main.getAttribute("data-ds-part"), "home",
    "The specific home part must win when generic home and main are one node.");
  assert.equal(genericHome.window.__CODEX_DREAM_SKIN_STATE__.scope.baseState, "home");

  const full = makeFixture({ nativeAppearance: "dark" });
  vm.runInNewContext(full.payloadFor({ art: { taskMode: "full" } }), full.context);
  assert.equal(full.attrs.get("data-dream-task-mode"), "full");
  assert.equal(full.attrs.get("data-dream-art-task-mode"), "full");

  const explicitColors = {
    background: "#abc",
    panel: "#abcd",
    panelAlt: "#11223344",
    accent: "#010203",
    accentAlt: "rgba(4, 5, 6, .5)",
    secondary: "rgb(999, 2, 3)",
    highlight: "#abcdef",
    text: "#000",
    muted: "#fff8",
    line: "rgba(7, 8, 9, .25)",
  };
  const explicitLight = makeFixture({ nativeAppearance: "light" });
  vm.runInNewContext(explicitLight.payloadFor({
    appearance: "auto",
    colorMode: "explicit",
    explicitColorKeys: Object.keys(explicitColors),
    colors: explicitColors,
  }), explicitLight.context);
  const renderedColors = {
    background: "--ds-bg",
    panel: "--ds-panel",
    panelAlt: "--ds-panel-2",
    accent: "--ds-green",
    accentAlt: "--ds-lime",
    secondary: "--ds-cyan",
    highlight: "--ds-purple",
    text: "--ds-text",
    muted: "--ds-muted",
    line: "--ds-line",
  };
  for (const [key, variable] of Object.entries(renderedColors)) {
    assert.equal(explicitLight.rootStyle.values.get(variable), explicitColors[key],
      `Light auto appearance must preserve explicit ${key}`);
  }
  const publicColorVariables = {
    "--ds-theme-color-background": "background",
    "--ds-theme-color-panel": "panel",
    "--ds-theme-color-panel-alt": "panelAlt",
    "--ds-theme-color-accent": "accent",
    "--ds-theme-color-accent-alt": "accentAlt",
    "--ds-theme-color-secondary": "secondary",
    "--ds-theme-color-highlight": "highlight",
    "--ds-theme-color-text": "text",
    "--ds-theme-color-muted": "muted",
    "--ds-theme-color-line": "line",
  };
  for (const [variable, colorKey] of Object.entries(publicColorVariables)) {
    assert.equal(explicitLight.rootStyle.values.get(variable), explicitColors[colorKey],
      `${variable} must expose the validated theme color`);
  }
  const renderedRgb = {
    "--ds-bg-rgb": "170 187 204",
    "--ds-panel-rgb": "170 187 204",
    "--ds-panel-2-rgb": "17 34 51",
    "--ds-accent-rgb": "1 2 3",
    "--ds-accent-alt-rgb": "4 5 6",
    "--ds-secondary-rgb": "255 2 3",
    "--ds-highlight-rgb": "171 205 239",
    "--ds-text-rgb": "0 0 0",
    "--ds-muted-rgb": "255 255 255",
    "--ds-line-rgb": "7 8 9",
  };
  for (const [variable, expected] of Object.entries(renderedRgb)) {
    assert.equal(explicitLight.rootStyle.values.get(variable), expected,
      `${variable} must support official hex forms and clamp RGB channels`);
  }

  rootObserver.callback([]);
  home.flushTimers(64);
  assert.equal(state.metrics.routePasses, 2, "Attribute safety pass must not be a route pass");
  const navigationHandler = home.listeners.get("navigation:navigate");
  assert.equal(typeof navigationHandler, "function");
  navigationHandler();
  home.flushTimers(180);
  assert.equal(state.metrics.navigationEvents, 1);
  assert.equal(state.metrics.routePasses, 3);

  const settings = makeFixture({ nativeAppearance: "light", settings: true });
  vm.runInNewContext(settings.payloadFor(), settings.context);
  assert.equal(settings.window.__CODEX_DREAM_SKIN_STATE__.scope.baseState, "settings");
  assert.equal(settings.window.__CODEX_DREAM_SKIN_STATE__.scope.level, "L0");
  assert.equal(settings.attrs.get("data-dream-skin"), "active");
  assert.equal(settings.document.adoptedStyleSheets.length, 1);

  const currentSettings = makeFixture({ nativeAppearance: "light", settingsPanel: true });
  vm.runInNewContext(currentSettings.payloadFor(), currentSettings.context);
  const currentSettingsScope = currentSettings.window.__CODEX_DREAM_SKIN_STATE__.scope;
  assert.equal(currentSettingsScope.baseState, "settings",
    "Codex 26.727 general-settings must classify as Settings without legacy appearance controls.");
  assert.equal(currentSettingsScope.level, "L0");
  assert.equal(currentSettingsScope.missingL1.length, 0);
  assert.equal(currentSettings.attrs.get("data-dream-skin"), "active");
  assert.equal(currentSettings.document.adoptedStyleSheets.length, 1);

  const explicit = makeFixture({ nativeAppearance: "light" });
  const result = vm.runInNewContext(explicit.payloadFor({ appearance: "dark", quote: "TEST QUOTE" }), explicit.context);
  assert.equal(result.shell, "dark", "Explicit appearance must beat native appearance");
  assert.equal(explicit.attrs.get("data-dream-shell"), "dark");
  const oldState = explicit.window.__CODEX_DREAM_SKIN_STATE__;
  vm.runInNewContext(explicit.payloadFor({ appearance: "dark" }), explicit.context);
  assert.equal(oldState.cleanup(), false, "A stale cleanup must not remove the replacement");
  const replacement = explicit.window.__CODEX_DREAM_SKIN_STATE__;
  assert.equal(explicit.document.adoptedStyleSheets.length, 1);
  assert.equal(replacement.cleanup(), true);
  assert.equal(explicit.document.adoptedStyleSheets.length, 0);
  assert.equal(explicit.attrs.size, 0);
  assert.equal(explicit.rootStyle.values.size, 0);
  assert.equal(explicit.window.__CODEX_DREAM_SKIN_STATE__, undefined);
  assert.ok([...explicit.domNodes].every((node) => node.getAttribute?.("data-ds-part") === null));
  assert.deepEqual(explicit.revoked, ["blob:fixture-1", "blob:fixture-2"]);

  const fallback = makeFixture({ nativeAppearance: "dark", adopted: false });
  vm.runInNewContext(fallback.payloadFor(), fallback.context);
  const fallbackState = fallback.window.__CODEX_DREAM_SKIN_STATE__;
  assert.equal(fallbackState.styleMode, "style");
  assert.ok(fallback.nodes.has("codex-dream-skin-style"));
  assert.equal(fallbackState.cleanup(), true);
  assert.equal(fallback.nodes.has("codex-dream-skin-style"), false);

  console.log(`PASS: unified renderer runtime (${path.basename(assetRoot)})`);
}

const fixture = { template: "" };
