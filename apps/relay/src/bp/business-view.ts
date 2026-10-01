import type {
  BusinessInboxMessage,
  BusinessSendFields,
  DeliveredMessage,
  RelayBundle,
} from '../bundle/bundle.types';

export function toBusinessSendFields(b: RelayBundle): BusinessSendFields {
  return { id: b.id, src: b.src, dst: b.dst, payload: b.payload, ttlMs: b.ttlMs };
}

export function toBusinessInboxMessage(m: DeliveredMessage): BusinessInboxMessage {
  return {
    id: m.id,
    src: m.src,
    dst: m.dst,
    payload: m.payload,
    deliveredAt: m.deliveredAt,
  };
}
