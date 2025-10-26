// src/middlware/targetResolvers.ts
import type { Request } from 'express';
import mongoose from 'mongoose';

import { UserModel } from '../routes/schemas/user';
import { ProfileModel } from '../routes/schemas/profile';
import { PublicationModel } from '../routes/schemas/publication';
import { CareerModel } from '../routes/schemas/career';
import { StreamModel } from '../routes/schemas/stream';

type ObjId = string;

export type TargetInfo = {
	id?: ObjId;
	careerIds?: ObjId[];
	facultyIds?: ObjId[];
};

export type Resolver = (req: Request) => Promise<TargetInfo>;

const toStr = (v: any): string => String(v);
const uniq = (arr: string[] | undefined): string[] =>
	Array.from(new Set((arr ?? []).filter(Boolean).map(toStr)));

	/** Convierte carreras -> facultades (string[]) */
	async function careersToFacultyIds(careerIds: string[]): Promise<string[]> {
		if (!careerIds || careerIds.length === 0) return [];
		const Career = CareerModel(mongoose);
		const careers = await Career.find({ _id: { $in: careerIds } }, { facultyId: 1 })
		.lean()
		.exec();
		const facs: string[] = [];
		for (const c of careers as any[]) {
			if (c?.facultyId) facs.push(toStr(c.facultyId));
		}
		return uniq(facs);
	}

/** Devuelve careerIds/facultyIds del usuario */
async function userToCareerAndFaculty(userId?: string): Promise<{ careerIds: string[]; facultyIds: string[] }> {
	if (!userId) return { careerIds: [], facultyIds: [] };
	const User = UserModel(mongoose);
	const u = await User.findById(userId).populate('careers').lean().exec();
	const uCareerIds: string[] = uniq(((u?.careers as any[]) ?? []).map((c: any) => toStr(c?._id ?? c)));
	const uFacultyIds = await careersToFacultyIds(uCareerIds);
	return { careerIds: uCareerIds, facultyIds: uFacultyIds };
}

/**
 * Profiles:Read
 * - /api/profiles/:id puede ser profileId o userId
 */
const resolveProfileRead: Resolver = async (req) => {
	const id = req.params?.id;
	if (!id) return {};
	const Profile = ProfileModel(mongoose);

	const prof = await Profile.findById(id).lean().exec();
	if (prof?.user) {
		const userId = toStr(prof.user);
		const { careerIds, facultyIds } = await userToCareerAndFaculty(userId);
		return { id: userId, careerIds, facultyIds };
	}

	// Si no es ProfileId válido, intenta como UserId
	const { careerIds, facultyIds } = await userToCareerAndFaculty(id);
	return { id, careerIds, facultyIds };
};

/**
 * Authors:Read
 * - /api/authors/:id siempre usa :id como userId del autor
 */
const resolveAuthorRead: Resolver = async (req) => {
	const id = req.params?.id; // userId del autor
	if (!id) return {};
	const { careerIds, facultyIds } = await userToCareerAndFaculty(id);
	return { id, careerIds, facultyIds };
};

/**
 * Message:Send
 * - Target = receptor del mensaje (req.body.receiver ó req.body.toUserId)
 */
const resolveMessageSend: Resolver = async (req) => {
	const toUserIdRaw = (req.body?.receiver ?? req.body?.toUserId);
	if (!toUserIdRaw) return {};
	const toUserId = toStr(toUserIdRaw);
	const { careerIds, facultyIds } = await userToCareerAndFaculty(toUserId);
	return { id: toUserId, careerIds, facultyIds };
};

/**
 * Publications:Read
 * - Combina carreras del autor + carrera asociada a la publicación (publication.career)
 */
const resolvePublicationRead: Resolver = async (req) => {
	const id = req.params?.id;
	if (!id) return {};

	const Publication = PublicationModel(mongoose);
	const pub = await Publication.findById(id)
	.populate({ path: 'author', populate: { path: 'careers' } })
	.populate({ path: 'career' })
	.lean()
	.exec();

	if (!pub) return {};

	const owner = (pub as any).author;
	const ownerId: string | undefined = owner?._id ? toStr(owner._id) : undefined;

	const ownerCareerIds: string[] = uniq(((owner?.careers as any[]) ?? []).map((c: any) => toStr(c?._id ?? c)));
	const pubCareerId: string | undefined = (pub as any)?.career
		? toStr((pub as any).career?._id ?? (pub as any).career)
		: undefined;

		const combinedCareerIds: string[] = uniq([...ownerCareerIds, ...(pubCareerId ? [pubCareerId] : [])]);
		const facultyIds: string[] = await careersToFacultyIds(combinedCareerIds);

		return { id: ownerId, careerIds: combinedCareerIds, facultyIds };
};

/**
 * Stream:Read
 * - Combina stream.careerIds + carreras del owner (stream.userId)
 */
const resolveStreamRead: Resolver = async (req) => {
	const id = req.params?.id;
	if (!id) return {};

	const s: any = await StreamModel.findById(id).lean().exec();
	if (!s) return {};

	const ownerId: string | undefined = s.userId ? toStr(s.userId) : undefined;
	const streamCareerIds: string[] = uniq(((s.careerIds as any[]) ?? []).map((c: any) => toStr(c?._id ?? c)));

	const { careerIds: ownerCareerIds } = await userToCareerAndFaculty(ownerId);
	const combinedCareerIds: string[] = uniq([...streamCareerIds, ...ownerCareerIds]);
	const facultyIds: string[] = await careersToFacultyIds(combinedCareerIds);

	return { id: ownerId, careerIds: combinedCareerIds, facultyIds };
};

/**
 * Exporta los resolvers por "Module:Action"
 */
export const TargetResolvers: Record<string, Resolver> = {
	'Profiles:Read':     resolveProfileRead,
	'Authors:Read':      resolveAuthorRead,   // <-- clave para tu ruta /api/authors/:id
	'Message:Send':      resolveMessageSend,
	'Publications:Read': resolvePublicationRead,
	'Stream:Read':       resolveStreamRead,
};

