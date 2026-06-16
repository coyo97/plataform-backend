import { Schema, Document } from 'mongoose';

export interface IReport extends Document {
	reporter: Schema.Types.ObjectId; // Usuario que realiza el reporte
	targetType: 'Publication' | 'Stream' | 'Message' | 'AcademicHelp';
	target: Schema.Types.ObjectId; // ID de la entidad (Publicación, Stream, etc.)
	reason: string; // Razón del reporte
	status: 'pending' | 'reviewed' | 'dismissed'; // Estado del reporte
	createdAt: Date;
	updatedAt: Date;
}

const ReportSchema = new Schema<IReport>(
	{
		reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },

		targetType: {
			type: String,
			enum: ['Publication', 'Stream', 'Message', 'AcademicHelp'],
			required: true,
		},
		target: {
			type: Schema.Types.ObjectId,
			required: true,
			refPath: 'targetType', 
		},

		reason: { type: String, required: true },
		status: {
			type: String,
			enum: ['pending', 'reviewed', 'dismissed'],
			default: 'pending',
		},
	},
	{ timestamps: true }
);

export const ReportModel = (mongoose: typeof import('mongoose')) =>
	mongoose.model<IReport>('Report', ReportSchema);

