export interface SDKTracePayload {
  externalTraceId: string;
  environmentId: string;
  agentVersion: string;
  promptVersion: string;
  userInput: string;
  finalOutput?: string | null;
  status: 'SUCCESS' | 'FAILED' | 'RUNNING';
  totalCost?: number;
  totalLatencyMs?: number;
  sessionId: string;
  actions: {
    actionType: 'FILL' | 'CLICK' | 'REQUEST_HUMAN_APPROVAL' | 'SUBMIT' | 'STOP' | 'NAVIGATE';
    elementId?: string | null;
    selector?: string | null;
    inputValue?: string | null;
    url?: string | null;
    timestamp?: string | null;
  }[];
  networkLogs?: {
    url: string;
    method: string;
    requestHeaders: string;
    requestBody?: string | null;
    responseHeaders: string;
    responseBody?: string | null;
    statusCode: number;
    latencyMs?: number;
    timestamp?: string | null;
  }[];
}

export class LoomEvalClient {
  private ingestionKey: string;
  private endpoint: string;

  constructor(config: { ingestionKey: string; endpoint?: string }) {
    this.ingestionKey = config.ingestionKey;
    this.endpoint = config.endpoint || 'http://localhost:3000/api/v1/traces';
  }

  /**
   * Submit a trace session log to the LoomEval Ingestion server.
   */
  async submitTrace(payload: SDKTracePayload): Promise<{ traceId: string; duplicated?: boolean }> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.ingestionKey}`,
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json();

    if (!res.ok) {
      throw new Error(
        body.error || `Failed to submit trace: HTTP ${res.status} ${res.statusText}`
      );
    }

    return {
      traceId: body.traceId,
      duplicated: body.duplicated || false,
    };
  }
}
