# Interop corpus provenance

The four bundles under this directory are the official Open Knowledge Format
reference bundles, vendored verbatim from the canonical specification
repository — the same revision the rule contract pins:

- Repository: https://github.com/GoogleCloudPlatform/open-knowledge-format.git
- Commit: ad30107c31c06aec8a7d5636e0d1058118604e6f
- Source path: bundles/
- License: Apache-2.0 (see repository LICENSE.md)
- Produced by: the repository's reference OKF agent (see its README)

They are an INTEROP CORPUS, not an oracle: the snapshot test records this
validator's verdict and findings for each bundle and fails only when a code
change alters those verdicts. Findings against these bundles (for example
non-markdown portability advisories, or pre-datetime-revision field shapes)
are information to record, never fixture bugs to fix. Update the snapshot
only with an explicit, reviewed justification.
