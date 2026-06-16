import * as toxicity from '@tensorflow-models/toxicity';
import * as tf from '@tensorflow/tfjs-node';

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

export async function loadModel() {
  if (!model) {
    console.log('Cargando el modelo de toxicidad...');
    model = await toxicity.load(threshold, toxicityLabels);
    console.log('Modelo de toxicidad cargado.');
  }
}

export async function analyzeComment(comment: string): Promise<boolean> {
  // Cargar el modelo si aún no está cargado
  if (!model) {
    await loadModel();
  }

  // Verificar que el modelo esté definido
  if (!model) {
    throw new Error('Model not loaded');
  }

  console.log('Comentario a analizar:', comment);

  // Clasificar el comentario
  const predictions = await model.classify([comment]);
  console.log('Predicciones:', JSON.stringify(predictions, null, 2));

  return predictions.some(prediction => 
    prediction.results.some(result => result.match)
  );
}

