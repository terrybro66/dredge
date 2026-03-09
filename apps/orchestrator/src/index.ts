import dotenv from "dotenv";
import path from "path";
dotenv.config({
  path: path.resolve(__dirname, "../../../.env"),
  override: true,
});
console.log("after override:", process.env.DEEPSEEK_API_KEY?.slice(-4));
import express from "express";
import cors from "cors";
import { queryRouter } from "./query";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/query", queryRouter);

app.listen(PORT, () => {
  console.log(`🚔 query-os orchestrator running on http://localhost:${PORT}`);
});
