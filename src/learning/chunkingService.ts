export type Chunk = {
	idx: number;
	text: string;
	charStart: number;
	charEnd: number;
};

export function chunkText(input: string, maxChars = 1200, overlap = 150): Chunk[] {
	const text = (input ?? "").replace(/\r\n/g, "\n").trim();
	if (!text) return [];

	const out: Chunk[] = [];
	let start = 0;
	let idx = 0;

	while (start < text.length) {
		let end = Math.min(start + maxChars, text.length);

		const slice = text.slice(start, end);
		const lastBreak = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(". "));

		if (lastBreak > Math.floor(maxChars * 0.6)) end = start + lastBreak + 1;

		const chunk = text.slice(start, end).trim();
		if (chunk) out.push({ idx: idx++, text: chunk, charStart: start, charEnd: end });

		if (end >= text.length) break;
		start = Math.max(0, end - overlap);
	}

	return out;
}
