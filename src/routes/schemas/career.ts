// src/routes/schemas/career.ts
import mongoose, { Schema, Document, Mongoose, Types } from 'mongoose';

export interface ICareer extends Document {
	_id: Types.ObjectId;
	name: string;
	description?: string;
	facultyId?: Types.ObjectId;          // ← opcional
}

const careerSchema: Schema<ICareer> = new Schema({
	name       : { type:String, required:true, unique:true },
	description: { type:String },
	facultyId  : { type:Schema.Types.ObjectId, ref:'Faculty' }  // 👈 NUEVO (sin required)
});

export const CareerModel = (mongoose:Mongoose) =>
	mongoose.model<ICareer>('Career', careerSchema);

