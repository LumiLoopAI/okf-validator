# OKF Validator

A deterministic, library-first TypeScript conformance validator for the
[Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/open-knowledge-format)
— for LumiPad Knowledge Projects and any other OKF producer or consumer.

- **Rule contract:** `contract/okf-v0.2-core.json` (`2.3.0`), pinned to the
  exact canonical spec revision it implements
  (`open-knowledge-format@ad30107c`, `SPEC.md`, sha256-verified)
- **Report schema:** `contract/okf-validation-report.schema.json`
  (`okf-validation-report.v1`)
- **Consumer surfaces:** the `@lumiloop/okf-validator` library API and the
  `okf-validator` CLI. Nothing under `src/` internals is a contract.

## Doctrine

**OKF is the contract. A tool is an implementation of that contract.**
No producer, validator, editor, catalog, or viewer defines OKF by its
behavior. When an implementation disagrees with the declared OKF version,
that is a compatibility finding — never a reason to rewrite the input or
silently adopt the tool's dialect as the standard.

Three boundaries this validator never crosses:

1. **It diagnoses; it never mutates.** Validation reads the bundle and
   produces findings. It does not rewrite content to manufacture a pass,
   and it never writes inside the bundle it evaluates.
2. **Versions are explicit or the run is unevaluable.** The caller supplies
   the expected OKF version and the exact rule contract. A missing,
   unsupported, or inconsistent boundary is `unevaluable` — never an
   implicit fallback to whatever happens to be present.
3. **Conformance is not truth.** Core-conformant, profile-conformant,
   accepted-by-a-consumer, faithful, useful, and safe are different claims.
   Passing one never implies another. Authorization, editorial acceptance,
   and publication policy belong to the systems that own them.

## Outcomes

| Exit | Status | Meaning |
| ---- | ------ | ------- |
| `0` | `pass` | Evaluated and conformant |
| `1` | `fail` | Evaluated and nonconformant |
| `2` | — | Invalid invocation or unevaluable boundary |

The distinction between `1` (the bundle is nonconformant) and `2` (the run
could not evaluate) is load-bearing. Consumers must preserve it.

## Usage

```ts
import { validateBundle, DirectoryProvider } from '@lumiloop/okf-validator';

const result = await validateBundle({
  provider: new DirectoryProvider('/path/to/bundle'),
  contractPath: 'contract/okf-v0.2-core.json',
  expectedVersion: '0.2',
});
```

For latency-sensitive per-file checks, `validateDocument` evaluates only
document-scoped rules and deliberately returns no bundle status or report:

```ts
import { validateDocument, MemoryProvider } from '@lumiloop/okf-validator';

const result = await validateDocument({
  provider: new MemoryProvider(new Map([['concept.md', source]])),
  path: 'concept.md',
  contractPath: 'contract/okf-v0.2-core.json',
  expectedVersion: '0.2',
});
// { path: 'concept.md', findings: [...] }
```

```sh
okf-validator validate \
  --bundle path/to/bundle \
  --contract contract/okf-v0.2-core.json \
  --expected-version 0.2 \
  --output validation.json
```

Findings identify the rule, severity, path, message, an optional 1-based line,
and, when available, the rule's `requirement` and canonical `specSections`;
the JSON report conforms to `okf-validation-report.v1`.

## Provenance

This implementation succeeds the Ruby validator at
`LumiLoopAI/lumipad-okf-validator` release `v1.2.1`
(`dfc381b23c6dceb6b8d037adcb239a4839e31355`). The rule contract, report
schema, and the conformance fixture suite under `tests/fixtures/` were
imported verbatim from that qualified release and are the acceptance
oracle: this implementation must produce the same verdicts on the same
fixtures. Subsequent contract revisions re-pinned the deprecated
`knowledge-catalog` snapshot to the canonical `open-knowledge-format`
repository, aligned log-frontmatter treatment with §9, and added explanatory
finding metadata without changing the oracle verdicts.

## License

Apache-2.0.
