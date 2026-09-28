# Companion bundle

The canonical map of the SMF OpenClaw companions is maintained in the vision repo:

[smfworks/smf-openclaw-vision `docs/companion-bundle.md`](https://github.com/smfworks/smf-openclaw-vision/blob/main/docs/companion-bundle.md)

This file only points there. Install steps stay in each repository’s README.

**OpenClaw is not an SMF Works product.** Install the gateway from upstream: [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) and [openclaw.ai](https://openclaw.ai). Docs: [docs.openclaw.ai](https://docs.openclaw.ai). [github.com/smfworks/openclaw](https://github.com/smfworks/openclaw) is an SMF fork/mirror. It is not the canonical source.

SMF authors three companions only:

| Piece | Repository | Purpose |
|-------|------------|---------|
| Skills | [smfworks/smfworks-skills](https://github.com/smfworks/smfworks-skills) | Free OpenClaw skills pack for everyday file, document, and system tasks. |
| Memory | [smfworks/mnemosyne-openclaw](https://github.com/smfworks/mnemosyne-openclaw) (this repo) | Offline SQLite memory plugin for the OpenClaw gateway. |
| Vision | [smfworks/smf-openclaw-vision](https://github.com/smfworks/smf-openclaw-vision) | Community guide for iPhone vision over Tailscale. |

**Suggested order:** upstream OpenClaw → optional skills → memory (this repo) → optional vision.

The skills pack and the vision guide are optional. Mnemosyne still needs a working OpenClaw gateway from upstream. The install path in this repo is unchanged: clone, `npm install`, `npm run build`, `openclaw plugin load`, then enable the `mnemosyne` memory slot.
