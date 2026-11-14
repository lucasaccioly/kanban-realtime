import { Router } from "express";
import { actorOf } from "../boards/routes.js";
import { clientMutationId as cmid } from "../lib/position.js";
import { deleteCard, moveCard, updateCard } from "./service.js";

export const cardsRouter = Router();

cardsRouter.patch("/:id", async (req, res) => {
  res.json(await updateCard(await actorOf(req.userId!), req.params.id, req.body, cmid(req)));
});

cardsRouter.post("/:id/move", async (req, res) => {
  res.json(await moveCard(await actorOf(req.userId!), req.params.id, req.body, cmid(req)));
});

cardsRouter.delete("/:id", async (req, res) => {
  await deleteCard(await actorOf(req.userId!), req.params.id, cmid(req));
  res.status(204).end();
});
