export function auditContinuityInput(input) {
  const failures = [];
  const context = input?.continuityContext || {};
  const mode = context.mode;
  const recentDrafts = Array.isArray(input?.recentDrafts) ? input.recentDrafts : [];
  if (!Array.isArray(input?.recentDrafts)) failures.push({ code: "INVALID_RECENT_DRAFTS" });
  if (recentDrafts.length > 5) failures.push({ code: "RECENT_DRAFT_LIMIT_EXCEEDED", actual: recentDrafts.length, maximum: 5 });
  if (new Set(recentDrafts).size !== recentDrafts.length) failures.push({ code: "DUPLICATE_RECENT_DRAFT" });

  if (mode === "STANDALONE_CALIBRATION") {
    if (input?.phase !== "CALIBRATION") failures.push({ code: "STANDALONE_CONTINUITY_ONLY_CALIBRATION", actual: input?.phase || null });
    if (recentDrafts.length) failures.push({ code: "STANDALONE_RECENT_DRAFTS_FORBIDDEN" });
  } else if (mode === "FIRST_CHAPTER") {
    if (Number(input?.chapterOrdinal) !== 1) failures.push({ code: "FIRST_CHAPTER_ORDINAL_MISMATCH", actual: input?.chapterOrdinal ?? null });
    if (recentDrafts.length) failures.push({ code: "FIRST_CHAPTER_RECENT_DRAFTS_FORBIDDEN" });
  } else if (mode === "SERIAL") {
    const ordinal = Number(input?.chapterOrdinal);
    const previousOrdinal = Number(context.previousChapterOrdinal);
    if (!Number.isInteger(ordinal) || ordinal < 2) failures.push({ code: "INVALID_SERIAL_CHAPTER_ORDINAL", actual: input?.chapterOrdinal ?? null });
    if (!Number.isInteger(previousOrdinal) || previousOrdinal !== ordinal - 1) failures.push({ code: "PREVIOUS_CHAPTER_ORDINAL_MISMATCH", expected: Number.isInteger(ordinal) ? ordinal - 1 : null, actual: context.previousChapterOrdinal ?? null });
    if (typeof context.previousChapterId !== "string" || !context.previousChapterId.trim() || context.previousChapterId === input?.chapterId) failures.push({ code: "INVALID_PREVIOUS_CHAPTER_ID", actual: context.previousChapterId ?? null });
    if (typeof context.previousDraft !== "string" || !context.previousDraft.trim() || !recentDrafts.length) failures.push({ code: "SERIAL_PREVIOUS_DRAFT_REQUIRED" });
    else if (recentDrafts[0] !== context.previousDraft) failures.push({ code: "ADJACENT_DRAFT_ORDER_MISMATCH", expected: context.previousDraft, actual: recentDrafts[0] });
  } else {
    failures.push({ code: "INVALID_CONTINUITY_MODE", actual: mode ?? null });
  }

  return { mode: mode || null, chapterOrdinal: input?.chapterOrdinal ?? null, recentDraftCount: recentDrafts.length, failures };
}
