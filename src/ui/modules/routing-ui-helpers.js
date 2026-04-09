export function setSelectByValueOrFirst(q, id, value) {
  const el = q(id);
  if (!el) return;
  if (el.tagName !== 'SELECT') {
    el.value = value ?? '';
    return;
  }
  const options = Array.from(el.options).map((o) => o.value);
  el.value = options.includes(value) ? value : options[0] || '';
}

export function createRoutingUiHelpers({
  q,
  qa,
  getModelProviderIds,
  getFallbackSequence,
  setFallbackSequence,
  ensureFallbackSequence,
  preferredModelForProvider,
  providerChoicesForFallbackRow,
  buildFallbackModelOptions,
  setSelectByValueOrFirstFn
}) {
  function renderProviderSelectors() {
    const modelProviderIds = getModelProviderIds();
    const providerSelect = q('provider');
    const fallbackSelect = q('fallbackProviderPicker');
    if (providerSelect) {
      const selected = providerSelect.value;
      providerSelect.innerHTML = modelProviderIds
        .map((provider) => `<option value="${provider}">${provider}</option>`)
        .join('');
      setSelectByValueOrFirstFn('provider', selected || modelProviderIds[0] || '');
    }
    if (fallbackSelect) {
      const selected = fallbackSelect.value;
      fallbackSelect.innerHTML = '<option value="">Select provider</option>' + modelProviderIds
        .map((provider) => `<option value="${provider}">${provider}</option>`)
        .join('');
      if (selected) fallbackSelect.value = selected;
    }
  }

  function renderFallbackSequence() {
    const fallbackSequence = getFallbackSequence();
    ensureFallbackSequence(q('provider')?.value);
    const body = q('fallbackSequenceBody');
    if (!body) return;
    body.innerHTML = fallbackSequence.map((entry, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>
          <select class="fallback-provider" data-index="${index}">
            ${providerChoicesForFallbackRow(getModelProviderIds(), fallbackSequence, q('provider').value, index)
              .map((provider) => `<option value="${provider}" ${provider === entry.provider ? 'selected' : ''}>${provider}</option>`).join('')}
          </select>
        </td>
        <td>
          <select class="fallback-model" data-index="${index}">
            ${buildFallbackModelOptions(entry.provider, entry.model)}
          </select>
        </td>
        <td>
          <div class="row">
            <button type="button" class="fallback-up" data-index="${index}">Up</button>
            <button type="button" class="fallback-down" data-index="${index}">Down</button>
            <button type="button" class="fallback-remove" data-index="${index}">Remove</button>
          </div>
        </td>
      </tr>
    `).join('');
    if (!fallbackSequence.length) {
      body.innerHTML = '<tr><td colspan="4" class="hint">No explicit fallback rows yet. Use `Auto Fill Best Sequence` or `Add Fallback`.</td></tr>';
    }
    qa('.fallback-provider').forEach((el) => {
      el.onchange = () => {
        const index = Number(el.dataset.index);
        const provider = el.value;
        const next = [...getFallbackSequence()];
        next[index] = { provider, model: preferredModelForProvider(provider) };
        setFallbackSequence(next);
        renderFallbackSequence();
      };
    });
    qa('.fallback-model').forEach((el) => {
      el.onchange = () => {
        const index = Number(el.dataset.index);
        const next = [...getFallbackSequence()];
        next[index].model = el.value;
        setFallbackSequence(next);
      };
    });
    qa('.fallback-up').forEach((btn) => {
      btn.onclick = () => {
        const index = Number(btn.dataset.index);
        if (index <= 0) return;
        const next = [...getFallbackSequence()];
        const current = next[index];
        next[index] = next[index - 1];
        next[index - 1] = current;
        setFallbackSequence(next);
        renderFallbackSequence();
      };
    });
    qa('.fallback-down').forEach((btn) => {
      btn.onclick = () => {
        const index = Number(btn.dataset.index);
        const next = [...getFallbackSequence()];
        if (index >= next.length - 1) return;
        const current = next[index];
        next[index] = next[index + 1];
        next[index + 1] = current;
        setFallbackSequence(next);
        renderFallbackSequence();
      };
    });
    qa('.fallback-remove').forEach((btn) => {
      btn.onclick = () => {
        const index = Number(btn.dataset.index);
        const next = [...getFallbackSequence()];
        next.splice(index, 1);
        setFallbackSequence(next);
        renderFallbackSequence();
      };
    });
  }

  return {
    renderProviderSelectors,
    renderFallbackSequence
  };
}
