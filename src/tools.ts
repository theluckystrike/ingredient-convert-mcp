import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  COMMON_CONVERSIONS, INGREDIENTS, convertBulk, convertIngredient, decimalToFraction,
  findIngredient, parseFractionString, scaleRecipe,
} from './lib.js';

export const SERVER_NAME = 'ingredient-convert-mcp';
export const SERVER_VERSION = '1.0.1';

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// Same inference trap as the workspace servers: the SDK derives every handler type from the
// Zod shape, and with six tools tsc pays an exponential cost. One alias keeps runtime
// validation identical and takes the inference out of the hot path.
type Registrar = (name: string, cfg: unknown, handler: (...args: any[]) => any) => unknown;

type Out = { summary: string } & Record<string, unknown>;
function wrap(fn: (a: any) => Out) {
  return async (a: any) => {
    try {
      const out = fn(a);
      return { content: [{ type: 'text' as const, text: `${out.summary}\n\n${JSON.stringify(out, null, 2)}` }], structuredContent: out };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: (e as Error).message }], isError: true };
    }
  };
}

const unitSchema = z.string().min(1).max(20)
  .describe('Unit: cups, tablespoons (tbsp), teaspoons (tsp), milliliters (ml), fluid ounces (floz), grams (g), ounces (oz)');

export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const regTool = server.registerTool.bind(server) as unknown as Registrar;

  regTool('convert_ingredient', {
    description: 'Convert a cooking ingredient amount between cups, tablespoons, teaspoons, milliliters, fluid ounces, grams and ounces using a per-ingredient density table (e.g. 1 cup flour = 125 g).',
    inputSchema: {
      ingredient: z.string().min(1).max(60).describe("Ingredient name, e.g. 'all-purpose flour', 'butter', 'honey'"),
      amount: z.number().finite().describe('Amount to convert from'),
      unit: unitSchema,
    },
    annotations: RO,
  }, wrap((a) => {
    const r = convertIngredient(a.ingredient, a.amount, a.unit);
    const byUnit = Object.fromEntries(r.results.map((x) => [x.unit, x.amount]));
    return { ...r, summary: `${a.amount} ${a.unit} of ${r.ingredient} = ${byUnit['grams']} g (${byUnit['cups']} cups, ${byUnit['tablespoons']} tbsp).` } as Out;
  }));

  regTool('list_ingredients', {
    description: 'List the full ingredient density table (grams per US cup) with sources and aliases.',
    inputSchema: {},
    annotations: RO,
  }, wrap(() => {
    const table = INGREDIENTS.map((i) => ({ name: i.name, aliases: i.aliases, grams_per_cup: i.gramsPerCup, category: i.category, source: i.source }));
    return { count: table.length, ingredients: table, summary: `${table.length} ingredients in the density table; call convert_ingredient with any name or alias.` };
  }));

  regTool('scale_recipe', {
    description: 'Scale recipe ingredient amounts by a factor (double, halve, 1.5x...). Output in friendly fractions like 1 1/2 cups. Any unit can be scaled (cups, tbsp, grams, cloves, cans); a line without a unit is a count, e.g. 2 eggs.',
    inputSchema: {
      items: z.array(z.object({
        ingredient: z.string().min(1).max(60),
        amount: z.union([z.number().finite(), z.string().min(1).max(20)]).describe("Number or fraction string like '1 1/2'"),
        unit: z.string().min(1).max(20).optional().describe("Unit as written, e.g. 'cups', 'tbsp', 'g', 'cloves'. Omit for a count such as 2 eggs."),
      })).min(1).max(50).describe('Recipe lines to scale'),
      factor: z.number().finite().positive().describe('Scale factor, e.g. 2 to double, 0.5 to halve'),
    },
    annotations: RO,
  }, wrap((a) => {
    const r = scaleRecipe(a.items, a.factor);
    const line = r.items.map((i) => `${i.original}${i.unit ? ` ${i.ingredient}` : ''} -> ${i.scaled}`).join('; ');
    return { ...r, summary: `Scaled by ${a.factor}x: ${line.slice(0, 200)}${line.length > 200 ? '...' : ''}` } as Out;
  }));

  regTool('convert_bulk', {
    description: 'Convert many ingredient amounts at once (grams to cups, cups to grams, etc.). Unknown ingredients are reported per item instead of failing the batch.',
    inputSchema: {
      items: z.array(z.object({
        ingredient: z.string().min(1).max(60),
        amount: z.number().finite(),
        unit: z.string().min(1).max(20),
      })).min(1).max(100).describe('Each entry: ingredient, amount, unit'),
    },
    annotations: RO,
  }, wrap((a) => {
    const r = convertBulk(a.items);
    const failed = r.filter((x) => x.error).length;
    return { results: r, failures: failed, summary: `Bulk conversion: ${r.length - failed}/${r.length} converted${failed ? `, ${failed} failed (see results[].error)` : ''}.` };
  }));

  regTool('decimal_to_fraction', {
    description: 'Convert a decimal amount to a friendly cooking fraction (e.g. 0.5 -> 1/2, 1.75 -> 1 3/4) with a denominator cap.',
    inputSchema: {
      value: z.number().finite(),
      max_denominator: z.number().int().min(1).max(64).optional().describe('Largest denominator allowed (default 8)'),
    },
    annotations: RO,
  }, wrap((a) => {
    const r = decimalToFraction(a.value, a.max_denominator ?? 8);
    return { ...r, summary: `${a.value} = ${r.text}` } as Out;
  }));

  regTool('fraction_to_decimal', {
    description: "Convert a fraction string used in recipes ('1/2', '1 1/2', '3/4') or a plain number into a decimal amount.",
    inputSchema: {
      value: z.string().min(1).max(20).describe("Fraction string like '1/2' or '1 1/2', or a plain number"),
    },
    annotations: RO,
  }, wrap((a) => {
    const n = parseFractionString(a.value);
    return { value: a.value, decimal: n, summary: `${a.value} = ${n}` };
  }));

  regTool('common_conversions', {
    description: 'Free lookup of the most-googled cooking conversions (1 cup flour in grams, 1 tbsp butter in grams, cup to tablespoons...).',
    inputSchema: {},
    annotations: RO,
  }, wrap(() => {
    const q = COMMON_CONVERSIONS.map((c) => `${c.conversion} = ${c.value}`).join('; ');
    return { count: COMMON_CONVERSIONS.length, conversions: COMMON_CONVERSIONS, summary: `${COMMON_CONVERSIONS.length} common conversions: ${q.slice(0, 180)}...` };
  }));

  // Fail fast if the density table has an inconsistency.
  for (const i of INGREDIENTS) findIngredient(i.name);

  return server;
}
