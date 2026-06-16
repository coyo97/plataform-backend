import { execFile } from "child_process";
import { parseEnvString } from "../utils";

const OCR_PY = parseEnvString("OCR_PY");
const OCR_LANG = process.env.OCR_LANG || "spa";
const PYTHON_OCR_BIN = process.env.PYTHON_OCR_BIN || "python3";

export async function ocrImage(imagePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(PYTHON_OCR_BIN, [OCR_PY, imagePath, OCR_LANG], (error, stdout, stderr) => {
			if (error && !stdout) return reject(new Error(stderr || error.message));
			try {
				const data = JSON.parse(stdout);
				if (data?.error) return reject(new Error(data.error));
				resolve((data?.text ?? "").toString());
			} catch {
				reject(new Error("OCR: salida inválida (no JSON)"));
			}
		});
	});
}
