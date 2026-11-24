/** Lines that credit an agent: a trailer, or a line that opens with "Generated with". Quoting the phrase mid-sentence is fine. */
export const ATTRIBUTION = /^(co-authored-by|claude-session):|^\W*generated with\b/im;
