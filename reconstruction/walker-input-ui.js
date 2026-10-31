(function (root) {
  'use strict';
  const model = typeof module !== 'undefined' && module.exports ? module.exports : root.PkaWalker;
  const nativePosition = model.currentPosition;
  model.currentPosition = session => {
    if (session?.source === 'rpm' && session.capabilities?.walkerKeyboard === true
        && session.online && !session.stale && session.ageMs >= 0 && session.ageMs <= 1000
        && model.validPosition(session.telemetry?.position)) return { ...session.telemetry.position };
    return nativePosition(session);
  };
})(typeof window === 'undefined' ? globalThis : window);
