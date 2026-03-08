import type { ShoppingCategory } from "../types";

// Maps ingredient keywords to shopping categories
const CATEGORY_KEYWORDS: Record<ShoppingCategory, string[]> = {
  produce: [
    "apple", "apricot", "artichoke", "arugula", "asparagus", "avocado",
    "banana", "basil", "bean sprout", "beet", "bell pepper", "berry",
    "blackberry", "blueberry", "bok choy", "broccoli", "brussels sprout",
    "butternut", "cabbage", "cantaloupe", "carrot", "cauliflower", "celery",
    "chard", "cherry", "chive", "cilantro", "clementine", "collard",
    "corn", "cranberry", "cucumber", "date", "dill", "edamame", "eggplant",
    "endive", "fennel", "fig", "garlic", "ginger", "grape", "grapefruit",
    "green bean", "green onion", "guava", "herb", "honeydew",
    "jalapeno", "jicama", "kale", "kiwi", "kohlrabi", "kumquat",
    "leek", "lemon", "lettuce", "lime", "lychee", "mango", "melon",
    "mint", "mushroom", "nectarine", "okra", "olive", "onion", "orange",
    "oregano", "papaya", "parsley", "parsnip", "passion fruit", "pea",
    "peach", "pear", "pepper", "persimmon", "pineapple", "plantain",
    "plum", "pomegranate", "potato", "pumpkin", "radicchio", "radish",
    "raspberry", "rhubarb", "romaine", "rosemary", "rutabaga", "sage",
    "scallion", "serrano", "shallot", "snap pea", "snow pea", "spinach",
    "sprout", "squash", "starfruit", "strawberry", "sweet potato",
    "tangelo", "tangerine", "thyme", "tomatillo", "tomato", "turnip",
    "watercress", "watermelon", "yam", "zucchini",
    "fresh fruit", "fresh vegetable", "salad", "lettuce mix", "salad mix",
    "coleslaw mix", "stir fry mix", "baby spinach", "spring mix",
  ],
  dairy: [
    "butter", "buttermilk", "cheese", "cheddar", "colby", "cottage cheese",
    "cream", "cream cheese", "crema", "creme fraiche", "custard",
    "egg", "eggs", "feta", "ghee", "goat cheese", "gouda", "gruyere",
    "half and half", "heavy cream", "heavy whipping cream", "havarti",
    "ice cream", "kefir", "mascarpone", "milk", "monterey jack",
    "mozzarella", "muenster", "neufchatel", "oat milk", "parmesan",
    "pecorino", "pepper jack", "provolone", "queso", "ricotta",
    "sharp cheddar", "sour cream", "swiss", "whipping cream",
    "whipped cream", "yogurt", "almond milk", "soy milk", "coconut milk",
    "brie", "camembert", "manchego", "asiago", "romano",
  ],
  meat: [
    "anchovy", "bacon", "bass", "beef", "bratwurst", "brisket", "catfish",
    "chicken", "chorizo", "clam", "cod", "crab", "crawfish", "duck",
    "filet", "fish", "flank steak", "flounder", "ground beef",
    "ground chicken", "ground pork", "ground turkey", "grouper", "haddock",
    "halibut", "ham", "hot dog", "italian sausage", "jerky", "kielbasa",
    "lamb", "lobster", "mahi mahi", "meatball", "mussel", "octopus",
    "oyster", "pancetta", "pepperoni", "pork", "prawn", "prosciutto",
    "ribeye", "ribs", "roast", "salami", "salmon", "sardine", "sausage",
    "scallop", "sea bass", "shrimp", "sirloin", "snapper", "sole",
    "squid", "steak", "swordfish", "tenderloin", "tilapia", "trout",
    "tuna", "turkey", "veal", "venison",
  ],
  pantry: [
    "agave", "almond", "almond butter", "almond flour", "baking mix",
    "baking powder", "baking soda", "balsamic", "barley", "basmati",
    "bay leaf", "bbq sauce", "black bean", "bouillon", "breadcrumb",
    "broth", "brown rice", "brown sugar", "bulgur", "canola oil",
    "caper", "cardamom", "cashew", "cayenne", "cereal", "chia seed",
    "chickpea", "chili", "chili powder", "cinnamon", "clove", "cocoa",
    "coconut", "coconut cream", "coconut oil", "confectioner",
    "coriander", "cornmeal", "cornstarch", "couscous", "cracker",
    "cranberry sauce", "cream of mushroom", "cream of chicken",
    "cumin", "curry", "curry paste", "dijon", "dried fruit",
    "evaporated milk", "extract", "farro", "fish sauce", "flax",
    "flour", "garam masala", "garlic powder", "gelatin", "gnocchi",
    "grain", "granola", "gravy", "hazelnut", "hemp seed", "hoisin",
    "honey", "hot sauce", "hummus", "jam", "jasmine rice", "jelly",
    "ketchup", "lentil", "macadamia", "maple syrup", "marinara",
    "mayo", "mayonnaise", "mirin", "miso", "molasses", "mustard",
    "noodle", "nut", "nutmeg", "oat", "olive oil", "onion powder",
    "orzo", "oyster sauce", "panko", "paprika", "pasta",
    "peanut", "peanut butter", "pecan", "penne", "pesto", "pickle",
    "pine nut", "pistachio", "polenta", "poppy seed", "powdered sugar",
    "pretzel", "protein powder", "quinoa", "raisin", "ranch",
    "red pepper flake", "relish", "rice", "rice vinegar",
    "rotini", "salsa", "salt", "sesame", "sesame oil",
    "soy sauce", "spaghetti", "spice", "sriracha", "starch", "stock",
    "stuffing", "sugar", "sunflower seed", "sweetener",
    "taco seasoning", "taco shell", "tahini", "tamari", "tapioca",
    "teriyaki", "tomato paste", "tomato sauce", "tortilla chip",
    "turmeric", "vanilla", "vegetable oil", "vinegar", "walnut",
    "wasabi", "white rice", "wild rice", "worcestershire", "yeast",
    "bean", "canned", "dried", "seed",
  ],
  snacks: [
    "chip", "corn chip", "crouton", "dip", "fruit snack",
    "granola bar", "gummy", "nacho", "nut mix", "pita chip",
    "popcorn", "pork rind", "rice cake", "salsa verde",
    "snack bar", "snack mix", "tortilla chip", "trail mix",
    "veggie straw", "protein bar", "energy bar",
  ],
  frozen: [
    "frozen", "ice cream", "frozen pizza", "frozen vegetable",
    "frozen fruit", "popsicle", "frozen dinner", "sorbet", "gelato",
    "frozen waffle", "frozen burrito", "frozen pie", "ice pop",
    "frozen fry", "frozen nugget", "frozen fish stick",
    "frozen shrimp", "frozen berry", "tv dinner",
  ],
  bakery: [
    "bagel", "baguette", "bialy", "bread", "brioche", "bun",
    "challah", "ciabatta", "cornbread", "crescent roll", "croissant",
    "danish", "dinner roll", "english muffin", "flatbread", "focaccia",
    "hamburger bun", "hot dog bun", "kaiser roll", "lavash", "loaf",
    "naan", "pita", "pretzel roll", "pumpernickel", "roll",
    "rye bread", "scone", "sourdough", "texas toast", "tortilla",
    "wheat bread", "white bread", "whole wheat", "wrap",
    "cake", "cookie", "cupcake", "donut", "doughnut", "muffin",
    "pie crust", "pastry",
  ],
  beverages: [
    "beer", "bourbon", "brandy", "champagne", "cider", "club soda",
    "cocktail", "coconut water", "coffee", "cola", "cranberry juice",
    "energy drink", "espresso", "gatorade", "gin", "ginger ale",
    "ginger beer", "grape juice", "iced tea", "juice", "kombucha",
    "lemonade", "liqueur", "mineral water", "orange juice", "prosecco",
    "rum", "sake", "seltzer", "soda", "sparkling water", "sprite",
    "tea", "tequila", "tonic", "vodka", "water", "whiskey", "wine",
  ],
  other: [],
};

/**
 * Normalize an ingredient name for category matching:
 * - lowercase
 * - strip trailing 's' / 'es' for basic plural handling
 * - strip leading amounts/numbers
 */
function normalizeForMatch(name: string): string {
  let lower = name.toLowerCase().trim();
  // Strip leading numbers & units like "2 cups", "1/2 lb"
  lower = lower.replace(/^[\d\/.\s]+(oz|lb|cup|tbsp|tsp|g|kg|ml|l|pt|qt|gal|bunch|head|can|pkg|bag|box|jar|bottle|ct|count|stick|clove|sprig|slice|piece|each)s?\b\s*/i, "");
  lower = lower.replace(/^[\d\/.\s]+/, "").trim();
  return lower;
}

/**
 * Simple stemming: try both the raw word and common plural-stripped forms
 */
function getStemVariants(word: string): string[] {
  const variants = [word];
  if (word.endsWith("ies")) {
    variants.push(word.slice(0, -3) + "y"); // berries → berry
  }
  if (word.endsWith("ves")) {
    variants.push(word.slice(0, -3) + "f"); // halves → half
  }
  if (word.endsWith("es")) {
    variants.push(word.slice(0, -2)); // tomatoes → tomato
  }
  if (word.endsWith("s") && !word.endsWith("ss")) {
    variants.push(word.slice(0, -1)); // almonds → almond
  }
  return variants;
}

export function categorizeIngredient(name: string): ShoppingCategory {
  const normalized = normalizeForMatch(name);
  const variants = getStemVariants(normalized);

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === "other") continue;
    for (const keyword of keywords) {
      // Check if normalized name or any stem variant contains keyword
      for (const variant of variants) {
        if (variant.includes(keyword) || keyword.includes(variant)) {
          return category as ShoppingCategory;
        }
      }
      // Also check keyword stems against the name
      const keywordVariants = getStemVariants(keyword);
      for (const kv of keywordVariants) {
        if (normalized.includes(kv)) {
          return category as ShoppingCategory;
        }
      }
    }
  }

  return "other";
}

export const CATEGORY_LABELS: Record<ShoppingCategory, string> = {
  produce: "Produce",
  dairy: "Dairy & Eggs",
  meat: "Meat & Seafood",
  pantry: "Pantry",
  snacks: "Snacks",
  frozen: "Frozen",
  bakery: "Bakery",
  beverages: "Beverages",
  other: "Other",
};

export const CATEGORY_EMOJI: Record<ShoppingCategory, string> = {
  produce: "\uD83E\uDD66",
  dairy: "\uD83E\uDDC8",
  meat: "\uD83E\uDD69",
  pantry: "\uD83E\uDED9",
  snacks: "\uD83C\uDF7F",
  frozen: "\u2744\uFE0F",
  bakery: "\uD83C\uDF5E",
  beverages: "\uD83E\uDD64",
  other: "\uD83D\uDCE6",
};

export const CATEGORY_ORDER: ShoppingCategory[] = [
  "produce",
  "dairy",
  "meat",
  "pantry",
  "snacks",
  "frozen",
  "bakery",
  "beverages",
  "other",
];

// ── Drink-specific categories ──────────────────────────

export type DrinkCategory =
  | "spirits"
  | "wine"
  | "beer"
  | "mixers"
  | "bitters_modifiers"
  | "garnish"
  | "other";

const DRINK_CATEGORY_KEYWORDS: Record<DrinkCategory, string[]> = {
  spirits: [
    "bourbon", "brandy", "cognac", "gin", "mezcal", "pisco", "rum",
    "rye", "scotch", "tequila", "vodka", "whiskey", "whisky",
    "absinthe", "aquavit", "cachaca", "grappa", "moonshine",
    "amaretto", "baileys", "campari", "chambord", "chartreuse",
    "cointreau", "creme de", "curacao", "drambuie", "elderflower liqueur",
    "frangelico", "galliano", "grand marnier", "kahlua", "limoncello",
    "maraschino liqueur", "midori", "patron", "sambuca", "schnapps",
    "st-germain", "st germain", "triple sec", "liqueur", "amaro",
    "aperol", "fernet",
  ],
  wine: [
    "wine", "champagne", "prosecco", "cava", "sparkling wine",
    "red wine", "white wine", "rose", "rosé", "port", "sherry",
    "vermouth", "marsala", "madeira", "sake", "soju", "mead",
  ],
  beer: [
    "beer", "ale", "lager", "stout", "porter", "ipa", "pilsner",
    "wheat beer", "hefeweizen", "hard cider", "hard seltzer",
    "hard lemonade", "malt liquor", "shandy", "radler",
  ],
  mixers: [
    "soda", "soda water", "club soda", "tonic", "tonic water",
    "ginger ale", "ginger beer", "cola", "sprite", "lemon-lime",
    "cranberry juice", "orange juice", "pineapple juice", "grapefruit juice",
    "lime juice", "lemon juice", "juice", "tomato juice", "apple cider",
    "coconut water", "coconut cream", "coconut milk", "cream of coconut",
    "grenadine", "simple syrup", "syrup", "agave", "honey",
    "cream", "heavy cream", "half and half", "milk", "egg white",
    "espresso", "coffee", "tea", "hot water", "water", "ice",
    "sparkling water", "mineral water", "seltzer", "kombucha",
  ],
  bitters_modifiers: [
    "bitters", "angostura", "peychaud", "orange bitters",
    "aromatic bitters", "chocolate bitters", "celery bitters",
    "mole bitters", "worcestershire", "hot sauce", "tabasco",
    "salt", "pepper", "sugar", "sugar cube", "demerara",
    "powdered sugar", "cinnamon", "nutmeg", "cayenne",
    "celery salt", "tajin", "everything bagel",
  ],
  garnish: [
    "garnish", "cherry", "maraschino cherry", "olive", "onion",
    "cocktail onion", "lime wheel", "lemon wheel", "orange peel",
    "lemon peel", "lime peel", "lemon twist", "orange twist",
    "lime wedge", "lemon wedge", "orange slice", "pineapple wedge",
    "mint", "mint sprig", "basil", "rosemary", "thyme",
    "cucumber", "celery", "celery stalk", "jalapeño", "jalapeno",
    "whipped cream", "cocoa powder", "cinnamon stick",
    "star anise", "umbrella", "edible flower", "candied ginger",
  ],
  other: [],
};

export function categorizeIngredientForDrink(name: string): DrinkCategory {
  const normalized = normalizeForMatch(name);
  const variants = getStemVariants(normalized);

  for (const [category, keywords] of Object.entries(DRINK_CATEGORY_KEYWORDS)) {
    if (category === "other") continue;
    for (const keyword of keywords) {
      for (const variant of variants) {
        if (variant.includes(keyword) || keyword.includes(variant)) {
          return category as DrinkCategory;
        }
      }
      const keywordVariants = getStemVariants(keyword);
      for (const kv of keywordVariants) {
        if (normalized.includes(kv)) {
          return category as DrinkCategory;
        }
      }
    }
  }

  return "other";
}

export const DRINK_CATEGORY_LABELS: Record<DrinkCategory, string> = {
  spirits: "Spirits & Liqueurs",
  wine: "Wine",
  beer: "Beer & Cider",
  mixers: "Mixers & Juices",
  bitters_modifiers: "Bitters & Modifiers",
  garnish: "Garnish",
  other: "Other",
};

export const DRINK_CATEGORY_ORDER: DrinkCategory[] = [
  "spirits",
  "wine",
  "beer",
  "mixers",
  "bitters_modifiers",
  "garnish",
  "other",
];
