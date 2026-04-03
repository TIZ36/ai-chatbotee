# Skill Selector Component Analysis - Workflow.tsx

## File Location
`/Users/lilithgames/aiproj/chaya/front/src/components/Workflow.tsx`

---

## 1. COMPONENT RENDERING LOCATION

**Line Range:** 6074-6156

### Main Container Structure:
```
Lines 6074-6156: Main skill selector popover container
  - Conditionally rendered: {showSkillSelector && ( ... )}
  - Parent container: div.absolute.bottom-full.left-0
  - Child: flex layout with skill items
```

---

## 2. POSITIONING APPROACH

### Positioning Method: **Absolute + Bottom-Full**

**CSS Classes & Inline Styles (Lines 6075-6082):**

```typescript
className="absolute bottom-full left-0 mb-1 z-[190] bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#404040] rounded-lg shadow-lg overflow-y-auto at-selector-container"

style={{
  minWidth: '220px',
  maxWidth: '320px',
  maxHeight: '256px',
}}
```

**Breaking Down the Classes:**
- `absolute` - Absolute positioning
- `bottom-full` - Position at bottom of container (above the trigger)
- `left-0` - Align with left edge
- `mb-1` - Margin-bottom 1 unit (4px) = spacing below popover
- `z-[190]` - Z-index layer 190 (below @ selector at z-[200])
- `bg-white dark:bg-[#2d2d2d]` - Background color (light/dark mode)
- `border border-gray-300 dark:border-[#404040]` - Border styling
- `rounded-lg` - Rounded corners
- `shadow-lg` - Drop shadow
- `overflow-y-auto` - Vertical scrolling enabled
- `at-selector-container` - Custom CSS class

**Inline Style Properties:**
- `minWidth: '220px'` - Minimum width
- `maxWidth: '320px'` - Maximum width  
- `maxHeight: '256px'` - Maximum height (scroll enabled beyond this)

---

## 3. STATE MANAGEMENT

### State Variables (Lines 229-231):

```typescript
// Skill 浮动选择器（独立于 @，用于显式选 skill）
const [showSkillSelector, setShowSkillSelector] = useState(false);
const [skillSelectorIndex, setSkillSelectorIndex] = useState(0);
const [skillTriggeredBySlash, setSkillTriggeredBySlash] = useState(false);
```

**State Properties:**
1. **showSkillSelector** - Boolean controlling visibility
2. **skillSelectorIndex** - Currently highlighted item index (for keyboard nav)
3. **skillTriggeredBySlash** - Flag for "/" trigger vs button trigger

### Derived State (Line 4211-4216):

```typescript
const selectedSkillPackIds = new Set(
  (selectedSkillPackIdsFromProps && selectedSkillPackIdsFromProps.length > 0
    ? selectedSkillPackIdsFromProps
    : selectedComponents.filter(c => c.type === 'skillpack').map(c => c.id)
  ),
);
```

---

## 4. TRIGGER MECHANISMS

### 4A. BUTTON TRIGGER (Lines 5622-5635)

**Trigger Location:** Bottom toolbar, left section

**Button Code:**
```typescript
{!isLoading && Array.from(selectedSkillPackIds).length === 0 && (
  <button
    type="button"
    className="mr-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-dashed border-gray-300 dark:border-gray-600 text-[11px] text-gray-600 dark:text-[#c0c0c0] hover:bg-muted/60 flex-shrink-0"
    onClick={() => {
      setShowSkillSelector((v) => !v);
      setSkillSelectorIndex(0);
      setSkillTriggeredBySlash(false);
    }}
  >
    <Package className="w-3 h-3" />
    <span>选择 Skill</span>
  </button>
)}
```

**Visibility Condition:**
- Only shows when: `!isLoading && selectedSkillPackIds.length === 0`
- Hidden during loading or when a skill is already selected

### 4B. SLASH TRIGGER (Lines 4907-4975)

**Trigger Method:** "/" key in input field

**Handler Function:** `handleKeyDownWithSlash` (Lines 4907-4975)

**Key Behaviors:**
```typescript
if (e.key === '/' && !showAtSelector) {
  // Show skill selector when "/" pressed
  if (!showSkillSelector) {
    setShowSkillSelector(true);
    setSkillTriggeredBySlash(true);
    setSkillSelectorIndex(0);
  }
  return handleKeyDown(e);
}
```

**Slash-triggered Specific Handling:**
- Backspace closes selector and removes "/"
- Space closes selector and keeps "/"
- "/" must be followed by selection or deletion, not left hanging

---

## 5. KEYBOARD NAVIGATION (Lines 4919-4970)

**When showSkillSelector is true:**

- **Arrow Down** (Line 4935-4938):
  - Moves cursor to next item
  - Wraps around to first item
  
- **Arrow Up** (Line 4940-4945):
  - Moves cursor to previous item
  - Wraps around to last item
  
- **Enter** (Line 4947-4968):
  - Selects current skill pack at `skillSelectorIndex`
  - Closes selector
  - If triggered by slash, removes the "/" from input

---

## 6. JSX RENDERING LOGIC

### 6A. Header Section (Lines 6092-6099)

```typescript
<div className="p-2 border-b border-gray-200 dark:border-[#404040]">
  <div className="text-xs font-semibold text-gray-700 dark:text-[#ffffff]">
    选择要激活的 Skill
  </div>
  <div className="mt-1 text-[11px] text-gray-500 dark:text-[#b0b0b0]">
    选中的 Skill 会在本轮对话中启用，并在消息中打标。
  </div>
</div>
```

**Styling:**
- Header padding: `p-2`
- Border separator below
- Light gray/white text with dark mode support

### 6B. Content Section (Lines 6100-6154)

**Empty State (Lines 6101-6104):**
```typescript
{allSkillPacks.length === 0 ? (
  <div className="px-3 py-2 text-[12px] text-gray-500 dark:text-[#b0b0b0]">
    暂无技能包
  </div>
)
```

**Items List (Lines 6106-6152):**
```typescript
allSkillPacks.map((sp, index) => {
  const active = selectedSkillPackIds.has(sp.skill_pack_id);
  const isCursor = index === skillSelectorIndex;
  return (
    <button
      key={sp.skill_pack_id}
      type="button"
      onClick={() => {
        setSelectedComponents([
          { type: 'skillpack', id: sp.skill_pack_id, name: sp.name },
        ]);
        setShowSkillSelector(false);
        // Handle slash-triggered cleanup...
      }}
      className={`w-full px-3 py-2 flex items-center justify-between text-left text-sm ${
        active
          ? 'bg-emerald-500/10 border-l-2 border-emerald-500 text-emerald-500'
          : isCursor
          ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-[#f5f5f5]'
          : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-[#f5f5f5]'
      }`}
    >
      <div className="flex flex-col min-w-0">
        <span className="truncate">{sp.name}</span>
        {sp.summary && (
          <span className="mt-0.5 text-[11px] text-gray-500 dark:text-[#b0b0b0] truncate">
            {sp.summary}
          </span>
        )}
      </div>
      {active && <Check className="w-3 h-3 flex-shrink-0" />}
    </button>
  );
})
```

**Item Styling States:**
- **Active**: Green highlight with left border and checkmark
- **Cursor** (keyboard hover): Light gray background
- **Normal**: White background with hover state
- All support dark mode

### 6C. Mouse Event Handling (Lines 6083-6090)

```typescript
onMouseDown={(e) => {
  e.preventDefault();
  e.stopPropagation();
}}
onMouseUp={(e) => {
  e.preventDefault();
  e.stopPropagation();
}}
```

**Purpose:** Prevent event bubbling when interacting with selector

---

## 7. SUPPORTING DATA & REFS

### Data Sources:
- **allSkillPacks** - Array of SkillPack objects
  - Used in: Line 6106 (mapping items)
  - Used in: Line 4934-4970 (keyboard nav bounds)

### Refs:
- **selectorRef** (Line 6076) - Ref to the selector container
  - Type: HTMLDivElement
  - Also shared with @ selector (Line 5639 in @ selector block)

---

## 8. Z-INDEX HIERARCHY

```
z-[200] = @ 符号选择器 (higher priority)
z-[190] = Skill 浮动选择器 (below @ selector)
```

---

## 9. COMPARISON WITH @ SELECTOR

The Skill Selector is **similar but independent** from @ selector (Lines 6159-6173):

| Aspect | Skill Selector | @ Selector |
|--------|----------------|-----------|
| Z-index | 190 | 200 |
| Trigger | "/" key or button | "@" key |
| Positioning | absolute bottom-full left-0 | absolute bottom-full left-0 |
| Min Width | 220px | 200px |
| Max Width | 320px | 300px |
| Max Height | 256px | 256px |
| State | showSkillSelector | showAtSelector |
| Index Var | skillSelectorIndex | selectedComponentIndex |

---

## 10. COMPONENT SELECTION FLOW

1. **Button Click** (Line 5626) → `setShowSkillSelector(true)`
2. **Slash Key** (Line 4911) → `setShowSkillSelector(true)` + `setSkillTriggeredBySlash(true)`
3. **Item Click** (Line 6113) → Updates `selectedComponents` → Closes selector
4. **Keyboard Selection** (Line 4947-4968) → Updates `selectedComponents` → Closes selector

**Final State Update:**
```typescript
setSelectedComponents([
  { type: 'skillpack', id: sp.skill_pack_id, name: sp.name },
]);
setShowSkillSelector(false);
```

---

## SUMMARY TABLE

| Aspect | Value |
|--------|-------|
| **Component Type** | Floating Popover/Selector |
| **Positioning** | Absolute + bottom-full + left-0 |
| **Container Element** | div.absolute.bottom-full.left-0 |
| **Z-Index** | 190 |
| **Primary CSS Class** | at-selector-container |
| **Width Range** | 220px - 320px |
| **Height** | Max 256px (scrollable) |
| **Scroll** | overflow-y-auto |
| **Background** | white / #2d2d2d (dark) |
| **Border** | gray-300 / #404040 (dark) |
| **Shadow** | shadow-lg |
| **State Hook** | useState(false) |
| **Trigger 1** | Button in toolbar (line 5626) |
| **Trigger 2** | "/" key in input (line 4911) |
| **Keyboard Nav** | Arrow Up/Down/Enter |
| **Selection State** | selectedComponents array |
| **Active Item Color** | emerald-500 (green) |
| **Cursor Item Color** | gray-100/gray-700 (light/dark) |

