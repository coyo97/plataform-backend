// schemas/cycle.ts
import { Schema, Mongoose, Document } from 'mongoose';

export interface ICycle extends Document {
	type : 'semester' | 'year' | 'trimester';
	year : number;        // 2024
	number?: number;      // 1, 2 … (solo para semestre/trimestre)
}

const cycleSchema = new Schema<ICycle>({
	type  : { type:String, enum:['semester','year','trimester'], required:true },
	year  : { type:Number, required:true },
	number: { type:Number }     // opcional en anual
});

export const CycleModel = (mongoose:Mongoose) =>
	mongoose.model<ICycle>('Cycle', cycleSchema);

