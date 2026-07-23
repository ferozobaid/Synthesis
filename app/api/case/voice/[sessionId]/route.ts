import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { voiceCaseRecord } from "@/lib/voice/voice-case-records";
import { loadSession } from "@/lib/voice/session-store";
import { CASE_STATES } from "@/lib/types";

function tokenMatches(provided: string, storedHashHex: string): boolean {
  try {
    const a = createHash("sha256").update(provided).digest();
    const b = Buffer.from(storedHashHex, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

export async function GET(
  req: NextRequest,
  ctx: { params: { sessionId: string } },
) {
  const sessionId = ctx.params?.sessionId ?? "";
  const token = req.headers.get("x-case-voice-token") ?? "";
  if (!sessionId || !token) return notFound();

  const record = await loadSession(sessionId).catch(() => null);
  if (!record || record.module !== "case" || !record.projectionTokenHash) return notFound();
  if (!tokenMatches(token, record.projectionTokenHash)) return notFound();

  const c = voiceCaseRecord(record.caseId);
  if (!c) return notFound();

  const stage = record.session.fsm_state;
  const exhibits = record.session.exhibits_revealed
    .map((id) => c.exhibits.find((e) => e.id === id) ?? null)
    .filter(Boolean);
  const turnsBySequence = new Map(
    [...(record.projectedTurns ?? [])]
      .sort((a, b) => a.turnSeq - b.turnSeq)
      .map((turn) => [turn.turnSeq, turn]),
  );
  const turns = [...turnsBySequence.values()];
  const lastTurn = turns[turns.length - 1];

  return NextResponse.json({
    caseId: record.caseId,
    caseTitle: c.title,
    caseDescription: record.selectedCaseDescription ?? null,
    openingText: record.openingText ?? c.prompt ?? "Let's begin.",
    readinessStatus: record.readinessStatus ?? "confirmed",
    readinessConfirmedAt: record.readinessConfirmedAt ?? null,
    conversationStatus: record.conversationStatus ?? "active",
    liveStatus: record.liveStatus ?? "active",
    concludedAt: record.concludedAt ?? null,
    stage,
    stageIndex: CASE_STATES.indexOf(stage),
    complete: record.session.complete,
    turnSeq: record.turnSeq ?? 0,
    responseSeq: record.responseSeq ?? record.turnSeq ?? 0,
    lastAction: lastTurn?.action ?? null,
    score: record.score ?? null,
    exhibits,
    turns,
    updatedAt: record.updatedAt,
  });
}
