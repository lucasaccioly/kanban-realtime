import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { HttpError } from "../errors.js";
import { rateLimit } from "../lib/rateLimit.js";
import { createGuestDemoBoard } from "../seed/guestBoard.js";
import { requireAuth } from "./middleware.js";
import { signToken } from "./token.js";

const registerSchema = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  // bcrypt only uses the first 72 bytes
  password: z.string().min(8).refine((p) => Buffer.byteLength(p) <= 72, "Senha muito longa"),
});
const loginSchema = z.object({ email: z.string().trim().toLowerCase(), password: z.string() });

type UserRow = { id: string; name: string; email: string | null; isGuest: boolean };
export const publicUser = ({ id, name, email, isGuest }: UserRow) => ({ id, name, email, isGuest });

const emailTaken = () => new HttpError(409, "E-mail já cadastrado");

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  const data = registerSchema.parse(req.body);
  if (await prisma.user.findUnique({ where: { email: data.email } })) throw emailTaken();
  const passwordHash = await bcrypt.hash(data.password, 10);
  const user = await prisma.user.create({ data: { name: data.name, email: data.email, passwordHash } }).catch((e) => {
    throw e?.code === "P2002" ? emailTaken() : e; // lost a race with a parallel register
  });
  res.status(201).json({ token: signToken(user.id), user: publicUser(user) });
});

authRouter.post("/login", rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  const data = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user?.passwordHash || !(await bcrypt.compare(data.password, user.passwordHash))) {
    throw new HttpError(401, "E-mail ou senha inválidos");
  }
  res.json({ token: signToken(user.id), user: publicUser(user) });
});

authRouter.post("/guest", rateLimit({ windowMs: 60 * 60_000, max: 5 }), async (_req, res) => {
  const { user, boardId } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name: "Visitante", isGuest: true } });
    return { user, boardId: await createGuestDemoBoard(tx, user.id) };
  });
  res.status(201).json({ token: signToken(user.id), user: publicUser(user), boardId });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) throw new HttpError(401, "Não autenticado");
  res.json({ user: publicUser(user) });
});
