import mongoose, { Schema, Document, Mongoose, Types } from "mongoose";

export type LearningSourceType = "note" | "pdf" | "docx" | "txt" | "video" | "link" | "book" | "audio" | "image";

export interface ILearningDocument extends Document {
	user: Types.ObjectId;
	subjectId: Types.ObjectId;
	topicId?: Types.ObjectId;

	title: string;
	sourceType: LearningSourceType;

	content?: string;        // para notas pegadas o texto ya extraído
	fileUrl?: string;        // /uploads/...
	originalName?: string;   // nombre original del archivo

status: "draft" | "indexed" | "processing" | "failed"
	created_at: Date;
	updated_at: Date;
}

const LearningDocumentSchema = new Schema<ILearningDocument>({
	user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
	subjectId: { type: Schema.Types.ObjectId, ref: "LearningSubject", required: true, index: true },
	topicId: { type: Schema.Types.ObjectId, ref: "LearningTopic", index: true },

	title: { type: String, required: true, trim: true, maxlength: 200 },
	sourceType: { type: String, required: true, enum: ["note", "pdf", "docx", "txt", "video", "link", "book", "audio", "image"], index: true },

	content: { type: String },
	fileUrl: { type: String, trim: true },
	originalName: { type: String, trim: true },

	status: { type: String, enum: ["draft", "indexed", "processing", "failed"], default: "draft", index: true },

	created_at: { type: Date, default: Date.now },
	updated_at: { type: Date, default: Date.now },
});

LearningDocumentSchema.index({ user: 1, subjectId: 1, topicId: 1, created_at: -1 });

export const LearningDocumentModel = (mongoose: Mongoose) =>
	mongoose.model<ILearningDocument>("LearningDocument", LearningDocumentSchema);
