import axios from "axios";
import { parseEnvString } from "../utils";

const OLLAMA_BASE = parseEnvString("OLLAMA_BASE_URL");
const OLLAMA_MODEL = parseEnvString("OLLAMA_EMBED_MODEL");

export async function embedText(text: string): Promise<number[]> {
	const input = (text ?? "").trim();
	if (!input) return [];

	const safeInput = input.length > 8000 ? input.slice(0, 8000) : input;

	const { data } = await axios.post(`${OLLAMA_BASE}/api/embed`, {
		model: OLLAMA_MODEL,
		input: safeInput,
	});

	// Ollama puede devolver "embeddings" (array de arrays) o "embedding" según cliente/versión
	const emb =
		Array.isArray(data?.embeddings) && Array.isArray(data.embeddings[0])
			? data.embeddings[0]
			: data?.embedding;

	if (!Array.isArray(emb) || emb.length === 0) {
		throw new Error("Ollama embedding inválido.");
	}

	return emb as number[];
}
