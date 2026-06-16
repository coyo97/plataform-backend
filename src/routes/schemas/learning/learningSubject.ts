import mongoose, { Schema, Document, Mongoose, Types } from "mongoose";

export interface ILearningSubject extends Document {
	user: Types.ObjectId;           // dueño
	title: string;                  // "Derecho Constitucional I"
	career?: string;                // opcional (para agrupar)
	jurisdiction?: string;          // "General" / "Bolivia"
	created_at: Date;
	updated_at: Date;
}

const LearningSubjectSchema = new Schema<ILearningSubject>({
	user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
	title: { type: String, required: true, trim: true, maxlength: 120 },
	career: { type: String, trim: true, maxlength: 120 },
	jurisdiction: { type: String, trim: true, default: "General", maxlength: 60 },
	created_at: { type: Date, default: Date.now },
	updated_at: { type: Date, default: Date.now },
});

LearningSubjectSchema.index({ user: 1, title: 1 }, { unique: true });
LearningSubjectSchema.index({ created_at: -1 });

export const LearningSubjectModel = (mongoose: Mongoose) =>
	mongoose.model<ILearningSubject>("LearningSubject", LearningSubjectSchema);
