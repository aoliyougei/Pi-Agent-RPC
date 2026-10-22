export const REQUIRED_CAPABILITIES = [
  "extension-ui",
  "custom-ui",
  "remote-files",
  "subagents",
  "session-locks",
] as const;

export const OPTIONAL_CAPABILITIES = ["project-session-discovery"] as const;

// Capability negotiation must tolerate additions from newer servers.
export type AgentCapability = string;
