import app from "./app";
import { logger } from "./lib/logger";
import { migrateDb } from "./lib/migrate";
import { autoRegisterWebhook } from "./telegram/autoSetup";

// Process-level safety net: never let a stray error or a transient
// network/DB hiccup take the bot down. Replit auto-restarts on crash,
// but logging-and-continuing keeps the Telegram webhook responsive
// and avoids losing in-flight requests.
process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaughtException — keeping process alive");
});
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "unhandledRejection — keeping process alive");
});
process.on("warning", (warning) => {
  logger.warn({ warning: warning.message, name: warning.name }, "node warning");
});
// Graceful shutdown on SIGTERM/SIGINT (Replit deploy/restart signals)
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    logger.info({ signal: sig }, "received shutdown signal, exiting cleanly");
    setTimeout(() => process.exit(0), 200).unref();
  });
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Run DB migration then register webhook — non-blocking
  migrateDb()
    .then(() => autoRegisterWebhook())
    .catch((e) => logger.error({ err: e }, "startup tasks failed"));

  // Periodically re-register the webhook in case Replit's edge proxy
  // changes domains (idle wake-up, redeploy, etc.). 6h cadence — cheap.
  setInterval(() => {
    autoRegisterWebhook().catch((e) =>
      logger.error({ err: e }, "periodic autoRegisterWebhook failed"),
    );
  }, 6 * 60 * 60 * 1000).unref();
});

server.on("clientError", (err, socket) => {
  logger.warn({ err: err.message }, "clientError");
  try {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  } catch {
    /* ignore */
  }
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
