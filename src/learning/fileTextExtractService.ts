import fs from "fs/promises";
import path from "path";
import pdf from "pdf-parse";
import mammoth from "mammoth";

export type ExtractResult = {
	text: string;
	detectedType: "pdf" | "docx" | "txt" | "unknown";
};

function normalizeText(t: string) {
	return (t ?? "")
	.replace(/\r\n/g, "\n")
	.replace(/\n{3,}/g, "\n\n")
	.trim();
}

export async function extractTextFromFile(filePath: string, mimeType: string): Promise<ExtractResult> {
	const ext = path.extname(filePath).toLowerCase();

	// TXT
	if (mimeType === "text/plain" || ext === ".txt") {
		const raw = await fs.readFile(filePath, "utf-8");
		return { text: normalizeText(raw), detectedType: "txt" };
	}

	// PDF
	if (mimeType === "application/pdf" || ext === ".pdf") {
		const buf = await fs.readFile(filePath);
		const data = await pdf(buf);
		return { text: normalizeText(data.text), detectedType: "pdf" };
	}

	// DOCX
	if (
		mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
		ext === ".docx"
	) {
		const buf = await fs.readFile(filePath);
		const result = await mammoth.extractRawText({ buffer: buf });
		return { text: normalizeText(result.value), detectedType: "docx" };
	}

	return { text: "", detectedType: "unknown" };
}
