import { escapeHtml } from './utils.js';

export class AlertManager {
  constructor(containerId, onAlertAction) {
    this.container = document.getElementById(containerId);
    this.onAlertAction = onAlertAction;

    // Use event delegation to handle alert action clicks (prevents memory leaks and multiple bindings)
    this.container.addEventListener('click', (e) => {
      const btn = e.target.closest('.alert-action-btn');
      if (btn) {
        const alertId = btn.getAttribute('data-alert-id');
        if (alertId) {
          this.onAlertAction(alertId);
        }
      }
    });
  }

  render(alerts) {
    const activeAlerts = alerts.filter(a => !a.resolved);

    if (activeAlerts.length === 0) {
      this.container.innerHTML = `
        <div class="empty-alerts">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shield-check"><path d="M20 13c0 5-3.5 7.5-7.66 9.7a1 1 0 0 1-.68 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 .76-.97l8-2a1 1 0 0 1 .48 0l8 2A1 1 0 0 1 20 6z"/><path d="m9 12 2 2 4-4"/></svg>
          <span style="font-weight: 500; color: var(--text-secondary)">All Systems Operating Normally</span>
          <span style="font-size: 0.7rem; color: var(--text-muted)">Smart Grid Automated optimization active.</span>
        </div>
      `;
      return;
    }

    this.container.innerHTML = activeAlerts.map(alert => `
      <div class="alert-item ${alert.level}">
        <div class="alert-item-header">
          <span class="alert-title flex-between alert-${alert.level}">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            ${escapeHtml(alert.title)}
          </span>
          <span class="alert-time">${escapeHtml(alert.time)}</span>
        </div>
        <div class="alert-desc">${escapeHtml(alert.desc)}</div>
        <button class="alert-action-btn" data-alert-id="${escapeHtml(alert.id)}">
          ${escapeHtml(alert.actionLabel)}
        </button>
      </div>
    `).join('');
  }
}