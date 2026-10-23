// Calcul du battant en tâche de fond, pour garder l'animation fluide (voir battant.js)
importScripts("battant.js");

const recevoir = Battant.pilote((instantane) => postMessage(instantane));
onmessage = (e) => recevoir(e.data);
