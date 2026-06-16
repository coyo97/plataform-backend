import jwt from 'jsonwebtoken';

export interface TokenPayload {
  userId: string;  
}

// Usa la misma clave secreta para ambos procesos
const secretKey = process.env.JWT_SECRET || 'your_secret_key'; 

export function generateToken(userId: string): string {
  const token = jwt.sign({ userId }, secretKey, { expiresIn: '2h' }); // Clave secreta aquí
  return token;
}

export function verifyToken(token: string): TokenPayload {
  const payload = jwt.verify(token, secretKey) as TokenPayload; // Y la misma clave aquí
  return payload;
}

