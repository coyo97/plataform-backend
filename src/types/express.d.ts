// src/types/express/index.d.ts
import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string; // Añadimos la propiedad userId para que esté disponible en todo el proyecto
  }
}

