// Shared utilities for AURA Grid
// Polyfills, sanitization, formatting, and solar calculations

// ============================================
// structuredClone polyfill for older environments
// ============================================
export function deepClone(obj) {
  if (typeof structuredClone === 'function') {
    return structuredClone(obj);
  }
  // Fallback for older browsers/Node
  return JSON.parse(JSON.stringify(obj));
}

// ============================================
// HTML Sanitization (prevents XSS)
// ============================================
const ALLOWED_TAGS = ['span', 'div', 'svg', 'path', 'circle', 'line', 'polyline', 'polygon', 'rect', 'text'];
const ALLOWED_ATTRS = ['class', 'data-', 'width', 'height', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'points', 'rx', 'ry', 'transform'];

export function sanitizeHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  sanitizeNode(template.content);
  return template.innerHTML;
}

function sanitizeNode(node) {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const tagName = node.tagName.toLowerCase();
    if (!ALLOWED_TAGS.includes(tagName)) {
      node.remove();
      return;
    }
    // Remove disallowed attributes
    const attrs = Array.from(node.attributes);
    for (const attr of attrs) {
      const name = attr.name.toLowerCase();
      const allowed = ALLOWED_ATTRS.some(a => name === a || name.startsWith(a));
      if (!allowed) {
        node.removeAttribute(attr.name);
      }
    }
  }
  for (const child of Array.from(node.childNodes)) {
    sanitizeNode(child);
  }
}

// Simpler: escape HTML for text content
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// Time formatting (single source of truth)
// ============================================
export function formatSimTime(decimalTime) {
  const hours = Math.floor(decimalTime);
  const minutes = Math.floor((decimalTime - hours) * 60);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  const minStr = minutes < 10 ? '0' + minutes : minutes;
  return `${displayHours}:${minStr} ${ampm}`;
}

export function formatTime24(decimalTime) {
  const hours = Math.floor(decimalTime);
  const minutes = Math.floor((decimalTime - hours) * 60);
  const hStr = hours < 10 ? '0' + hours : hours;
  const mStr = minutes < 10 ? '0' + minutes : minutes;
  return `${hStr}:${mStr}`;
}

// ============================================
// Solar Position Calculations (SPA algorithm - NREL)
// Accurate for any latitude/longitude/date
// Returns: { elevation, azimuth, airMass, solarTime, isDaylight, declination, hourAngle, equationOfTime }
// ============================================
export function calculateSolarPosition(date, latitude, longitude, timezoneOffset) {
  // Convert to UTC
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const dayOfYear = Math.floor((date - new Date(Date.UTC(date.getUTCFullYear(), 0, 0))) / 86400000);

  // Solar declination angle (radians) - Spencer 1971
  const gamma = 2 * Math.PI * (dayOfYear - 1) / 365;
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) -
                      0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) -
                      0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);

  // Equation of time (minutes) - Spencer 1971
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) -
                            0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));

  // Time correction factor (minutes)
  const timeCorrection = eqTime + 4 * longitude - 60 * timezoneOffset;

  // Local solar time (hours)
  const solarTime = utcHours + timeCorrection / 60;

  // Hour angle (radians)
  const hourAngle = (solarTime - 12) * 15 * Math.PI / 180;

  // Solar elevation angle (radians)
  const latRad = latitude * Math.PI / 180;
  const sinElevation = Math.sin(latRad) * Math.sin(declination) +
                       Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinElevation)));

  // Solar azimuth (radians) - from NREL SPA
  const cosAzimuth = (Math.sin(declination) - Math.sin(elevation) * Math.sin(latRad)) /
                     (Math.cos(elevation) * Math.cos(latRad));
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAzimuth)));
  if (hourAngle > 0) azimuth = 2 * Math.PI - azimuth;

  // Air mass (Kasten-Young 1989)
  let airMass = 0;
  if (elevation > 0) {
    const zenith = Math.PI / 2 - elevation;
    airMass = 1 / (Math.cos(zenith) + 0.50572 * Math.pow(96.07995 - zenith * 180 / Math.PI, -1.6364));
  } else {
    airMass = 38; // Approximate for below horizon
  }

  return {
    elevation,           // radians, >0 = above horizon
    azimuth,             // radians, 0 = North
    airMass,             // dimensionless
    solarTime,           // decimal hours
    isDaylight: elevation > 0,
    declination,         // radians
    hourAngle,           // radians
    equationOfTime: eqTime, // minutes
  };
}


// ============================================
// Seeded PRNG for deterministic "weather noise"
// ============================================
export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ============================================
// LocalStorage wrapper with quota handling
// ============================================
export const storage = {
  _memory: new Map(),
  get(key) {
    try {
      const val = localStorage.getItem(key);
      if (val !== null) return val;
      return this._memory.has(key) ? this._memory.get(key) : null;
    } catch {
      return this._memory.has(key) ? this._memory.get(key) : null;
    }
  },
  set(key, value) {
    this._memory.set(key, value);
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        console.warn('[AURA Grid] localStorage quota exceeded. Clearing old state...');
        try {
          localStorage.removeItem(key);
          localStorage.setItem(key, value);
          return true;
        } catch {
          return false;
        }
      }
      console.warn('[AURA Grid] localStorage error:', e);
      return false;
    }
  },
  remove(key) {
    this._memory.delete(key);
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },
};

// ============================================
// Audit log for auto-actions (NOC compliance)
// ============================================
export const auditLog = {
  entries: [],
  maxEntries: 100,

  add(action, details, severity = 'info') {
    const entry = {
      timestamp: Date.now(),
      time: new Date().toISOString(),
      action,
      details,
      severity, // 'info' | 'warning' | 'critical'
    };
    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.pop();
    }
    // Also persist to localStorage for session survival
    try {
      localStorage.setItem('aura-audit-log', JSON.stringify(this.entries));
    } catch {
      // ignore quota
    }
    // Dispatch custom event for UI toast/notification (only in browser)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aura-audit', { detail: entry }));
    }
    return entry;
  },

  getAll() {
    return this.entries;
  },

  clear() {
    this.entries = [];
    try { localStorage.removeItem('aura-audit-log'); } catch {}
  },

  init() {
    try {
      const saved = localStorage.getItem('aura-audit-log');
      if (saved) this.entries = JSON.parse(saved);
    } catch {
      this.entries = [];
    }
  },
};

// Initialize on load
if (typeof window !== 'undefined') {
  auditLog.init();
}