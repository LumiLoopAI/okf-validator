# Design

The architecture brief this implementation is built against. Normative
inputs: `contract/okf-v0.2-core.json` (rules), the pinned canonical
`SPEC.md` revision it names (semantics), and
`contract/okf-validation-report.schema.json` (output shape).
`tests/fixtures/okf-v0.2/cases.json` is the acceptance oracle.

## Why library-first

The primary consumer (lumipad-api) validates immutable Git revisions with
seconds-scale latency, in-process, without materializing snapshot
directories. The CLI is a thin wrapper for CI and standalone users. This
inverts the predecessor's shape (Ruby CLI over a directory) and is the
reason the port exists.

## Module layout

```
src/
  provider.ts        FileProvider interface + DirectoryProvider + MemoryProvider
  frontmatter.ts     YAML frontmatter extraction (js-yaml), line-position aware
  bundle.ts          Bundle walk: enumerate docs, classify reserved files
  rules/
    types.ts         Rule module contract
    core.ts          OKF-0.2-C1, C2, C3-INDEX, C3-LOG
    boundary.ts      BOUNDARY-CONTRACT, BOUNDARY-VERSION
    advisory.ts      OKF-0.2-A-* advisory checks
  engine.ts          Load contract, select + run bundle or document rules, collect findings
  report.ts          Map engine result -> okf-validation-report.v1 JSON
  verify.ts          Input-tree manifest (sha256 per file) + comparison
  cli.ts             validate / manifest / verify commands, exit-code mapping
  index.ts           Public library surface
tests/
  harness.test.ts    Runs every case in cases.json against the library + CLI
  unit/*.test.ts     Focused unit tests per module
```

## FileProvider

```ts
interface FileProvider {
  /** Relative paths of every file in the bundle, POSIX separators, stable order. */
  list(): Promise<string[]>;
  /** Raw bytes; the validator decides UTF-8 validity itself (rule C1). */
  read(path: string): Promise<Uint8Array>;
}
```

- `DirectoryProvider(root)` — filesystem-backed, used by the CLI.
- `MemoryProvider(files: Map<string, Uint8Array | string>)` — used by the
  fixture harness (base bundle + per-case overlay operations) and by
  embedders validating single documents or git-blob-backed trees.
- Providers are read-only by construction. There is no write surface; the
  never-mutates boundary is structural, not disciplinary.

## Rule module contract

```ts
interface Rule {
  id: string;                          // e.g. 'OKF-0.2-C1'
  dimension: 'core' | 'boundary' | 'advisory';
  scope: 'document' | 'bundle';        // document rules may run per-file
  requirement?: string;                // resolved from contract or advisory declaration
  specSections?: readonly string[];    // canonical SPEC.md sections, when grounded
  check(ctx: RuleContext): Finding[];  // pure; no I/O beyond ctx
}
```

`scope` is declared, not inferred: the fast per-file lane in consumers runs
exactly the `document`-scoped rules and nothing else. Findings:

```ts
interface Finding {
  rule: string;
  severity: 'error' | 'warning' | 'advisory';
  path: string;                        // bundle-relative
  message: string;
  line?: number;                       // 1-based, when addressable
  requirement?: string;                // concise statement of the rule
  specSections?: readonly string[];    // canonical spec sections, when applicable
}
```

`rule`, `severity`, `path`, `message` map 1:1 onto the report schema's
required finding fields. When a finding has an addressable source line,
the optional 1-based `line` is also persisted in the v1 report. The optional
`requirement` and `specSections` are persisted when present: core and boundary
metadata is resolved from the selected contract by rule id, while advisory
metadata is declared with the advisory rule. A missing contract rule or a
check with no canonical spec basis leaves the corresponding field absent.

## Per-document fast lane

`validateDocument(options: ValidateDocumentOptions): Promise<DocumentValidationResult>`
loads the selected contract and exactly one requested Markdown path, filters
the selected rule set to `scope: 'document'`, and returns only
`{ path, findings }`. It never executes bundle-scoped rules and cannot produce
a bundle status or validation report; bundle conformance requires
`validateBundle`.

## Rule inventory (contract 2.3.0)

| Rule | Dimension | Scope | Substance |
| ---- | --------- | ----- | --------- |
| OKF-0.2-C1 | core | document | Non-reserved `.md` is UTF-8 with a parseable YAML frontmatter mapping |
| OKF-0.2-C2 | core | document | Frontmatter has non-empty string `type` |
| OKF-0.2-C3-INDEX | core | document | `index.md` reserved: no frontmatter except optional root `okf_version` |
| OKF-0.2-C3-LOG | core | document | `log.md` reserved: no frontmatter, newest-first ISO-date-grouped entries |
| BOUNDARY-CONTRACT | boundary | bundle | Selected contract matches declared expected version; no inference |
| BOUNDARY-VERSION | boundary | bundle | Declared `okf_version` (if any) matches the selected contract |
| BOUNDARY-IMMUTABLE | boundary | bundle | Input tree identical before/after (verify command) |
| OKF-0.2-A-LINK | advisory | bundle | Internal path/fragment resolvability |
| OKF-0.2-A-VERIFIED | advisory | document | Optional-field shape (incl. bare `verified` mapping as 1-element list) |
| OKF-0.2-A-SOURCE | advisory | bundle | Source identity uniqueness |
| OKF-0.2-A-PORTABLE | advisory | bundle | Portable bundle contents |

Permissive-consumption rules (`OKF-0.2-P-*`) are constraints on the
validator, not checks on the bundle: missing optional families, unknown
types, unknown keys, missing `index.md`, and broken links must NOT produce
core failures. They are enforced by the fixture suite, not by rule modules.
Advisory rule ids must match the oracle exactly (`present_rules` /
`absent_rules` assertions) — recover any id or message detail this table
lacks from the fixture expectations and, where needed, the Ruby
implementation at `lumipad-okf-validator@dfc381b` (reference only; never
copy its code, match its verdicts).

Timestamp semantics follow the pinned canonical revision: every
timestamp-valued frontmatter key (`stale_after`, `last_modified`,
`usage_window.{from,to}`, `generated.at`) is an ISO 8601 datetime with an
explicit UTC offset. Bare `YYYY-MM-DD` values are advisory field-shape
findings, not core failures. `log.md` date group headings remain plain ISO
dates per the spec.

## Determinism

Same declared inputs, same normalized output — byte-identical reports.
Findings sorted by (path, rule, line). No wall-clock, no locale, no
filesystem-order dependence (providers return stable order; the engine
sorts anyway). The report carries no timestamp; identity comes from the
validator version, contract path + sha256, and upstream pin.

## Unevaluable vs nonconformant

Exit `2` (unevaluable) covers: unknown/unreadable contract, contract vs
expected-version mismatch at invocation, unreadable bundle root, invalid
CLI invocation. Exit `1` (nonconformant) covers every evaluated finding of
dimension core or boundary that the contract marks as failing — including
a declared `okf_version` that contradicts the selected contract
(BOUNDARY-VERSION fixtures expect exit `1`). When in doubt, the fixture
suite decides.

## Fixture harness semantics

For each case in `cases.json`: materialize `base_fixture` into a
`MemoryProvider`, apply `operations` (`write`, `remove`) as overlay, run
the named `command`, assert `expect.exit`, `expect.status`, and
`present_rules` / `absent_rules` against the report findings. `verify`
cases build a manifest first, apply mutation operations, then verify. The
harness must run against the library API; a smoke subset additionally
exercises the built CLI end to end.

## Tech constraints

- Node ≥ 20, TypeScript strict, ESM, `tsc` build to `dist/`.
- Tests: `node:test` + `assert/strict` (house style), runnable via
  `npm test` after build (or tsx-free: compile then test against `dist/`).
- Runtime dependency: `js-yaml` only. No CLI framework — hand-rolled arg
  parsing keeps the facade auditable.
- Package: `@lumiloop/okf-validator`, `bin: okf-validator`.
