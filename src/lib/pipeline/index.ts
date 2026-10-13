// relight-pipeline — the on-device image pipeline (kept from the prior refactor).
// The app currently reads from these modules where needed; unused exports are
// left in place so the pipeline can be wired back in later without a rewrite.

// No barrels re-exported here: anything imported from this package must come from
// a specific sub-path so removals stay explicit.
