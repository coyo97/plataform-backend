import { loadModel as loadModelOnline, analyzeComment as analyzeOnline } from "./toxicityService";
import { loadModelLocal, analyzeCommentLocal as analyzeLocal } from "./toxicityServiceLocal";

//  - "local"  -> fuerza offline
//  - "online" -> fuerza online
//  - "auto"   -> intenta local, si falla usa online
const MODE = (process.env.TOXICITY_MODE || "auto").toLowerCase();

let initialized = false;
let using: "local" | "online" = "local";

export async function loadModel() {
	if (initialized) return;

	if (MODE === "online") {
		await loadModelOnline();
		using = "online";
		initialized = true;
		return;
	}

	if (MODE === "local") {
		await loadModelLocal();
		using = "local";
		initialized = true;
		return;
	}

	// auto: intenta offline primero
	try {
		await loadModelLocal();
		using = "local";
	} catch (e) {
		console.warn("⚠ Offline no disponible, usando online. Motivo:", e);
		await loadModelOnline();
		using = "online";
	}

	initialized = true;
}

export async function analyzeComment(comment: string): Promise<boolean> {
	if (!initialized) await loadModel();

	if (using === "local") {
		try {
			return await analyzeLocal(comment);
		} catch (e) {
			console.warn("⚠ Falló local en runtime, fallback a online:", e);
			using = "online";
			await loadModelOnline();
			return await analyzeOnline(comment);
		}
	}

	return await analyzeOnline(comment);
}

