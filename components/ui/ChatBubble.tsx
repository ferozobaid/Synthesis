/**
 * Case interview chat bubble. Interviewer intent is conveyed through styling
 * and an optional plain-language label — no raw FSM action names.
 */
export function ChatBubble({
  role,
  text,
  label,
  children,
}: {
  role: "interviewer" | "candidate";
  text: string;
  label?: string;
  children?: React.ReactNode;
}) {
  const isCandidate = role === "candidate";
  return (
    <div style={{ display: "flex", justifyContent: isCandidate ? "flex-end" : "flex-start" }}>
      <div
        style={{
          maxWidth: "88%",
          borderRadius: 16,
          padding: "11px 15px",
          fontSize: 14,
          lineHeight: 1.55,
          background: isCandidate ? "var(--accent)" : "var(--surface-2)",
          color: isCandidate ? "#fff" : "var(--ink)",
          border: isCandidate ? "none" : "1px solid var(--line)",
        }}
      >
        {label && (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: isCandidate ? "rgba(255,255,255,.65)" : "var(--ink-4)",
              marginBottom: 5,
              fontWeight: 600,
            }}
          >
            {label}
          </div>
        )}
        <div>{text}</div>
        {children}
      </div>
    </div>
  );
}
