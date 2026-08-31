# Secret scanning

Vorton scans its complete Git history with Gitleaks 8.30.1. Local and CI scans must use that exact version so detector rules and finding fingerprints do not drift silently.

The release workflow scans before dependency installation and does not persist checkout credentials. Dependency code therefore cannot run before the history gate or inherit the release job's repository credential.

The reviewed ignore file contains 38 exact finding fingerprints. It contains no secret values and grants no path, commit, or rule-wide exemption. Thirty-five findings are deterministic auth-user UUID identifiers used by tests and hostile authority fixtures. Three findings are TypeScript arithmetic expressions involving authentication time. Those three lines contain no string literal, assignment, token, or credential.

No reviewed finding contains credential material, so this review requires neither credential rotation nor a history rewrite. New findings fail the scan. Moving or changing a reviewed line creates a new fingerprint and requires a new value-blind review before it can be ignored.

Never disable the `generic-api-key` rule, allowlist an entire test path, or use the current ignore file as evidence that another scanner version passed. The ignore file answers only the 38 exact findings produced by Gitleaks 8.30.1.
