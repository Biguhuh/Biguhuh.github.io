// Carte des deux axes : captages en points, réseaux en zones de communes.
// Données : <script id="carte-donnees">, écrites par scripts/carte_axes.py.
(function () {
  "use strict";
  var bloc = document.getElementById("carte-donnees");
  var racine = document.getElementById("carte");
  if (!bloc || !racine) return;
  var D = JSON.parse(bloc.textContent);
  var blocC = document.getElementById("champs-donnees");
  var C = blocC ? JSON.parse(blocC.textContent) : null;
  var NS = "http://www.w3.org/2000/svg";
  var noms = {};
  ["axe1", "axe2"].forEach(function (a) {
    D.substances[a].forEach(function (s) { noms[a + s.cle] = s.nom; });
  });
  // Classes de nitrates moyens pour la couleur des points, en mg/L
  var CLASSES = [[10, "#86b6ef"], [25, "#5598e7"], [40, "#2a78d6"], [50, "#1c5cab"], [Infinity, "#0d366b"]];

  // Au clavier : Tab va de point en point, Entrée ou Espace affiche le panneau
  function clavier(e, action) {
    e.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); action(); }
    });
  }
  function el(nom, attrs, parent) {
    var e = document.createElementNS(NS, nom);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function fmt(v) {
    var s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3);
    if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s.replace(".", ",");
  }
  function esc(t) { var d = document.createElement("div"); d.textContent = t; return d.innerHTML; }
  function dateDe(a) {
    var an = Math.floor(a), j = Math.round((a - an) * 365.25);
    var d = new Date(Date.UTC(an, 0, 1) + j * 864e5);
    return d.toLocaleDateString("fr-FR", { timeZone: "UTC" });
  }
  function couleur(m) {
    if (m === null || m === undefined) return null;
    for (var i = 0; i < CLASSES.length; i++) if (m < CLASSES[i][0]) return CLASSES[i][1];
  }

  // ---------- Carte ----------
  var svg = el("svg", { viewBox: "0 0 " + D.largeur + " " + D.hauteur, class: "carte-svg", role: "img",
    "aria-label": "Carte des Deux-Sèvres : communes, réseaux et captages" });
  var plan = racine.querySelector(".carte-plan");
  plan.insertBefore(svg, plan.firstChild);
  var gC = el("g", {}, svg), gP = el("g", {}, svg);
  var chemins = {};
  D.communes.forEach(function (c) {
    var p = el("path", { d: c.d, class: "carte-commune" + (c.mellois ? " mellois" : "") + (c.udi.length ? "" : " sans-reseau") }, gC);
    p.dataset.code = c.code;
    chemins[c.code] = p;
    p.addEventListener("mouseenter", function () { montrerCommune(c); });
    p.addEventListener("click", function () { montrerCommune(c, true); });
  });
  var communesDe = {};
  D.communes.forEach(function (c) { c.udi.forEach(function (u) { (communesDe[u] = communesDe[u] || []).push(c.code); }); });

  D.captages.forEach(function (k) {
    var col = couleur(k.moy_nitrates);
    var analyse = Object.keys(k.series).length > 0;
    var cercle = el("circle", { cx: k.x, cy: k.y, r: analyse ? 5 : 3.2,
      class: "carte-point" + (analyse ? "" : " vide"), fill: col || (analyse ? "#9a988f" : "none") }, gP);
    var cible = el("circle", { cx: k.x, cy: k.y, r: 10, class: "carte-cible", tabindex: 0, role: "button",
      "aria-label": "Captage de " + k.commune + (analyse ? "" : ", sans analyse de l'ARS") }, gP);
    function entrer() { montrerCaptage(k, cercle); }
    cible.addEventListener("mouseenter", entrer);
    cible.addEventListener("click", function () { montrerCaptage(k, cercle, true); });
    clavier(cible, function () { montrerCaptage(k, cercle, true); });
  });

  // Prises d'eau de surface : carrés ; bord tireté si la position est approchée
  (D.prises || []).forEach(function (k) {
    var col = couleur(k.moy_nitrates);
    var analyse = Object.keys(k.series).length > 0;
    var c = 6.5;
    var carre = el("rect", { x: k.x - c, y: k.y - c, width: 2 * c, height: 2 * c, rx: 1.5,
      class: "carte-prise" + (k.exacte ? "" : " approx"), fill: col || (analyse ? "#9a988f" : "#ffffff") }, gP);
    var cible = el("circle", { cx: k.x, cy: k.y, r: 12, class: "carte-cible", tabindex: 0, role: "button",
      "aria-label": "Prise d'eau de surface " + k.nom + ", " + k.commune }, gP);
    cible.addEventListener("mouseenter", function () { montrerPrise(k, carre); });
    cible.addEventListener("click", function () { montrerPrise(k, carre, true); });
    clavier(cible, function () { montrerPrise(k, carre, true); });
  });

  // ---------- Panneau ----------
  var panneau = racine.querySelector(".carte-panneau");
  var epingle = false, actifs = [];
  function nettoyer() {
    actifs.forEach(function (e) { e.classList.remove("actif"); });
    actifs = [];
  }
  function marquer(e) { e.classList.add("actif"); actifs.push(e); }

  function montrerCommune(c, clic) {
    if (epingle && !clic) return;
    epingle = !!clic;
    nettoyer();
    var html = "<h3>" + esc(c.nom) + "</h3>";
    if (!c.udi.length) {
      html += "<p>Pas de réseau rattaché à cette commune dans le lien de l'ARS de " + D.annee_liens + ".</p>";
    }
    c.udi.forEach(function (u) {
      (communesDe[u] || []).forEach(function (code) { marquer(chemins[code]); });
      var r = D.udi[u];
      html += '<div class="carte-bloc"><p class="carte-titre">Réseau ' + esc(r.nom) + "</p>";
      html += '<p class="carte-sous">Eau du robinet. Réseau qui dessert ' + r.communes.length + " commune" +
        (r.communes.length > 1 ? "s" : "") + ", en clair sur la carte.</p>";
      html += graphes("axe2", r.series) + "</div>";
    });
    panneau.innerHTML = html + aide();
  }

  function montrerCaptage(k, cercle, clic) {
    if (epingle && !clic) return;
    epingle = !!clic;
    nettoyer();
    marquer(cercle);
    var html = "<h3>Captage, " + esc(k.commune) + "</h3><p class=\"carte-sous\">Point d'eau souterraine " +
      esc(k.code_bss) + ". Eau brute, avant traitement.";
    if (k.moy_nitrates !== null) html += " Nitrates en moyenne sur 2021-2025 : " + fmt(k.moy_nitrates) + " mg/L.";
    html += "</p>";
    if (!Object.keys(k.series).length) html += "<p>Aucune analyse de l'ARS de 2021 à 2025 pour ce point.</p>";
    else html += graphes("axe1", k.series);
    panneau.innerHTML = html + champs(k.id) + achats(k.id) + aide();
  }
  function montrerPrise(k, carre, clic) {
    if (epingle && !clic) return;
    epingle = !!clic;
    nettoyer();
    marquer(carre);
    var html = "<h3>Prise d'eau de surface, " + esc(k.nom) + "</h3><p class=\"carte-sous\">Commune : " + esc(k.commune) + ". ";
    html += k.exacte ? "Le carré est placé sur la station de mesure " + esc(k.station) + ", pas forcément sur la prise elle-même."
      : "Position approchée : la banque des prélèvements ne donne que le centre de la commune.";
    html += "</p>" + volumes(k.volumes);
    if (!Object.keys(k.series).length) {
      html += "<p>Aucune analyse publiée pour cette prise dans Naïades depuis 2021.</p>";
    } else {
      html += '<p class="carte-sous">Eau brute de la retenue ou de la rivière, avant traitement. Analyses : ' +
        esc(k.producteurs.join(" ; ")) + ".";
      if (k.moy_nitrates !== null) html += " Nitrates en moyenne : " + fmt(k.moy_nitrates) + " mg/L.";
      html += "</p>" + graphes("surface", k.series);
    }
    panneau.innerHTML = html + champs(k.id) + achats(k.id) + aide();
  }

  // ---------- Champs dans un rayon de 1 km, registre parcellaire 2024 ----------
  function champs(id) {
    var p = C && C.points[id];
    if (!p) return "";
    var R = C.rayon, o = ['<svg class="champs-svg" viewBox="' + (-R) + " " + (-R) + " " + 2 * R + " " + 2 * R + '" role="img" aria-label="Parcelles dans un rayon de 1 km">'];
    o.push('<defs><clipPath id="clip-champs"><circle cx="0" cy="0" r="' + R + '"/></clipPath></defs>');
    o.push('<circle class="champs-fond" cx="0" cy="0" r="' + R + '"/><g clip-path="url(#clip-champs)">');
    p.parcelles.forEach(function (q) {
      o.push('<path d="' + q[1] + '" fill="' + C.categories[q[0]][1] + '" class="champs-parcelle"><title>' + esc(C.categories[q[0]][0]) + "</title></path>");
    });
    o.push('</g><circle class="champs-bord" cx="0" cy="0" r="' + R + '"/><circle class="champs-centre" cx="0" cy="0" r="35"/></svg>');
    // Parts 2015 et 2024, en barres empilées
    function pile(an) {
      var x = 0, s = "";
      p.parts[an].forEach(function (v, i) {
        if (v > 0) s += '<rect x="' + x + '" y="0" width="' + Math.max(0, v - 0.3) + '" height="10" fill="' + C.categories[i][1] + '"><title>' + esc(C.categories[i][0]) + " : " + fmt(v) + " %</title></rect>";
        x += v;
      });
      s += '<rect x="' + x + '" y="0" width="' + Math.max(0, 100 - x) + '" height="10" class="champs-hors"><title>Hors parcelles déclarées : ' + fmt(p.hors[an]) + " %</title></rect>";
      return '<div class="champs-ligne"><span>' + an + '</span><svg viewBox="0 0 100 10" preserveAspectRatio="none" class="champs-pile">' + s + "</svg></div>";
    }
    var leg = C.categories.map(function (c, i) {
      return '<li><span class="champs-carre" style="background:' + c[1] + '"></span>' + esc(c[0]) + " : " + fmt(p.parts["2015"][i]) + " % → " + fmt(p.parts["2024"][i]) + " %</li>";
    }).join("") + '<li><span class="champs-carre champs-hors-carre"></span>Hors parcelles déclarées, bois, bourgs, routes : ' + fmt(p.hors["2015"]) + " % → " + fmt(p.hors["2024"]) + " %</li>";
    return '<div class="carte-bloc"><p class="carte-titre">Les champs dans un rayon de 1 km</p>' +
      '<p class="carte-sous">Parcelles déclarées en 2024, registre parcellaire graphique. Le point noir est le captage. Ce cercle n\'est pas l\'aire qui alimente le captage : elle n\'est pas publiée ici.</p>' +
      '<div class="champs">' + o.join("") + '<div class="champs-parts">' + pile("2015") + pile("2024") + '<ul class="champs-leg">' + leg + "</ul></div></div></div>";
  }

  // ---------- Achats de pesticides dans le code postal du point ----------
  function achats(id) {
    if (!C) return "";
    var cps = (C.cp_point[id] || []).filter(function (cp) { return C.cp[cp]; });
    if (!cps.length) return "";
    var out = "";
    cps.forEach(function (cp) {
      var c = C.cp[cp], blocs = "", aucun = [];
      C.molecules.forEach(function (m) {
        var s = c.series[m[0]] || {}, ans = Object.keys(s);
        if (!ans.length || !ans.some(function (a) { return s[a] > 0; })) { aucun.push(m[1]); return; }
        blocs += barresAn(m[1] + ", kg par an", s, "Molécule mère de : " + m[2] + ".");
      });
      var manquent = C.annees.filter(function (a) { return c.annees_presentes.indexOf(a) < 0; });
      out += '<div class="carte-bloc"><p class="carte-titre">Achats de pesticides, code postal ' + esc(cp) + "</p>" +
        '<p class="carte-sous">Achats déclarés par les acheteurs de ce code postal, qui couvre : ' + esc(c.communes.join(", ")) +
        ". Le lieu d'achat n'est pas le lieu d'épandage." +
        (manquent.length ? " Code postal absent du fichier en " + manquent.join(", ") + " : secret ou aucun achat." : "") + "</p>" +
        blocs + (aucun.length ? '<p class="carte-sous">Aucun achat déclaré de 2015 à 2024 : ' + esc(aucun.join(", ")) + ".</p>" : "") + "</div>";
    });
    return out;
  }
  function barresAn(titre, s, note) {
    var W = 340, H = 90, g = 40, d = 8, h = 10, b = 18, ans = C.annees;
    var vmax = Math.max.apply(null, ans.map(function (a) { return s[a] || 0; })) || 1;
    var X = function (i) { return g + i * (W - g - d) / ans.length; };
    var Y = function (v) { return H - b - v / vmax * (H - b - h); };
    var lg = (W - g - d) / ans.length - 3;
    var o = ['<svg class="petit" viewBox="0 0 ' + W + " " + H + '"><line class="g-grille" x1="' + g + '" x2="' + (W - d) + '" y1="' + Y(0) + '" y2="' + Y(0) + '"/>'];
    ans.forEach(function (a, i) {
      var v = s[a] || 0;
      if (v > 0) o.push('<rect class="petit-barre" x="' + (X(i) + 1.5) + '" y="' + Y(v) + '" width="' + lg + '" height="' + (Y(0) - Y(v)) + '" rx="1.5"><title>' + a + " : " + fmt(v) + " kg</title></rect>");
      if (i % 3 === 0) o.push('<text class="g-axe" x="' + (X(i) + 1.5) + '" y="' + (H - 4) + '">' + a + "</text>");
    });
    o.push('<text class="g-axe" x="' + (g - 4) + '" y="' + (Y(vmax) + 4) + '" text-anchor="end">' + fmt(vmax) + '</text><text class="g-axe" x="' + (g - 4) + '" y="' + (Y(0) + 4) + '" text-anchor="end">0</text></svg>');
    return '<div class="petit-bloc"><p class="petit-titre">' + esc(titre) + "</p>" + o.join("") + '<p class="carte-sous">' + esc(note) + "</p></div>";
  }

  // Volumes pompés par année, en millions de m³, d'après la banque des prélèvements
  function volumes(v) {
    var ans = Object.keys(v).sort();
    if (!ans.length) return "";
    var W = 340, H = 90, g = 36, d = 8, h = 10, b = 18;
    var vmax = Math.max.apply(null, ans.map(function (a) { return v[a]; })) / 1e6 || 1;
    var a0 = +ans[0], a1 = +ans[ans.length - 1] + 1;
    var X = function (t) { return g + (t - a0) / (a1 - a0) * (W - g - d); };
    var Y = function (m) { return H - b - m / vmax * (H - b - h); };
    var larg = Math.max(2, (W - g - d) / (a1 - a0) - 2);
    var o = ['<svg class="petit" viewBox="0 0 ' + W + " " + H + '">'];
    o.push('<line class="g-grille" x1="' + g + '" x2="' + (W - d) + '" y1="' + Y(0) + '" y2="' + Y(0) + '"/>');
    ans.forEach(function (a) {
      var m = v[a] / 1e6;
      if (m > 0) o.push('<rect class="petit-barre" x="' + (X(+a) + 1) + '" y="' + Y(m) + '" width="' + larg + '" height="' + (Y(0) - Y(m)) +
        '" rx="1.5"><title>' + a + " : " + fmt(m) + " million" + (m >= 2 ? "s" : "") + " de m³</title></rect>");
    });
    var pas = Math.max(1, Math.ceil((a1 - a0) / 6));
    for (var a = a0; a < a1; a += pas) o.push('<text class="g-axe" x="' + (X(a) + 2) + '" y="' + (H - 4) + '">' + a + "</text>");
    o.push('<text class="g-axe" x="' + (g - 4) + '" y="' + (Y(vmax) + 4) + '" text-anchor="end">' + fmt(vmax) + "</text>");
    o.push('<text class="g-axe" x="' + (g - 4) + '" y="' + (Y(0) + 4) + '" text-anchor="end">0</text>');
    o.push("</svg>");
    return '<div class="petit-bloc"><p class="petit-titre">Volume pompé pour l’eau potable, millions de m³ par an</p>' + o.join("") + "</div>";
  }

  function aide() {
    return '<p class="carte-aide">' + (epingle ? "Sélection fixée. Clique ailleurs sur la carte pour en changer, ou survole après avoir cliqué sur le fond." :
      "Clique pour fixer la sélection.") + "</p>";
  }
  svg.addEventListener("click", function (e) {
    if (e.target === svg) { epingle = false; nettoyer(); }
  });

  // ---------- Petits graphes ----------
  function graphes(axe, series) {
    var out = "", absents = [];
    D.substances[axe].forEach(function (s) {
      var pts = series[s.cle];
      if (!pts || !pts.length) return;
      var q = pts.filter(function (p) { return !p[2]; });
      if (!q.length) { absents.push(s.nom); return; }
      out += petit(axe, s, pts);
    });
    if (absents.length) out += '<p class="carte-sous">Cherchés, jamais quantifiés : ' + esc(absents.join(" ; ")) + ".</p>";
    return out || "<p>Aucune analyse pour les substances suivies.</p>";
  }

  function limiteA(lims, t) {
    for (var i = 0; i < lims.length; i++) if (lims[i][3] === "limite" && lims[i][0] <= t && t < lims[i][1]) return lims[i][2];
    return null;
  }

  function petit(axe, s, pts) {
    var W = 340, H = 120, g = 36, d = 8, h = 10, b = 18;
    var per = D.periodes[axe];
    var t0 = Math.floor(pts[0][0]), t1 = Math.floor(pts[pts.length - 1][0]) + 1;
    t0 = Math.max(t0, per[0]);
    var lims = (D.limites[axe][s.cle] || []).slice();
    var nitrates = s.cle === "1340";
    // Repère : limite du robinet, 50 mg/L, sur les nitrates de l'eau brute
    if (axe === "axe1" && nitrates) lims.push([per[0], per[1], 50, "repère"]);
    var vmax = 0;
    pts.forEach(function (p) { if (!p[2]) vmax = Math.max(vmax, p[1]); });
    lims.forEach(function (l) { if (l[1] > t0 && l[0] < t1) vmax = Math.max(vmax, l[2]); });
    vmax = vmax * 1.1 || 1;
    var X = function (t) { return g + (t - t0) / (t1 - t0) * (W - g - d); };
    var Y = function (v) { return H - b - v / vmax * (H - b - h); };
    var o = ['<svg class="petit" viewBox="0 0 ' + W + " " + H + '">'];
    o.push('<line class="g-grille" x1="' + g + '" x2="' + (W - d) + '" y1="' + Y(0) + '" y2="' + Y(0) + '"/>');
    var pas = Math.max(1, Math.ceil((t1 - t0) / 6));
    for (var a = t0; a < t1; a += pas) {
      o.push('<text class="g-axe" x="' + (X(a) + 2) + '" y="' + (H - 4) + '">' + a + "</text>");
      o.push('<line class="g-an" x1="' + X(a) + '" x2="' + X(a) + '" y1="' + h + '" y2="' + Y(0) + '"/>');
    }
    o.push('<text class="g-axe" x="' + (g - 4) + '" y="' + (Y(vmax / 1.1) + 4) + '" text-anchor="end">' + fmt(vmax / 1.1) + "</text>");
    o.push('<text class="g-axe" x="' + (g - 4) + '" y="' + (Y(0) + 4) + '" text-anchor="end">0</text>');
    // Moyenne annuelle des nitrates, si presque toutes les analyses de l'année sont quantifiées
    if (nitrates) {
      var parAn = {};
      pts.forEach(function (p) { var an = Math.floor(p[0]); (parAn[an] = parAn[an] || []).push(p); });
      Object.keys(parAn).forEach(function (an) {
        var l = parAn[an], qq = l.filter(function (p) { return !p[2]; });
        if (qq.length < 3 || qq.length < 0.8 * l.length) return;
        var m = qq.reduce(function (s0, p) { return s0 + p[1]; }, 0) / qq.length;
        var a0 = Math.max(+an, t0), a1 = Math.min(+an + 1, t1);
        o.push('<line class="petit-moy" x1="' + X(a0) + '" x2="' + X(a1) + '" y1="' + Y(m) + '" y2="' + Y(m) + '"><title>Moyenne ' + an + " : " + fmt(m) + "</title></line>");
      });
    }
    pts.forEach(function (p) {
      if (p[2]) {
        o.push('<line class="petit-cens" x1="' + X(p[0]) + '" x2="' + X(p[0]) + '" y1="' + (Y(0) - 3) + '" y2="' + (Y(0) + 3) + '"><title>' + dateDe(p[0]) + " : sous le seuil de quantification</title></line>");
        return;
      }
      var lim = limiteA(lims, p[0]);
      var sup = lim !== null && p[1] > lim;
      o.push('<circle class="' + (sup ? "g-pt-sup" : "g-pt") + '" cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="' + (pts.length > 200 ? 2 : 3) + '"><title>' + dateDe(p[0]) + " : " + fmt(p[1]) + "</title></circle>");
    });
    lims.forEach(function (l) {
      var a0 = Math.max(l[0], t0), a1 = Math.min(l[1], t1);
      if (a1 <= a0) return;
      var cls = l[3] === "limite" ? "g-lim" : l[3] === "repère" ? "petit-repere" : "g-ref";
      o.push('<line class="g-halo" x1="' + X(a0) + '" x2="' + X(a1) + '" y1="' + Y(l[2]) + '" y2="' + Y(l[2]) + '"/>');
      o.push('<line class="' + cls + '" x1="' + X(a0) + '" x2="' + X(a1) + '" y1="' + Y(l[2]) + '" y2="' + Y(l[2]) + '"/>');
      o.push('<text class="g-lim-txt" x="' + (X(a0) + 3) + '" y="' + (Y(l[2]) - 4) + '">' + fmt(l[2]) + "</text>");
    });
    // Repères numérotés aux dates où la limite change, expliqués sous le graphe
    var chg = ((D.changements || {})[axe] || {})[s.cle] || [], notes = [];
    chg.forEach(function (c, i) {
      if (c[0] < t0 || c[0] >= t1) return;
      var xc = X(c[0]);
      o.push('<line class="g-chgt" x1="' + xc + '" x2="' + xc + '" y1="' + h + '" y2="' + Y(0) + '"/>');
      o.push('<circle class="g-chgt-rond" cx="' + xc + '" cy="' + (h + 1) + '" r="6"/><text class="g-chgt-num petit-num" x="' + xc + '" y="' + (h + 4) + '" text-anchor="middle">' + (i + 1) + "</text>");
      notes.push('<li value="' + (i + 1) + '">' + citer(esc(c[1])) + "</li>");
    });
    o.push("</svg>");
    var unite = nitrates ? "mg/L" : "µg/L";
    var pq = notes.length ? '<div class="g-pourquoi petit-pourquoi"><p><strong>Pourquoi la ligne change</strong></p><ol>' + notes.join("") + "</ol></div>" : "";
    return '<div class="petit-bloc"><p class="petit-titre">' + esc(s.nom) + ", " + unite + "</p>" + o.join("") + pq + "</div>";
  }
  // [27] devient un appel vers l'onglet Sources, [fait] une étiquette
  // Les numéros du dossier deviennent ceux de l'onglet Sources de la page
  var blocN = document.getElementById("num-sources");
  var NUM = blocN ? JSON.parse(blocN.textContent) : {};
  function citer(t) {
    return t.replace(/\[(fait|estimation|hypothèse)\]/g, '<span class="tag">$1</span>')
      .replace(/\[(\d{1,3})\]/g, function (_, g) {
        var n = NUM[g] || g;
        return '<sup class="cite">[<a href="#src-' + n + '">' + n + "</a>]</sup>";
      });
  }
})();
