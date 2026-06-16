// src/routes/schemas/fileFormat.ts
import { Schema, Document } from 'mongoose';

export interface IFileFormat extends Document {
  mimeType: string;
  description?: string;
  enabled: boolean;
}

const FileFormatSchema = new Schema<IFileFormat>({
  mimeType: { type: String, required: true, unique: true },
  description: { type: String },
  enabled: { type: Boolean, default: true },
});

export const FileFormatModel = (mongoose: typeof import('mongoose')) =>
  mongoose.model<IFileFormat>('FileFormat', FileFormatSchema);

