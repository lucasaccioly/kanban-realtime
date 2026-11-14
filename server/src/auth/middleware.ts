import type { RequestHandler } from "express";
import { HttpError } from "../errors.js";
import { verifyToken } from "./token.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next(new HttpError(401, "Não autenticado"));
  req.userId = verifyToken(header.slice(7));
  next();
};
