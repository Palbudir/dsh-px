# DSH-PX development

DSH-PX is a Windows local Agent product built on native DSH plugins. Read README.md, docs/ROADMAP.md and docs/PLUGINS.md before changing product boundaries.

- Work on a branch. Keep implementation, verification and release preparation reviewable. Do not publish a version before the current commit passes quality checks and independent review.
- Reuse DSH execution, permissions, sessions, jobs, storage and plugin contracts. Validate against the pinned runtime types and real behavior.
- Protect existing workspaces, credentials, conversations and third-party configuration. Use isolated data directories for tests and failure injection.
- Give concurrent reviewers and test runs separate temporary paths; preserve another run's evidence.
- Resolve confirmed P0/P1/P2 defects before release. A passed test suite is evidence for its cases, not proof that untested behavior works. Report coverage limits explicitly.
- Reviewers must be independent of the change they approve. Results must identify the exact commit and scope. New commits invalidate earlier commit-specific approval.
- Keep public documents focused on usage, current contracts and maintenance. Do not commit conversation transcripts, personal machine paths, QA session data, credentials or development diaries.
- Keep historical release tags and assets intact. Source, manifest, runtime binaries and plugin artifacts must describe the same release.
- Run the quality commands in CONTRIBUTING.md. Rebuild tracked plugin artifacts after source changes. Test Electron and browser surfaces separately.
