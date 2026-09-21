#!/usr/bin/env node
// Smoke test for the Piece lifecycle API (app/api/pieces/**). Exercises the
// DoD cases from the task brief plus a couple of adjacent edge cases (409
// duplicate-in-week, unapprove, stale-publishAt auto-reschedule on approve).
// Run `pnpm dev` (or `PORT=3001 pnpm dev`) first, then `pnpm smoke`.
//
// Usage: PORT=3001 node scripts/api-smoke.mjs

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;
const TOKEN = process.env.GENERATION_API_TOKEN || "dev-token-change-me";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`  ok - ${message}`);
  } else {
    failed += 1;
    console.error(`  FAIL - ${message}`);
  }
}

async function jsonFetch(pathname, options = {}) {
  const res = await fetch(`${BASE_URL}${pathname}`, options);
  let body = null;
  try {
    body = await res.json();
  } catch {
    // no body / not JSON
  }
  return { res, body };
}

function futurePublishAt(daysFromNow = 7) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString();
}

async function main() {
  console.log(`Running API smoke tests against ${BASE_URL}\n`);

  // 1. POST /api/pieces without bearer -> 401
  console.log("1. POST /api/pieces without bearer token");
  {
    const { res, body } = await jsonFetch("/api/pieces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pillar: "a",
        segment: "salao",
        format: "carrossel",
        caption: "Marque horário pelo link, sem ligação.",
        imagePrompt: "print da tela de agenda",
        publishAt: futurePublishAt(),
      }),
    });
    assert(res.status === 401, `status is 401 (got ${res.status})`);
    assert(body && typeof body.error === "string", "response has an error field");
  }

  // 2. POST with bearer + banned promise in caption -> 422 citing the term
  console.log("\n2. POST /api/pieces with a forbidden claim in the caption");
  {
    const { res, body } = await jsonFetch("/api/pieces", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        pillar: "a",
        segment: "salao",
        format: "carrossel",
        caption: "Receba lembrete automático 24h antes do seu horário.",
        imagePrompt: "print da tela de agenda",
        publishAt: futurePublishAt(),
      }),
    });
    assert(res.status === 422, `status is 422 (got ${res.status})`);
    assert(Array.isArray(body?.violations) && body.violations.length > 0, "response includes violations[]");
    assert(
      body?.violations?.some((v) => v.id === "lembrete-automatico"),
      'violation cites "lembrete-automatico"',
    );
  }

  // 3. POST a valid draft piece -> 201
  console.log("\n3. POST /api/pieces with a valid payload");
  let pieceId;
  const uniqueSegment = `smoke-${Date.now()}`;
  {
    const { res, body } = await jsonFetch("/api/pieces", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        pillar: "a",
        segment: uniqueSegment,
        format: "carrossel",
        caption: "Seus clientes marcam horário sozinhos, pelo link. agendai.space — 30 dias grátis, sem cartão",
        imagePrompt: "print real da tela de Agenda do Portal da Equipe",
        publishAt: futurePublishAt(),
      }),
    });
    assert(res.status === 201, `status is 201 (got ${res.status})`);
    assert(body?.piece?.status === "draft", `piece status is draft (got ${body?.piece?.status})`);
    assert(body?.piece?.claimCheckPassed === true, "claimCheckPassed is true");
    pieceId = body?.piece?.id;
    assert(typeof pieceId === "string" && pieceId.length > 0, "piece has an id");
  }

  // 3b. Duplicate pillar+segment+format in the same ISO week -> 409
  console.log("\n3b. POST duplicate pillar+segment+format in the same ISO week");
  {
    const { res, body } = await jsonFetch("/api/pieces", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        pillar: "a",
        segment: uniqueSegment,
        format: "carrossel",
        caption: "Outra legenda qualquer, sem promessas proibidas.",
        imagePrompt: "outra cena",
        publishAt: futurePublishAt(2),
      }),
    });
    assert(res.status === 409, `status is 409 (got ${res.status})`);
    assert(body && typeof body.error === "string", "response has an error field");
  }

  if (!pieceId) {
    console.error("\nCannot continue — piece was not created in step 3.");
    printSummary();
    process.exit(1);
  }

  // 4. PATCH status=approved without any image -> 422
  console.log("\n4. PATCH status=approved without any image");
  {
    const { res, body } = await jsonFetch(`/api/pieces/${pieceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    assert(res.status === 422, `status is 422 (got ${res.status})`);
    assert(body && typeof body.error === "string", "response has an error field");
  }

  // 4b. PATCH caption with a forbidden claim -> 422, caption unchanged
  console.log("\n4b. PATCH caption with a forbidden claim");
  {
    const { res, body } = await jsonFetch(`/api/pieces/${pieceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caption: "Agenda cheia garantida em 30 dias." }),
    });
    assert(res.status === 422, `status is 422 (got ${res.status})`);
    assert(
      body?.violations?.some((v) => v.id === "resultado-garantido"),
      'violation cites "resultado-garantido"',
    );
  }

  function pngForm(label) {
    // 1x1 transparent PNG
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const pngBytes = Buffer.from(pngBase64, "base64");
    const form = new FormData();
    form.set("file", new Blob([pngBytes], { type: "image/png" }), `${label}.png`);
    return form;
  }

  // 5. Image upload -> appends a PieceImage
  console.log("\n5. POST /api/pieces/[id]/image (1st image)");
  let firstImageId, secondImageId;
  {
    const res = await fetch(`${BASE_URL}/api/pieces/${pieceId}/image`, { method: "POST", body: pngForm("a") });
    const body = await res.json().catch(() => null);
    assert(res.status === 200, `status is 200 (got ${res.status})`);
    assert(Array.isArray(body?.piece?.images) && body.piece.images.length === 1, "piece.images has 1 entry");
    firstImageId = body?.piece?.images?.[0]?.id;
    console.log(`     image: ${body?.piece?.images?.[0]?.url}`);
  }

  // 5a. carrossel with only 1 image -> 422 (needs >= 2 to approve)
  console.log("\n5a. PATCH status=approved with a carrossel piece that has only 1 image");
  {
    const { res, body } = await jsonFetch(`/api/pieces/${pieceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    assert(res.status === 422, `status is 422 (got ${res.status})`);
    assert(body?.error === "Carrossel precisa de pelo menos 2 imagens", `error message matches (got "${body?.error}")`);
  }

  // 5b. Oversized/wrong content-type upload -> 400
  console.log("\n5b. POST /api/pieces/[id]/image with unsupported content type");
  {
    const form = new FormData();
    form.set("file", new Blob([Buffer.from("not an image")], { type: "text/plain" }), "test.txt");
    const res = await fetch(`${BASE_URL}/api/pieces/${pieceId}/image`, { method: "POST", body: form });
    assert(res.status === 400, `status is 400 (got ${res.status})`);
  }

  // 5c. 2nd image -> appended, not replaced (carrossel format)
  console.log("\n5c. POST /api/pieces/[id]/image (2nd image, carrossel appends)");
  {
    const res = await fetch(`${BASE_URL}/api/pieces/${pieceId}/image`, { method: "POST", body: pngForm("b") });
    const body = await res.json().catch(() => null);
    assert(res.status === 200, `status is 200 (got ${res.status})`);
    assert(Array.isArray(body?.piece?.images) && body.piece.images.length === 2, "piece.images has 2 entries");
    secondImageId = body?.piece?.images?.[1]?.id;
    assert(
      body?.piece?.images?.[0]?.id === firstImageId && body?.piece?.images?.[1]?.id === secondImageId,
      "images keep upload order (sortOrder 0, 1)",
    );
  }

  // 5d. Reorder: swap the two images -> publish order flips
  console.log("\n5d. PATCH /api/pieces/[id]/image/reorder (swap order)");
  {
    const res = await fetch(`${BASE_URL}/api/pieces/${pieceId}/image/reorder`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageOrder: [secondImageId, firstImageId] }),
    });
    const body = await res.json().catch(() => null);
    assert(res.status === 200, `status is 200 (got ${res.status})`);
    assert(
      body?.piece?.images?.[0]?.id === secondImageId && body?.piece?.images?.[1]?.id === firstImageId,
      "reorder flips the publish order",
    );
  }

  // 5e. Reorder back to the original order, so later steps see a stable order
  console.log("\n5e. PATCH /api/pieces/[id]/image/reorder (restore order)");
  {
    const res = await fetch(`${BASE_URL}/api/pieces/${pieceId}/image/reorder`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageOrder: [firstImageId, secondImageId] }),
    });
    const body = await res.json().catch(() => null);
    assert(res.status === 200, `status is 200 (got ${res.status})`);
    assert(
      body?.piece?.images?.[0]?.id === firstImageId && body?.piece?.images?.[1]?.id === secondImageId,
      "reorder restores the original order",
    );
  }

  // 6. PATCH status=approved now that the carrossel has 2 images -> 200
  console.log("\n6. PATCH status=approved with 2 images present");
  {
    const { res, body } = await jsonFetch(`/api/pieces/${pieceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    assert(res.status === 200, `status is 200 (got ${res.status})`);
    assert(body?.piece?.status === "approved", `piece status is approved (got ${body?.piece?.status})`);
  }

  // 6a. Images are frozen once approved: upload/delete both -> 409
  console.log("\n6a. Image mutations on an approved piece -> 409");
  {
    const uploadRes = await fetch(`${BASE_URL}/api/pieces/${pieceId}/image`, { method: "POST", body: pngForm("c") });
    assert(uploadRes.status === 409, `upload status is 409 (got ${uploadRes.status})`);

    const deleteRes = await fetch(`${BASE_URL}/api/pieces/${pieceId}/image/${firstImageId}`, { method: "DELETE" });
    assert(deleteRes.status === 409, `delete status is 409 (got ${deleteRes.status})`);
  }

  // 6b. Unapprove: approved -> draft
  console.log("\n6b. PATCH status=draft (unapprove)");
  {
    const { res, body } = await jsonFetch(`/api/pieces/${pieceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "draft" }),
    });
    assert(res.status === 200, `status is 200 (got ${res.status})`);
    assert(body?.piece?.status === "draft", `piece status is draft (got ${body?.piece?.status})`);
  }

  // 7. GET /api/pieces lists the created piece with its images
  console.log("\n7. GET /api/pieces?since=6w");
  {
    const { res, body } = await jsonFetch("/api/pieces?since=6w");
    assert(res.status === 200, `status is 200 (got ${res.status})`);
    const created = body?.pieces?.find((p) => p.id === pieceId);
    assert(created !== undefined, "list includes the created piece");
    assert(Array.isArray(created?.images) && created.images.length === 2, "listed piece has its 2 images");
  }

  // 8. Stale schedule on approve: piece's STORED publishAt is far in the
  // past (drifted while it sat in draft) and the caller approves without
  // sending an explicit publishAt -> reschedules atomically instead of
  // 422ing, landing on the next free cadence slot.
  console.log("\n8. PATCH status=approved with a stale STORED publishAt -> auto-reschedule");
  {
    const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { res: patchDateRes } = await jsonFetch(`/api/pieces/${pieceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publishAt: staleDate }),
    });
    assert(patchDateRes.status === 200, `publishAt update succeeds (got ${patchDateRes.status})`);

    const beforeApprove = new Date();
    const { res, body } = await jsonFetch(`/api/pieces/${pieceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    assert(res.status === 200, `status is 200 (got ${res.status})`);
    assert(body?.rescheduled === true, `response has rescheduled: true (got ${body?.rescheduled})`);
    assert(body?.piece?.status === "approved", `piece status is approved (got ${body?.piece?.status})`);
    assert(
      typeof body?.piece?.publishAt === "string" && new Date(body.piece.publishAt) > beforeApprove,
      `piece.publishAt was moved into the future (got ${body?.piece?.publishAt})`,
    );
  }

  // 9. Stale schedule with an EXPLICIT publishAt on approve -> still 422s
  // (the reschedule fallback only applies when the caller didn't set
  // publishAt themselves in this same PATCH).
  console.log("\n9. PATCH status=approved with an explicit stale publishAt -> 422 (no reschedule)");
  {
    const { res: unapproveRes, body: unapproveBody } = await jsonFetch(`/api/pieces/${pieceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "draft" }),
    });
    assert(unapproveRes.status === 200, `unapprove succeeds (got ${unapproveRes.status})`);
    assert(unapproveBody?.piece?.status === "draft", `piece status is draft (got ${unapproveBody?.piece?.status})`);

    const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { res, body } = await jsonFetch(`/api/pieces/${pieceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "approved", publishAt: staleDate }),
    });
    assert(res.status === 422, `status is 422 (got ${res.status})`);
    assert(body && typeof body.error === "string", "response has an error field");
  }

  printSummary();
  process.exit(failed > 0 ? 1 : 0);
}

function printSummary() {
  console.log(`\n${passed} passed, ${failed} failed`);
}

main().catch((error) => {
  console.error("Smoke test crashed:", error);
  process.exit(1);
});
