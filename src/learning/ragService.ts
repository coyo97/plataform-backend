import { embedText } from "./embeddingService";
import { searchPoints } from "./qdrantService";
import type { Model } from "mongoose";

type Citation = {
	n: number;
	chunkId: string;
	documentId: string;
	chunkIdx: number;
	title?: string;
	excerpt: string;
	score?: number;
};

export async function ragAnswer(opts: {
	userId: string;
	question: string;
	topicId?: string;
	limit?: number;

	chunkModel: Model<any>;
	documentModel: Model<any>;
}) {
	const { userId, question, topicId, limit = 8, chunkModel, documentModel } = opts;

	// 1) embedding de la pregunta
	const qvec = await embedText(question);

	// 2) búsqueda en Qdrant (filtro por userId y opcional topicId)
	const filter: any = {
		must: [{ key: "userId", match: { value: String(userId) } }],
	};
	if (topicId) {
		filter.must.push({ key: "topicId", match: { value: String(topicId) } });
	}

	const hits = await searchPoints(qvec, filter, limit);

	if (!Array.isArray(hits) || hits.length === 0) {
		return {
			answer:
				"No encontré información en tus apuntes para responder eso todavía. Puedes subir más material o indexar el documento correcto.",
			citations: [],
		};
	}

	const chunkIds = hits
  .map((h: any) => h?.payload?.chunkId)
  .filter(Boolean)
  .map((x: any) => String(x));

	// 3) Traer chunks reales desde Mongo (para excerpt y consistencia)
	const chunks = await chunkModel.find({ _id: { $in: chunkIds } }).exec();
	const chunkMap = new Map<string, any>(chunks.map((c: any) => [String(c._id), c]));

	// 4) Traer títulos de documentos (opcional, para UI)
	const docIds = Array.from(
		new Set(
			hits
			.map((h: any) => h?.payload?.documentId)
			.filter(Boolean)
			.map((x: any) => String(x))
		)
	);

	const docs = docIds.length ? await documentModel.find({ _id: { $in: docIds } }).select("title").exec() : [];
	const docTitleMap = new Map<string, string>(docs.map((d: any) => [String(d._id), String(d.title)]));

	// 5) Construir citas (numeradas)
	const citations: Citation[] = hits.map((h: any, i: number) => {
		const payload = h.payload ?? {};
		const chunkId = payload.chunkId ? String(payload.chunkId) : "";
		const ch = chunkMap.get(chunkId);
		const documentId = payload.documentId ? String(payload.documentId) : (ch?.documentId ? String(ch.documentId) : "");
		const chunkIdx = typeof payload.chunkIdx === "number" ? payload.chunkIdx : (ch?.idx ?? 0);
		const excerpt = (ch?.text ?? "").slice(0, 280);

		return {
			n: i + 1,
			chunkId,
			documentId,
			chunkIdx,
			title: documentId ? docTitleMap.get(documentId) : undefined,
			excerpt,
			score: h.score,
		};
	});

	// 6) Armar contexto para el LLM
	const context = citations
	.map((c) => {
		const title = c.title ? ` (${c.title})` : "";
		return `[${c.n}]${title} ${c.excerpt}`;
	})
	.join("\n\n");

	return { citations, context };
}
