// Transport des poussières dans l'écoulement moyen de la pièce. Voir docs/theorie_convection.md (§8).
//
// Dans l'air : dx = (u − v_s·e_y) dt + √(2 D dt) ξ,  D = D_brownien + D_t,  D_t = ν_t / Sc_t constant.
//
// Couche de paroi : la diffusivité turbulente s'y éteint en n³ (profil de Lai & Nazaroff 2000),
// sur une épaisseur δ. La résoudre demanderait des pas de quelques millisecondes : une marche
// aléatoire à pas raisonnables la « saute » et dépose cent fois trop. On la traite donc
// analytiquement. Sa résistance au transport vaut
//     I = ∫₀^∞ dn / (D_B + a n³) = (2π / 3√3) · D_B^(-2/3) · a^(-1/3),   a = D_t / δ³,
// et chaque surface devient partiellement absorbante, de réactivité K (vitesse de dépôt) :
//     paroi verticale  K = 1 / I
//     face vers le haut K = v_s / (1 − e^(−v_s I))
//     face vers le bas  K = v_s / (e^(v_s I) − 1)
// Une particule dont le pas traverse une surface s'y dépose avec la probabilité
// P = K √(π Δt / D) (Erban & Chapman 2007), sinon elle est réfléchie.

const Transport = (() => {
  // SORTIE : a quitté le système (parti au fond du couloir) ; COULOIR : déposée côté couloir
  const AIR = 0, SOL = 1, DESSUS_M1 = 2, DESSUS_M2 = 3, COTES = 4, RADIATEUR = 5, FENETRE = 6, MURS = 7, PLAFOND = 8, SORTIE = 9, COULOIR = 10;
  const DT_MAX = 0.5;        // s : saut turbulent √(2 D_t dt) ≈ 7 cm au plus
  const C_I = (2 * Math.PI) / (3 * Math.sqrt(3));

  let reserve = null;
  function gauss() {
    if (reserve !== null) { const g = reserve; reserve = null; return g; }
    let u = 0;
    while (u === 0) u = Math.random();
    const r = Math.sqrt(-2 * Math.log(u)), a = 2 * Math.PI * Math.random();
    reserve = r * Math.sin(a);
    return r * Math.cos(a);
  }

  // Vitesses de dépôt d'une particule (c : { vt, D }, physique.js) à travers la couche de paroi
  function reactivites(c, Dt, delta) {
    const I = C_I * c.D ** (-2 / 3) * (Dt / delta ** 3) ** (-1 / 3);
    const x = c.vt * I;
    return {
      vertical: 1 / I,
      haut: x > 1e-6 ? c.vt / -Math.expm1(-x) : 1 / I,
      bas: x > 700 ? 0 : x > 1e-6 ? c.vt / Math.expm1(x) : 1 / I,
    };
  }

  // scene : { L, H, dx, nx, ny, x0, u, v, Dt,                 x0 : abscisse du nœud i = 0 de la grille
  //           obstacles: [{ x0, x1, h, dessus, cote }],     posés au sol de la pièce
  //           fenetre: { x, y0, y1 } | null,                x = 0 ou L
  //           couloir: { xa, xb, cloison, yPorte } | null } couloir [xa, xb] derrière le mur x = cloison,
  //                                                         percé de 0 à yPorte (0 : porte fermée)
  // La pièce occupe [0, L] × [0, H].
  function interp(sc, f, x, y) {
    const gx = Math.min(sc.nx - 1e-6, Math.max(0, (x - (sc.x0 || 0)) / sc.dx)), gy = Math.min(sc.ny - 1e-6, Math.max(0, y / sc.dx));
    const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, ni = sc.nx + 1, k = j * ni + i;
    return (f[k] * (1 - fx) + f[k + 1] * fx) * (1 - fy) + (f[k + ni] * (1 - fx) + f[k + ni + 1] * fx) * fy;
  }
  const dansCouloir = (sc, x) => sc.couloir && x > Math.min(sc.couloir.xa, sc.couloir.xb) && x < Math.max(sc.couloir.xa, sc.couloir.xb);
  const bornes = (sc) => (sc.couloir ? [Math.min(0, sc.couloir.xa, sc.couloir.xb), Math.max(sc.L, sc.couloir.xa, sc.couloir.xb)] : [0, sc.L]);

  // Distance à la surface la plus proche et normale qui s'en éloigne
  function distance(sc, x, y) {
    const [xmin, xmax] = bornes(sc);
    let n = x - xmin, gx = 1, gy = 0;
    if (xmax - x < n) { n = xmax - x; gx = -1; gy = 0; }
    if (y < n) { n = y; gx = 0; gy = 1; }
    if (sc.H - y < n) { n = sc.H - y; gx = 0; gy = -1; }
    if (sc.couloir) {
      // Cloison : segment vertical x = cloison, de yPorte à H
      const c = sc.couloir, dxc = x - c.cloison, dyc = y < c.yPorte ? c.yPorte - y : 0;
      const d = Math.hypot(dxc, dyc);
      if (d < n && d > 0) { n = d; gx = dxc / d; gy = -dyc / d; }
    }
    for (const o of sc.obstacles) {
      const dx = x < o.x0 ? o.x0 - x : x > o.x1 ? x - o.x1 : 0;
      const dy = y > o.h ? y - o.h : 0;
      const d = Math.hypot(dx, dy);
      if (d < n && d > 0) { n = d; gx = (x < o.x0 ? -dx : dx) / d; gy = dy / d; }
    }
    return [Math.max(n, 0), gx, gy];
  }

  // Premier obstacle rencontré sur le segment (x0,y0) → (x1,y1) :
  // surface touchée, point d'impact et normale de la face (tournée vers l'air)
  function impact(sc, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    let tMin = Infinity, surf = AIR, nx = 0, ny = 0;
    const garder = (t, s, ax, ay) => { if (t >= 0 && t < tMin) { tMin = t; surf = s; nx = ax; ny = ay; } };
    const [xmin, xmax] = bornes(sc);
    const cote = (t, piece) => (dansCouloir(sc, x0 + t * dx) ? COULOIR : piece);
    const mur = (t, xm, sens) => {
      if (dansCouloir(sc, xm + sens * 1e-9)) { garder(t, COULOIR, sens, 0); return; }
      const y = y0 + t * dy, f = sc.fenetre;
      garder(t, f && f.x === xm && y >= f.y0 && y <= f.y1 ? FENETRE : MURS, sens, 0);
    };
    if (y1 < 0) { const t = -y0 / dy; garder(t, cote(t, SOL), 0, 1); }
    if (y1 > sc.H) { const t = (sc.H - y0) / dy; garder(t, cote(t, PLAFOND), 0, -1); }
    if (x1 < xmin) mur((xmin - x0) / dx, xmin, 1);
    if (x1 > xmax) mur((xmax - x0) / dx, xmax, -1);
    if (sc.couloir) {
      // Cloison entre pièce et couloir, traversable seulement par la porte
      const c = sc.couloir;
      if ((x0 - c.cloison) * (x1 - c.cloison) < 0) {
        const t = (c.cloison - x0) / dx, y = y0 + t * dy;
        if (y >= c.yPorte) garder(t, dansCouloir(sc, x0) ? COULOIR : MURS, dx > 0 ? -1 : 1, 0);
      }
    }
    for (const o of sc.obstacles) {
      // Méthode des dalles : on entre dans [x0, x1] × [0, h] par le dessus ou par un côté
      let tE = -Infinity, tS = Infinity, face = AIR, fx = 0, fy = 0;
      if (dx === 0) { if (x0 <= o.x0 || x0 >= o.x1) continue; }
      else {
        const t1 = (o.x0 - x0) / dx, t2 = (o.x1 - x0) / dx;
        tE = Math.min(t1, t2); tS = Math.max(t1, t2); face = o.cote; fx = dx > 0 ? -1 : 1;
      }
      if (dy === 0) { if (y0 >= o.h) continue; }
      else {
        const t1 = -y0 / dy, t2 = (o.h - y0) / dy;
        const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
        if (lo > tE) { tE = lo; face = o.dessus; fx = 0; fy = 1; }
        tS = Math.min(tS, hi);
      }
      if (tE <= tS && tE <= 1) garder(tE, face, fx, fy);
    }
    if (tMin > 1) return null;
    return { s: surf, x: x0 + tMin * dx, y: y0 + tMin * dy, nx, ny };
  }

  // Avance la particule p ({ x, y, s }) de `duree` secondes.
  // c : { vt, D } (physique.js) ; K : reactivites(c, …) ; renvoie le nombre de sous-pas.
  function avancer(sc, p, c, K, duree) {
    const D = c.D + sc.Dt;
    let reste = duree, n = 0;
    while (reste > 0 && p.s === AIR) {
      let ua = interp(sc, sc.u, p.x, p.y), va = interp(sc, sc.v, p.x, p.y);
      const [d, gx, gy] = distance(sc, p.x, p.y);
      if (d < sc.dx) {
        // Continuité : la vitesse normale de l'air s'annule en n² contre une paroi. L'interpolation
        // bilinéaire la ferait décroître en n seulement, et l'air pousserait les particules dans les murs.
        const un = (ua * gx + va * gy) * (1 - d / sc.dx);
        ua -= un * gx;
        va -= un * gy;
      }
      va -= c.vt;
      const dt = Math.min(reste, DT_MAX, (0.5 * sc.dx) / (Math.abs(ua) + Math.abs(va) + 1e-9));
      const sigma = Math.sqrt(2 * D * dt);
      let x1 = p.x + ua * dt + sigma * gauss(), y1 = p.y + va * dt + sigma * gauss();
      let x0 = p.x, y0 = p.y;
      // Rebonds successifs (coins) : au plus quelques-uns par pas
      for (let r = 0; r < 4; r++) {
        const choc = impact(sc, x0, y0, x1, y1);
        if (!choc) break;
        const k = choc.ny > 0 ? K.haut : choc.ny < 0 ? K.bas : K.vertical;
        if (Math.random() < k * Math.sqrt((Math.PI * dt) / D)) {
          x1 = choc.x; y1 = choc.y; p.s = choc.s;
          break;
        }
        // Réflexion du reste du pas par rapport à la face touchée
        if (choc.nx !== 0) x1 = 2 * choc.x - x1;
        if (choc.ny !== 0) y1 = 2 * choc.y - y1;
        x0 = choc.x + choc.nx * 1e-9; y0 = choc.y + choc.ny * 1e-9;
        if (r === 3) { x1 = x0; y1 = y0; }
      }
      p.x = x1; p.y = y1;
      reste -= dt;
      n++;
    }
    return n;
  }

  return { avancer, reactivites, impact, distance, AIR, SOL, DESSUS_M1, DESSUS_M2, COTES, RADIATEUR, FENETRE, MURS, PLAFOND, SORTIE, COULOIR };
})();
