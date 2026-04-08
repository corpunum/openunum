export const q = (id) => document.getElementById(id);
export const qa = (sel) => Array.from(document.querySelectorAll(sel));

export const escapeHtml = (s) =>
  String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
