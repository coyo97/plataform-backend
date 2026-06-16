import { execFile } from 'child_process';

export function analyzeImage(imagePath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        execFile('python3', ['/home/coyo/plataform/development/docu/NudeNet/your_nudenet_script.py', imagePath], (error, stdout, stderr) => {
            if (error) {
                console.error('Error ejecutando NudeNet:', error);
                console.error('Stderr:', stderr);
                return reject(new Error(`Error ejecutando NudeNet: ${stderr || error.message}`));
            }
            try {
                console.log('Stdout:', stdout);
                const detectionsArray = JSON.parse(stdout);
                console.log('Detecciones:', detectionsArray);

                // Verificar si hay detecciones
                const isNSFW = detectionsArray.length > 0;

                resolve(isNSFW);
            } catch (err) {
                console.error('Error al parsear el resultado de NudeNet:', err);
                reject(new Error('Error al parsear el resultado de NudeNet'));
            }
        });
    });
}

