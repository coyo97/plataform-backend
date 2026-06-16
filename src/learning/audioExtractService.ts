import { execFile } from "child_process";
import path from "path";

export function extractAudioToWav(videoPath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const outPath = videoPath.replace(path.extname(videoPath), "") + ".wav";

		// WAV mono 16kHz (ideal para whisper)
		const args = [
			"-y",
			"-i", videoPath,
			"-vn",
			"-ac", "1",
			"-ar", "16000",
			"-f", "wav",
			outPath,
		];

		execFile("ffmpeg", args, (error, stdout, stderr) => {
			if (error) {
				return reject(new Error(`ffmpeg error: ${stderr || error.message}`));
			}
			resolve(outPath);
		});
	});
}
