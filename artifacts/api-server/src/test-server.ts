import app from "./app";

const rawPort = process.env.PORT ?? "0";
const port = Number(rawPort);

if (!Number.isInteger(port) || port < 0) {
  throw new Error(`Invalid test server PORT value: "${rawPort}".`);
}

const server = app.listen(port, "127.0.0.1");

server.once("error", (error) => {
  console.error(error);
  process.exit(1);
});

server.once("listening", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test API server did not expose a TCP address.");
  }

  console.log(`Test API server listening on ${address.port}`);
});

function shutDown(signal: NodeJS.Signals) {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
  console.log(`Test API server received ${signal}; closing.`);
}

process.once("SIGINT", () => shutDown("SIGINT"));
process.once("SIGTERM", () => shutDown("SIGTERM"));