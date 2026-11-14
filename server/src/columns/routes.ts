import { Router } from "express";
import { actorOf } from "../boards/routes.js";
import { createCard } from "../cards/service.js";
import { clientMutationId as cmid } from "../lib/position.js";
import { deleteColumn, updateColumn } from "./service.js";

export const columnsRouter = Router();

columnsRouter.patch("/:id", async (req, res) => {
  res.json(await updateColumn(await actorOf(req.userId!), req.params.id, req.body, cmid(req)));
});

columnsRouter.delete("/:id", async (req, res) => {
  await deleteColumn(await actorOf(req.userId!), req.params.id, cmid(req));
  res.status(204).end();
});

columnsRouter.post("/:id/cards", async (req, res) => {
  res.status(201).json(await createCard(await actorOf(req.userId!), req.params.id, req.body, cmid(req)));
});
