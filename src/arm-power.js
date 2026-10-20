export const ARM_POWER = Object.freeze({
  min: 20, max: 200, step: 10, default: 100,
  presets: Object.freeze([40, 100, 180]),
});

export function normalizeArmPower(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return ARM_POWER.default;
  const number = Number(value);
  if (!Number.isFinite(number)) return ARM_POWER.default;
  return Math.max(ARM_POWER.min, Math.min(ARM_POWER.max, Math.round(number / ARM_POWER.step) * ARM_POWER.step));
}

export function armPowerLabel(value) {
  const power = normalizeArmPower(value);
  return power <= 60 ? '弱め' : power < 100 ? 'やや弱め' : power === 100 ? '標準' : power <= 140 ? 'やや強め' : '強め';
}

export function armPowerRecordKey(prizeId, power) {
  return `hashi-best-${prizeId}-power-${normalizeArmPower(power)}`;
}
