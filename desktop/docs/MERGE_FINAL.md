# Merge Feature - Final Implementation ✅

**Date:** February 18, 2026  
**Status:** Complete

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  [4 WebView Grid]                          │ [Merge Panel] │
│                                            │               │
│                                            │ ┌───────────┐ │
│                                            │ │ Provider  │ │
│                                            │ │ API Key   │ │
│                                            │ │ [Run Merge]││ ← NEW BUTTON
│                                            │ └───────────┘ │
│                                            │ [Result]      │
│                                            │ [Clarification│
├────────────────────────────────────────────┼───────────────┤
│ [Slots] [Merge ◂] [Input____] [Send]      │               │
└────────────────────────────────────────────┴───────────────┘
```

---

## Key Changes

### 1. Bottom Panel (Unchanged)
- **Input field** - Only for sending messages to models
- **Send button** - Only sends to models (no merge)
- **Merge toggle** - Opens/closes right panel

### 2. Right Side Panel (Merge Only)
- **Run Merge button** - Triggers merge (teal color)
- **Clarification input** - Appears after merge completes
- **Clarification Send button** - Sends follow-up question

---

## Button Functions

| Button | Location | Action |
|--------|----------|--------|
| **Send** | Bottom panel | Sends message to all enabled slots |
| **Run Merge** | Right panel | Collects responses and runs merge |
| **Clarification Send** | Right panel | Sends follow-up question |
| **Merge ▸/◂** | Bottom panel | Toggles right panel |

---

## Flow

### Send to Models
1. Type message in **bottom input**
2. Press Enter or click **Send**
3. Message sent to all enabled slots
4. Status indicators update (✓/✗)

### Run Merge
1. Open right panel (click "Merge ▸")
2. Ensure API key is entered
3. Click **⚡ Run Merge** (teal button)
4. Merge collects responses from enabled slots
5. Result appears in markdown
6. **Clarification input** appears

### Clarification
1. Type follow-up question in right panel
2. Press Enter or click **Send**
3. Response maintains merge context

---

## Files Modified

| File | Changes |
|------|---------|
| `index.html` | Added Run Merge button in side panel |
| `renderer.js` | Separated send/merge logic |
| `side-panel-controls.js` | Panel toggle (unchanged) |

---

## Code Changes

### renderer.js - Send (Bottom)
```javascript
// BOTTOM SEND BUTTON - Only sends to models
sendBtn.addEventListener('click', sendToAll);

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendToAll();
  }
});
```

### renderer.js - Run Merge (Right Panel)
```javascript
// RUN MERGE BUTTON (IN SIDE PANEL) - Only runs merge
runMergeBtn?.addEventListener('click', () => {
  runMerge(false, '', '');
});
```

---

## Testing Checklist

- [ ] Bottom input sends to models only
- [ ] Run Merge button is in right panel
- [ ] Run Merge button is teal color
- [ ] Clarification appears after merge
- [ ] Panel toggle works correctly
- [ ] Resize handle works

---

## UI Colors

| Element | Color | Purpose |
|---------|-------|---------|
| Send button | Blue (#0066ff) | Send to models |
| Run Merge button | Teal (#00aa88) | Run merge |
| Clarification Send | Blue (#0066ff) | Send follow-up |

---

## Notes

- Bottom input **never** triggers merge
- Run Merge **only** in right panel
- Clarification **only** in right panel
- Clear separation of concerns
