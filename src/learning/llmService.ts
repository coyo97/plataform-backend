import axios from "axios";
import { parseEnvString } from "../utils";

const OLLAMA_BASE = parseEnvString("OLLAMA_BASE_URL");
const CHAT_MODEL = parseEnvString("OLLAMA_CHAT_MODEL");

export async function chatWithOllama(system: string, user: string): Promise<string> {
	const { data } = await axios.post(`${OLLAMA_BASE}/api/chat`, {
		model: CHAT_MODEL,
		messages: [
			{ role: "system", content: system },
			{ role: "user", content: user },
		],
		stream: false,
	});

	const content = data?.message?.content;
	if (!content || typeof content !== "string") {
		throw new Error("Respuesta inválida de Ollama (chat).");
	}
	return content;
}
