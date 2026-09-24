import { createHash } from 'node:crypto';

const sha = (value) => createHash('sha256').update(String(value)).digest('hex');

export class EvidenceStore {
  #items = new Map();

  put({
    id,
    state,
    producer,
    producerVersion = '0.1.0',
    inputDigest = null,
    source = null,
    details = {},
    observedAt = null,
  }) {
    if (!id || !producer) throw new TypeError('evidence requires id and producer');
    if (!['present', 'absent', 'unknown'].includes(state)) throw new TypeError('invalid evidence state');

    const record = Object.freeze({
      id,
      state,
      producer,
      producerVersion,
      inputDigest,
      source,
      details: structuredClone(details),
      observedAt,
      provenanceDigest: sha(JSON.stringify({
        id, state, producer, producerVersion, inputDigest, source, details,
      })),
    });

    this.#items.set(id, record);
    return record;
  }

  get(id) {
    return this.#items.get(id) ?? null;
  }

  has(id) {
    return this.#items.has(id);
  }

  list() {
    return [...this.#items.values()];
  }

  snapshot() {
    return Object.freeze({
      version: 1,
      items: this.list().sort((a, b) => a.id.localeCompare(b.id)),
    });
  }
}
