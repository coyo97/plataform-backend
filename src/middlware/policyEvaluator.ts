// src/middlware/policyEvaluator.ts
type Ctx = {
	actor: { id: string; careerIds: string[]; facultyId?: string; roleIds?: string[] };
	target: { id?: string; careerIds?: string[]; facultyId?: string };
	resource?: Record<string, any>;
};

function get(obj: any, path: string) {
	return path.split('.').reduce((acc, k) => acc?.[k], obj);
}
function toArr(v: any) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }

function match(cond: { path:string; op:string; value:any }, ctx: Ctx) {
	const left = get(ctx, cond.path);
	const right = cond.value;
	switch (cond.op) {
		case 'eq':       return String(left) === String(right);
		case 'neq':      return String(left) !== String(right);
		case 'in':       return toArr(right).map(String).includes(String(left));
		case 'not_in':   return !toArr(right).map(String).includes(String(left));
		case 'overlaps': {
			const A = new Set(toArr(left).map(String));
			return toArr(right).map(String).some((x:string)=>A.has(x));
		}
		default:         return false;
	}
}

export function policyMatches(policy: any, ctx: Ctx): boolean {
	const groups = ['subject','target','resource'] as const;
	return groups.every(g => (policy[g] ?? []).every((c:any)=>match(c, ctx)));
}

