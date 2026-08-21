// ./src/lib/invoke-error.ts
// Normalize Tauri invoke failures into typed conflict or message errors.
// Run via Vitest; used by save and conflict flows.

import type { ConflictResult, DocumentMeta } from './types';

export type ParsedInvokeError =
  | { kind: 'Conflict'; detail: ConflictResult }
  | { kind: 'Message'; detail: string };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function conflictFrom(value: unknown): ConflictResult | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const diskSource = record.diskSource;
  const currentRevision = record.currentRevision;
  const diskMeta = record.diskMeta;
  if (typeof diskSource !== 'string' || typeof currentRevision !== 'string' || !asRecord(diskMeta)) {
    return undefined;
  }
  return {
    currentRevision,
    diskSource,
    diskMeta: diskMeta as DocumentMeta,
  };
}

export function parseInvokeError(error: unknown): ParsedInvokeError {
  const candidates: unknown[] = [error];
  const record = asRecord(error);
  if (typeof record?.message === 'string') {
    candidates.push(record.message, parseJson(record.message));
  }
  if (typeof error === 'string') {
    candidates.push(parseJson(error));
  }

  for (const candidate of candidates) {
    const body = asRecord(candidate);
    if (!body) continue;
    if (body.kind === 'Conflict') {
      const detail = conflictFrom(body.detail);
      if (detail) return { kind: 'Conflict', detail };
    }
    if (body.kind === 'Message' && typeof body.detail === 'string') {
      return { kind: 'Message', detail: body.detail };
    }
  }

  return { kind: 'Message', detail: String(error) };
}

export function invokeErrorMessage(error: unknown): string {
  const parsed = parseInvokeError(error);
  return parsed.kind === 'Message' ? parsed.detail : 'This file changed on disk';
}

export function clampScanDepth(value: number): number {
  if (!Number.isFinite(value)) return 3;
  return Math.min(12, Math.max(1, Math.round(value)));
}
