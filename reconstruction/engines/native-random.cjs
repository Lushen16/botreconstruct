'use strict';

function sampleInclusiveInteger(minimum, maximum, unitSample) {
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum > maximum) {
    throw new RangeError('Expected ordered integer bounds');
  }
  if (minimum < -0x80000000 || maximum > 0x7fffffff || maximum - minimum + 1 > 0x7fffffff) {
    throw new RangeError('Bounds exceed the recovered signed-int arithmetic subset');
  }
  if (!Number.isFinite(unitSample) || unitSample < 0 || unitSample >= 1) {
    throw new RangeError('Expected a unit sample in [0, 1)');
  }
  return minimum + Math.trunc(unitSample * (maximum - minimum + 1));
}

function nativeRandomDeadline(config, now, unitSample) {
  const minimumValue = Number.isFinite(config?.randomMinSeconds) ? config.randomMinSeconds : 45;
  const maximumValue = Number.isFinite(config?.randomMaxSeconds) ? config.randomMaxSeconds : 100;
  const minimum = Math.max(1, Math.trunc(minimumValue));
  const maximum = Math.max(minimum, Math.trunc(maximumValue));
  if (!Number.isFinite(now) || maximum > 2147483) {
    throw new RangeError('Expected finite clock and non-overflowing signed milliseconds');
  }
  const seconds = sampleInclusiveInteger(minimum, maximum, unitSample);
  return { seconds, until: now + seconds * 1000 };
}

function unitSampleFromNativeWords(firstWord, secondWord) {
  for (const word of [firstWord, secondWord]) {
    if (!Number.isInteger(word) || word < 0 || word > 0xffffffff) {
      throw new RangeError('Expected two unsigned 32-bit generator words');
    }
  }
  return (secondWord * 0x200000 + (firstWord >>> 11)) / 0x20000000000000;
}

module.exports = { sampleInclusiveInteger, nativeRandomDeadline, unitSampleFromNativeWords };
