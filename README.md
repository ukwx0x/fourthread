# fourthread

**Your local AI team — 4 specialized agents, one shared memory, zero cloud.**

fourthread is a local-first, self-hostable multi-agent assistant that runs four
specialized bots (1 Chief of Staff + 3 specialists) in a single shared
conversation thread per workspace. Each bot's model is independently
configurable against any OpenAI-compatible endpoint (including local Ollama),
and all context, memory, and session state persist in plain files (SQLite +
per-directory `MEMORY.md` and per-bot `.fourthread/memory/<bot-id>.md`) so that
model swaps, process restarts, and directory changes lose nothing.

No accounts. No telemetry. No cloud dependency. Just a binary you run.

## Install

```bash
npm install -g fourthread
```

## Quickstart

```bash
# 1. Create config (edit endpoints/models as needed)
fourthread init   # writes ./fourthread.yaml with 4 bot configs

# 2. Run
fourthread        # starts REPL in current directory

# 3. Work
> plan a REST API for a todo app
# Chief → SpecialistA → SpecialistB → SpecialistC → Chief(summary)

# 4. Memory persists automatically
# ./MEMORY.md updated; SQLite thread saved to .fourthread/thread.sqlite
```

## Config Example (`fourthread.yaml`)

```yaml
bots:
  chief:
    endpoint: "http://localhost:11434/v1"
    model: "llama3.1:70b"
    temperature: 0.3
    maxTokens: 2048
  specialist_a:
    endpoint: "http://localhost:11434/v1"
    model: "codellama:34b"
    temperature: 0.2
    maxTokens: 2048
  specialist_b:
    endpoint: "https://api.openai.com/v1"
    model: "gpt-4o"
    temperature: 0.4
    maxTokens: 2048
  specialist_c:
    endpoint: "http://localhost:11434/v1"
    model: "qwen2.5-coder:32b"
    temperature: 0.1
    maxTokens: 2048

safety:
  allow_network_tools: true
  require_approval_for: [shell, file_delete]
  max_turn_tokens: 8192
```

## How it works

- Every user message is processed by **Chief → the 3 specialists (in order) →
  Chief summary**; each response is appended to the shared SQLite thread
  (`checkpoint_v1.json` schema) immediately, so Ctrl+C loses nothing.
- `MEMORY.md` in the working directory is shared by all bots;
  `.fourthread/memory/<bot-id>.md` is loaded into that bot's prompt only.
- Swap any bot's `model` in `fourthread.yaml` and restart — memory and thread
  come from disk, not the model.

## Development

```bash
npm install
npm test          # vitest, fully offline (adapters are mocked)
npm run demo      # scripted offline demo of the vertical slice
npm start         # REPL (needs fourthread.yaml + a live endpoint)
```

## License

Apache-2.0 — see [LICENSE](LICENSE).
