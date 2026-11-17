# ingredient-convert-mcp

Cooking ingredient unit converter MCP server. Converts between cups, tablespoons, teaspoons,
millilitres, fluid ounces, grams and ounces using a per-ingredient density table
(1 cup all-purpose flour = 125 g, 1 cup water = 236.588 g, 1 cup honey = 340 g), and scales recipes.

Tools: `convert_ingredient`, `list_ingredients`, `scale_recipe`, `convert_bulk`,
`decimal_to_fraction`, `fraction_to_decimal`, `common_conversions`.

## Connect

Hosted endpoint (Streamable HTTP, no token, no sign-up):

```
https://ingredient-convert-mcp.lipmichal.workers.dev/mcp
```

Paste it into any MCP client that accepts a remote server URL (a custom connector, ChatGPT developer mode), or:

```
claude mcp add --transport http ingredient-convert https://ingredient-convert-mcp.lipmichal.workers.dev/mcp
```

Local stdio from this repository:

```
npm ci && npm run build
node dist/stdio.js
```

## Notes

- Deterministic: no network calls, no clock, no randomness. The hosted Worker makes no upstream request.
- Densities are US customary reference values (King Arthur Baking ingredient weight chart, USDA FoodData Central where available). Volume measures assume level, unpacked cups.
- The hosted Worker accepts a well-formed `mcp-protocol-version` newer than its SDK knows (for example `2026-07-28`) and serves it as the SDK's latest version; malformed values are still refused with 400.
- Web calculator: https://ingredientcalculator.com

## License

MIT
