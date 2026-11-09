# Security

This plugin is a local page service. It listens on `127.0.0.1` only and guards its APIs with a random token kept at `~/.cache/magpie/route-cost/token` (0600).

It reads, but never writes:

- Magpie's gateway usage API and `/v1/models`
- `~/.config/magpie/providers.json` and `settings.json`
- `~/.cc-switch/cc-switch.db` (opened readonly)

No data is uploaded. To report a vulnerability, open a private security advisory on GitHub or contact the maintainer through the repository.
