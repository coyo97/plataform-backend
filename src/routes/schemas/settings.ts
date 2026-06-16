// src/routes/schemas/settings.ts
import { Schema, Document } from 'mongoose';

export interface ISettings extends Document {
  aiModerationEnabled: boolean;
  commentModerationEnabled: boolean;
  maxUploadSize: number; // Nuevo campo
  reportThreshold: number;
  notificationThreshold: number;
}

const SettingsSchema = new Schema<ISettings>({
  aiModerationEnabled: { type: Boolean, default: true },
  commentModerationEnabled: { type: Boolean, default: true },
  maxUploadSize: { type: Number, default: 50 * 1024 * 1024 }, // Por defecto 50MB
    reportThreshold: { type: Number, default: 5 }, // Umbral para bloquear usuarios
  notificationThreshold: { type: Number, default: 3 }, // Umbral para notificar a usuarios
});

export const SettingsModel = (mongoose: typeof import('mongoose')) =>
  mongoose.model<ISettings>('Settings', SettingsSchema);

