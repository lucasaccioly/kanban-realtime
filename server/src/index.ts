import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { startBot } from "./bot/teammate.js";
import { startGuestCleanup } from "./jobs/cleanupGuests.js";
import { attachRealtime } from "./realtime/socket.js";

const port = Number(process.env.PORT ?? 3002);
const server = createServer(createApp());
attachRealtime(server);
startGuestCleanup();
startBot();
server.listen(port, () => console.log(`FlowBoard API on http://localhost:${port}`));
