# Dictation engine

The program behind referat's dictation: hold a key, speak, and the text is
typed where the cursor is. It also transcribes meeting audio with the same
model. referat starts it as `viska-engine.exe` and talks to it with one JSON
object per line on stdin and stdout; the protocol is in
[PROTOCOL.md](PROTOCOL.md) and referat's side in `src/main/dictation.ts`.

The code came from the standalone Viska app (commit `a135795`), keeping only
what the engine uses. The Python package is still named `viska`.

```bash
uv sync --group dev
uv run pytest
uv run python build.py          # dist/viska-engine/viska-engine.exe
```

`scripts/build-local-ai-components.ps1 -Component dictation-cpu` (or
`dictation-gpu`) builds and packages the component for a release. To try a
locally built engine in referat, set `REFERAT_DICTATION_ENGINE` to the path of
`viska-engine.exe`.
