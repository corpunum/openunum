export function knownProviderRowIds(modelProviderIds = [], providerRows = []) {
  return [...new Set([
    ...(Array.isArray(modelProviderIds) ? modelProviderIds : []).map((id) => String(id || '').trim()).filter(Boolean),
    ...(Array.isArray(providerRows) ? providerRows : []).map((row) => String(row?.provider || '').trim()).filter(Boolean)
  ])];
}

export function knownServiceRowIds(serviceProviderIds = [], authMethodRows = []) {
  return [...new Set([
    ...(Array.isArray(serviceProviderIds) ? serviceProviderIds : []).map((id) => String(id || '').trim()).filter(Boolean),
    ...(Array.isArray(authMethodRows) ? authMethodRows : []).map((row) => String(row?.id || '').trim()).filter(Boolean)
  ])];
}

export function normalizeHiddenRows({
  hiddenProviderRows = [],
  hiddenServiceRows = [],
  knownProviders = [],
  knownServices = []
} = {}) {
  const providerSet = new Set(Array.isArray(knownProviders) ? knownProviders : []);
  const serviceSet = new Set(Array.isArray(knownServices) ? knownServices : []);
  return {
    hiddenProviderRows: (Array.isArray(hiddenProviderRows) ? hiddenProviderRows : [])
      .filter((id, index, arr) => providerSet.has(id) && arr.indexOf(id) === index),
    hiddenServiceRows: (Array.isArray(hiddenServiceRows) ? hiddenServiceRows : [])
      .filter((id, index, arr) => serviceSet.has(id) && arr.indexOf(id) === index)
  };
}

export function buildAddRowSelectMarkup({
  knownProviders = [],
  knownServices = [],
  hiddenProviderRows = [],
  hiddenServiceRows = []
} = {}) {
  const providerOptions = '<option value="">Add model provider...</option>' +
    (Array.isArray(knownProviders) ? knownProviders : [])
      .filter((id) => (Array.isArray(hiddenProviderRows) ? hiddenProviderRows : []).includes(id))
      .map((id) => `<option value="${id}">${id}</option>`).join('');
  const serviceOptions = '<option value="">Add service...</option>' +
    (Array.isArray(knownServices) ? knownServices : [])
      .filter((id) => (Array.isArray(hiddenServiceRows) ? hiddenServiceRows : []).includes(id))
      .map((id) => `<option value="${id}">${id}</option>`).join('');
  return { providerOptions, serviceOptions };
}
