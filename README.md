# The Necro-Oracle

> *The cards read your code. The necromancer brings it back to life.*

A retro CRT terminal that performs **tarot readings on GitHub repositories**: every card drawn is a real, evidence-backed diagnosis of the codebase (upright = active problem, reversed = latent risk). Then a coven of AI agents **resurrects** legacy code (Python 2 -> 3 and more), running machine-checked verification gates before delivering results.

Built with [Kiro](https://kiro.dev) for **Kiroween 2026** -- *Frankenstein* category.

## Docs
- [Design](docs/DESIGN.md)
- [Compliance checklist](docs/COMPLIANCE.md)
- [Spec prompts](docs/KIRO_SPEC_PROMPT.md)
- [How Kiro was used](docs/KIRO_USAGE.md)
- [Disclosures](docs/DISCLOSURES.md)

## Kiro setup
Steering lives in [`.kiro/steering`](.kiro/steering); MCP config in `.kiro/settings/mcp.json` (secrets via env vars, e.g. `GITHUB_PAT`).

## Roadmap
- **Sandbox differential testing** (property-based tests run inside the E2B sandbox against the resurrected code) -- planned for L1 Flesh.
- **Pull requests to forks** (the necromancer opens a real PR against a fork of the target repo) -- planned for L1 Flesh.

## License
[MIT](LICENSE). Tarot card art: Rider-Waite-Smith deck illustrated by Pamela Colman Smith (1909), public domain.
