/** Curated Verse of the Day refs — date-stable index into this list. */
export type VotdRef = {
	bookId: string;
	chapter: number;
	from: number;
	to: number;
	label: string;
};

export const VOTD_REFS: VotdRef[] = [
	{ bookId: "PSA", chapter: 23, from: 1, to: 3, label: "Psalm 23:1–3" },
	{ bookId: "JHN", chapter: 3, from: 16, to: 16, label: "John 3:16" },
	{ bookId: "PHP", chapter: 4, from: 6, to: 7, label: "Philippians 4:6–7" },
	{ bookId: "ROM", chapter: 8, from: 28, to: 28, label: "Romans 8:28" },
	{ bookId: "ISA", chapter: 40, from: 31, to: 31, label: "Isaiah 40:31" },
	{ bookId: "PRO", chapter: 3, from: 5, to: 6, label: "Proverbs 3:5–6" },
	{ bookId: "JER", chapter: 29, from: 11, to: 11, label: "Jeremiah 29:11" },
	{ bookId: "MAT", chapter: 11, from: 28, to: 30, label: "Matthew 11:28–30" },
	{ bookId: "JOS", chapter: 1, from: 9, to: 9, label: "Joshua 1:9" },
	{ bookId: "PSA", chapter: 46, from: 1, to: 2, label: "Psalm 46:1–2" },
	{ bookId: "2CO", chapter: 12, from: 9, to: 9, label: "2 Corinthians 12:9" },
	{ bookId: "HEB", chapter: 11, from: 1, to: 1, label: "Hebrews 11:1" },
	{ bookId: "GAL", chapter: 5, from: 22, to: 23, label: "Galatians 5:22–23" },
	{ bookId: "EPH", chapter: 2, from: 8, to: 9, label: "Ephesians 2:8–9" },
	{ bookId: "MIC", chapter: 6, from: 8, to: 8, label: "Micah 6:8" },
	{ bookId: "PSA", chapter: 119, from: 105, to: 105, label: "Psalm 119:105" },
	{ bookId: "MAT", chapter: 6, from: 33, to: 33, label: "Matthew 6:33" },
	{ bookId: "ROM", chapter: 12, from: 2, to: 2, label: "Romans 12:2" },
	{ bookId: "1CO", chapter: 13, from: 4, to: 7, label: "1 Corinthians 13:4–7" },
	{ bookId: "COL", chapter: 3, from: 23, to: 23, label: "Colossians 3:23" },
	{
		bookId: "1TH",
		chapter: 5,
		from: 16,
		to: 18,
		label: "1 Thessalonians 5:16–18",
	},
	{ bookId: "JAS", chapter: 1, from: 5, to: 5, label: "James 1:5" },
	{ bookId: "1PE", chapter: 5, from: 7, to: 7, label: "1 Peter 5:7" },
	{ bookId: "1JN", chapter: 4, from: 7, to: 8, label: "1 John 4:7–8" },
	{ bookId: "REV", chapter: 21, from: 4, to: 4, label: "Revelation 21:4" },
	{ bookId: "GEN", chapter: 1, from: 1, to: 1, label: "Genesis 1:1" },
	{ bookId: "DEU", chapter: 6, from: 4, to: 5, label: "Deuteronomy 6:4–5" },
	{ bookId: "PSA", chapter: 27, from: 1, to: 1, label: "Psalm 27:1" },
	{ bookId: "PSA", chapter: 121, from: 1, to: 2, label: "Psalm 121:1–2" },
	{ bookId: "ISA", chapter: 41, from: 10, to: 10, label: "Isaiah 41:10" },
	{
		bookId: "LAM",
		chapter: 3,
		from: 22,
		to: 23,
		label: "Lamentations 3:22–23",
	},
	{ bookId: "JHN", chapter: 14, from: 6, to: 6, label: "John 14:6" },
	{ bookId: "JHN", chapter: 15, from: 5, to: 5, label: "John 15:5" },
	{ bookId: "ACT", chapter: 1, from: 8, to: 8, label: "Acts 1:8" },
	{ bookId: "ROM", chapter: 5, from: 8, to: 8, label: "Romans 5:8" },
	{ bookId: "PHP", chapter: 4, from: 13, to: 13, label: "Philippians 4:13" },
	{ bookId: "2TI", chapter: 3, from: 16, to: 17, label: "2 Timothy 3:16–17" },
	{ bookId: "HEB", chapter: 13, from: 8, to: 8, label: "Hebrews 13:8" },
	{ bookId: "JAS", chapter: 1, from: 17, to: 17, label: "James 1:17" },
	{ bookId: "JUD", chapter: 1, from: 24, to: 25, label: "Jude 24–25" },
];

/** Local calendar day-of-year (0-based) for stable daily pick. */
export function dayOfYear(date = new Date()): number {
	const start = new Date(date.getFullYear(), 0, 0);
	return Math.floor((date.getTime() - start.getTime()) / 86_400_000);
}

export function pickTodayVotd(date = new Date()): VotdRef {
	return VOTD_REFS[dayOfYear(date) % VOTD_REFS.length]!;
}
