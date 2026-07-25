import { describe, expect, it } from "vitest";
import {
  mapQuestionBankTranscript,
  questionAnchorManifest,
} from "@/lib/voice/question-bank-transcript";
import { CASE_VOICE_QUESTION_ANCHOR_VERSION } from "@/lib/voice/case-native-config";
import type { NormalizedVoiceTranscriptTurn } from "@/lib/voice/transcript";

const CASE_ID = "data_analyst_technical_round";
const VERSION = CASE_VOICE_QUESTION_ANCHOR_VERSION;
const manifest = questionAnchorManifest(CASE_ID, VERSION)!;
const ORDER = manifest.order;

let ordinal = 0;
function turn(role: "assistant" | "candidate", text: string): NormalizedVoiceTranscriptTurn {
  return { role, text, ordinal: ordinal++ };
}
function anchorTurn(id: string): NormalizedVoiceTranscriptTurn {
  return turn("assistant", `${manifest.anchors[id]} Here is the scenario, please walk me through it.`);
}
const ANSWER = "I would filter out the canceled orders, then join and aggregate revenue by month and region using a distinct customer count and reconcile the totals.";

function reset() {
  ordinal = 0;
}

describe("question-bank transcript mapping — primary spoken anchors", () => {
  it("maps every question when all anchors and answers are present", () => {
    reset();
    const transcript: NormalizedVoiceTranscriptTurn[] = [turn("assistant", "Welcome. Say ready to begin."), turn("candidate", "ready")];
    for (const id of ORDER) {
      transcript.push(anchorTurn(id), turn("candidate", ANSWER));
    }
    const mapped = mapQuestionBankTranscript(CASE_ID, VERSION, transcript)!;
    expect(mapped.observedQuestions).toEqual(ORDER);
    expect(mapped.answeredQuestions).toEqual(ORDER);
    expect(mapped.missingQuestions).toEqual([]);
    expect(mapped.partial).toBe(false);
    expect(mapped.partialReasons).toEqual([]);
  });

  it("readiness/greeting speech before question one is never attributed to a question", () => {
    reset();
    const transcript = [
      turn("candidate", "I am ready but give me a moment"),
      anchorTurn(ORDER[0]),
      turn("candidate", ANSWER),
    ];
    const mapped = mapQuestionBankTranscript(CASE_ID, VERSION, transcript)!;
    // Only the post-anchor answer counts; the pre-anchor candidate turn is dropped.
    expect(mapped.turns.filter((t) => t.role === "candidate").length).toBe(1);
    expect(mapped.answeredQuestions).toEqual([ORDER[0]]);
  });
});

describe("question-bank transcript mapping — deterministic fallbacks", () => {
  it("a missing anchor leaves that question unobserved and marks the report partial", () => {
    reset();
    const transcript: NormalizedVoiceTranscriptTurn[] = [];
    for (const id of ORDER) {
      if (id === ORDER[2]) {
        // Skip question three's anchor entirely (garbled/missed).
        transcript.push(turn("candidate", ANSWER));
        continue;
      }
      transcript.push(anchorTurn(id), turn("candidate", ANSWER));
    }
    const mapped = mapQuestionBankTranscript(CASE_ID, VERSION, transcript)!;
    expect(mapped.observedQuestions).not.toContain(ORDER[2]);
    expect(mapped.missingQuestions).toContain(ORDER[2]);
    expect(mapped.partial).toBe(true);
    expect(mapped.partialReasons).toContain("missing_anchor");
    // The other four questions still map correctly and never regress.
    expect(mapped.answeredQuestions).toEqual(ORDER.filter((id) => id !== ORDER[2]));
  });

  it("an observed-but-unanswered question is partial with missing_candidate_response", () => {
    reset();
    const transcript: NormalizedVoiceTranscriptTurn[] = [];
    for (const id of ORDER) {
      transcript.push(anchorTurn(id));
      transcript.push(turn("candidate", id === ORDER[4] ? "okay" : ANSWER));
    }
    const mapped = mapQuestionBankTranscript(CASE_ID, VERSION, transcript)!;
    expect(mapped.observedQuestions).toEqual(ORDER);
    expect(mapped.answeredQuestions).not.toContain(ORDER[4]);
    expect(mapped.missingQuestions).toEqual([ORDER[4]]);
    expect(mapped.partial).toBe(true);
    expect(mapped.partialReasons).toContain("missing_candidate_response");
  });

  it("no anchors at all yields an unusable, fully partial transcript (not a crash)", () => {
    reset();
    const transcript = [turn("assistant", "Let's just chat."), turn("candidate", ANSWER)];
    const mapped = mapQuestionBankTranscript(CASE_ID, VERSION, transcript)!;
    expect(mapped.observedQuestions).toEqual([]);
    expect(mapped.answeredQuestions).toEqual([]);
    expect(mapped.partial).toBe(true);
    expect(mapped.partialReasons).toContain("unusable_transcript");
  });

  it("returns null for an unknown case id or version (fails closed)", () => {
    expect(mapQuestionBankTranscript("nope", VERSION, [])).toBeNull();
    expect(mapQuestionBankTranscript(CASE_ID, "wrong-version", [])).toBeNull();
  });
});
