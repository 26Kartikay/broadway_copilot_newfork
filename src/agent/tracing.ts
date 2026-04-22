import type { Prisma } from '@prisma/client';

/**
 * In-memory trace buffers used by the LangGraph-style runner (`lib/graph`) and LLM adapters.
 * Shapes match what `ChatGroq` / `ChatOpenAI` append for optional DB persistence flows.
 */

export interface BufferedNodeRun {
  id: string;
  nodeName: string;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BufferedLlmTrace {
  id: string;
  nodeRunId: string;
  model: string;
  inputMessages: Prisma.JsonArray;
  rawRequest: Prisma.JsonObject;
  rawResponse?: Prisma.JsonObject;
  outputMessage?: Prisma.JsonObject;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  errorTrace?: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
}

export interface TraceBuffer {
  nodeRuns: BufferedNodeRun[];
  llmTraces: BufferedLlmTrace[];
}
