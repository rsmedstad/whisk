// ── Vectorize + Workers AI Embeddings ─────────────────────────

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

interface RecipeEmbeddingInput {
  id: string;
  title: string;
  tags?: string[];
  cuisine?: string;
  description?: string;
  ingredientNames?: string[];
}

/** Build a text blob optimized for embedding from recipe metadata */
function buildEmbeddingText(recipe: RecipeEmbeddingInput): string {
  const parts: string[] = [recipe.title];
  if (recipe.cuisine) parts.push(recipe.cuisine);
  if (recipe.tags?.length) parts.push(recipe.tags.join(", "));
  if (recipe.ingredientNames?.length) parts.push(recipe.ingredientNames.join(", "));
  if (recipe.description) parts.push(recipe.description);
  // Truncate to ~400 tokens (~2000 chars) to stay within model limits
  return parts.join(". ").slice(0, 2000);
}

/** Generate an embedding vector for a text string using Workers AI */
export async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run(EMBEDDING_MODEL, { text: [text] }) as { data: number[][] };
  const vec = result.data[0];
  if (!vec) throw new Error("Embedding model returned no data");
  return vec;
}

/** Upsert a recipe's embedding into the Vectorize index */
export async function upsertRecipeEmbedding(
  ai: Ai,
  vectorize: VectorizeIndex,
  recipe: RecipeEmbeddingInput
): Promise<void> {
  const text = buildEmbeddingText(recipe);
  const embedding = await generateEmbedding(ai, text);
  await vectorize.upsert([
    {
      id: recipe.id,
      values: embedding,
      metadata: { title: recipe.title },
    },
  ]);
}

/** Query the Vectorize index for recipes similar to a text query */
export async function queryRecipes(
  ai: Ai,
  vectorize: VectorizeIndex,
  query: string,
  topK = 15
): Promise<VectorizeMatch[]> {
  const embedding = await generateEmbedding(ai, query);
  const results = await vectorize.query(embedding, {
    topK,
    returnMetadata: "all",
  });
  return results.matches;
}

/** Build embedding input from a full recipe object (as stored in KV) */
export function recipeToEmbeddingInput(recipe: Record<string, unknown>): RecipeEmbeddingInput {
  return {
    id: recipe.id as string,
    title: (recipe.title as string) ?? "Untitled",
    tags: (recipe.tags as string[]) ?? [],
    cuisine: recipe.cuisine as string | undefined,
    description: recipe.description as string | undefined,
    ingredientNames: Array.isArray(recipe.ingredients)
      ? (recipe.ingredients as { name?: string }[]).map((i) => i.name).filter((n): n is string => !!n)
      : undefined,
  };
}
