(function attachAggregationControl(globalScope) {
  const SLOT_STATUS = Object.freeze({
    IDLE: 'idle',
    SENDING: 'sending',
    SENT: 'sent',
    WAITING: 'waiting',
    READY: 'ready',
    PAUSED: 'paused',
    SCRAPING: 'scraping',
    COLLECTED: 'collected',
    ERROR: 'error'
  });

  const STATUS_META = Object.freeze({
    [SLOT_STATUS.IDLE]: { text: '', className: 'status', title: '' },
    [SLOT_STATUS.SENDING]: { text: '\u23F3', className: 'status waiting', title: 'Sending prompt' },
    [SLOT_STATUS.SENT]: { text: '\u2713', className: 'status sent', title: 'Prompt sent' },
    [SLOT_STATUS.WAITING]: { text: '\u2026', className: 'status waiting', title: 'Waiting for reply' },
    [SLOT_STATUS.READY]: { text: '\u25CF', className: 'status ready', title: 'Reply appears ready' },
    [SLOT_STATUS.PAUSED]: { text: '\u23F8', className: 'status paused', title: 'Aggregation paused' },
    [SLOT_STATUS.SCRAPING]: { text: '\u21BB', className: 'status scraping', title: 'Collecting latest reply' },
    [SLOT_STATUS.COLLECTED]: { text: '\u2713', className: 'status collected', title: 'Reply collected' },
    [SLOT_STATUS.ERROR]: { text: '\u2717', className: 'status error', title: 'Action failed' }
  });

  class AggregationControlState {
    constructor() {
      this.paused = false;
      this.pendingMerge = null;
    }

    beginPendingMerge(payload) {
      this.pendingMerge = payload;
      this.paused = false;
    }

    clearPendingMerge() {
      this.pendingMerge = null;
      this.paused = false;
    }

    hasPendingMerge() {
      return !!this.pendingMerge;
    }

    pause() {
      this.paused = true;
    }

    resume() {
      this.paused = false;
    }
  }

  function slotStatusMeta(status) {
    return STATUS_META[status] || STATUS_META[SLOT_STATUS.IDLE];
  }

  function summarizeStatuses(statusesBySlot, enabledSlots, getLabel) {
    const labels = [];
    enabledSlots.forEach((slot) => {
      const label = typeof getLabel === 'function' ? getLabel(slot) : slot;
      const status = statusesBySlot[slot] || SLOT_STATUS.IDLE;
      if (status === SLOT_STATUS.IDLE) return;
      labels.push(`${label}: ${status}`);
    });
    return labels.join(' • ');
  }

  globalScope.AggregationControl = {
    SLOT_STATUS,
    slotStatusMeta,
    summarizeStatuses,
    AggregationControlState
  };
})(window);
