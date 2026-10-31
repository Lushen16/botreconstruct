'use strict';
const { OtmmReader } = require('./reconstruction/otmm.cjs');

const otmmPath = 'C:\\Users\\yago\\AppData\\Roaming\\PokeAlliance\\PokeAllianceV3\\minimap854.otmm';
const reader = new OtmmReader(otmmPath);

console.log('=== Searching for yellow tiles (color 210 = stairs/ramps) ===');
for (const z of [7, 8, 9]) {
  const yellow = [];
  for (let y = 2150; y <= 2300; y++) {
    for (let x = 3250; x <= 3350; x++) {
      const t = reader.tile({x, y, z});
      if (t && t.color === 210) {
        yellow.push({x, y, z, flags: t.flags, speed: t.speed, walkable: t.walkable});
      }
    }
  }
  console.log(`Floor z=${z}: ${yellow.length} yellow tiles found:`, yellow);
}
