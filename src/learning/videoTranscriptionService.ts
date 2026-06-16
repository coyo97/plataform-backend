import { execFile } from "child_process";
import { parseEnvString } from "../utils";

const PYTHON_BIN = process.env.PYTHON_BIN || "python3";

// ruta del script python
const WHISPER_PY = parseEnvString("WHISPER_TRANSCRIBE_PY"); // en .env

// modelo por defecto
const WHISPER_MODEL = process.env.WHISPER_MODEL || "base";  // en .env opcional

export type WhisperResult = {
	language?: string;
	duration?: number;
	text: string;
	segments?: { start: number; end: number; text: string }[];
	error?: string;
};

export function transcribeAudio(audioPath: string, language?: string): Promise<WhisperResult> {
	return new Promise((resolve, reject) => {
		const args = [WHISPER_PY, audioPath, WHISPER_MODEL];
		if (language) args.push(language);

		execFile(PYTHON_BIN, args, (error, stdout, stderr) => {
			if (error && !stdout) {
				return reject(new Error(`Whisper error: ${stderr || error.message}`));
			}

			try {
				const data = JSON.parse(stdout);
				resolve(data);
			} catch (e) {
				reject(new Error("No se pudo parsear salida JSON de Whisper."));
			}
		});
	});
}
