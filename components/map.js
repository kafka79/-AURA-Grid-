export class CampusMap {
  constructor(containerId, onBuildingSelect) {
    this.container = document.getElementById(containerId);
    this.onBuildingSelect = onBuildingSelect;
    this.selectedBuildingId = null;
    this.lastBuildingData = null;
    this.isLoaded = false;
    this.pendingUpdateData = null;
    this.init();
  }

  async init() {
    this.container.innerHTML = `
      <div class="map-canvas-container">
        <div class="map-loading" style="color: var(--text-secondary); font-family: var(--font-display); font-size: 0.85rem;">
          Initializing telemetry map...
        </div>
        <div id="map-tooltip" class="map-tooltip">Building Info</div>
      </div>
    `;

    this.tooltip = document.getElementById('map-tooltip');

    try {
      const response = await fetch('./components/map.svg');
      if (!response.ok) throw new Error('Could not load map.svg');
      const svgText = await response.text();

      const canvas = this.container.querySelector('.map-canvas-container');
      if (canvas) {
        const loading = canvas.querySelector('.map-loading');
        if (loading) loading.remove();

        // Parse the SVG and inject it safely
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, 'image/svg+xml');
        const svgElement = doc.querySelector('svg');

        if (svgElement) {
          // Let CSS custom properties natively handle colors inside inline SVG

          canvas.appendChild(svgElement);
          this.isLoaded = true;
          this.bindEvents();

          // Apply any updates that queued up during async load
          if (this.pendingUpdateData) {
            this.updateMapStates(this.pendingUpdateData.buildingData, this.pendingUpdateData.solarOutput);
            this.pendingUpdateData = null;
          }
        } else {
          throw new Error('Parsed document does not contain an SVG element');
        }
      }
    } catch (e) {
      console.error('CampusMap SVG load error:', e);
      const canvas = this.container.querySelector('.map-canvas-container');
      if (canvas) {
        canvas.innerHTML = `
          <div style="color: var(--color-red); font-family: var(--font-display); font-size: 0.9rem; text-align: center; padding: 20px;">
            Telemetry Map Offline
            <button class="map-retry-btn" style="margin-top: 8px; padding: 4px 12px; background: var(--color-cyan); border: none; border-radius: 4px; color: var(--bg-dark); font-family: var(--font-body); cursor: pointer;">
              Retry
            </button>
          </div>
        `;
        canvas.querySelector('.map-retry-btn')?.addEventListener('click', () => this.init());
      }
    }
  }


  bindEvents() {
    const buildings = this.container.querySelectorAll('.map-building');
    buildings.forEach(building => {
      building.addEventListener('mouseenter', (e) => this.showTooltip(e, building.id));
      building.addEventListener('mouseleave', () => this.hideTooltip());
      building.addEventListener('mousemove', (e) => this.moveTooltip(e));
      building.addEventListener('click', () => this.selectBuilding(building.id));
      // Improve touch targets on mobile
      building.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.selectBuilding(building.id);
      }, { passive: false });
    });
  }

  showTooltip(e, id) {
    if (!this.lastBuildingData) return;
    const stats = this.lastBuildingData[id];
    if (!stats) return;

    this.tooltip.innerHTML = `
      <div class="map-tooltip-title">${escapeHtml(stats.name)}</div>
      <div class="map-tooltip-row">Load: <span class="map-tooltip-value cyan">${stats.load.toFixed(1)} kW</span></div>
      <div class="map-tooltip-row">Temp: <span class="map-tooltip-value">${stats.currentTemp.toFixed(1)}°C</span></div>
      <div class="map-tooltip-footer">Click for deep analytics</div>
    `;
    this.tooltip.style.opacity = 1;
    this.moveTooltip(e);
  }

  moveTooltip(e) {
    const canvas = this.container.querySelector('.map-canvas-container');
    if (!canvas) return;
    const mapBounds = canvas.getBoundingClientRect();
    const x = e.clientX - mapBounds.left + 15;
    const y = e.clientY - mapBounds.top + 15;
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
  }

  hideTooltip() {
    this.tooltip.style.opacity = 0;
  }

  selectBuilding(id) {
    const prevSelected = this.container.querySelector('.map-building.selected');
    if (prevSelected) {
      prevSelected.classList.remove('selected');
    }

    if (this.selectedBuildingId === id) {
      this.selectedBuildingId = null;
      this.onBuildingSelect(null);
    } else {
      this.selectedBuildingId = id;
      const buildingElement = this.container.querySelector(`#${id}`);
      if (buildingElement) {
        buildingElement.classList.add('selected');
      }
      this.onBuildingSelect(id);
    }
  }

  updateMapStates(buildingData, solarOutput) {
    this.lastBuildingData = buildingData;

    if (!this.isLoaded) {
      this.pendingUpdateData = { buildingData, solarOutput };
      return;
    }
    
    if (!this.elCache) this.elCache = new Map();

    Object.keys(buildingData).forEach(id => {
      let el = this.elCache.get(id);
      if (el === undefined) {
        el = this.container.querySelector(`#${id}`);
        this.elCache.set(id, el);
      }
      if (!el) return;

      const stats = buildingData[id];

      if (el.getAttribute('data-status') !== stats.state) {
        el.setAttribute('data-status', stats.state);
      }

      // Update wire speeds and direction
      const wireId = id.replace('building-', '');
      let wire = this.elCache.get(`wire-${wireId}`);
      if (wire === undefined) {
        wire = this.container.querySelector(`#wire-${wireId}`);
        this.elCache.set(`wire-${wireId}`, wire);
      }
      if (wire) {
        if (stats.load === 0) {
          if (!wire.classList.contains('inactive')) {
            wire.classList.add('inactive');
            wire.style.animationDuration = '0s';
          }
        } else {
          wire.classList.remove('inactive');
          const baseDuration = 25;
          const loadRatio = stats.load / stats.maxCapacity;
          const duration = Math.max(3, baseDuration - (loadRatio * 20));
          const durationStr = `${duration.toFixed(1)}s`;
          if (wire.style.animationDuration !== durationStr) {
            wire.style.animationDuration = durationStr;
          }
        }
      }
    });

    // Update solar wire
    let solarWire = this.elCache.get('wire-solar');
    if (solarWire === undefined) {
      solarWire = this.container.querySelector('#wire-solar');
      this.elCache.set('wire-solar', solarWire);
    }
    if (solarWire) {
      if (solarOutput <= 5) {
        if (!solarWire.classList.contains('inactive')) {
          solarWire.classList.add('inactive');
          solarWire.style.animationDuration = '0s';
        }
      } else {
        solarWire.classList.remove('inactive');
        const duration = Math.max(3, 20 - (solarOutput / 400 * 17));
        const durationStr = `${duration.toFixed(1)}s`;
        if (solarWire.style.animationDuration !== durationStr) {
          solarWire.style.animationDuration = durationStr;
        }
      }
    }
  }
}

// Simple HTML escape utility
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}