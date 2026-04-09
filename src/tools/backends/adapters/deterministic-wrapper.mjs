export function executeDeterministicWrapper(fn, args = {}) {
  try {
    const out = fn(args);
    if (out && typeof out.then === 'function') {
      return out.then((value) => ({ ok: true, data: value, confidence: 1.0 }));
    }
    return { ok: true, data: out, confidence: 1.0 };
  } catch (error) {
    return { ok: false, error: String(error?.message || error), confidence: 0 };
  }
}

