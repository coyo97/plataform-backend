// src/moderation/text/htmlToPlainText.ts

export function htmlToPlainText(input: string | null | undefined): string {
	if (!input) return '';

	// Quitamos estilos y scripts por si acaso
	const withoutStyle = input
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<script[\s\S]*?<\/script>/gi, '');

	// Quitamos todas las etiquetas HTML
	const withoutTags = withoutStyle.replace(/<[^>]+>/g, ' ');

	// Normalizamos espacios
	return withoutTags.replace(/\s+/g, ' ').trim();
}

