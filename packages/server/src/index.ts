import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/index.js";

const config = loadConfig();
const database = createDatabase(config);
const app = buildApp({ database, config });

database
  .initialize()
  .then(() => app.listen({ port: config.port, host: config.host }))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
