import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { requireSameOriginLenient } from "@/lib/auth";
import { hashPassword } from "@/lib/passwords";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/session";
import { createViewerUserSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Prisma's P2002 (unique constraint violation) error code.
const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

// GET /api/users
// Lists every ViewerUser (id, username, role, active, createdAt only —
// never the passwordHash), oldest first, for the Config page's
// user-management table. Same-origin (lenient, matching login/logout) plus
// owner-only.
export async function GET(req: NextRequest) {
  const originError = requireSameOriginLenient(req);
  if (originError) return originError;

  const authError = await requireOwner(req);
  if (authError) return authError;

  const users = await prisma.viewerUser.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, username: true, role: true, active: true, createdAt: true },
  });

  return Response.json({ users });
}

// POST /api/users
// Creates a new ViewerUser (role "viewer" or "approver", see
// lib/validation.ts USER_ROLES). Same-origin (lenient) plus owner-only.
// Rejects a duplicate username with 409 rather than the zod 400s used for
// shape violations.
export async function POST(req: NextRequest) {
  const originError = requireSameOriginLenient(req);
  if (originError) return originError;

  const authError = await requireOwner(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = createViewerUserSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { username, password, role } = parsed.data;

  const duplicate = await prisma.viewerUser.findUnique({ where: { username } });
  if (duplicate) {
    return Response.json({ error: "usuário já existe" }, { status: 409 });
  }

  const passwordHash = hashPassword(password);

  try {
    const user = await prisma.viewerUser.create({
      data: { username, passwordHash, role },
      select: { id: true, username: true, role: true, active: true, createdAt: true },
    });

    return Response.json({ user }, { status: 201 });
  } catch (error) {
    // Race: another request created the same username between the check
    // above and this create.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
      return Response.json({ error: "usuário já existe" }, { status: 409 });
    }
    throw error;
  }
}
