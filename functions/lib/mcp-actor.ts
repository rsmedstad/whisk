// MCP actor resolution for write attribution.
//
// PRODUCT LOCK: MCP writes attribute to the **household owner** (isOwner
// member from KV key `household`), not a dedicated bot member. Use that
// userId for favoritedBy / createdBy / meal-plan notes attribution.
// Fallback `mcp-bot` only when household KV is missing or has no members —
// responses still surface actorUserId so callers can see what was used.

export type HouseholdMember = {
  id: string;
  name: string;
  isOwner: boolean;
  joinedAt?: string;
};

export type Household = {
  members: HouseholdMember[];
  updatedAt?: string;
};

export type McpActor = {
  userId: string;
  name: string;
  source: "household-owner" | "household-first" | "fallback-mcp-bot";
};

export type ActorKv = {
  get(key: string, type: "json"): Promise<Household | null>;
};

const FALLBACK_ID = "mcp-bot";
const FALLBACK_NAME = "MCP";

export async function resolveMcpActor(kv: ActorKv): Promise<McpActor> {
  try {
    const household = await kv.get("household", "json");
    const members = household?.members ?? [];
    if (members.length === 0) {
      return { userId: FALLBACK_ID, name: FALLBACK_NAME, source: "fallback-mcp-bot" };
    }
    const owner = members.find((m) => m.isOwner);
    if (owner?.id) {
      return {
        userId: owner.id,
        name: typeof owner.name === "string" && owner.name ? owner.name : owner.id,
        source: "household-owner",
      };
    }
    const first = members[0]!;
    return {
      userId: first.id,
      name: typeof first.name === "string" && first.name ? first.name : first.id,
      source: "household-first",
    };
  } catch {
    return { userId: FALLBACK_ID, name: FALLBACK_NAME, source: "fallback-mcp-bot" };
  }
}
