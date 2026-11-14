import jwt from "jsonwebtoken";
import { HttpError } from "../errors.js";

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
}

export function signToken(userId: string): string {
  return jwt.sign({}, secret(), { subject: userId, expiresIn: "7d", algorithm: "HS256" });
}

export function verifyToken(token: string): string {
  try {
    const payload = jwt.verify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload === "string" || !payload.sub) throw new Error("no subject");
    return payload.sub;
  } catch {
    throw new HttpError(401, "Não autenticado");
  }
}
