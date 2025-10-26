// src/routes/schemas/systemPermission.ts
import { Schema, Mongoose, Document } from 'mongoose';

export interface ISystemPermission extends Document {
	originModule: string;   // módulo de origen (p.ej. "AyudaAcadémica")
	targetModule: string;   // módulo destino (p.ej. "Publicaciones")
	actions: ('Read' | 'Create' | 'Update' | 'Delete')[];
	enabled: boolean;
	created_at: Date;
	updated_at: Date;
}

const systemPermissionSchema = new Schema<ISystemPermission>({
	originModule: { type: String, required: true },
	targetModule: { type: String, required: true },
	actions: [
		{
			type: String,
			enum: ['Read', 'Create', 'Update', 'Delete'],
			required: true,
		},
	],
	enabled: { type: Boolean, default: true },
	created_at: { type: Date, default: Date.now },
	updated_at: { type: Date, default: Date.now },
});

// Evitar duplicados entre módulos
systemPermissionSchema.index(
	{ originModule: 1, targetModule: 1 },
	{ unique: true }
);

export const SystemPermissionModel = (mongoose: Mongoose) =>
	mongoose.model<ISystemPermission>('SystemPermission', systemPermissionSchema);

