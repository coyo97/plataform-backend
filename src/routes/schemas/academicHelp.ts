// src/routes/schemas/academicHelp.ts
import { Schema, Document, Mongoose, Types } from 'mongoose';

export interface IAcademicHelp extends Document {
	user       : Types.ObjectId;

	/* NUEVOS metadatos */
	facultyId ?: Types.ObjectId;          // ref Faculty
	careerId  : Types.ObjectId;           // ref Career   (oblig.)
	cycleId  ?: Types.ObjectId;           // ref Cycle
	subjectId?: Types.ObjectId;           // ref Subject
	unitId   ?: Types.ObjectId;           // ref Unit

	/* Campos legacy opcionales (seguirán llegando desde el front viejo) */
	faculty  ?: string;
	semester ?: string;
	subject  ?: string;

	topic      ?: string;
	description : string;
	fileUrl    ?: string;

	/* Tipo de solicitud */
	requestType: 'concept_question' | 'need_notes' | 'need_exam' | 'need_assignment';

	status : 'open' | 'resolved';
	created_at: Date;
	updated_at: Date;
}

const AcademicHelpSchema = new Schema<IAcademicHelp>({
	user      : { type: Schema.Types.ObjectId, ref: 'User', required: true },

	facultyId : { type: Schema.Types.ObjectId, ref: 'Faculty' },
	careerId  : { type: Schema.Types.ObjectId, ref: 'Career',  required: true },
	cycleId   : { type: Schema.Types.ObjectId, ref: 'Cycle' },
	subjectId : { type: Schema.Types.ObjectId, ref: 'Subject' },
	unitId    : { type: Schema.Types.ObjectId, ref: 'Unit' },

	/* legacy */
	faculty   : { type: String },
	semester  : { type: String },
	subject   : { type: String },

	topic      : { type: String },
	description: { type: String, required: true },
	fileUrl    : { type: String },

	requestType: {
		type   : String,
		enum   : ['concept_question','need_notes','need_exam','need_assignment'],
		default: 'concept_question'
	},

	status     : { type: String, enum: ['open','resolved'], default: 'open' },
	created_at : { type: Date, default: Date.now },
	updated_at : { type: Date, default: Date.now }
});

/* Índices recomendados para filtros */
AcademicHelpSchema.index({ careerId:1, subjectId:1 });
AcademicHelpSchema.index({ requestType:1, status:1 });
AcademicHelpSchema.index({ created_at:-1 });

export const AcademicHelpModel = (mongoose: Mongoose) =>
	mongoose.model<IAcademicHelp>('AcademicHelp', AcademicHelpSchema);

