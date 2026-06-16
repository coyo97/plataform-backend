import "@tensorflow/tfjs";
import * as toxicity from "@tensorflow-models/toxicity";

const threshold = 0.7;
const toxicityLabels = [
  "identity_attack",
  "insult",
  "obscene",
  "severe_toxicity",
  "threat",
  "toxicity",
  "sexual_explicit"
];

let model: toxicity.ToxicityClassifier | null = null;

export async function loadModelLocal() {
  throw new Error(
    "Modo OFFLINE no soportado en esta CPU (tfjs-node requiere AVX). Usa modo ONLINE."
  );
}

export async function analyzeCommentLocal(comment: string): Promise<boolean> {
  // Esto mantiene la firma pero evita que alguien lo llame sin querer
  await loadModelLocal();
  return false;
}
