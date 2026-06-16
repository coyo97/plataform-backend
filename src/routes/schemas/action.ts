// src/routes/schemas/action.ts
import { Schema, Document, model } from 'mongoose';

export interface IAction extends Document {
  name: string;
}

const ActionSchema = new Schema<IAction>({
  name: { type: String, required: true, unique: true },
});

export const ActionModel = (mongoose: typeof import('mongoose')) =>
  mongoose.model<IAction>('Action', ActionSchema);

