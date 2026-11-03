# Grocery list reads like a real grocery list

## What changed
- **Parser** moved to `src/lib/ingredient-parse.ts` (shared by URL import, Discover feed, shopping list, scripts). Fixes: ranges (`1 or 2`, `1 to 2`, `2-3`), hyphen mixed numbers (`2-1/4`, `1 -3/4`), `(15-ounce) cans`, `ribs`/`packets` units, second measures (`1 cup plus 1 tablespoon`, `2/3 cup / 2½ ounces`), spaced decimals (`1 .5`). Discover feed now uses the same parser instead of its own loose regex.
- **Buyable items** (`src/lib/grocery.ts`): a deterministic table turns recipe measures into store items. Produce by count (cups converted, citrus juice by tablespoons), garlic by head, herbs/celery/green onions by bunch, dairy and pantry items as name only, store units (lb, oz, can, packet) kept. Alternates pick one item, multi-item lines split, prep notes dropped, water always skipped. Stored ingredients are re-parsed first, so stale data comes out right.
- **Add Essentials** (list, plan, recipe screens) uses one shared staple list. The same item from several recipes now lands as one row with every recipe name (heads and bunches take the max, counts sum, display pluralizes).
- **Organize** first rewrites recipe items on the list into buyable form and re-aisles them, then classifies and consolidates. The AI smart-list prompt asks for store forms too.
- **Aisles**: celery measured in ribs/stalks is Produce; broth/stock is Pantry; black pepper and chilli powder/flakes are Pantry; pasta shapes and chile crisp are Pantry.
- **Stale data**: `scripts/reparse-ingredients.ts` (dry run by default) re-parses saved recipes. `scripts/tidy-shopping-list.ts` tidies a saved list. `.github/workflows/demo-data.yml` runs both against the demo namespace only.

## Before / after (from Add Essentials)
| Before | After |
|---|---|
| 6 g Arlic cloves | 1 head garlic |
| 1 or 2 sprigs parsley or cilantro (shown without the 1) | 1 bunch parsley |
| 2 -1/4 teaspoons fresh basil | 1 bunch basil |
| 1 -3/4 cups water | (skipped) |
| 1 Carrot, and / 1 Yellow | 1 carrot, 1 yellow onion |
| Chile crisp, lemon wedges | chile crisp, 1 lemon |
| 1/2 cup Onion | 1 onion |
| 1 Egg / 2 large eggs | eggs |
| 1/4 cup tahini | tahini |
| Ribs celery (Meat & Seafood) | 1 bunch celery (Produce) |
| chicken broth (Meat & Seafood) | chicken broth (Pantry) |

"6 g Arlic" and "1" + "or 2 sprigs" were stale stored data: today's parser already read `6 garlic cloves` correctly. The range and hyphen-fraction bugs were real and are fixed. "1 Yellow" as a lone stored item can't be recovered without its source line.

## Tested
- `bun test`: 220 pass, 0 fail (new: `tests/ingredient-parse.test.ts`, `tests/grocery.test.ts`).
- `npx tsc --noEmit`: clean. `bun run build`: ok.
- Ran the demo's live seeded list (102 items, fetched read-only) through the conversion: 72 display rows, every example above converts as listed.
- Not driven end to end in a browser.

## Data fixed (2026-11-02, with Ryan's OK)
- Personal book: `reparse-ingredients --apply` updated 92 ingredient lines in 52 recipes (garlic/large/green splits, "cup s", ranges, "1 .5"). A follow-up dry run shows 0 changes.
- Demo: recipes re-parsed the same way; seeded shopping list tidied with `--drop-staples` (102 items -> 69).
- Follow-ups in rsmedstad/whisk#153: recipe text keeps "plus 2 tablespoons" and package sizes; serving scaling handles "1-2" and "1 ½".

## Left
- The GitHub `CLOUDFLARE_API_TOKEN` gets 401 on KV, so the "Refresh demo data" workflow can't run until that token gets Workers KV Storage: Edit. Local scripts work with `npx wrangler login`.
- `scripts/local-scrape.ts` still has its own older parser.
