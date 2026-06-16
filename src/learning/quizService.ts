import axios from "axios";
import { parseEnvString } from "../utils";

const OLLAMA_BASE = parseEnvString("OLLAMA_BASE_URL");
const CHAT_MODEL = parseEnvString("OLLAMA_CHAT_MODEL");

type QuizItem = {
	question: string;
	type: "multiple_choice" | "true_false" | "short_answer";
	options?: string[];
	correctAnswer: string;
	explanation?: string;
};

type QuizResponse = {
	items: QuizItem[];
};

export async function generateQuizFromContext(params: {
	topicTitle?: string;
	count: number;
	context: string;
}): Promise<QuizResponse> {
	const { topicTitle, count, context } = params;

	const schema = {
		type: "object",
		properties: {
			items: {
				type: "array",
				minItems: 1,
				maxItems: count,
				items: {
					type: "object",
					properties: {
						question: { type: "string" },
						type: {
							type: "string",
							enum: ["multiple_choice", "true_false", "short_answer"],
						},
						options: {
							type: "array",
							items: { type: "string" },
						},
						correctAnswer: { type: "string" },
						explanation: { type: "string" },
					},
					required: ["question", "type", "correctAnswer"],
				},
			},
		},
		required: ["items"],
	};

	const system = [
		"Eres un tutor académico.",
		"Genera preguntas SOLO usando el contexto dado.",
		"No inventes información externa.",
		"Devuelve JSON válido siguiendo exactamente el schema.",
		"Para multiple_choice incluye 4 opciones.",
		"Para true_false, correctAnswer debe ser 'true' o 'false'.",
	].join("\n");

	const user = [
		`Tema: ${topicTitle ?? "General"}`,
		`Genera ${count} preguntas de estudio.`,
		"",
		"CONTEXTO:",
		context,
	].join("\n");

	const { data } = await axios.post(`${OLLAMA_BASE}/api/chat`, {
		model: CHAT_MODEL,
		messages: [
			{ role: "system", content: system },
			{ role: "user", content: user },
		],
		stream: false,
		format: schema,
		options: {
			temperature: 0,
		},
	});

	const raw = data?.message?.content;
	if (!raw || typeof raw !== "string") {
		throw new Error("Respuesta inválida de Ollama al generar quiz.");
	}

	const parsed = JSON.parse(raw) as QuizResponse;

	if (!parsed?.items || !Array.isArray(parsed.items) || parsed.items.length === 0) {
		throw new Error("Ollama no devolvió preguntas válidas.");
	}

	return parsed;
}
