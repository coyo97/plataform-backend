// 👇 ESTA LÍNEA ES LA CLAVE: registra backends + file save handlers en Node
import "@tensorflow/tfjs-node";

import * as fs from "fs";
import * as path from "path";
import * as toxicity from "@tensorflow-models/toxicity";

async function main() {
  const OUT_DIR = path.join(__dirname, "..", "text", "toxicity_model");
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("1) Cargando modelo Toxicity desde internet (solo esta vez)...");

  const LABELS = [
    "identity_attack",
    "insult",
    "obscene",
    "severe_toxicity",
    "sexual_explicit",
    "threat",
    "toxicity",
  ];

  const classifier: any = await toxicity.load(0.85, LABELS);

  console.log("2) Guardando GraphModel localmente...");
  const graphModel =
    classifier.model || classifier.baseModel || classifier._model;

  if (!graphModel) {
    console.log("No encontré la GraphModel interna. Keys:", Object.keys(classifier));
    throw new Error("No se pudo acceder al modelo interno para guardarlo.");
  }

  await graphModel.save(`file://${OUT_DIR}`);
  console.log("   ✔ model.json + shards guardados en:", OUT_DIR);

  console.log("3) Guardando metadata si existe...");
  const metadata = classifier.metadata || classifier._metadata;
  if (metadata) {
    fs.writeFileSync(
      path.join(OUT_DIR, "metadata.json"),
      JSON.stringify(metadata)
    );
    console.log("   ✔ metadata.json guardado");
  } else {
    console.log("   ⚠ No encontré metadata, pero el modelo ya está guardado.");
  }

  console.log("✅ Listo. Ya tienes el modelo offline.");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});

