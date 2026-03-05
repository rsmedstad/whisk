#!/usr/bin/env bun
/**
 * Fix recipe index: remove duplicates, fix titles, clean descriptions.
 */

const KV_NS = "9961b213d1114876af09f83f3884aeb9";

// IDs to remove (duplicates from earlier runs, no images)
const REMOVE_IDS = ["r_85187f8b", "r_d6f45585"];

// Title/description fixes
const FIXES: Record<string, { title?: string; description?: string }> = {
  r_ea826a15: {
    title: "Citrus Salmon With Creamy Feta Sauce",
    description: "",
  },
};

async function main() {
  // Get current index
  const proc = Bun.spawnSync([
    "npx", "wrangler", "kv", "key", "get",
    "--binding", "WHISK_KV", "recipes:index",
  ]);
  const index = JSON.parse(proc.stdout.toString()) as Array<Record<string, unknown>>;
  console.log("Before:", index.length, "recipes");

  // Filter out duplicates
  let cleaned = index.filter((r) => !REMOVE_IDS.includes(r.id as string));

  // Apply fixes
  cleaned = cleaned.map((r) => {
    const fix = FIXES[r.id as string];
    if (fix) {
      return { ...r, ...fix };
    }
    return r;
  });

  console.log("After:", cleaned.length, "recipes");
  cleaned.forEach((r) => console.log(`  ${r.id} - ${r.title}`));

  // Update index
  const putProc = Bun.spawnSync([
    "npx", "wrangler", "kv", "key", "put",
    "--binding", "WHISK_KV", "recipes:index",
    JSON.stringify(cleaned),
  ]);

  if (putProc.exitCode !== 0) {
    console.log("Index update failed:", putProc.stderr.toString());
    return;
  }
  console.log("Index updated successfully");

  // Also fix the full recipe for Citrus Salmon
  const salmonProc = Bun.spawnSync([
    "npx", "wrangler", "kv", "key", "get",
    "--binding", "WHISK_KV", "recipe:r_ea826a15",
  ]);
  const salmon = JSON.parse(salmonProc.stdout.toString());
  salmon.title = "Citrus Salmon With Creamy Feta Sauce";
  salmon.description = "";
  Bun.spawnSync([
    "npx", "wrangler", "kv", "key", "put",
    "--binding", "WHISK_KV", "recipe:r_ea826a15",
    JSON.stringify(salmon),
  ]);
  console.log("Fixed Citrus Salmon recipe");

  // Delete duplicate recipe entries
  for (const id of REMOVE_IDS) {
    Bun.spawnSync([
      "npx", "wrangler", "kv", "key", "delete",
      "--binding", "WHISK_KV", `recipe:${id}`,
    ]);
    console.log(`Deleted recipe:${id}`);
  }
}

main().catch(console.error);
