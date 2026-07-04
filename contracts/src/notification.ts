/**
 * contracts/notification — canonical Notification Service interface (PMS-6). DELIVERY-ONLY.
 *
 * Reliable delivery of requests SUPPLIED by consuming services. It never:
 *  - makes business decisions, evaluates authorization/rules, executes workflows;
 *  - determines recipients from business policy (recipients are supplied);
 *  - owns templates (templates are supplied per request) or notification policy.
 *
 * It consumes Audit + Event (and Authorization for management ops, Scheduler for scheduled delivery).
 * It NEVER consumes Workflow. Workflow consumes Notification.
 *
 * Breaking changes require constitutional review.
 */
import type { CorrelationId } from "../../libs/types/src/index.ts";

/** A delivery channel key (e.g., "email", "sms", "webhook"). The Channel adapter is injected. */
export type ChannelKey = string;

/** A supplied template — the CONSUMER owns it; the service only renders it. */
export interface SuppliedTemplate {
  /** Template body with {{placeholders}} replaced from `data`. */
  readonly body: string;
  /** Optional subject (email-like channels). */
  readonly subject?: string;
}

/** A delivery request supplied by a consumer. Recipients + template + channel all supplied. */
export interface DeliveryRequest {
  readonly channel: ChannelKey;
  /** Opaque recipient address (email/phone/url). Supplied by the consumer; never derived here. */
  readonly recipient: string;
  readonly template: SuppliedTemplate;
  /** Render data merged into the template. */
  readonly data: Readonly<Record<string, unknown>>;
  readonly correlationId: CorrelationId;
  /** Idempotency key so duplicate submits do not double-send. */
  readonly idempotencyKey: string;
  /** Optional scheduled send time (ISO). Consumed via the Scheduler hook; null => send now. */
  readonly sendAfter?: string;
  /** Consumer component name (for audit + rate-limit bucketing). */
  readonly requestedBy: string;
}

export type DeliveryStatus = "pending" | "sending" | "delivered" | "dead_lettered" | "rate_limited";

/** A delivery receipt — proof of the delivery attempt outcome. */
export interface DeliveryReceipt {
  readonly deliveryId: string;
  readonly status: DeliveryStatus;
  readonly channel: ChannelKey;
  readonly recipient: string;
  readonly attempts: number;
  readonly providerMessageId: string | null;
  readonly correlationId: CorrelationId;
  readonly auditRef: string;
  readonly at: string;
  readonly explanation: string;
}

/** Result a Channel adapter returns for a single send. */
export interface ChannelSendResult {
  readonly ok: boolean;
  readonly providerMessageId?: string;
  /** Transient => retry; permanent => dead-letter immediately. */
  readonly errorKind?: "transient" | "permanent";
  readonly error?: string;
}

/** A channel adapter delivers a rendered message. Injected; business-agnostic. */
export interface Channel {
  readonly key: ChannelKey;
  send(rendered: { recipient: string; subject?: string; body: string }): Promise<ChannelSendResult>;
}

export interface NotificationService {
  /** Submit a delivery request. Idempotent: duplicate key returns the original receipt. */
  submit(req: DeliveryRequest): Promise<DeliveryReceipt>;
  /** Submit a batch. Per-item idempotency; partial success allowed. */
  submitBatch(reqs: readonly DeliveryRequest[]): Promise<readonly DeliveryReceipt[]>;
  /** Drive pending deliveries (delivery worker). Returns count attempted. */
  deliverPending(maxBatch?: number): Promise<number>;
  /** Fetch a delivery receipt. */
  getReceipt(deliveryId: string): Promise<DeliveryReceipt | null>;
  /** Register a channel adapter (management op). */
  registerChannel(channel: Channel): void;
}
