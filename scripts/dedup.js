const data = JSON.parse(require("fs").readFileSync("C:/tmp/all-recipes.json", "utf8"));
console.log("Total recipes:", data.length);

const titles = {};
const dupes = [];

for (const r of data) {
  if (titles[r.title]) {
    dupes.push({
      id: r.id,
      title: r.title,
      hasThumb: !!r.thumbnailUrl,
      firstId: titles[r.title].id,
      firstThumb: titles[r.title].hasThumb,
    });
  } else {
    titles[r.title] = { id: r.id, hasThumb: !!r.thumbnailUrl };
  }
}

console.log("Duplicates:", dupes.length);

const toDelete = [];
for (const d of dupes) {
  if (d.hasThumb && !d.firstThumb) {
    // New one has image, old one doesn't — delete old
    toDelete.push(d.firstId);
    console.log("  DELETE", d.firstId, "(no thumb) KEEP", d.id, "for:", d.title);
  } else {
    // Delete the newer duplicate
    toDelete.push(d.id);
    console.log("  DELETE", d.id, "KEEP", d.firstId, "for:", d.title);
  }
}

require("fs").writeFileSync("/tmp/delete-ids.json", JSON.stringify(toDelete));
console.log("\nIDs to delete:", toDelete.length);
