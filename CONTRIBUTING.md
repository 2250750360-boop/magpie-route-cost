# Contributing

Issues and pull requests are welcome. Please keep the page read-only: it may read Magpie's gateway, CC Switch's SQLite database and Magpie's config, but it must never write to them.

## Develop

```sh
node serve.mjs --port 3495
node --test test/*.test.mjs
```

Open `http://127.0.0.1:3495/` in a browser for the page, or install the folder as a Magpie plugin with `magpie plugin add <path>`.

## Pull requests

- Keep the server on `127.0.0.1`.
- Do not add remote requests, telemetry or uploaded data.
- Add or update a test when changing pure logic (canonical model names, agent folding, aggregation).
- Update both the Chinese and English sections of `README.md` when behavior changes.

## Icons

Vendor icons are used only to identify providers. New icons must come from a redistributable source and be recorded in `NOTICE`.
