import type { ShoppingCategory } from "../types";

// Maps ingredient keywords to shopping categories
const CATEGORY_KEYWORDS: Record<ShoppingCategory, string[]> = {
  produce: [
    "apple", "avocado", "banana", "basil", "bell pepper", "berry", "blueberry",
    "broccoli", "cabbage", "carrot", "celery", "cherry", "cilantro", "corn",
    "cucumber", "dill", "eggplant", "garlic", "ginger", "grape", "green bean",
    "green onion", "herbs", "jalapeno", "kale", "lemon", "lettuce", "lime",
    "mango", "mint", "mushroom", "onion", "orange", "oregano", "parsley",
    "peach", "pear", "pepper", "pineapple", "potato", "raspberry", "rosemary",
    "sage", "scallion", "shallot", "spinach", "squash", "strawberry",
    "sweet potato", "thyme", "tomato", "watermelon", "zucchini",
    "arugula", "asparagus", "beet", "bok choy", "cauliflower", "fennel",
    "leek", "pea", "radish", "turnip",
  ],
  dairy: [
    "butter", "cheese", "cheddar", "cream", "cream cheese", "egg", "eggs",
    "half and half", "heavy cream", "milk", "mozzarella", "parmesan",
    "ricotta", "sour cream", "whipping cream", "yogurt", "cottage cheese",
    "goat cheese", "feta", "brie", "swiss", "provolone", "gruyere",
  ],
  meat: [
    "bacon", "beef", "brisket", "chicken", "chorizo", "duck", "ground beef",
    "ground turkey", "ham", "hot dog", "lamb", "pork", "prosciutto",
    "ribeye", "salami", "salmon", "sausage", "shrimp", "sirloin", "steak",
    "tenderloin", "tuna", "turkey", "veal", "fish", "cod", "tilapia",
    "crab", "lobster", "scallop", "clam", "mussel", "anchovy",
  ],
  pantry: [
    "baking powder", "baking soda", "bbq sauce", "bouillon", "breadcrumb",
    "broth", "brown sugar", "canola oil", "cayenne", "chili", "cinnamon",
    "cocoa", "coconut", "cornstarch", "cumin", "curry", "dijon", "flour",
    "honey", "hot sauce", "ketchup", "maple syrup", "marinara", "mayo",
    "mayonnaise", "mustard", "nutmeg", "oats", "olive oil", "paprika",
    "pasta", "peanut butter", "pepper", "ranch", "red pepper flakes", "rice",
    "salt", "sesame oil", "soy sauce", "sriracha", "stock", "sugar",
    "tahini", "teriyaki", "tomato paste", "tomato sauce", "vanilla",
    "vegetable oil", "vinegar", "worcestershire", "yeast", "noodle",
    "quinoa", "couscous", "lentil", "bean", "chickpea", "chip",
  ],
  frozen: [
    "frozen", "ice cream", "frozen pizza", "frozen vegetable", "frozen fruit",
    "popsicle", "frozen dinner", "sorbet", "gelato",
  ],
  bakery: [
    "bagel", "baguette", "bread", "bun", "ciabatta", "croissant", "english muffin",
    "flatbread", "naan", "pita", "roll", "sourdough", "tortilla", "wrap",
    "cake", "cookie", "donut", "muffin", "pie crust",
  ],
  beverages: [
    "beer", "club soda", "coconut water", "coffee", "cola", "ginger ale",
    "juice", "kombucha", "lemonade", "seltzer", "soda", "sparkling water",
    "tea", "tonic", "water", "wine",
  ],
  other: [],
};

export function categorizeIngredient(name: string): ShoppingCategory {
  const lower = name.toLowerCase();

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === "other") continue;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        return category as ShoppingCategory;
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
  frozen: "Frozen",
  bakery: "Bakery",
  beverages: "Beverages",
  other: "Other",
};

export const CATEGORY_ORDER: ShoppingCategory[] = [
  "produce",
  "dairy",
  "meat",
  "pantry",
  "frozen",
  "bakery",
  "beverages",
  "other",
];
