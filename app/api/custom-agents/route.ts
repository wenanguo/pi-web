import { NextResponse } from "next/server";
import { listCustomAgents } from "@/lib/custom-agents";
import { toCustomAgentSummary } from "@/lib/custom-agents-shared";

// GET /api/custom-agents - the custom agents this fork defines.
// The personas stay on the server: the browser gets names, models and tool lists.
export async function GET() {
  return NextResponse.json(
    { agents: listCustomAgents().map(toCustomAgentSummary) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
