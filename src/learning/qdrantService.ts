import axios from "axios";
import { parseEnvString, parseEnvNumber } from "../utils";

const QDRANT_HOST = parseEnvString("QDRANT_HOST");
const QDRANT_PORT = parseEnvNumber("QDRANT_PORT");
const QDRANT_COLLECTION = parseEnvString("QDRANT_COLLECTION");

const BASE = `http://${QDRANT_HOST}:${QDRANT_PORT}`;

	type Payload = Record<string, any>;

export async function ensureCollection(vectorSize: number): Promise<void> {
	// revisa si existe
	try {
		await axios.get(`${BASE}/collections/${QDRANT_COLLECTION}`);
		return;
	} catch {
		// crear si no existe
	}

	await axios.put(`${BASE}/collections/${QDRANT_COLLECTION}`, {
		vectors: {
			size: vectorSize,
			distance: "Cosine",
		},
	});
}

export async function upsertPoint(pointId: number, vector: number[], payload: Payload): Promise<void> {
	await axios.put(`${BASE}/collections/${QDRANT_COLLECTION}/points`, {
		points: [{ id: pointId, vector, payload }],
	});
}

export async function searchPoints(vector: number[], filter: any, limit = 8) {
	const { data } = await axios.post(`${BASE}/collections/${QDRANT_COLLECTION}/points/search`, {
		vector,
		filter,
		limit,
		with_payload: true,
	});
	return data?.result ?? [];
}

export async function deletePointsByDocumentId(userId: string, documentId: string): Promise<void> {
	// Borra todos los puntos cuyo payload coincida con userId y documentId
	await axios.post(`${BASE}/collections/${QDRANT_COLLECTION}/points/delete`, {
		filter: {
			must: [
				{ key: "userId", match: { value: String(userId) } },
				{ key: "documentId", match: { value: String(documentId) } },
			],
		},
	});
}
