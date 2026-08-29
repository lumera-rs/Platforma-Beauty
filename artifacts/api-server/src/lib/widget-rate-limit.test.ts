import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { pool } from "@workspace/db";
import app from "../app";

async function run(): Promise<void> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const slug = `rate-limit-${randomUUID()}`;

  try {
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/widget/salons/${slug}/booking-groups`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // A direct client controls this header. Changing it must not create a
          // fresh rate-limit identity when Express does not trust the peer.
          "x-forwarded-for": `198.51.100.${index + 1}`,
        },
        body: "{}",
      });
      statuses.push(response.status);
    }

    assert.deepEqual(
      statuses.slice(0, 5),
      [400, 400, 400, 400, 400],
      "valid direct requests below the booking limit must reach body validation",
    );
    assert.equal(statuses[5], 429, "spoofing a different X-Forwarded-For value must not bypass the booking limit");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

try {
  await run();
  console.log("Widget rate-limit spoofing regression passed.");
} finally {
  await pool.end();
}