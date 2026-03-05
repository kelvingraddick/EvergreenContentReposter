function weightedPick(records, weightField = "Weight") {
  const items = records.map(r => ({
    ...r,
    _w: Number(r.fields?.[weightField] ?? 1) || 1,
  }));

  const total = items.reduce((sum, r) => sum + r._w, 0);
  if (total <= 0) return null;

  let n = Math.random() * total;
  for (const r of items) {
    n -= r._w;
    if (n <= 0) return r;
  }
  return items[items.length - 1] || null;
}

module.exports = { weightedPick };
