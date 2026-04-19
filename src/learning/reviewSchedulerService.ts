type Grade = "again" | "hard" | "good";

export type ReviewState = {
	repetition: number;
	intervalDays: number;
	easeFactor: number;
};

export type ReviewResult = ReviewState & {
	dueDate: Date;
};

function addDays(days: number): Date {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return d;
}

/**
 * Scheduler simple tipo SM-2-like para MVP.
 * again: reinicia
 * hard: avanza poco
 * good: avanza normal
 */
export function scheduleNextReview(state: ReviewState, grade: Grade): ReviewResult {
	let { repetition, intervalDays, easeFactor } = state;

	if (grade === "again") {
		repetition = 0;
		intervalDays = 1;
		easeFactor = Math.max(1.3, easeFactor - 0.2);
		return {
			repetition,
			intervalDays,
			easeFactor,
			dueDate: addDays(intervalDays),
		};
	}

	if (grade === "hard") {
		repetition += 1;
		intervalDays = repetition === 1 ? 2 : Math.max(2, Math.round(intervalDays * 1.2));
		easeFactor = Math.max(1.3, easeFactor - 0.05);
		return {
			repetition,
			intervalDays,
			easeFactor,
			dueDate: addDays(intervalDays),
		};
	}

	// good
	repetition += 1;

	if (repetition === 1) {
		intervalDays = 1;
	} else if (repetition === 2) {
		intervalDays = 3;
	} else {
		intervalDays = Math.max(4, Math.round(intervalDays * easeFactor));
	}

	easeFactor = Math.min(3.0, easeFactor + 0.03);

	return {
		repetition,
		intervalDays,
		easeFactor,
		dueDate: addDays(intervalDays),
	};
}
