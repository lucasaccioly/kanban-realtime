import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { attachRealtime } from "./realtime/socket.js";

const port = Number(process.env.PORT ?? 3002);
const server = createServer(createApp());
attachRealtime(server);
server.listen(port, () => console.log(`FlowBoard API on http://localhost:${port}`));
