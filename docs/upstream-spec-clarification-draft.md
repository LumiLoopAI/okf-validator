# Draft issue for GoogleCloudPlatform/open-knowledge-format

**Title:** Clarify §9: is YAML frontmatter permitted on `log.md`?

**Body:**

§9 (Log files) specifies the format of `log.md` as date-grouped entries and
states one normative requirement: date headings MUST use ISO 8601
`YYYY-MM-DD` form. The section's example shows a log file without
frontmatter, and §3 lists `log.md` as a reserved file (not a concept
document), but the spec text neither permits nor forbids a frontmatter
block on log files.

The reference bundles in this repository are inconsistent with a strict
reading: `bundles/acme_retail/log.md` (produced by the reference agent)
opens with a frontmatter block (`type: Log`, `title: …`), while the other
reference bundles' log files carry none.

Could §9 state explicitly whether:

1. a `log.md` MAY carry a frontmatter block (and if so, whether any keys
   are reserved for it — e.g. `type: Log`), or
2. reserved files other than the root `index.md` (§3) are required to be
   frontmatter-free?

Context: we maintain a conformance validator and currently treat log-file
frontmatter as an advisory finding rather than a conformance failure,
because the spec is silent. An explicit statement either way would let
validators converge instead of each choosing a dialect.
