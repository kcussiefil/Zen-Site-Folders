// ==UserScript==
// @name         Zen Site Folders — native Zen/Zia folder motion
// @version      0.3.7
// @description  Delegate tab-group collapse, selection and animation entirely to Zen/Zia.
// @include      chrome://browser/content/browser.xhtml
// ==/UserScript==
(() => {
  'use strict';
  if (window.__zsfCollapseV037) return;

  // Previous v0.3.3–v0.3.6 versions ran another Web Animations height
  // transition and then switched a collapsed group to display:none.
  // Zia already hooks the native tab-group animation, including the
  // selected-tab transition and reversal. A second controller can only
  // compete for geometry and make the last frame snap.
  //
  // This module intentionally does NOT listen for TabGroupCollapse,
  // TabGroupExpand, TabSelect or clicks. It does not animate, hide, move
  // or replace any tabs. Keep it in the Sine manifest to replace the old
  // script reliably during auto-update.

  const SELECTOR = 'tab-group[data-zsf-site]:not([split-view-group])';

  function clearLegacyFlags() {
    const tabs = window.gBrowser?.tabContainer;
    if (!tabs) return;
    for (const group of tabs.querySelectorAll?.(SELECTOR) || []) {
      group.removeAttribute('data-zsf-animating');
      group.removeAttribute('data-zsf-collapse-settled');
    }
  }

  const api = { version: '0.3.7', clearLegacyFlags };
  window.__zsfCollapseV037 = api;
  if (document.readyState === 'complete') clearLegacyFlags();
  else window.addEventListener('load', clearLegacyFlags, { once: true });
})();
