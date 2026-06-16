// src/routes/schemas/module.ts
import { Schema, Document, model } from 'mongoose';

export interface IModule extends Document {
  name: string;
}

const ModuleSchema = new Schema<IModule>({
  name: { type: String, required: true, unique: true },
});

export const ModuleModel = (mongoose: typeof import('mongoose')) =>
  mongoose.model<IModule>('Module', ModuleSchema);

