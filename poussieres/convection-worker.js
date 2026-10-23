// Calcul de l'écoulement en tâche de fond, pour garder l'animation fluide (voir convection.js)
importScripts("convection.js");

const recevoir = Convection.pilote((instantane) => postMessage(instantane));
onmessage = (e) => recevoir(e.data);
