// Convection naturelle 2D (Boussinesq), formulation fonction de courant - tourbillon.
// Régime stationnaire obtenu par faux transitoire. Voir docs/theorie_convection.md (§5, §7).
//
// Grille de nœuds (i, j), i = 0..nx, j = 0..ny, x = i·dx, y = j·dx, indice k = j·(nx+1) + i.
// Le cadre extérieur est toujours solide. Toutes les surfaces solides touchent le cadre,
// donc ψ = 0 sur toutes (§5.2). Un réservoir (couloir derrière une porte, voir
// docs/theorie_porte.md) est une zone fluide dont la température est rappelée vers Text.

const Convection = (() => {
  // SOLIDE : intérieur d'un obstacle, PAROI : nœud solide au contact de l'air
  const FLUIDE = 0, SOLIDE = 1, PAROI = 2;

  function creer({ nx, ny, dx, gbeta = 9.81 / 293.15 }) {
    const ni = nx + 1, n = ni * (ny + 1);
    return {
      nx, ny, dx, ni, gbeta,
      nu: 5e-3, kappa: 5.6e-3,
      psi: new Float64Array(n), om: new Float64Array(n), T: new Float64Array(n),
      om2: new Float64Array(n), T2: new Float64Array(n),
      u: new Float64Array(n), v: new Float64Array(n),
      type: new Uint8Array(n).fill(FLUIDE),
      Tfix: new Float64Array(n).fill(NaN),   // NaN : paroi adiabatique
      fluides: new Int32Array(0),
      parois: [],                             // { k, voisins: [indices fluides] }
      Text: 20,                               // °C du réservoir
      rappel: null,                           // taux de rappel de T vers Text (s⁻¹) par nœud
      chol: null, rhs: new Float64Array(n),   // facteur de Cholesky en bande du laplacien
      temps: 0, pas: 0, umax: 0, ecartT: 1,
    };
  }

  // estSolide(i, j) -> booléen ; temperature(i, j) -> °C imposée, ou null si adiabatique.
  // Tinit(i, j) -> °C donnée aux nœuds qui redeviennent fluides.
  function definir(s, estSolide, temperature, Tinit) {
    const { nx, ny, ni, type } = s;
    const ancien = type.slice();
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const cadre = i === 0 || j === 0 || i === nx || j === ny;
        type[j * ni + i] = cadre || estSolide(i, j) ? SOLIDE : FLUIDE;
      }
    }
    const fluides = [];
    s.parois = [];
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const k = j * ni + i;
        if (type[k] === FLUIDE) {
          fluides.push(k);
          if (ancien[k] !== FLUIDE) { s.om[k] = 0; s.psi[k] = 0; s.T[k] = Tinit(i, j); }
          continue;
        }
        const voisins = [];
        if (i > 0 && type[k - 1] === FLUIDE) voisins.push(k - 1);
        if (i < nx && type[k + 1] === FLUIDE) voisins.push(k + 1);
        if (j > 0 && type[k - ni] === FLUIDE) voisins.push(k - ni);
        if (j < ny && type[k + ni] === FLUIDE) voisins.push(k + ni);
        s.psi[k] = 0; s.u[k] = 0; s.v[k] = 0;
        if (!voisins.length) { s.om[k] = 0; s.Tfix[k] = NaN; continue; }
        const t = temperature(i, j);
        s.Tfix[k] = t === null ? NaN : t;
        s.parois.push({ k, voisins });
      }
    }
    // Les parois ont été reclassées après coup : on corrige leur type
    for (const p of s.parois) type[p.k] = PAROI;
    s.fluides = Int32Array.from(fluides);
    factoriser(s);
    resoudrePsi(s);
    conditionsAuxLimites(s);
  }

  // Poisson ∇²ψ = -ω résolu directement : matrice A = -dx²·∇² sur les nœuds fluides,
  // identité sur les nœuds solides (ψ = 0). A est symétrique définie positive. On numérote
  // les nœuds colonne par colonne (p = i·nj + j) pour que sa largeur de bande soit nj, la plus
  // petite dimension, et on la factorise une fois par géométrie (Cholesky en bande).
  function factoriser(s) {
    const { ni, nx, ny, type } = s, nj = ny + 1, n = type.length, b = nj, w = b + 1;
    const perm = new Int32Array(n);           // perm[p] = k
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) perm[i * nj + j] = j * ni + i;
    const fl = new Uint8Array(n);
    for (let p = 0; p < n; p++) fl[p] = type[perm[p]] === FLUIDE ? 1 : 0;
    // Ligne p de L stockée de façon contiguë : L[p][q] en L[p·w + q - p + b], q = p-b..p
    const L = new Float64Array(n * w);
    for (let p = 0; p < n; p++) {
      const lp = p * w - p + b;
      if (!fl[p]) { L[lp + p] = 1; continue; }  // nœud solide : ligne identité, sans remplissage
      const q0 = Math.max(0, p - b);
      for (let q = q0; q <= p; q++) {
        let somme = q === p ? 4 : fl[q] && (p - q === 1 || p - q === nj) ? -1 : 0;
        const lq = q * w - q + b;
        for (let r = q0; r < q; r++) somme -= L[lp + r] * L[lq + r];
        L[lp + q] = q === p ? Math.sqrt(somme) : somme / L[lq + q];
      }
    }
    s.chol = L;
    s.perm = perm;
    s.flP = fl;
    s.bande = b;
  }

  function resoudrePsi(s) {
    const { type, om, psi, rhs: y, chol: L, perm, flP: fl, bande: b, dx } = s, n = type.length, w = b + 1;
    const dx2 = dx * dx;
    for (let p = 0; p < n; p++) {             // descente : L·y = dx²·ω
      if (!fl[p]) { y[p] = 0; continue; }
      const lp = p * w - p + b;
      let somme = dx2 * om[perm[p]];
      for (let q = Math.max(0, p - b); q < p; q++) somme -= L[lp + q] * y[q];
      y[p] = somme / L[lp + p];
    }
    for (let p = n - 1; p >= 0; p--) {        // remontée Lᵀ·ψ = y, colonne par colonne
      if (!fl[p]) continue;
      const lp = p * w - p + b;
      const x = y[p] / L[lp + p];
      y[p] = x;
      for (let q = Math.max(0, p - b); q < p; q++) y[q] -= L[lp + q] * x;
    }
    for (let p = 0; p < n; p++) psi[perm[p]] = fl[p] ? y[p] : 0;
  }

  function conditionsAuxLimites(s) {
    const { psi, om, T, Tfix, dx } = s;
    const c = -2 / (dx * dx);
    for (const { k, voisins } of s.parois) {
      // Formule de Thom (ψ_paroi = 0), moyennée sur les directions fluides aux coins
      let sp = 0, sT = 0;
      for (const m of voisins) { sp += psi[m]; sT += T[m]; }
      om[k] = (c * sp) / voisins.length;
      T[k] = Number.isNaN(Tfix[k]) ? sT / voisins.length : Tfix[k];
    }
  }

  // Schéma hybride : différence centrée si le Péclet de maille |u|·dx/diff ≤ 2, décentrée amont sinon
  function derivee(f, k, d, vit, dx, diff) {
    if (Math.abs(vit) * dx <= 2 * diff) return (f[k + d] - f[k - d]) / (2 * dx);
    return vit > 0 ? (f[k] - f[k - d]) / dx : (f[k + d] - f[k]) / dx;
  }

  // Euler explicite : dt·(|u|/dx + |v|/dx + 4·diff/dx²) ≤ 1 couvre les nœuds décentrés. Aux nœuds
  // centrés (Péclet ≤ 2), la condition |u|²·dt ≤ 2·diff en découle déjà.
  function pasDeTemps(s) {
    return 0.8 / (s.umax / s.dx + (4 * Math.max(s.nu, s.kappa)) / (s.dx * s.dx));
  }

  function avancer(s, nPas = 1) {
    const { ni, dx, psi, om, T, om2, T2, u, v, fluides, nu, kappa, gbeta, rappel, Text } = s;
    const i2dx = 1 / (2 * dx), idx2 = 1 / (dx * dx);
    for (let p = 0; p < nPas; p++) {
      const dt = pasDeTemps(s);

      // Vitesses aux nœuds fluides
      let umax = 0;
      for (const k of fluides) {
        u[k] = (psi[k + ni] - psi[k - ni]) * i2dx;
        v[k] = -(psi[k + 1] - psi[k - 1]) * i2dx;
        const a = Math.abs(u[k]) + Math.abs(v[k]);
        if (a > umax) umax = a;
      }
      s.umax = umax;

      // Tourbillon et température (Euler explicite)
      for (const k of fluides) {
        const uk = u[k], vk = v[k];
        const lapOm = (om[k + 1] + om[k - 1] + om[k + ni] + om[k - ni] - 4 * om[k]) * idx2;
        const lapT = (T[k + 1] + T[k - 1] + T[k + ni] + T[k - ni] - 4 * T[k]) * idx2;
        const advOm = uk * derivee(om, k, 1, uk, dx, nu) + vk * derivee(om, k, ni, vk, dx, nu);
        const advT = uk * derivee(T, k, 1, uk, dx, kappa) + vk * derivee(T, k, ni, vk, dx, kappa);
        const rOm = -advOm + nu * lapOm + gbeta * (T[k + 1] - T[k - 1]) * i2dx;
        const rT = -advT + kappa * lapT - (rappel ? rappel[k] * (T[k] - Text) : 0);
        om2[k] = om[k] + dt * rOm;
        T2[k] = T[k] + dt * rT;
      }
      for (const k of fluides) { om[k] = om2[k]; T[k] = T2[k]; }

      // Fonction de courant, exacte à chaque pas : un ψ en retard sur ω fausserait
      // le tourbillon de paroi et ferait osciller le calcul
      resoudrePsi(s);

      conditionsAuxLimites(s);
      s.temps += dt;
      s.pas++;
    }
  }

  // Interpolation bilinéaire d'un champ nodal au point (x, y) en mètres
  function interpoler(s, f, x, y) {
    const gx = x / s.dx, gy = y / s.dx;
    const i = Math.min(s.nx - 1, Math.max(0, Math.floor(gx)));
    const j = Math.min(s.ny - 1, Math.max(0, Math.floor(gy)));
    const fx = gx - i, fy = gy - j, k = j * s.ni + i;
    return (f[k] * (1 - fx) + f[k + 1] * fx) * (1 - fy) + (f[k + s.ni] * (1 - fx) + f[k + s.ni + 1] * fx) * fy;
  }

  // Grandeurs globales suivies pour juger du régime : température moyenne de l'air et débit de
  // la boucle (max |ψ|). Un critère local (max sur la grille) resterait bloqué par de petites
  // oscillations sans effet visible.
  function bilan(s) {
    let sT = 0, pMax = 0;
    for (const k of s.fluides) { sT += s.T[k]; const a = Math.abs(s.psi[k]); if (a > pMax) pMax = a; }
    return { Tmoy: sT / s.fluides.length, psiMax: pMax };
  }
  const INTERVALLE = 20;   // s de pseudo-temps entre deux bilans
  const ATTENTE = 300;     // s de pseudo-temps avant de pouvoir déclarer un écoulement oscillant

  // Oscillation : la température moyenne change au moins deux fois de sens de variation sur les
  // derniers bilans. Une dérive lente et monotone (mise en température d'une pièce isolée) n'en est pas une.
  function oscille(hist) {
    let changements = 0;
    for (let i = 2; i < hist.length; i++) {
      if ((hist[i] - hist[i - 1]) * (hist[i - 1] - hist[i - 2]) < 0) changements++;
    }
    return changements >= 2;
  }

  // Boucle de calcul pilotée par messages, commune au Web Worker et au repli sur le fil principal.
  //   { type: "config", grille, nu, kappa, Tinit, tinit, ecartT, tol, solide, tfix, rappel, Text, rythme, reinit }
  //     tinit : °C initiale par nœud (NaN : Tinit) ; rappel : taux de rappel vers Text par nœud (réservoir)
  //   { type: "accel", valeur }  facteur de temps du rythme temps réel
  //   { type: "melange", paires, phi }  bouffée du battant : chaque paire de nœuds (a, b) échange la
  //     fraction phi de sa température (docs/theorie_porte.md §7)
  // rythme : "max" (aussi vite que possible) ou "reel" (temps réel × accel, pour suivre un
  // transitoire comme l'ouverture d'une porte). Trois régimes successifs :
  //   "calcul"       on avance jusqu'à l'état établi ;
  //   "stationnaire" les grandeurs globales ne bougent plus (tol sur INTERVALLE) : on s'arrête ;
  //   "oscillant"    toujours en mouvement après ATTENTE : le modèle n'a pas d'état stationnaire,
  //                  on continue en temps réel (× accel) et on estime la période.
  // publier(instantané) est appelé après chaque tranche de calcul de `budget` ms.
  function pilote(publier, budget = 40) {
    let s = null, actif = false, tol = 1e-3, accel = 1, rythme = "max";
    let regime, precedent, prochain, calmes, evolution, horloge, historique;
    let moyenneT, dernierT, montees;          // détection de période (régime oscillant)

    function suivreOscillation() {
      const T = bilan(s).Tmoy;
      moyenneT += (T - moyenneT) * 0.02;      // moyenne glissante sur ~50 échantillons
      if (dernierT < moyenneT && T >= moyenneT) montees.push(s.temps);
      if (montees.length > 4) montees.shift();
      dernierT = T;
    }
    const periode = () => (montees.length >= 3 ? (montees[montees.length - 1] - montees[0]) / (montees.length - 1) : null);

    // Bilan périodique : régime stationnaire, oscillant, ou toujours en évolution
    function juger() {
      prochain = s.temps + INTERVALLE;
      const b = bilan(s);
      if (precedent) {
        evolution = Math.max(Math.abs(b.Tmoy - precedent.Tmoy) / s.ecartT,
                             Math.abs(b.psiMax - precedent.psiMax) / Math.max(1e-9, b.psiMax));
        calmes = evolution < tol ? calmes + 1 : 0;
      }
      precedent = b;
      historique.push(b.Tmoy);
      if (historique.length > 8) historique.shift();
      if (calmes >= 2) regime = "stationnaire";
      else if (s.temps > ATTENTE && oscille(historique)) {
        regime = "oscillant";
        horloge = performance.now();
        prochain = s.temps + 1;
        moyenneT = dernierT = b.Tmoy;
        montees = [];
      }
    }

    function boucle() {
      const t0 = performance.now();
      if (regime === "oscillant" || rythme === "reel") {
        // Temps réel : on rattrape le temps écoulé depuis la dernière tranche
        const cible = s.temps + Math.min(0.5, (t0 - horloge) / 1000) * accel;
        horloge = t0;
        while (s.temps < cible && performance.now() - t0 < budget && regime !== "stationnaire") {
          avancer(s, 1);
          if (s.temps < prochain) continue;
          if (regime === "oscillant") { prochain = s.temps + 1; suivreOscillation(); } else juger();
        }
      } else {
        while (performance.now() - t0 < budget && regime === "calcul") {
          avancer(s, 2);
          if (s.temps >= prochain) juger();
        }
      }
      publier({
        psi: Float32Array.from(s.psi), T: Float32Array.from(s.T),
        u: Float32Array.from(s.u), v: Float32Array.from(s.v),
        temps: s.temps, evolution, regime, rythme, periode: regime === "oscillant" ? periode() : null,
      });
      if (regime === "stationnaire") { actif = false; return; }
      setTimeout(boucle, regime === "oscillant" || rythme === "reel" ? 30 : 0);
    }

    return (m) => {
      if (m.type === "accel") { accel = m.valeur; return; }
      if (m.type === "melange") {
        if (!s) return;
        for (let q = 0; q < m.paires.length; q += 2) {
          const a = m.paires[q], b = m.paires[q + 1], Ta = s.T[a], Tb = s.T[b];
          s.T[a] = Ta + m.phi * (Tb - Ta);
          s.T[b] = Tb + m.phi * (Ta - Tb);
        }
        return;
      }
      if (!s || m.reinit) {
        s = creer(m.grille);
        for (let k = 0; k < s.T.length; k++) s.T[k] = m.tinit && !Number.isNaN(m.tinit[k]) ? m.tinit[k] : m.Tinit;
      }
      s.nu = m.nu;
      s.kappa = m.kappa;
      s.ecartT = m.ecartT;
      s.Text = m.Text ?? 20;
      s.rappel = m.rappel || null;
      tol = m.tol;
      rythme = m.rythme || "max";
      definir(
        s,
        (i, j) => m.solide[j * s.ni + i] === 1,
        (i, j) => (Number.isNaN(m.tfix[j * s.ni + i]) ? null : m.tfix[j * s.ni + i]),
        (i, j) => {
          const t = m.tinit ? m.tinit[j * s.ni + i] : NaN;
          return Number.isNaN(t) ? m.Tinit : t;
        },
      );
      s.temps = 0;
      horloge = performance.now();
      regime = "calcul"; precedent = null; prochain = INTERVALLE; calmes = 0; evolution = Infinity; historique = [];
      if (!actif) { actif = true; setTimeout(boucle, 0); }
    };
  }

  return { creer, definir, avancer, interpoler, pilote, FLUIDE, SOLIDE, PAROI };
})();
