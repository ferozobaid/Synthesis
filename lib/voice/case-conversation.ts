import type { CaseAction, CaseExhibit, CaseState, Evaluation } from "@/lib/types";
import type {
  CaseFrameworkAssessment,
  FrameworkProbeObjective,
} from "@/lib/fsm/case-framework";
import type { CaseCandidateIntent } from "@/lib/voice/case-intent";

export const CASE_READINESS_PROMPT =
  "Hello, I’ll be your case interviewer today. We’ll be going through the Beautify case. Are you ready to begin?";
export const CASE_READINESS_CONFIRMED = "Great, let’s begin.";
export const CASE_NOT_READY_RESPONSE = "No problem. Let me know when you’re ready.";
export const CASE_ALREADY_READY_RESPONSE =
  "The case has begun. What would you like to clarify before structuring your approach?";
export const CASE_OPENING_QUESTION =
  "What would you like to clarify before structuring your approach?";

export interface CaseConversationTurn {
  candidateText: string;
  stageBefore: CaseState;
  stageAfter: CaseState;
  action: CaseAction;
  backendText: string;
  exhibit: CaseExhibit | null;
  complete: boolean;
  evaluation?: Evaluation;
  variationSeed?: string;
  frameworkAssessment?: CaseFrameworkAssessment;
}

interface ClarificationCoverage {
  timeHorizon: boolean;
  scope: boolean;
  costs: boolean;
  virtualDefinition: boolean;
  unsupportedFact: boolean;
}

function clarificationCoverage(candidateText: string): ClarificationCoverage {
  const answer = candidateText.toLowerCase();
  return {
    timeHorizon: /time|horizon|payback|profitable|profitability/.test(answer),
    scope: /scope|market|brand|country|countries|region/.test(answer),
    costs: /cost|invest|fund|bear|pay for|technology|training|operating/.test(answer),
    virtualDefinition: /what (?:does|would).*virtual|what do you mean by virtual|define virtual|virtual.*include|social.media channel/.test(answer),
    unsupportedFact: /market size|growth rate|revenue target|profit threshold|exact budget/.test(answer),
  };
}

function hasClarificationIntent(candidateText: string): boolean {
  return /\?|\b(?:clarif|what|which|who|when|where|how|is|are|do|does|will|would|should|could|can)\b/i.test(
    candidateText,
  );
}

export function isValidClarificationQuestion(candidateText: string): boolean {
  const coverage = clarificationCoverage(candidateText);
  return hasClarificationIntent(candidateText) && Object.values(coverage).some(Boolean);
}

function clarificationAnswer(candidateText: string, advancing: boolean): string | null {
  const coverage = clarificationCoverage(candidateText);
  if (!hasClarificationIntent(candidateText) || !Object.values(coverage).some(Boolean)) return null;

  const answers: string[] = [];
  if (coverage.timeHorizon) {
    answers.push(
      "The case does not specify a fixed profitability horizon, so use a three-year assessment horizon as a transparent working assumption.",
    );
  }
  if (coverage.scope) {
    answers.push(
      "Beautify is a global, multi-brand business; for this interview, assume the initial scope covers its major brands and priority markets.",
    );
  }
  if (coverage.costs) {
    answers.push(
      "Assume Beautify bears the technology, training, and ongoing operating costs; the case does not assign those costs to retail partners.",
    );
  }
  if (coverage.virtualDefinition) {
    answers.push(
      "Virtual includes using social-media channels and Beautify-managed online pages to advise customers and support sales.",
    );
  }
  if (coverage.unsupportedFact) {
    answers.push(
      "The case does not provide an exact figure for that point, so state a reasonable assumption rather than inventing data.",
    );
  }

  const next = advancing
    ? "Unless you have another clarification, please walk me through how you would structure the problem."
    : "Do you have another clarification, or are you ready to structure your approach?";
  return `Those are useful clarifications. ${answers.join(" ")} ${next}`;
}

export function caseOpeningAfterReadiness(authoredPrompt: string): string {
  return `${CASE_READINESS_CONFIRMED}\n\n${authoredPrompt}\n\n${CASE_OPENING_QUESTION}`;
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function variationIndex(seed: string, variants: number): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(hash, 31) + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % variants;
}

function frameworkAcknowledgement(assessment?: CaseFrameworkAssessment): string {
  const labels = assessment?.coveredGroups ?? [];
  return labels.length > 0
    ? `You’ve covered ${listWords(labels)}.`
    : "You have several relevant ideas on the table.";
}

function frameworkFeedback(
  assessment: CaseFrameworkAssessment | undefined,
  seed: string,
): string {
  const acknowledgement = frameworkAcknowledgement(assessment);
  const objective = assessment?.nextProbeObjective?.prompt;
  if (objective) return `${acknowledgement} ${objective}`;
  const objectives = [
    "Please group those ideas into distinct branches and explain what each branch would test.",
    "Make the structure explicit: name the branches, then place the relevant factors under each one.",
    "Let’s make the structure more mutually exclusive. How would you organize the factors into distinct areas?",
  ];
  return `${acknowledgement} ${objectives[variationIndex(seed, objectives.length)]}`;
}

function frameworkAdvanceFeedback(turn: CaseConversationTurn): string {
  const acknowledgement = frameworkAcknowledgement(turn.frameworkAssessment);
  const refinement = turn.frameworkAssessment?.refinementNeeded
    ? "The branches could be made more mutually exclusive, but the structure is sufficient to move forward."
    : "That is a workable structure.";
  return `${acknowledgement} ${refinement} ${turn.backendText}`;
}

function latestQuestion(text: string): string | null {
  const questions = text.match(/[^.!?]*\?/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
  return questions.at(-1) ?? null;
}

export function caseRepeatQuestion(currentPrompt: string, stage: CaseState): string {
  const question = latestQuestion(currentPrompt);
  if (question) return `Of course. ${question}`;
  const fallback: Partial<Record<CaseState, string>> = {
    clarification: CASE_OPENING_QUESTION,
    framework: "What external and internal factors should Beautify consider in making this decision?",
    analysis: "What would make customers switch from high-touch in-store service to a mostly virtual experience?",
    data_reveal: "What does the exhibit tell you, and what does it imply for Beautify?",
    pressure_test: "What is the strongest risk to your view, and how would you mitigate it?",
    recommendation: "What is your recommendation, the supporting evidence, the main risk, and the next step?",
  };
  return `Of course. ${fallback[stage] ?? "Please continue with your response."}`;
}

export function caseMetaConversationText(
  intent: CaseCandidateIntent,
  stage: CaseState,
  currentPrompt: string,
): string {
  if (intent === "thinking-pause-request") {
    return "Of course. Take your time—let me know when you’re ready to continue.";
  }
  if (intent === "repeat-question-request") return caseRepeatQuestion(currentPrompt, stage);
  if (intent === "readiness-confirmation") {
    return "Go ahead. Please continue with your response.";
  }
  if (intent === "end-interview") {
    return "Of course. We’ll stop the interview here.";
  }
  if (intent === "frustration") {
    return `I hear you. Let’s reset and stay with the current question. ${caseRepeatQuestion(currentPrompt, stage).replace(/^Of course\. /, "")}`;
  }
  return `No problem. Let’s stay with the current question. ${caseRepeatQuestion(currentPrompt, stage).replace(/^Of course\. /, "")}`;
}

export function caseFrameworkFrustrationText(
  objective: FrameworkProbeObjective | null,
  advanced: boolean,
  stage: CaseState,
  currentPrompt: string,
): string {
  if (advanced) {
    const acknowledgement = objective?.acknowledgement ?? "you already provided a sufficient framework";
    return `You’re right—${acknowledgement}. Let’s continue with the analysis.`;
  }
  return caseMetaConversationText("frustration", stage, currentPrompt);
}

function stageHint(stage: CaseState, backendText: string): string {
  switch (stage) {
    case "clarification":
      return "Consider the profitability horizon, scope, the virtual-advisor model, and who bears the costs. What would you like to clarify?";
    case "framework":
      return "Separate the external market and retailer questions from internal capabilities, brand, and economics. How would you organize those branches?";
    case "analysis":
      return "Start with what customers value in-store, then consider how virtual service could preserve personalization, trust, community, and private support. Which feature matters most?";
    case "data_reveal":
      return "Compare the upfront investment with annual profit after ongoing costs and depreciation. What payback period do you calculate?";
    case "pressure_test":
      return "Choose the most important retailer or brand risk and propose one concrete mitigation. What would make you pause the rollout?";
    case "recommendation":
      return "Lead with a clear decision, support it with the payback and exhibit evidence, then name the main risk and next step. What is your recommendation?";
    default:
      return backendText;
  }
}

/** Voice-only phrasing layered over a completed, server-owned FSM decision. */
export function caseConversationText(turn: CaseConversationTurn): string {
  if (turn.complete || turn.stageAfter === "scoring") {
    return "Thank you. That concludes the case. Your score is ready on screen.";
  }

  if (turn.stageBefore === "clarification") {
    const clarification = clarificationAnswer(
      turn.candidateText,
      turn.stageAfter === "framework",
    );
    if (clarification) return clarification;
  }

  if (turn.stageBefore === "framework" && turn.action === "advance") {
    return frameworkAdvanceFeedback(turn);
  }

  if (turn.action === "reveal") {
    const title = turn.exhibit?.title ?? "the next exhibit";
    return `I’m sharing ${title}. Take a moment to review it, then tell me what stands out and what it means for Beautify.`;
  }

  if (turn.action === "hint") {
    if (turn.stageBefore === "framework") {
      return frameworkFeedback(
        turn.frameworkAssessment,
        turn.variationSeed ?? turn.candidateText,
      );
    }
    return stageHint(turn.stageBefore, turn.backendText);
  }

  if (turn.action === "probe" || turn.action === "redirect") {
    if (turn.stageBefore === "framework") {
      return frameworkFeedback(
        turn.frameworkAssessment,
        turn.variationSeed ?? turn.candidateText,
      );
    }
    return turn.backendText;
  }

  switch (turn.stageAfter) {
    case "clarification":
      return "Before you structure the problem, what would you like to clarify?";
    case "framework":
      return "Please walk me through the factors Beautify should consider in shifting consultants into virtual-advisor roles.";
    case "analysis":
      return "That gives us a workable structure. Start with the customer: what would make someone who values high-touch service switch to a mostly virtual experience?";
    case "data_reveal":
      return "You’ve identified the key customer needs. Now let’s test the economics and market evidence, one exhibit at a time.";
    case "pressure_test":
      return "We’ve grounded the opportunity in the exhibits. What is the strongest argument against the shift, and how would you address it?";
    case "recommendation":
      return "Bring the analysis together in a concise final recommendation, including the main evidence, risks, and next steps.";
    default:
      return turn.backendText;
  }
}
