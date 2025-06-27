import { execFile } from "child_process";
const PY = "/home/coyo/plataform/development/docu/NudeNet/your_nudenet_video.py";

export function analyzeVideo(videoPath: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		execFile("python3", [PY, videoPath], (error, stdout) => {
			// si Python no emitió stdout, es fallo real
			if (error && !stdout) return reject(error);

			try {
				const res = JSON.parse(stdout);
				if (res.error) return resolve(true);             // bloquea por precaución
				const isNSFW = Array.isArray(res) && res.length > 0;
				resolve(isNSFW);
			} catch (e) {
				reject(e);
			}
		});
	});
}

