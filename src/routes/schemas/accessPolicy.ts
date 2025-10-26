// src/routes/schemas/accessPolicy.ts
import { Schema, model, Document, Types } from 'mongoose';

type Op = 'eq' | 'in' | 'overlaps' | 'neq' | 'not_in';

interface Condition {
	/**
	 * Paths admitidos típicos (no se valida por enum para mantener flexibilidad):
	 * - 'actor.careerIds'    | 'actor.facultyIds'    | 'actor.roleIds'
	 * - 'target.careerIds'   | 'target.facultyIds'
	 * - 'resource.ownerId'   | ...
	 */
	path: string;
	op: Op;
	// Puede ser string o string[] según el operador
	value?: any; // ['<careerId1>', '<careerId2>'] ó '<facultyId>'
}

export interface IAccessPolicy extends Document {
	module: Types.ObjectId;        // ref Module
	action: Types.ObjectId;        // ref Action
	effect: 'allow' | 'deny';      // deny gana si matchea
	subject?: Condition[];         // condiciones sobre actor
	target?: Condition[];          // condiciones sobre target
	resource?: Condition[];        // opcional (dueño del recurso, etc.)
	label?: string;                // para UI
	enabled: boolean;
	createdAt?: Date;
	updatedAt?: Date;
}

const ConditionSchema = new Schema<Condition>({
	path:  { type: String, required: true },
	op:    { type: String, enum: ['eq','in','overlaps','neq','not_in'], required: true },
	value: { type: Schema.Types.Mixed }
}, { _id: false });

const AccessPolicySchema = new Schema<IAccessPolicy>({
	module:   { type: Schema.Types.ObjectId, ref: 'Module', required: true },
	action:   { type: Schema.Types.ObjectId, ref: 'Action', required: true },
	effect:   { type: String, enum: ['allow','deny'], required: true },
	subject:  { type: [ConditionSchema], default: [] },
	target:   { type: [ConditionSchema], default: [] },
	resource: { type: [ConditionSchema], default: [] },
	label:    { type: String },
	enabled:  { type: Boolean, default: true },
}, { timestamps: true });

// Índices útiles para lookup por módulo/acción y toggling rápido
AccessPolicySchema.index({ module: 1, action: 1, enabled: 1 });
AccessPolicySchema.index({ effect: 1 });

export const AccessPolicyModel = (mongoose: typeof import('mongoose')) =>
	model<IAccessPolicy>('AccessPolicy', AccessPolicySchema);

