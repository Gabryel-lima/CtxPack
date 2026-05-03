# Polyglot semantic fixtures

This directory contains small, intentionally simple files used to validate semantic extraction across multiple languages.

Current fixture coverage: Python, JavaScript, TypeScript, Rust, Go, Java, Kotlin, C++, Shell, PHP, Ruby, C#, Swift, Dart, and Lua.

The files are fixtures for `ctxpack.py`, not a buildable application. Some files reference neighbors only to exercise relation detection and semantic summarization.

Recommended validation command from the repository root:

```bash
python3 tests/run_smoke.py
```

If you only want to regenerate the semantic fixture output, run:

Run from the repository root:

```bash
python3 ctxpack.py tests/prototypes --semantic-only --no-output tests/prototypes/prototypes.sem.ctx.md
```