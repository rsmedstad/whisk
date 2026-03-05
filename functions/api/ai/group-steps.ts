import {
  loadAIConfig,
  resolveConfig,
  callTextAI,
  type ProviderEnv,
} from "../../lib/ai-providers";

interface Env extends ProviderEnv {
  WHISK_KV: KVNamespace;
}

interface GroupStepsBody {
  title: string;
  steps: string[];
}

// POST /api/ai/group-steps - AI-powered step section grouping
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as GroupStepsBody;

  if (!body.steps.length) {
    return new Response(JSON.stringify({ groups: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const config = await loadAIConfig(env.WHISK_KV);
  const fnConfig = resolveConfig(config, "chat", env);

  if (!fnConfig) {
    return new Response(JSON.stringify({ groups: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const systemPrompt = [
    "You group recipe steps into logical cooking phases. Given a recipe title and numbered steps, assign each step to a section.",
    "",
    "Guidelines:",
    "- Use short, natural section names like: Prep, Make the Sauce, Season & Sear, Bake, Assemble, Rest & Serve",
    "- Tailor section names to the specific recipe (e.g. 'Roll the Dough' not just 'Prep')",
    "- Usually 2-4 sections. Simple recipes may have just 2.",
    "- Every step must be assigned to exactly one section.",
    "- Preserve the original step order within each section.",
    '- Return JSON: { "groups": ["section name for step 1", "section name for step 2", ...] }',
    "- The groups array must have exactly the same number of entries as there are steps.",
  ].join("\n");

  const numberedSteps = body.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const userPrompt = `Recipe: ${body.title}\n\nSteps:\n${numberedSteps}`;

  try {
    const content = await callTextAI(
      fnConfig,
      env,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { maxTokens: 512, temperature: 0.3, jsonMode: true }
    );

    const parsed = JSON.parse(content) as { groups?: string[] };
    const groups = parsed.groups ?? [];

    // Validate: must have same length as input steps
    if (groups.length !== body.steps.length) {
      return new Response(JSON.stringify({ groups: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ groups }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ groups: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }
};
