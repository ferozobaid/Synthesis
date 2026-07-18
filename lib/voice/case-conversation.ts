import type { CaseAction, CaseExhibit, CaseState } from "@/lib/types";

interface CaseConversationTurn {
  candidateText: string;
  stageBefore: CaseState;
  stageAfter: CaseState;
  action: CaseAction;
  backendText: string;
  exhibit: CaseExhibit | null;
  complete: boolean;
}

function clarificationAnswer(candidateText: string): string {
  const answer = candidateText.toLowerCase();
  if (/time|horizon|payback|profitable|profitability/.test(answer)) {
    return "No fixed time horizon is provided, so state a reasonable assumption and test it against the case economics.";
  }
  if (/scope|market|brand|country|countries|region/.test(answer)) {
    return "Use Beautify's broader global business as the working scope.";
  }
  if (/cost|invest|fund|bear|pay for/.test(answer)) {
    return "Treat the retraining and technology investment shown in the case as Beautify's.";
  }
  return "Use the case prompt as your working scope and state any assumption you need.";
}

/** Voice-only phrasing layered over a completed, server-owned FSM decision. */
export function caseConversationText(turn: CaseConversationTurn): string {
  if (turn.complete || turn.stageAfter === "scoring") {
    return "Thank you. That concludes the case.";
  }

  if (turn.action === "reveal") {
    const title = turn.exhibit?.title ?? "this exhibit";
    return `Let's look at ${title}. Take a moment, then tell me what stands out and what it means for Beautify.`;
  }

  if (turn.action === "hint") {
    return `Here's a nudge: ${turn.backendText}`;
  }

  if (turn.action === "probe" || turn.action === "redirect") {
    if (turn.stageBefore === "clarification") {
      return `${clarificationAnswer(turn.candidateText)} What else would you like to clarify before structuring your approach?`;
    }
    return turn.backendText;
  }

  switch (turn.stageAfter) {
    case "clarification":
      return "That's a clear framing. What would you like to clarify before structuring your approach?";
    case "framework":
      return "Good. Let's move to your structure. What factors should Beautify consider as it shifts consultants into virtual-advisor roles?";
    case "analysis":
      return "That's a sensible structure. Let's start with the customer. What would make a high-touch in-store customer switch to a mostly virtual experience?";
    case "data_reveal":
      return "Good. Let's ground the case in data. Are you ready for the first exhibit?";
    case "pressure_test":
      return "Good. Now pressure-test your conclusion. What is the strongest argument against this shift, and how would you address it?";
    case "recommendation":
      return "Understood. Please give me your concise final recommendation, supported by the key evidence and next steps.";
    default:
      return turn.backendText;
  }
}
