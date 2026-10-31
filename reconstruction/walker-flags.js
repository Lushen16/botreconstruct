(function (root) {
  'use strict';
  const model = typeof module !== 'undefined' && module.exports ? module.exports : root.PkaWalker;
  model.canStand = flags => Number.isInteger(flags) && flags >= 0 && flags <= 255
    && (flags & 1) !== 0 && (flags & 4) === 0 && (flags & 8) === 0;
  model.canRoute = flags => model.canStand(flags) && (flags & 2) === 0;
})(typeof window === 'undefined' ? globalThis : window);
