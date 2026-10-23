// Battant de porte, vue de dessus : Navier-Stokes 2D incompressible isotherme, grille décalée (MAC),
// battant mobile par pénalisation de Brinkman. Voir docs/theorie_battant.md.
//
// Cellule (i, j), i = 0..nx-1, j = 0..ny-1, centre (X0 + (i+½)dx, Y0 + (j+½)dx).
// u sur les faces verticales (i = 0..nx, j), v sur les faces horizontales (i, j = 0..ny).

const Battant = (() => {
  const ETA = 1e-6;          // s, temps de rappel de la pénalisation (≪ dt : le battant est rigide)

  // ---------- Géométrie ----------
  // geo : { dx, L, W, LC, yC0, yC1, xMur, epMur, yPorte0, yPorte1, hauteur }
  function creer(geo, nu) {
    const { dx } = geo;
    const X0 = 0, Y0 = geo.yC0;
    const nx = Math.round((geo.L + geo.epMur + geo.LC) / dx), ny = Math.round((geo.yC1 - geo.yC0) / dx);
    const fluide = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = X0 + (i + 0.5) * dx, y = Y0 + (j + 0.5) * dx;
        const piece = x < geo.xMur && y > 0 && y < geo.W;
        const mur = x >= geo.xMur && x < geo.xMur + geo.epMur;
        const embrasure = mur && y > geo.yPorte0 && y < geo.yPorte1;
        const couloir = x >= geo.xMur + geo.epMur;
        fluide[i + j * nx] = piece || embrasure || couloir ? 1 : 0;
      }
    }
    const nu1 = nx + 1;
    const uOuvert = new Uint8Array(nu1 * ny), vOuvert = new Uint8Array(nx * (ny + 1));
    for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) uOuvert[i + j * nu1] = fluide[i - 1 + j * nx] && fluide[i + j * nx];
    for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) vOuvert[i + j * nx] = fluide[i + (j - 1) * nx] && fluide[i + j * nx];
    const s = {
      geo, nu, dx, X0, Y0, nx, ny, fluide, uOuvert, vOuvert,
      u: new Float64Array(nu1 * ny), v: new Float64Array(nx * (ny + 1)),
      u2: new Float64Array(nu1 * ny), v2: new Float64Array(nx * (ny + 1)),
      u3: new Float64Array(nu1 * ny), v3: new Float64Array(nx * (ny + 1)),
      au: new Float64Array(nu1 * ny), bu: new Float64Array(nu1 * ny), av: new Float64Array(nx * (ny + 1)), bv: new Float64Array(nx * (ny + 1)),
      p: new Float64Array(nx * ny),
      temps: 0, pas: 0,
      porte: { theta: 0, omega: 0, mvt: null },   // mvt : { t0, T, de, vers }
      vEntrant: 0, vSortant: 0, umax: 0,
    };
    factoriser(s);
    return s;
  }

  // ---------- Pression : Cholesky en bande sur les cellules fluides ----------
  function factoriser(s) {
    const { nx, ny, fluide, uOuvert, vOuvert } = s, nu1 = nx + 1;
    const index = new Int32Array(nx * ny).fill(-1), cellules = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {   // par colonnes : bande ≈ ny
      const c = i + j * nx;
      if (fluide[c]) { index[c] = cellules.length; cellules.push(c); }
    }
    const n = cellules.length;
    // Voisins (indices compacts inférieurs) et diagonale = nombre de faces ouvertes
    const diag = new Float64Array(n), voisins = cellules.map(() => []);
    let b = 0;
    cellules.forEach((c, q) => {
      const i = c % nx, j = (c - i) / nx;
      const faces = [[uOuvert[i + j * nu1], c - 1], [uOuvert[i + 1 + j * nu1], c + 1], [vOuvert[i + j * nx], c - nx], [vOuvert[i + (j + 1) * nx], c + nx]];
      for (const [ouvert, cv] of faces) {
        if (!ouvert) continue;
        diag[q]++;
        const r = index[cv];
        if (r < q) { voisins[q].push(r); b = Math.max(b, q - r); }
      }
    });
    diag[0] += 1;   // p fixée dans la première cellule : lève l'indétermination
    const w = b + 1, Lc = new Float64Array(n * w);   // ligne q : L[q][r] en Lc[q·w + r − q + b]
    for (let q = 0; q < n; q++) {
      const lq = q * w - q + b, r0 = Math.max(0, q - b);
      for (const r of voisins[q]) Lc[lq + r] = -1;
      Lc[lq + q] = diag[q];
      for (let r = r0; r <= q; r++) {
        let somme = Lc[lq + r];
        const lr = r * w - r + b, k0 = Math.max(r0, r - b);
        for (let k = k0; k < r; k++) somme -= Lc[lq + k] * Lc[lr + k];
        Lc[lq + r] = r === q ? Math.sqrt(somme) : somme / Lc[lr + r];
      }
    }
    Object.assign(s, { cellules, index, chol: Lc, bande: b, rhs: new Float64Array(n) });
  }

  function resoudre(s) {
    const { cellules, chol: L, bande: b, rhs: y } = s, n = cellules.length, w = b + 1;
    for (let q = 0; q < n; q++) {
      const lq = q * w - q + b;
      let somme = y[q];
      for (let r = Math.max(0, q - b); r < q; r++) somme -= L[lq + r] * y[r];
      y[q] = somme / L[lq + q];
    }
    for (let q = n - 1; q >= 0; q--) {
      const lq = q * w - q + b, x = y[q] / L[lq + q];
      y[q] = x;
      for (let r = Math.max(0, q - b); r < q; r++) y[r] -= L[lq + r] * x;
    }
  }

  // ---------- Interpolations sur la grille décalée ----------
  function interpU(s, f, x, y) {
    const { nx, ny, dx } = s, nu1 = nx + 1;
    const gx = Math.min(nx - 1e-9, Math.max(0, (x - s.X0) / dx));
    const gy = Math.min(ny - 1 - 1e-9, Math.max(0, (y - s.Y0) / dx - 0.5));
    const i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j, k = i + j * nu1;
    return (f[k] * (1 - fx) + f[k + 1] * fx) * (1 - fy) + (f[k + nu1] * (1 - fx) + f[k + nu1 + 1] * fx) * fy;
  }
  function interpV(s, f, x, y) {
    const { nx, ny, dx } = s;
    const gx = Math.min(nx - 1 - 1e-9, Math.max(0, (x - s.X0) / dx - 0.5));
    const gy = Math.min(ny - 1e-9, Math.max(0, (y - s.Y0) / dx));
    const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, k = i + j * nx;
    return (f[k] * (1 - fx) + f[k + 1] * fx) * (1 - fy) + (f[k + nx] * (1 - fx) + f[k + nx + 1] * fx) * fy;
  }
  // Échantillonnage sans allocation : la valeur interpolée est renvoyée, et le min / max des 4 nœuds
  // qui encadrent le point (limiteur de MacCormack) sont laissés dans MN / MX
  let MN = 0, MX = 0;
  function echantU(s, f, x, y) {
    const { nx, ny, dx } = s, nu1 = nx + 1;
    const gx = Math.min(nx - 1e-9, Math.max(0, (x - s.X0) / dx));
    const gy = Math.min(ny - 1 - 1e-9, Math.max(0, (y - s.Y0) / dx - 0.5));
    const i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j, k = i + j * nu1;
    const a = f[k], b = f[k + 1], c = f[k + nu1], d = f[k + nu1 + 1];
    MN = Math.min(a, b, c, d); MX = Math.max(a, b, c, d);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  function echantV(s, f, x, y) {
    const { nx, ny, dx } = s;
    const gx = Math.min(nx - 1 - 1e-9, Math.max(0, (x - s.X0) / dx - 0.5));
    const gy = Math.min(ny - 1e-9, Math.max(0, (y - s.Y0) / dx));
    const i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j, k = i + j * nx;
    const a = f[k], b = f[k + 1], c = f[k + nx], d = f[k + nx + 1];
    MN = Math.min(a, b, c, d); MX = Math.max(a, b, c, d);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  const vitesse = (s, x, y) => [interpU(s, s.u, x, y), interpV(s, s.v, x, y)];

  // ---------- Battant ----------
  function cinematique(s) {
    const pt = s.porte, m = pt.mvt;
    if (!m) { pt.omega = 0; return; }
    const r = Math.min(1, Math.max(0, (s.temps - m.t0) / m.T));
    pt.theta = m.de + (m.vers - m.de) * (1 - Math.cos(Math.PI * r)) / 2;
    pt.omega = r < 1 ? ((m.vers - m.de) * Math.PI * Math.sin(Math.PI * r)) / (2 * m.T) : 0;
    if (r >= 1) {
      pt.mvt = m.suite ? { ...m.suite, t0: s.temps + (m.suite.attente || 0) } : null;
      if (pt.mvt) pt.omega = 0;
    }
  }
  // Charnière, extrémité et indicatrice adoucie du battant (ep : épaisseur pénalisée)
  function battant(s) {
    const g = s.geo, th = s.porte.theta;
    const xh = g.xMur + g.epMur / 2, yh = g.yPorte0;
    return { xh, yh, xb: xh - g.lPorte * Math.sin(th), yb: yh + g.lPorte * Math.cos(th), ep: g.epBattant };
  }
  function chi(s, B, x, y) {
    const ax = B.xb - B.xh, ay = B.yb - B.yh, l2 = ax * ax + ay * ay;
    const t = Math.min(1, Math.max(0, ((x - B.xh) * ax + (y - B.yh) * ay) / l2));
    const d = Math.hypot(x - B.xh - t * ax, y - B.yh - t * ay);
    return Math.min(1, Math.max(0, (B.ep / 2 + s.dx - d) / s.dx));
  }

  // ---------- Pas de temps ----------
  function pas(s, dt) {
    const { nx, ny, dx, u, v, u2, v2, u3, v3, uOuvert, vOuvert, nu } = s, nu1 = nx + 1;
    // 1. Advection de MacCormack (Selle et al. 2008) : remontée d'Euler aller (u2), retour,
    //    correction limitée par les valeurs qui encadrent le point de départ (u3).
    //    La vitesse transverse est la moyenne des 4 faces voisines.
    const { au, bu, av, bv } = s;
    for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) {
      const k = i + j * nu1;
      if (!uOuvert[k]) { u2[k] = 0; continue; }
      const a = u[k], ii = Math.min(Math.max(i, 1), nx - 1);
      const b = 0.25 * (v[ii - 1 + j * nx] + v[ii + j * nx] + v[ii - 1 + (j + 1) * nx] + v[ii + (j + 1) * nx]);
      au[k] = a; bu[k] = b;
      u2[k] = echantU(s, u, s.X0 + i * dx - dt * a, s.Y0 + (j + 0.5) * dx - dt * b);
    }
    for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) {
      const k = i + j * nx;
      if (!vOuvert[k]) { v2[k] = 0; continue; }
      const jj = Math.min(Math.max(j, 1), ny - 1);
      const a = 0.25 * (u[i + (jj - 1) * nu1] + u[i + 1 + (jj - 1) * nu1] + u[i + jj * nu1] + u[i + 1 + jj * nu1]), b = v[k];
      av[k] = a; bv[k] = b;
      v2[k] = echantV(s, v, s.X0 + (i + 0.5) * dx - dt * a, s.Y0 + j * dx - dt * b);
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) {
      const k = i + j * nu1;
      if (!uOuvert[k]) { u3[k] = 0; continue; }
      const x = s.X0 + i * dx, y = s.Y0 + (j + 0.5) * dx, a = au[k], b = bu[k];
      const retour = echantU(s, u2, x + dt * a, y + dt * b);
      echantU(s, u, x - dt * a, y - dt * b);
      u3[k] = Math.min(MX, Math.max(MN, u2[k] + 0.5 * (u[k] - retour)));
    }
    for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) {
      const k = i + j * nx;
      if (!vOuvert[k]) { v3[k] = 0; continue; }
      const x = s.X0 + (i + 0.5) * dx, y = s.Y0 + j * dx, a = av[k], b = bv[k];
      const retour = echantV(s, v2, x + dt * a, y + dt * b);
      echantV(s, v, x - dt * a, y - dt * b);
      v3[k] = Math.min(MX, Math.max(MN, v2[k] + 0.5 * (v[k] - retour)));
    }
    // 2. Diffusion explicite (faces fermées à vitesse nulle)
    const c = (nu * dt) / (dx * dx);
    for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) {
      const k = i + j * nu1;
      if (!uOuvert[k]) { u[k] = 0; continue; }
      const g = i > 0 ? u3[k - 1] : 0, d = i < nx ? u3[k + 1] : 0;
      const bas = j > 0 ? u3[k - nu1] : 0, haut = j < ny - 1 ? u3[k + nu1] : 0;
      u[k] = u3[k] + c * (g + d + bas + haut - 4 * u3[k]);
    }
    for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) {
      const k = i + j * nx;
      if (!vOuvert[k]) { v[k] = 0; continue; }
      const g = i > 0 ? v3[k - 1] : 0, d = i < nx - 1 ? v3[k + 1] : 0;
      const bas = j > 0 ? v3[k - nx] : 0, haut = j < ny ? v3[k + nx] : 0;
      v[k] = v3[k] + c * (g + d + bas + haut - 4 * v3[k]);
    }
    // 3. Pénalisation implicite : l'air suit le battant
    const B = battant(s), om = s.porte.omega, kp = dt / ETA;
    const xmin = Math.min(B.xh, B.xb) - B.ep - dx, xmax = Math.max(B.xh, B.xb) + B.ep + dx;
    const ymin = Math.min(B.yh, B.yb) - B.ep - dx, ymax = Math.max(B.yh, B.yb) + B.ep + dx;
    const i0 = Math.max(0, Math.floor((xmin - s.X0) / dx)), i1 = Math.min(nx, Math.ceil((xmax - s.X0) / dx));
    const j0 = Math.max(0, Math.floor((ymin - s.Y0) / dx)), j1 = Math.min(ny, Math.ceil((ymax - s.Y0) / dx));
    for (let j = j0; j < Math.min(ny, j1 + 1); j++) for (let i = i0; i <= i1; i++) {
      const k = i + j * nu1;
      if (!uOuvert[k]) continue;
      const x = s.X0 + i * dx, y = s.Y0 + (j + 0.5) * dx, h = chi(s, B, x, y);
      if (h > 0) u[k] = (u[k] + kp * h * (-om * (y - B.yh))) / (1 + kp * h);
    }
    for (let j = j0; j <= j1; j++) for (let i = i0; i < Math.min(nx, i1 + 1); i++) {
      const k = i + j * nx;
      if (!vOuvert[k]) continue;
      const x = s.X0 + (i + 0.5) * dx, y = s.Y0 + j * dx, h = chi(s, B, x, y);
      if (h > 0) v[k] = (v[k] + kp * h * (om * (x - B.xh))) / (1 + kp * h);
    }
    // 4. Projection : ∇²p = ∇·u / dt, puis u -= dt ∇p
    const { cellules, rhs, p } = s;
    for (let q = 0; q < cellules.length; q++) {
      const cel = cellules[q], i = cel % nx, j = (cel - i) / nx;
      const div = u[i + 1 + j * nu1] - u[i + j * nu1] + v[i + (j + 1) * nx] - v[i + j * nx];
      rhs[q] = (-div * dx) / dt;
    }
    resoudre(s);
    p.fill(0);
    for (let q = 0; q < cellules.length; q++) p[cellules[q]] = rhs[q];
    const f = dt / dx;
    for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) {
      const k = i + j * nu1;
      if (uOuvert[k]) u[k] -= f * (p[i + j * nx] - p[i - 1 + j * nx]);
    }
    for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = i + j * nx;
      if (vOuvert[k]) v[k] -= f * (p[i + j * nx] - p[i + (j - 1) * nx]);
    }
    // Débit à travers l'embrasure (face côté pièce du mur) : volumes entrant et sortant
    const g = s.geo, iMur = Math.round((g.xMur - s.X0) / dx);
    let entrant = 0, sortant = 0;
    for (let j = 0; j < ny; j++) {
      const k = iMur + j * nu1;
      if (!uOuvert[k]) continue;
      entrant += Math.max(0, -u[k]) * dx;
      sortant += Math.max(0, u[k]) * dx;
    }
    s.qEntrant = entrant; s.qSortant = sortant;
    s.vEntrant += entrant * g.hauteur * dt;
    s.vSortant += sortant * g.hauteur * dt;
  }

  function vitesseMax(s) {
    let m = 0;
    for (const x of s.u) if (Math.abs(x) > m) m = Math.abs(x);
    for (const x of s.v) if (Math.abs(x) > m) m = Math.abs(x);
    return m;
  }

  // Avance de `duree` secondes en sous-pas stables ; apresPas(dt) est appelé après chaque sous-pas.
  // Renvoie le nombre de sous-pas.
  function avancer(s, duree, apresPas = null) {
    let reste = duree, n = 0;
    while (reste > 1e-9) {
      cinematique(s);
      const ub = Math.abs(s.porte.omega) * s.geo.lPorte;
      s.umax = vitesseMax(s);
      const vmax = Math.max(s.umax, ub, 1e-3);
      const dt = Math.min(reste, (0.5 * s.dx) / vmax, (0.2 * s.dx * s.dx) / s.nu, 0.04);
      // Air au repos et battant immobile : rien à calculer
      if (!s.porte.mvt && s.umax < 1e-4) { s.temps += reste; break; }
      pas(s, dt);
      if (apresPas) apresPas(dt);
      s.temps += dt;
      reste -= dt;
      s.pas++;
      n++;
    }
    return n;
  }

  // ---------- Traceurs : poussière de la pièce (o = 0) et du couloir (o = 1) ----------
  let reserve = null;
  function gauss() {
    if (reserve !== null) { const g = reserve; reserve = null; return g; }
    let a = 0;
    while (a === 0) a = Math.random();
    const r = Math.sqrt(-2 * Math.log(a)), t = 2 * Math.PI * Math.random();
    reserve = r * Math.sin(t);
    return r * Math.cos(t);
  }
  const estFluide = (s, x, y) => {
    const i = Math.floor((x - s.X0) / s.dx), j = Math.floor((y - s.Y0) / s.dx);
    return i >= 0 && j >= 0 && i < s.nx && j < s.ny && s.fluide[i + j * s.nx] === 1;
  };
  // Même densité de traceurs dans la pièce et dans le couloir
  function semerTraceurs(s, nPiece) {
    const g = s.geo, aPiece = g.xMur * g.W, aCouloir = g.LC * (g.yC1 - g.yC0);
    const nCouloir = Math.round((nPiece * aCouloir) / aPiece), n = nPiece + nCouloir;
    const tr = { x: new Float32Array(n), y: new Float32Array(n), o: new Uint8Array(n), nPiece, nCouloir, aPiece, aCouloir };
    for (let k = 0; k < n; k++) {
      const couloir = k >= nPiece;
      tr.o[k] = couloir ? 1 : 0;
      tr.x[k] = couloir ? g.xMur + g.epMur + Math.random() * g.LC : Math.random() * g.xMur;
      tr.y[k] = couloir ? g.yC0 + Math.random() * (g.yC1 - g.yC0) : Math.random() * g.W;
    }
    return tr;
  }
  function avancerTraceurs(s, tr, dt) {
    const sig = Math.sqrt(2 * s.nu * dt);
    for (let k = 0; k < tr.x.length; k++) {
      const x = tr.x[k], y = tr.y[k];
      const a = interpU(s, s.u, x, y), b = interpV(s, s.v, x, y);
      const xm = x + 0.5 * dt * a, ym = y + 0.5 * dt * b;
      const xn = x + dt * interpU(s, s.u, xm, ym) + sig * gauss(), yn = y + dt * interpV(s, s.v, xm, ym) + sig * gauss();
      if (estFluide(s, xn, yn)) { tr.x[k] = xn; tr.y[k] = yn; }
    }
  }
  function compterTraceurs(s, tr) {
    const g = s.geo;
    let cDansPiece = 0, pDansCouloir = 0;
    for (let k = 0; k < tr.x.length; k++) {
      if (tr.o[k] === 1 && tr.x[k] < g.xMur) cDansPiece++;
      if (tr.o[k] === 0 && tr.x[k] > g.xMur + g.epMur) pDansCouloir++;
    }
    return { cDansPiece, pDansCouloir };
  }

  // ---------- Pilote : boucle temps réel, commune au Web Worker et au repli ----------
  // Messages : { type: "init", geo, nu, nTraceurs }, { type: "evenement", action: "ouvrir" | "fermer" | "cycle", T, attente },
  //            { type: "vitesse", valeur }, { type: "nu", valeur }, { type: "reinit" }
  function pilote(publier, budget = 25) {
    let s = null, tr = null, facteur = 0.5, horloge = 0, actif = false, nTraceurs = 3000;
    function boucle() {
      const t0 = performance.now();
      const cible = Math.min(0.1, (t0 - horloge) / 1000) * facteur;
      horloge = t0;
      let reste = cible;
      // On rattrape le temps écoulé, sans dépasser le budget (sinon on ralentit)
      while (reste > 1e-9 && performance.now() - t0 < budget) {
        const tranche = Math.min(reste, 0.04);
        avancer(s, tranche, (dt) => avancerTraceurs(s, tr, dt));
        reste -= tranche;
      }
      const { nx, ny, u, v } = s, nu1 = nx + 1, vit = new Float32Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        if (!s.fluide[i + j * nx]) { vit[i + j * nx] = -1; continue; }
        const a = 0.5 * (u[i + j * nu1] + u[i + 1 + j * nu1]), b = 0.5 * (v[i + j * nx] + v[i + (j + 1) * nx]);
        vit[i + j * nx] = Math.hypot(a, b);
      }
      const B = battant(s), c = compterTraceurs(s, tr);
      publier({
        vitesse: vit, nx, ny, dx: s.dx, X0: s.X0, Y0: s.Y0,
        tx: Float32Array.from(tr.x), ty: Float32Array.from(tr.y), to: tr.o,
        battant: B, theta: s.porte.theta, omega: s.porte.omega, enMouvement: !!s.porte.mvt,
        temps: s.temps, vEntrant: s.vEntrant, vSortant: s.vSortant, qEntrant: s.qEntrant || 0, umax: s.umax,
        cDansPiece: c.cDansPiece, pDansCouloir: c.pDansCouloir, nPiece: tr.nPiece, nCouloir: tr.nCouloir,
        aPiece: tr.aPiece, aCouloir: tr.aCouloir, retard: reste > 1e-6,
      });
      setTimeout(boucle, 16);
    }
    return (m) => {
      if (m.type === "init") {
        s = creer(m.geo, m.nu);
        nTraceurs = m.nTraceurs;
        tr = semerTraceurs(s, nTraceurs);
        if (!actif) { actif = true; horloge = performance.now(); setTimeout(boucle, 0); }
      } else if (m.type === "vitesse") facteur = m.valeur;
      else if (m.type === "nu") s.nu = m.valeur;
      else if (m.type === "reinit") {
        s.u.fill(0); s.v.fill(0);
        Object.assign(s, { vEntrant: 0, vSortant: 0, temps: 0 });
        s.porte.mvt = null;
        tr = semerTraceurs(s, nTraceurs);
      } else if (m.type === "evenement") {
        const pt = s.porte, ouvert = Math.PI / 2;
        const de = pt.theta;
        if (m.action === "ouvrir") pt.mvt = { t0: s.temps, T: m.T, de, vers: ouvert };
        else if (m.action === "fermer") pt.mvt = { t0: s.temps, T: m.T, de, vers: 0 };
        else pt.mvt = { t0: s.temps, T: m.T, de, vers: ouvert, suite: { T: m.T, de: ouvert, vers: 0, attente: m.attente } };
      }
    };
  }

  return { creer, avancer, cinematique, battant, interpU, interpV, vitesse, semerTraceurs, avancerTraceurs, compterTraceurs, pilote };
})();
