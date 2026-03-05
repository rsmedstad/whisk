// Audit all recipes for missing data (direct KV access)
const CF_ACCOUNT_ID = "1d6a394479cb4f03320a4aba405c831e";
const KV_NS = "9961b213d1114876af09f83f3884aeb9";
const configPath = `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`;
const config = await Bun.file(configPath).text();
const tokenMatch = config.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!tokenMatch?.[1]) { console.error("No OAuth token"); process.exit(1); }
const token = tokenMatch[1];
const kvBase = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NS}`;
const headers = { Authorization: `Bearer ${token}` };

const listRes = await fetch(`${kvBase}/keys?prefix=recipe:`, { headers });
const keys = ((await listRes.json()) as { result: { name: string }[] }).result
  .filter(k => k.name !== "recipe_index");

interface Issue { id: string; title: string; critical: string[]; minor: string[] }
const issues: Issue[] = [];
let total = 0;

for (const { name: key } of keys) {
  const res = await fetch(`${kvBase}/values/${encodeURIComponent(key)}`, { headers });
  const d = await res.json() as Record<string, unknown>;
  const id = key.replace("recipe:", "");
  const title = (d.title as string) ?? "(no title)";
  total++;

  const critical: string[] = [];
  const minor: string[] = [];

  const ingredients = d.ingredients as unknown[] | undefined;
  const steps = d.steps as unknown[] | undefined;
  const photos = d.photos as unknown[] | undefined;
  const thumb = d.thumbnailUrl as string | undefined;

  if (!ingredients || ingredients.length === 0) critical.push("NO INGREDIENTS");
  if (!steps || steps.length === 0) critical.push("NO STEPS");
  if (!thumb && (!photos || photos.length === 0)) critical.push("NO IMAGE");
  if (thumb && (!photos || photos.length === 0)) minor.push("has thumbnailUrl but empty photos array");
  if (!d.description) minor.push("no description");
  if (!d.sourceUrl) minor.push("no sourceUrl");
  if (!d.prepTime && !d.cookTime) minor.push("no cook/prep times");
  if (!d.servings) minor.push("no servings");

  if (critical.length > 0 || minor.length > 0) {
    issues.push({ id, title, critical, minor });
  }
}

console.log(`Audited ${total} recipes\n`);

const criticalIssues = issues.filter(i => i.critical.length > 0);
const minorOnly = issues.filter(i => i.critical.length === 0);

if (criticalIssues.length > 0) {
  console.log(`=== CRITICAL (${criticalIssues.length} recipes) ===\n`);
  for (const { id, title, critical, minor } of criticalIssues) {
    console.log(`${id} | ${title}`);
    for (const p of critical) console.log(`  *** ${p}`);
    for (const p of minor) console.log(`  - ${p}`);
    console.log();
  }
}

if (minorOnly.length > 0) {
  console.log(`=== MINOR (${minorOnly.length} recipes) ===\n`);
  for (const { id, title, minor } of minorOnly) {
    console.log(`${id} | ${title}`);
    for (const p of minor) console.log(`  - ${p}`);
    console.log();
  }
}

if (issues.length === 0) {
  console.log("All recipes have complete data!");
}
