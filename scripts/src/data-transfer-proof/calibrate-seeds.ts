import { writeFile } from "node:fs/promises";
import { buildSeedContract } from "../data-transfer/seed-contract";
import { withOwnedPair } from "./owned-pair";

await withOwnedPair(async pair => {
  const client = await pair.target.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const contract = await buildSeedContract(client);
    await client.query("COMMIT");
    await writeFile(new URL("../data-transfer/seed-contract.json", import.meta.url), `${JSON.stringify(contract, null, 2)}\n`);
    for (const entry of contract.tables.filter(entry => entry.count > 0)) {
      console.log(`SEED ${entry.table} count=${entry.count} hash=${entry.hash} omitted=${entry.omittedColumns.join(",")}`);
    }
    console.log(`SEED_CONTRACT tables=${contract.tables.length} rows=${contract.tables.reduce((sum, entry) => sum + entry.count, 0)}`);
  } finally { client.release(); }
}, { builtCanonical: true });
console.log("OWNED_CLUSTER_REMOVED");