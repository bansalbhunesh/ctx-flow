export interface ContextFile {
  path: string;
  content: string;
  domain: string;
  alwaysLoad: boolean;
}

export interface InjectionResult {
  context: string;
  filesLoaded: string[];
  tokenEstimate: number;
}

export interface UpdatePayload {
  message: string;
  response: string;
  detectedDomains: string[];
}

export interface SessionState {
  turnCount: number;
  totalTokensUsed: number;
  summaryExists: boolean;
  lastSummary: StructuredSummary | null;
  pendingTurns: Turn[];
}

export interface StructuredSummary {
  goals: string[];
  facts: string[];
  decisions: string[];
  constraints: string[];
  openQuestions: string[];
  compressedAt: number; // turn number when this was created
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
}
