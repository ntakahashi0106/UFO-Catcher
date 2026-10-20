import { CONFIG } from './config.js';
import { CLAW } from './claw.js';

export const PRIZE_TYPES = Object.freeze([
  Object.freeze({
    id: 'standard', label: 'スタンダード', subtitle: 'まずはこの箱から',
    description: 'バランスのよい定番の箱。端を狙って、少しずつ傾けよう。',
    size: Object.freeze({ x: CONFIG.prize.x, y: CONFIG.prize.y, z: CONFIG.prize.z }),
    mass: CONFIG.prize.mass, friction: 0.52, color: '#e15e49', accent: '#f6ad83',
  }),
  Object.freeze({
    id: 'flat', label: '薄型ボックス', subtitle: '薄くて、軽やか',
    description: '幅が広く、背の低い箱。薄い側面と爪の掛かり方がポイント。',
    size: Object.freeze({ x: 0.88, y: 0.25, z: 1.42 }),
    mass: 0.30, friction: 0.48, color: '#77a08b', accent: '#b9d4b4',
  }),
  Object.freeze({
    id: 'tall', label: 'トールボックス', subtitle: '高さと重さに挑む',
    description: '背が高く、少し重めの箱。重心を読んで、倒す方向を考えよう。',
    size: Object.freeze({ x: 0.62, y: 0.62, z: 1.30 }),
    mass: 0.46, friction: 0.56, color: '#657da6', accent: '#b0bbd5',
  }),
]);

export function getPrizeType(id = 'standard') {
  return PRIZE_TYPES.find(type => type.id === id) ?? PRIZE_TYPES[0];
}

export function getPrizeLowerHeadY(id) {
  const type = getPrizeType(id);
  // Keep the housing above a tall carton while leaving the arms free to grip.
  return Math.max(CLAW.lowerHeadY, CONFIG.railY + CONFIG.railRadius + type.size.y + 0.10);
}
