// Physique de la sédimentation : portage de src/vitesse_chute.py.
// Voir docs/theorie_sedimentation.md pour la démonstration.

const Physique = (() => {
  const T = 293.15;               // K
  const K_B = 1.380649e-23;       // J/K
  const MU = 1.81e-5;             // Pa.s
  const RHO_AIR = 1.204;          // kg/m3
  const LAMBDA = 0.0665e-6;       // m, libre parcours moyen
  const G = 9.81;                 // m/s2

  const knudsen = (d) => (2 * LAMBDA) / d;

  // Correction de glissement de Cunningham (forme de Hinds)
  const cunningham = (d) =>
    1 + (LAMBDA / d) * (2.34 + 1.05 * Math.exp((-0.39 * d) / LAMBDA));

  const reynolds = (d, v) => (RHO_AIR * Math.abs(v) * d) / MU;

  // Traînée Clift-Gauvin divisée par Cc, écrite sans 1/Re pour rester finie quand v -> 0
  function trainee(d, v) {
    if (v === 0) return 0;
    const s = Math.sign(v);
    v = Math.abs(v);
    const re = reynolds(d, v);
    const stokes = 3 * Math.PI * MU * d * v * (1 + 0.15 * Math.pow(re, 0.687));
    const newton =
      (0.5 * RHO_AIR * v * v * (Math.PI * d * d) / 4) *
      (0.42 / (1 + 4.25e4 * Math.pow(re, -1.16)));
    return (s * (stokes + newton)) / cunningham(d);
  }

  const masse = (d, rhoP) => (rhoP * Math.PI * d ** 3) / 6;
  const poidsApparent = (d, rhoP) => ((rhoP - RHO_AIR) * Math.PI * d ** 3 * G) / 6;
  const vStokes = (d, rhoP) => ((rhoP - RHO_AIR) * G * d * d) / (18 * MU);

  function vTerminale(d, rhoP) {
    const w = poidsApparent(d, rhoP);
    let lo = 0, hi = 1;
    while (trainee(d, hi) < w) hi *= 2;
    for (let i = 0; i < 200; i++) {
      const mid = 0.5 * (lo + hi);
      if (trainee(d, mid) < w) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  // Stokes-Einstein avec glissement, m2/s
  const diffusion = (d) => (K_B * T * cunningham(d)) / (3 * Math.PI * MU * d);

  const tempsRelaxation = (d, rhoP) => (rhoP * d * d * cunningham(d)) / (18 * MU);

  function regime(d, re) {
    const kn = knudsen(d);
    if (kn > 10) return "moleculaire";
    if (kn > 0.1) return "transition";
    if (re < 0.1) return "stokes";
    if (re < 1000) return "intermediaire";
    return "newton";
  }

  // Grandeurs constantes d'une classe de taille
  function caracteriser(d, rhoP) {
    const vt = vTerminale(d, rhoP);
    const re = reynolds(d, vt);
    const tau = tempsRelaxation(d, rhoP);
    return {
      d,
      rhoP,
      vt,
      re,
      kn: knudsen(d),
      cc: cunningham(d),
      vStokes: vStokes(d, rhoP),
      D: diffusion(d),
      // Échelle de mise en vitesse : tau en Stokes, v_t/g quand la traînée est inertielle
      tauEff: Math.min(tau, vt / G),
      m: masse(d, rhoP),
      w: poidsApparent(d, rhoP),
      regime: regime(d, re),
    };
  }

  // Accélération verticale (z vers le bas) d'une particule de vitesse v
  const acceleration = (c, v) => (c.w - trainee(c.d, v)) / c.m;

  return { caracteriser, acceleration, G };
})();
