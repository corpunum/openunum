export function createWebuiWireValidator({
  setStatus,
  getRuntimeConfigCache,
  setRuntimeConfigCache,
  refreshModelCatalog,
  refreshAuthCatalog,
  refreshRuntimeOverview
}) {
  return async function runWebuiWireValidation(action = 'mutation') {
    const checks = [];
    try {
      setRuntimeConfigCache(await getRuntimeConfigCache());
      checks.push('config');
    } catch {
      setStatus('providerStatus', `wire validation failed (${action}): config`, { type: 'error', title: 'Wire Validation' });
      return false;
    }
    try {
      await refreshModelCatalog();
      checks.push('model-catalog');
    } catch {
      setStatus('providerStatus', `wire validation failed (${action}): model-catalog`, { type: 'error', title: 'Wire Validation' });
      return false;
    }
    try {
      await refreshAuthCatalog();
      checks.push('auth-catalog');
    } catch {
      setStatus('providerStatus', `wire validation failed (${action}): auth-catalog`, { type: 'error', title: 'Wire Validation' });
      return false;
    }
    try {
      await refreshRuntimeOverview();
      checks.push('runtime');
    } catch {
      setStatus('providerStatus', `wire validation failed (${action}): runtime`, { type: 'error', title: 'Wire Validation' });
      return false;
    }
    setStatus('providerStatus', `wire validation ok (${action}) | ${checks.join(', ')}`, {
      toast: false,
      type: 'success',
      title: 'Wire Validation'
    });
    return true;
  };
}
