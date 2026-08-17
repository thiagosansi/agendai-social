import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { requireSameOriginLenient } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/session";
import { patchViewerUserSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Prisma's P2025 (record to update/delete not found) error code.
const RECORD_NOT_FOUND = "P2025";

// PATCH /api/users/[id]
// Toggles a ViewerUser's active flag (deactivating a viewer immediately
// blocks new logins; app/layout.tsx also re-checks `active` on every
// request and clears an existing session if it flips to false). Same-origin
// (lenient) plus owner-only.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOriginLenient(req);
  if (originError) return originError;

  const authError = await requireOwner(req);
  if (authError) return authError;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = patchViewerUserSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const user = await prisma.viewerUser.update({
      where: { id },
      data: { active: parsed.data.active },
      select: { id: true, username: true, active: true, createdAt: true },
    });

    return Response.json({ user });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === RECORD_NOT_FOUND) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    throw error;
  }
}

// DELETE /api/users/[id]
// Permanently removes a ViewerUser. Same-origin (lenient) plus owner-only.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOriginLenient(req);
  if (originError) return originError;

  const authError = await requireOwner(req);
  if (authError) return authError;

  const { id } = await params;

  try {
    await prisma.viewerUser.delete({ where: { id } });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === RECORD_NOT_FOUND) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    throw error;
  }
}
