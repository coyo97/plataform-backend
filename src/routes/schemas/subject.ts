// schemas/subject.ts
import { Schema, Mongoose, Document } from 'mongoose';

export interface ISubject extends Document {
	name      : string;
	code      : string;                   // MAT-101
	careerIds : Schema.Types.ObjectId[];  // many-to-many
	level?    : number;                   // semestre / año sugerido
	credits?  : number;
}

const subjectSchema = new Schema<ISubject>({
	name      : { type:String, required:true },
	code      : { type:String, required:true, unique:true },
	careerIds : [{ type:Schema.Types.ObjectId, ref:'Career' }],
	level     : { type:Number },
	credits   : { type:Number }
});

export const SubjectModel = (mongoose:Mongoose) =>
	mongoose.model<ISubject>('Subject', subjectSchema);

