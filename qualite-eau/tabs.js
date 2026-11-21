(function () {
  "use strict";

  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs [role="tab"]'));
  var panels = Array.prototype.slice.call(document.querySelectorAll(".tab-panel"));
  if (!tabs.length || !panels.length) return;

  function isTabName(name) {
    return tabs.some(function (t) { return t.dataset.tab === name; });
  }

  function activateTab(name, opts) {
    opts = opts || {};
    if (!isTabName(name)) return false;
    tabs.forEach(function (tab) {
      var on = tab.dataset.tab === name;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    });
    panels.forEach(function (panel) {
      var on = panel.dataset.tab === name;
      panel.hidden = !on;
      panel.tabIndex = on ? 0 : -1;
    });
    if (opts.updateHash) {
      history.replaceState(null, "", "#" + name);
    }
    // Un nouvel onglet s'ouvre en haut de son texte, pas au milieu
    if (opts.toTop) {
      // La barre d'onglets est collante : sa position utile est la fin de l'en-tête
      var header = document.querySelector(".site-header");
      var haut = header ? header.offsetHeight : 0;
      if (window.scrollY > haut) window.scrollTo(0, haut);
    }
    return true;
  }

  // Une ancre comme #src-li-2022 (une source citée en note de bas de texte) vit dans l'onglet
  // Sources, qui est `hidden` tant qu'il n'est pas actif : le navigateur ne peut pas y faire
  // défiler la page tant qu'on n'a pas d'abord affiché cet onglet.
  function jumpToAnchor(id, opts) {
    opts = opts || {};
    var target = document.getElementById(id);
    if (!target) return false;
    var panel = target.closest(".tab-panel");
    if (panel) activateTab(panel.dataset.tab, { updateHash: false });
    requestAnimationFrame(function () {
      target.scrollIntoView({ behavior: opts.smooth === false ? "auto" : "smooth", block: "start" });
    });
    history.replaceState(null, "", "#" + id);
    return true;
  }

  tabs.forEach(function (tab, i) {
    tab.addEventListener("click", function () {
      activateTab(tab.dataset.tab, { updateHash: true, toTop: true });
    });
    tab.addEventListener("keydown", function (e) {
      var idx = null;
      if (e.key === "ArrowRight" || e.key === "Right") idx = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft" || e.key === "Left") idx = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") idx = 0;
      else if (e.key === "End") idx = tabs.length - 1;
      else return;
      e.preventDefault();
      tabs[idx].focus();
      activateTab(tabs[idx].dataset.tab, { updateHash: true });
    });
  });

  // Intercepte les liens de citation [n] (et toute ancre interne visant une autre section) pour
  // basculer d'onglet avant de faire défiler, plutôt que de laisser le navigateur cibler un
  // élément caché.
  document.addEventListener("click", function (e) {
    var link = e.target.closest('a[href^="#"]');
    if (!link) return;
    var id = link.getAttribute("href").slice(1);
    if (!id || isTabName(id)) return;
    var target = document.getElementById(id);
    if (!target || !target.closest(".tab-panel")) return;
    e.preventDefault();
    jumpToAnchor(id);
  });

  window.addEventListener("hashchange", function () {
    var id = location.hash.replace("#", "");
    if (!id) return;
    if (isTabName(id)) activateTab(id, { toTop: true });
    else jumpToAnchor(id, { smooth: true });
  });

  var initial = location.hash.replace("#", "");
  if (initial && isTabName(initial)) {
    activateTab(initial, {});
  } else if (initial && document.getElementById(initial)) {
    jumpToAnchor(initial, { smooth: false });
  } else {
    activateTab(tabs[0].dataset.tab, {});
  }
})();
