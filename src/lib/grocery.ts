/**
 * Turn recipe ingredients into grocery-list items: "1/2 cup diced onion" -> 1 onion,
 * "6 garlic cloves, minced" -> 1 head garlic, "2 large eggs" -> eggs.
 * Pure and deterministic; the AI smart list can refine on top.
 */
import { parseIngredientLine } from "./ingredient-parse";

export interface IngredientInput {
  name: string;
  amount?: string;
  unit?: string;
}

export interface BuyableItem {
  name: string;
  amount?: string;
  unit?: string;
}

// ── Pantry staples (skipped by "Add Essentials") ───────────

const PANTRY_STAPLES = new Set([
  // Salt & pepper
  "salt", "pepper", "black pepper", "kosher salt", "sea salt", "table salt",
  "salt & pepper", "salt and pepper", "ground black pepper", "ground pepper",
  "coarse salt", "flaky salt", "finishing salt", "black peppercorns", "peppercorns",
  // Oils & sprays
  "olive oil", "vegetable oil", "canola oil", "extra virgin olive oil", "extra-virgin olive oil",
  "cooking spray", "nonstick spray", "nonstick cooking spray", "oil", "neutral oil",
  "sesame oil", "avocado oil", "coconut oil",
  // Dried herbs & spices
  "oregano", "dried oregano", "dried basil", "dried thyme", "dried rosemary",
  "bay leaf", "bay leaves", "paprika", "smoked paprika", "sweet paprika",
  "cumin", "ground cumin", "chili powder", "cayenne", "cayenne pepper",
  "cinnamon", "ground cinnamon", "nutmeg", "ground nutmeg",
  "garlic powder", "onion powder", "turmeric", "ground turmeric",
  "red pepper flakes", "crushed red pepper", "crushed red pepper flakes", "red pepper flake",
  "italian seasoning", "dried parsley", "ground coriander",
  "ground ginger", "allspice", "ground allspice", "ground cloves",
  "curry powder", "garam masala", "chilli powder", "chilli flakes", "ground cardamom",
  // Baking basics
  "sugar", "granulated sugar", "white sugar", "brown sugar", "light brown sugar",
  "flour", "all-purpose flour", "all purpose flour",
  "baking powder", "baking soda", "vanilla", "vanilla extract", "pure vanilla extract",
  "cornstarch",
  // Liquids
  "ice", "water",
  // Vinegars & sauces most kitchens have
  "soy sauce", "vinegar", "white vinegar", "distilled white vinegar", "apple cider vinegar",
]);

/** True for salt, pepper, oil, water, dried spices and other things most kitchens keep. */
export function isPantryStaple(name: string): boolean {
  let lower = name.toLowerCase().trim();
  lower = lower.replace(/^[\d/.\s½⅓⅔¼¾⅛⅜⅝⅞-]+(oz|lb|cups?|tbsp|tsp|tablespoons?|teaspoons?|g|kg|ml|l|can|bunch|clove|sprig|pinch(es)?|dash(es)?)?\b\s*/i, "");
  lower = lower.replace(/\([^)]*\)?/g, "").replace(/^of\s+/, "").replace(/\s+/g, " ").trim();
  // Fresh herbs are never staples, even when the dried form is ("fresh oregano")
  if (/\bfresh\b/.test(lower)) return false;
  // Drop prep notes: "kosher salt, to taste", "olive oil, divided", "vegetable oil for bowl"
  const head = lower.split(",")[0]?.trim() ?? lower;
  const base = head
    .replace(/^(freshly|finely|coarsely|fine)\s+/, "")
    .replace(/\s+(to taste|divided|as needed|for\s+.*|plus more.*)$/, "")
    .trim();

  if (PANTRY_STAPLES.has(base)) return true;
  if (/^(cold |warm |hot |boiling |ice |tap |lukewarm )?water$/.test(base)) return true;
  // Any kind of salt is a staple (kosher salt, sea salt, flaky salt, etc.)
  if (/\bsalt\b/.test(base) && !/\bsalted\b/.test(base)) return true;
  // Grouped items: "salt & pepper", "salt and freshly ground black pepper"
  if (/&| and |,/.test(lower)) {
    const parts = lower
      .split(/[&,]|\band\b/)
      .map((s) => s.replace(/^(freshly|finely|coarsely)\s+/, "").replace(/\s+to taste$/, "").trim())
      .filter(Boolean);
    if (parts.length > 0 && parts.every((p) => PANTRY_STAPLES.has(p) || /\bsalt\b/.test(p))) return true;
  }
  return false;
}

// ── Buyable table ──────────────────────────────────────────

type SellKind =
  | "each" // count: "2 lemons"
  | "head" // garlic, lettuce: "1 head garlic"
  | "bunch" // herbs, celery, green onions: "1 bunch parsley"
  | "package"; // name only: "eggs", "butter", "tahini"

interface BuyableEntry {
  name: string;
  kind: SellKind;
  aliases?: string[];
  /** Cups of chopped/sliced produce one item yields (each only). */
  cupsPerEach?: number;
  /** Tablespoons of juice one item yields (citrus). */
  juiceTbspPerEach?: number;
  /** Cloves per head (garlic). */
  clovesPerHead?: number;
}

const BUYABLE: BuyableEntry[] = [
  // Produce sold by count
  { name: "onion", kind: "each", cupsPerEach: 1, aliases: ["onions", "white onion", "sweet onion", "vidalia onion"] },
  { name: "yellow onion", kind: "each", cupsPerEach: 1, aliases: ["yellow onions", "brown onion"] },
  { name: "red onion", kind: "each", cupsPerEach: 1, aliases: ["red onions"] },
  { name: "shallot", kind: "each", cupsPerEach: 0.25, aliases: ["shallots"] },
  { name: "carrot", kind: "each", cupsPerEach: 0.5, aliases: ["carrots"] },
  { name: "lemon", kind: "each", juiceTbspPerEach: 3, aliases: ["lemons", "lemon juice", "lemon zest", "lemon wedges", "lemon wedge"] },
  { name: "lime", kind: "each", juiceTbspPerEach: 2, aliases: ["limes", "lime juice", "lime zest", "lime wedges", "lime wedge"] },
  { name: "orange", kind: "each", juiceTbspPerEach: 5, aliases: ["oranges", "orange zest"] },
  { name: "avocado", kind: "each", cupsPerEach: 1, aliases: ["avocados"] },
  { name: "bell pepper", kind: "each", cupsPerEach: 1, aliases: ["bell peppers", "red bell pepper", "green bell pepper", "yellow bell pepper"] },
  { name: "jalapeño", kind: "each", cupsPerEach: 0.25, aliases: ["jalapeno", "jalapenos", "jalapeños", "jalapeño pepper", "jalapeno pepper"] },
  { name: "tomato", kind: "each", cupsPerEach: 1, aliases: ["tomatoes", "roma tomato", "roma tomatoes", "plum tomatoes"] },
  { name: "cherry tomatoes", kind: "package", aliases: ["grape tomatoes", "grape tomato", "cherry tomato"] },
  { name: "potato", kind: "each", cupsPerEach: 1, aliases: ["potatoes", "russet potato", "russet potatoes", "yukon gold potatoes"] },
  { name: "sweet potato", kind: "each", cupsPerEach: 1.5, aliases: ["sweet potatoes"] },
  { name: "zucchini", kind: "each", cupsPerEach: 1.5, aliases: ["zucchinis"] },
  { name: "cucumber", kind: "each", cupsPerEach: 1.5, aliases: ["cucumbers", "english cucumber"] },
  { name: "eggplant", kind: "each", cupsPerEach: 4, aliases: ["eggplants"] },
  { name: "apple", kind: "each", cupsPerEach: 1, aliases: ["apples"] },
  { name: "banana", kind: "each", cupsPerEach: 0.75, aliases: ["bananas"] },
  { name: "mango", kind: "each", cupsPerEach: 1, aliases: ["mangoes", "mangos"] },
  { name: "ginger", kind: "package", aliases: ["fresh ginger", "ginger root", "gingerroot"] },
  // Produce sold by head
  { name: "garlic", kind: "head", clovesPerHead: 10, aliases: ["garlic clove", "garlic cloves", "cloves garlic", "clove garlic", "cloves of garlic", "head garlic", "heads garlic"] },
  { name: "romaine", kind: "head", aliases: ["romaine lettuce", "romaine hearts"] },
  { name: "lettuce", kind: "head", aliases: ["iceberg lettuce", "butter lettuce"] },
  { name: "cabbage", kind: "head", aliases: ["green cabbage", "red cabbage", "napa cabbage"] },
  { name: "cauliflower", kind: "head" },
  { name: "broccoli", kind: "head", aliases: ["broccoli florets"] },
  // Produce sold by bunch
  { name: "celery", kind: "bunch", aliases: ["celery ribs", "ribs celery", "celery stalks", "stalks celery", "celery stalk", "celery rib"] },
  { name: "green onions", kind: "bunch", aliases: ["green onion", "scallion", "scallions", "spring onions"] },
  { name: "parsley", kind: "bunch", aliases: ["flat-leaf parsley", "italian parsley", "parsley leaves", "curly parsley"] },
  { name: "cilantro", kind: "bunch", aliases: ["cilantro leaves", "coriander leaves"] },
  { name: "basil", kind: "bunch", aliases: ["basil leaves", "fresh basil"] },
  { name: "mint", kind: "bunch", aliases: ["mint leaves", "fresh mint"] },
  { name: "dill", kind: "bunch", aliases: ["fresh dill"] },
  { name: "thyme", kind: "bunch", aliases: ["fresh thyme", "thyme sprigs", "thyme leaves"] },
  { name: "rosemary", kind: "bunch", aliases: ["fresh rosemary", "rosemary sprigs"] },
  { name: "chives", kind: "bunch", aliases: ["chive", "fresh chives"] },
  { name: "kale", kind: "bunch", aliases: ["lacinato kale", "tuscan kale"] },
  { name: "spinach", kind: "package", aliases: ["baby spinach", "fresh spinach"] },
  // Dairy & eggs
  { name: "eggs", kind: "package", aliases: ["egg", "large egg", "large eggs", "egg yolk", "egg yolks", "egg white", "egg whites"] },
  { name: "butter", kind: "package", aliases: ["unsalted butter", "salted butter"] },
  { name: "milk", kind: "package", aliases: ["whole milk", "2% milk"] },
  { name: "heavy cream", kind: "package", aliases: ["heavy whipping cream", "whipping cream"] },
  { name: "half and half", kind: "package", aliases: ["half-and-half"] },
  { name: "sour cream", kind: "package" },
  { name: "greek yogurt", kind: "package", aliases: ["plain greek yogurt"] },
  { name: "plain yogurt", kind: "package", aliases: ["yogurt", "whole-milk yogurt"] },
  { name: "cream cheese", kind: "package" },
  { name: "parmesan", kind: "package", aliases: ["parmesan cheese", "parmigiano-reggiano", "parmigiano reggiano", "grated parmesan"] },
  { name: "mozzarella", kind: "package", aliases: ["mozzarella cheese", "shredded mozzarella", "fresh mozzarella"] },
  { name: "ricotta", kind: "package", aliases: ["ricotta cheese", "whole-milk ricotta"] },
  { name: "cheddar", kind: "package", aliases: ["cheddar cheese", "sharp cheddar", "shredded cheddar"] },
  { name: "feta", kind: "package", aliases: ["feta cheese", "crumbled feta"] },
  // Pantry: buy the jar/bottle/bag, not the measure
  { name: "tahini", kind: "package" },
  { name: "honey", kind: "package" },
  { name: "maple syrup", kind: "package", aliases: ["pure maple syrup"] },
  { name: "dijon mustard", kind: "package", aliases: ["dijon"] },
  { name: "mayonnaise", kind: "package", aliases: ["mayo"] },
  { name: "chicken broth", kind: "package", aliases: ["chicken stock", "low-sodium chicken broth", "low sodium chicken broth"] },
  { name: "vegetable broth", kind: "package", aliases: ["vegetable stock"] },
  { name: "beef broth", kind: "package", aliases: ["beef stock"] },
  { name: "rice", kind: "package", aliases: ["white rice", "long-grain rice", "long grain rice", "uncooked long grain rice", "jasmine rice", "basmati rice"] },
  { name: "tomato paste", kind: "package" },
  { name: "lasagna noodles", kind: "package", aliases: ["lasagna sheets", "no-boil lasagna noodles", "oven-ready lasagna noodles"] },
  { name: "spaghetti", kind: "package" },
  { name: "penne", kind: "package", aliases: ["penne pasta"] },
  { name: "tortellini", kind: "package", aliases: ["cheese tortellini", "refrigerated tortellini"] },
  { name: "egg noodles", kind: "package" },
  { name: "fish sauce", kind: "package" },
  { name: "rice vinegar", kind: "package", aliases: ["rice wine vinegar", "seasoned rice vinegar"] },
  { name: "balsamic vinegar", kind: "package" },
  { name: "chile crisp", kind: "package", aliases: ["chili crisp"] },
  { name: "panko", kind: "package", aliases: ["panko breadcrumbs", "panko bread crumbs"] },
  { name: "breadcrumbs", kind: "package", aliases: ["bread crumbs"] },
  { name: "peanut butter", kind: "package" },
];

const ALIAS_INDEX: { alias: string; entry: BuyableEntry }[] = BUYABLE.flatMap((entry) =>
  [entry.name, ...(entry.aliases ?? [])].map((alias) => ({ alias, entry }))
).sort((a, b) => b.alias.length - a.alias.length);

function findEntry(name: string): BuyableEntry | undefined {
  for (const { alias, entry } of ALIAS_INDEX) {
    if (name === alias) return entry;
  }
  // Produce also matches as the tail of a longer name ("meyer lemon", "vine-ripe
  // tomatoes"). Tail-only so "lemon pepper" isn't a lemon; never for packaged goods
  // ("almond butter" is not butter) or dried/ground spices ("ground ginger").
  if (/^(ground|dried|powdered|granulated) /.test(name)) return undefined;
  for (const { alias, entry } of ALIAS_INDEX) {
    if (entry.kind !== "package" && name.endsWith(` ${alias}`)) return entry;
  }
  return undefined;
}

// ── Units ──────────────────────────────────────────────────

const CUPS_PER_UNIT: Record<string, number> = {
  cup: 1, cups: 1, c: 1,
  tablespoon: 1 / 16, tablespoons: 1 / 16, tbsp: 1 / 16, tbsps: 1 / 16,
  teaspoon: 1 / 48, teaspoons: 1 / 48, tsp: 1 / 48, tsps: 1 / 48,
};
const TBSP_PER_UNIT: Record<string, number> = {
  cup: 16, cups: 16,
  tablespoon: 1, tablespoons: 1, tbsp: 1, tbsps: 1,
  teaspoon: 1 / 3, teaspoons: 1 / 3, tsp: 1 / 3, tsps: 1 / 3,
};

/** Units a store sells by: keep the amount ("1 lb ground beef", "2 cans chickpeas"). */
const PURCHASE_UNITS = new Set([
  "lb", "lbs", "pound", "pounds", "oz", "ounce", "ounces", "g", "gram", "grams", "kg",
  "can", "cans", "jar", "jars", "package", "packages", "pkg", "pkgs", "bottle", "bottles",
  "bag", "bags", "box", "boxes", "pint", "pints", "pt", "pts", "quart", "quarts", "qt", "qts",
  "gallon", "gallons", "head", "heads", "bunch", "bunches", "stick", "sticks", "loaf", "loaves",
  "packet", "packets", "envelope", "envelopes",
]);

/** Parse "2", "1 ½", "1/2", "1-2" (takes the high end) into a number. */
function parseQuantity(amount: string | undefined): number | null {
  if (!amount) return null;
  const s = amount.trim();
  const range = s.split(/\s*-\s*/);
  const target = range.length === 2 ? range[1]! : s;
  const uni: Record<string, number> = { "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875 };
  let total = 0;
  let matched = false;
  for (const part of target.split(/\s+/)) {
    const m = part.match(/^(\d+(?:\.\d+)?)?([½⅓⅔¼¾⅛⅜⅝⅞])?$/);
    const frac = part.match(/^(\d+)\/(\d+)$/);
    if (frac) {
      const den = parseInt(frac[2]!, 10);
      if (den > 0) total += parseInt(frac[1]!, 10) / den;
      matched = true;
    } else if (m && (m[1] || m[2])) {
      total += (m[1] ? parseFloat(m[1]) : 0) + (m[2] ? uni[m[2]] ?? 0 : 0);
      matched = true;
    } else {
      return null;
    }
  }
  return matched ? total : null;
}

function countString(n: number): string {
  return String(Math.max(1, Math.ceil(n - 0.01)));
}

// ── Name cleanup ───────────────────────────────────────────

/** Prep and size words that never change what you buy. */
const PREP_WORDS =
  /\b(finely|roughly|coarsely|thinly|freshly|lightly|very|chopped|diced|minced|sliced|grated|julienned|cubed|halved|quartered|peeled|trimmed|cored|seeded|deseeded|stemmed|pitted|rinsed|drained|patted dry|softened|melted|beaten|whisked|divided|packed|loosely|firmly|torn|zested|juiced|warmed|small|medium|large|extra-large|extra large|fresh|full-fat|full fat|low-fat|low fat|nonfat|non-fat|about|plus more|room temperature|at room temperature|to taste|optional|as needed)\b/g;

/** Comma-tail phrases that are instructions, not another item. */
const INSTRUCTION_TAIL =
  /^(for|to|cut|plus|or more|at|about|into|such as|preferably|if|chopped|diced|minced|sliced|grated|peeled|trimmed|halved|quartered|softened|melted|divided|drained|rinsed|thinly|finely|roughly|cubed|beaten|torn|zested|juiced|lightly|patted|room|stems|leaves|seeds|optional|as needed|cooked|warmed|toasted|crumbled|shredded)\b/;

/**
 * Pick one item from "A or B": "parsley or cilantro" -> parsley, "grape or cherry
 * tomatoes" -> grape tomatoes, "chicken or vegetable stock" -> chicken stock,
 * "raisins or dried cranberries" -> raisins.
 */
function firstAlternative(name: string): string {
  const m = name.match(/^(.*?)\s+or\s+(.*)$/);
  if (!m) return name;
  const a = m[1]!.trim();
  const rest = m[2]!.trim().split(/\s+/);
  const sharesNoun = !/\s/.test(a) && !/s$/.test(a) && rest.length >= 2 && !/^(other|another|any|similar)$/.test(rest[0]!);
  return sharesNoun ? `${a} ${rest.slice(1).join(" ")}` : a;
}

function cleanName(raw: string): string {
  const lower = raw
    .toLowerCase()
    .replace(/\([^)]*\)?/g, " ")
    .replace(/\s+-\s+.*$/, "") // "chilli flakes - can use more" -> "chilli flakes"
    .replace(/\s+for\s+.*$/, "") // "vegetable oil for bowl"
    .replace(/^of\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return firstAlternative(lower)
    .replace(PREP_WORDS, " ")
    .replace(/\bof\b/g, " ")
    .replace(/[*;]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,-]+|[\s,-]+$/g, "")
    .replace(/\s+and$/, "")
    .trim();
}

/**
 * Split a recipe line's name into the item(s) it names. Comma tails are prep notes
 * ("garlic cloves, minced") unless they name another item ("Chile crisp, lemon
 * wedges, for serving") or start a new amount ("carrot, and 1 yellow onion").
 */
function splitItems(name: string): string[] {
  const parts = name.split(/\s*,\s*(?:and\s+|or\s+)?|\s+and\s+(?=\d)/);
  const out: string[] = [];
  parts.forEach((part, i) => {
    const p = part.trim();
    if (!p) return;
    if (i === 0) {
      out.push(p);
      return;
    }
    if (/^\d/.test(p)) {
      out.push(p);
      return;
    }
    if (INSTRUCTION_TAIL.test(p.toLowerCase())) return;
    const cleaned = cleanName(p);
    if (cleaned && findEntry(cleaned)) out.push(p);
  });
  return out;
}

// ── Conversion ─────────────────────────────────────────────

function convertOne(amount: string | undefined, unit: string | undefined, rawName: string): BuyableItem | null {
  const name = cleanName(rawName);
  if (!name) return null;
  if (/^(cold |warm |hot |boiling |ice |tap )?water$/.test(name) || name === "ice") return null;

  const qty = parseQuantity(amount);
  const u = unit?.toLowerCase().replace(/\.$/, "");
  const entry = findEntry(name);

  if (entry) {
    switch (entry.kind) {
      case "package":
        return { name: entry.name };
      case "bunch":
        if (u === "bunch" || u === "bunches") return { name: entry.name, amount: countString(qty ?? 1), unit: "bunch" };
        return { name: entry.name, amount: "1", unit: "bunch" };
      case "head": {
        if (u === "head" || u === "heads") return { name: entry.name, amount: countString(qty ?? 1), unit: "head" };
        const isCloves = u === "clove" || u === "cloves" || /\bcloves?\b/.test(name);
        if (entry.clovesPerHead && isCloves && qty) {
          return { name: entry.name, amount: countString(qty / entry.clovesPerHead), unit: "head" };
        }
        return { name: entry.name, amount: "1", unit: "head" };
      }
      case "each": {
        if (u && (u === "lb" || u === "lbs" || u === "pound" || u === "pounds" || u === "oz" || u === "ounces")) {
          return { name: entry.name, amount, unit };
        }
        if (/\bjuice\b/.test(name) && entry.juiceTbspPerEach && u && TBSP_PER_UNIT[u] && qty) {
          return { name: entry.name, amount: countString((qty * TBSP_PER_UNIT[u]!) / entry.juiceTbspPerEach) };
        }
        if (u && CUPS_PER_UNIT[u] && qty) {
          const per = entry.cupsPerEach ?? 1;
          return { name: entry.name, amount: countString((qty * CUPS_PER_UNIT[u]!) / per) };
        }
        if (/\b(zest|juice|wedges?)\b/.test(name)) return { name: entry.name, amount: "1" };
        return { name: entry.name, amount: countString(qty ?? 1) };
      }
    }
  }

  // Not in the table: keep store units and plain counts, drop cooking measures
  if (u && PURCHASE_UNITS.has(u)) return { name, amount, unit };
  if (u) return { name };
  if (qty !== null) return { name, amount: countString(qty) };
  return { name };
}

/** Re-parse a stored ingredient's text with the current parser. */
function reparse(ing: IngredientInput): { name: string; amount?: string; unit?: string } {
  const line = [ing.amount, ing.unit, ing.name].filter((s) => s && s.trim()).join(" ");
  return parseIngredientLine(line) ?? { name: ing.name };
}

/** isPantryStaple for a stored ingredient, re-parsed so older data matches too. */
export function isStapleIngredient(ing: IngredientInput): boolean {
  return isPantryStaple(reparse(ing).name);
}

/**
 * Convert one recipe ingredient into zero or more grocery items. Re-parses the
 * stored text first, so ingredients saved by older parser versions
 * ("6 g Arlic cloves", "1" + "or 2 sprigs parsley") come out right.
 */
export function toBuyableItems(ing: IngredientInput): BuyableItem[] {
  const parsed = reparse(ing);
  // Notes in parentheses can hold commas ("(you can use fresh too, adjust)")
  let name = parsed.name.replace(/\([^)]*\)?/g, " ").replace(/\s+/g, " ").trim();
  // "rapid-rise or other instant yeast" -> instant yeast (the generic is what to buy)
  const other = name.match(/\bor other\s+([^,]+)$/i);
  if (other?.[1]) name = other[1].trim();
  const items: BuyableItem[] = [];
  splitItems(name).forEach((part, i) => {
    if (i === 0) {
      const item = convertOne(parsed.amount, parsed.unit, part);
      if (item) items.push(item);
      return;
    }
    // A later part with its own amount ("1 yellow onion") parses on its own
    const sub = parseIngredientLine(part) ?? { name: part };
    const item = convertOne(sub.amount, sub.unit, sub.name);
    if (item) items.push(item);
  });
  return items;
}

// ── Display ────────────────────────────────────────────────

/** "onion" -> "onions", "tomato" -> "tomatoes", "head" -> "heads", "bunch" -> "bunches". */
export function pluralize(word: string): string {
  if (/(s|sh|ch|x|z)$/i.test(word)) return /s$/i.test(word) ? word : `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(tomato|potato|mango)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

/**
 * Pluralize the unit (or the name, for counted items) when the amount is above 1,
 * so a combined list reads "2 heads garlic" and "3 onions".
 */
export function pluralizeForAmount(amount: string | undefined, unit: string | undefined, name: string): { unit?: string; name: string } {
  const qty = parseQuantity(amount);
  if (qty === null || qty <= 1) return { unit, name };
  if (unit) {
    return /^(head|bunch)$/i.test(unit) ? { unit: pluralize(unit), name } : { unit, name };
  }
  return { unit, name: pluralize(name) };
}

// ── List building ──────────────────────────────────────────

export interface ListLikeItem {
  name: string;
  amount?: string;
  unit?: string;
}

function formatSum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Combine amounts of the same item from several recipes. Returns undefined when
 * nothing is numeric, null when they can't be combined (e.g. "1-2" and "a few").
 * Heads and bunches cover several recipes' worth, so they take the max, not the sum.
 */
export function combineAmounts(amounts: (string | undefined)[], unit: string | undefined): string | undefined | null {
  const present = amounts.filter((a): a is string => !!a && a.trim() !== "");
  if (present.length === 0) return undefined;
  const nums = present.map(parseQuantity);
  if (nums.some((n) => n === null)) return null;
  const values = nums as number[];
  const total = /^(heads?|bunch(es)?)$/i.test(unit ?? "") ? Math.max(...values) : values.reduce((x, y) => x + y, 0);
  return formatSum(total);
}

/**
 * Add `next` into `items`, combining with an existing item of the same name and
 * unit. Returns true if it merged.
 */
export function mergeInto<T extends ListLikeItem>(items: T[], next: T): boolean {
  const key = next.name.toLowerCase();
  const unit = (next.unit ?? "").toLowerCase();
  const existing = items.find((i) => i.name.toLowerCase() === key && (i.unit ?? "").toLowerCase() === unit);
  if (!existing) return false;
  const combined = combineAmounts([existing.amount, next.amount], existing.unit);
  if (combined) existing.amount = combined;
  return true;
}

/** All grocery items for one recipe's ingredients, merged within the recipe. */
export function buildRecipeItems(ingredients: IngredientInput[]): BuyableItem[] {
  const out: BuyableItem[] = [];
  for (const ing of ingredients) {
    for (const item of toBuyableItems(ing)) {
      if (!mergeInto(out, item)) out.push({ ...item });
    }
  }
  return out;
}

interface TidyItem extends ListLikeItem {
  id: string;
  addedBy?: string;
  sourceRecipeId?: string;
  checked: boolean;
}

/**
 * Rewrite recipe-added list items into buyable form (used by Organize, so lists
 * built before this conversion existed get fixed too). Manual, scanned and AI
 * items are left as typed.
 */
export function tidyRecipeItems<T extends TidyItem>(items: T[], makeId: () => string): { items: T[]; changed: boolean } {
  const out: T[] = [];
  let changed = false;
  for (const item of items) {
    if (item.addedBy !== "recipe") {
      out.push({ ...item });
      continue;
    }
    const converted = toBuyableItems(item);
    const same =
      converted.length === 1 &&
      converted[0]!.name === item.name &&
      (converted[0]!.amount ?? "") === (item.amount ?? "") &&
      (converted[0]!.unit ?? "") === (item.unit ?? "");
    if (same) {
      out.push({ ...item });
      continue;
    }
    changed = true;
    converted.forEach((c, i) => {
      const next = { ...item, id: i === 0 ? item.id : makeId(), name: c.name, amount: c.amount, unit: c.unit };
      const sameSource = out.filter((o) => o.sourceRecipeId === item.sourceRecipeId && o.checked === item.checked);
      if (!mergeInto(sameSource, next)) out.push(next);
    });
  }
  return { items: out, changed };
}
