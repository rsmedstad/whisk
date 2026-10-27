export const IMPORT_LD_PATH = "/import/ld";
export const IMPORT_LD_TYPE = "whisk-import-ld";
export const IMPORT_LD_ACK = "whisk-import-ld-ack";
/** Cap for `#ld=` / `#ldz=` so mobile browsers can open the Whisk tab.
 *  Whisk sends Cross-Origin-Opener-Policy: same-origin, which severs
 *  window.open from a Kitchn tab — the hash is the reliable path. */
export const BOOKMARKLET_HASH_MAX = 16_000;

export interface ImportLdPayload {
  v: 1;
  type: typeof IMPORT_LD_TYPE;
  url: string;
  jsonLd: unknown;
}

const SLIM_KEYS = [
  "@context",
  "@type",
  "@id",
  "name",
  "description",
  "image",
  "recipeIngredient",
  "recipeInstructions",
  "prepTime",
  "cookTime",
  "totalTime",
  "recipeYield",
  "recipeCategory",
  "recipeCuisine",
  "keywords",
  "aggregateRating",
  "url",
  "mainEntityOfPage",
  "author",
  "nutrition",
  "video",
] as const;

/** Walk JSON-LD (arrays, @graph, mainEntity) and return the Recipe node. */
export function findRecipeInLd(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeInLd(item);
      if (found) return found;
    }
    return null;
  }
  const obj = data as Record<string, unknown>;
  if (isRecipeType(obj["@type"])) return obj;
  if (Array.isArray(obj["@graph"])) {
    const found = findRecipeInLd(obj["@graph"]);
    if (found) return found;
  }
  if (obj.mainEntity) {
    const found = findRecipeInLd(obj.mainEntity);
    if (found) return found;
  }
  return null;
}

function isRecipeType(type: unknown): boolean {
  if (type === "Recipe") return true;
  if (typeof type === "string" && type.endsWith("/Recipe")) return true;
  if (Array.isArray(type)) {
    return type.some((t) => t === "Recipe" || (typeof t === "string" && t.endsWith("/Recipe")));
  }
  return false;
}

export function extractLdScriptsFromHtml(html: string): string[] {
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (raw) out.push(raw);
  }
  return out;
}

export function extractRecipeFromLdScripts(scripts: string[]): Record<string, unknown> | null {
  for (const raw of scripts) {
    try {
      const found = findRecipeInLd(JSON.parse(raw));
      if (found) return found;
    } catch {
      // skip malformed blocks
    }
  }
  return null;
}

export function slimRecipeJsonLd(recipe: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { "@type": "Recipe" };
  for (const key of SLIM_KEYS) {
    if (key in recipe && recipe[key] !== undefined) out[key] = recipe[key];
  }
  return out;
}

/** First http(s) URL in Android share text / title. */
export function firstHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/https?:\/\/[^\s<>"'\\)]+/i);
  if (!match?.[0]) return null;
  return match[0].replace(/[.,;:]+$/, "");
}

export function isImportLdPayload(value: unknown): value is ImportLdPayload {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return obj.v === 1 && obj.type === IMPORT_LD_TYPE && typeof obj.url === "string" && "jsonLd" in obj;
}

export function encodeImportLdHash(payload: { url: string; jsonLd: unknown }): string {
  const json = JSON.stringify({
    v: 1,
    type: IMPORT_LD_TYPE,
    url: payload.url,
    jsonLd: payload.jsonLd,
  });
  const b64 = utf8ToBase64(json)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return b64;
}

export function decodeImportLdHash(hash: string): ImportLdPayload | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw.startsWith("ldz=")) return null;
  const encoded = raw.startsWith("ld=")
    ? raw.slice(3)
    : new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw).get("ld");
  if (!encoded) return null;
  try {
    const json = base64ToUtf8(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed: unknown = JSON.parse(json);
    return isImportLdPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function encodeImportLdHashGzip(payload: { url: string; jsonLd: unknown }): Promise<string> {
  const json = JSON.stringify({
    v: 1,
    type: IMPORT_LD_TYPE,
    url: payload.url,
    jsonLd: payload.jsonLd,
  });
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  await writer.write(new TextEncoder().encode(json));
  await writer.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function decodeImportLdHashAsync(hash: string): Promise<ImportLdPayload | null> {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw.startsWith("ldz=")) {
    try {
      const encoded = raw.slice(4);
      const pad = encoded.length % 4 === 0 ? "" : "=".repeat(4 - (encoded.length % 4));
      const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/") + pad);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const ds = new DecompressionStream("gzip");
      const stream = new Blob([bytes]).stream().pipeThrough(ds);
      const json = await new Response(stream).text();
      const parsed: unknown = JSON.parse(json);
      return isImportLdPayload(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return decodeImportLdHash(hash);
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUtf8(value: string): string {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const binary = atob(value + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Bookmarklet that reads Recipe JSON-LD on the open page and opens Whisk
 * `/import/ld` so the existing localStorage session can save it.
 *
 * A gzip `#ldz=` (or uncompressed `#ld=`) hash is the reliable path: Whisk
 * sends COOP: same-origin, which severs window.open from a Kitchn tab so
 * postMessage to that handle often fails. postMessage is still attempted
 * when the opener relationship survives (no COOP, same-origin tests).
 */
/** Uncompressed `#ld=` URL — iOS Shortcuts cannot gzip. */
export function buildImportLdHref(origin: string, payload: { url: string; jsonLd: unknown }): string {
  const o = origin.replace(/\/$/, "");
  return `${o}${IMPORT_LD_PATH}#ld=${encodeImportLdHash(payload)}`;
}

/**
 * JavaScript for Shortcuts → Run JavaScript on Web Page.
 * Calls `completion(url)` with an uncompressed `#ld=` Whisk import link.
 */
export function buildShortcutJavaScript(origin: string): string {
  const o = origin.replace(/\/$/, "");
  return `var O=${JSON.stringify(o)};function find(d){if(!d||typeof d!="object")return null;if(Array.isArray(d)){for(var i=0;i<d.length;i++){var f=find(d[i]);if(f)return f}return null}var t=d["@type"];if(t==="Recipe"||(typeof t==="string"&&/Recipe$/.test(t))||(Array.isArray(t)&&t.some(function(x){return x==="Recipe"||(typeof x==="string"&&/Recipe$/.test(x))})))return d;if(d["@graph"]){var g=find(d["@graph"]);if(g)return g}if(d.mainEntity){var m=find(d.mainEntity);if(m)return m}return null}var K={name:1,description:1,image:1,recipeIngredient:1,recipeInstructions:1,prepTime:1,cookTime:1,totalTime:1,recipeYield:1,recipeCategory:1,recipeCuisine:1,keywords:1,aggregateRating:1,url:1,mainEntityOfPage:1,author:1,nutrition:1,video:1,"@type":1,"@context":1,"@id":1};function slim(r){var o={"@type":"Recipe"};for(var k in r){if(K[k])o[k]=r[k]}return o}var nodes=[],ss=document.querySelectorAll('script[type="application/ld+json"]');for(var i=0;i<ss.length;i++){try{var p=JSON.parse(ss[i].textContent||"");var r=find(p);if(r)nodes.push(slim(r))}catch(e){}}if(!nodes[0]){completion("");return}var payload={v:1,type:"whisk-import-ld",url:location.href,jsonLd:nodes[0]};var json=JSON.stringify(payload);var raw=btoa(unescape(encodeURIComponent(json))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");completion(O+"/import/ld#ld="+raw);`;
}

export function buildBookmarkletHref(origin: string): string {
  const o = origin.replace(/\/$/, "");
  const code = `void((async function(){var O=${JSON.stringify(o)};function find(d){if(!d||typeof d!="object")return null;if(Array.isArray(d)){for(var i=0;i<d.length;i++){var f=find(d[i]);if(f)return f}return null}var t=d["@type"];if(t==="Recipe"||(typeof t==="string"&&/Recipe$/.test(t))||(Array.isArray(t)&&t.some(function(x){return x==="Recipe"||(typeof x==="string"&&/Recipe$/.test(x))})))return d;if(d["@graph"]){var g=find(d["@graph"]);if(g)return g}if(d.mainEntity){var m=find(d.mainEntity);if(m)return m}return null}var K={name:1,description:1,image:1,recipeIngredient:1,recipeInstructions:1,prepTime:1,cookTime:1,totalTime:1,recipeYield:1,recipeCategory:1,recipeCuisine:1,keywords:1,aggregateRating:1,url:1,mainEntityOfPage:1,author:1,nutrition:1,video:1,"@type":1,"@context":1,"@id":1};function slim(r){var o={"@type":"Recipe"};for(var k in r){if(K[k])o[k]=r[k]}return o}var nodes=[],ss=document.querySelectorAll('script[type="application/ld+json"]');for(var i=0;i<ss.length;i++){try{var p=JSON.parse(ss[i].textContent||"");var r=find(p);if(r)nodes.push(slim(r))}catch(e){}}if(!nodes[0]){alert("No Recipe JSON-LD on this page. Save to Whisk reads structured recipe data from the page.");return}var payload={v:1,type:"whisk-import-ld",url:location.href,jsonLd:nodes[0]};var target=O+"/import/ld";var json=JSON.stringify(payload);try{if(typeof CompressionStream==="function"){var cs=new CompressionStream("gzip");var wr=cs.writable.getWriter();wr.write(new TextEncoder().encode(json));wr.close();var buf=await new Response(cs.readable).arrayBuffer();var u=new Uint8Array(buf),bin="";for(var i=0;i<u.length;i++)bin+=String.fromCharCode(u[i]);var gz=btoa(bin).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");if(gz.length<16000)target+="#ldz="+gz}}catch(e){}if(target.indexOf("#")<0){try{var raw=btoa(unescape(encodeURIComponent(json))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");if(raw.length<16000)target+="#ld="+raw}catch(e){}}var w=window.open(target,"_blank");if(!w){if(target.indexOf("#")>0){location.href=target;return}alert("Allow pop-ups for this site, then tap Save to Whisk again.");return}var n=0,t=setInterval(function(){n++;try{w.postMessage(payload,O)}catch(e){}if(n>50)clearInterval(t)},120);window.addEventListener("message",function onAck(e){if(e.origin!==O)return;if(e.data&&e.data.type==="whisk-import-ld-ack"){clearInterval(t);window.removeEventListener("message",onAck)}})})())`;
  return `javascript:${code}`;
}
