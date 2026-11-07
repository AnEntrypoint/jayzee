# Use the Spawn engine

Start at https://www.spawn.co/llms.txt for account access and the supported HTTP API.
Keep your Spawn token in SPAWN_TOKEN. Send it as a Bearer token on API requests.

For an existing world, GET /api/sdk/v1/<worldId>/agent/docs with your token.
Read guide for the world format, examples, editing tools, and asset uploads.
Read the API reference by section: ?section=<heading> answers one section in tomeApi, and sections lists every heading.

A 6.0 world is a git repository. Use the world's clone URL, then read AGENTS.md.
The engine reference is api-reference.md in the repo named by .spawn/engine.yaml.
Edit the world's files and push to main. Read the push result and resolve any reported errors.
For an older world, follow the document API described by its docs response.

Use the field names, units, hook arguments, and import names in the engine reference.
Use the installed Spawn client's --help for play controls, game code execution, and screenshots.
Check the edited game with those tools and its script logs.

Use the supported game API. A game does not import or inspect the engine implementation.
