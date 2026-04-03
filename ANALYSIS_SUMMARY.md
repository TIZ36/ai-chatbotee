# Skill Selector Component - Complete Analysis Summary

**File:** `/Users/lilithgames/aiproj/chaya/front/src/components/Workflow.tsx`

---

## EXECUTIVE SUMMARY

The Skill Selector is a floating popover component that allows users to select and activate skill packs in a chat workflow. It appears above the input field using absolute positioning with `bottom-full` positioning (Tailwind class).

### Key Facts:
- **Positioning:** Absolute + `bottom-full` + `left-0`
- **Z-Index:** 190 (below @ selector at 200)
- **Dimensions:** 220px-320px width, max 256px height (scrollable)
- **Triggers:** Button click OR "/" key press
- **Selection:** Updates `selectedComponents` array
- **State:** `showSkillSelector`, `skillSelectorIndex`, `skillTriggeredBySlash`

---

## SECTION 1: COMPONENT RENDERING

### Location: Lines 6074-6156

```
{showSkillSelector && (
  <div className="absolute bottom-full left-0 mb-1 z-[190] ...">
    {/* Header: "选择要激活的 Skill" */}
    {/* Items: List of skill packs */}
  </div>
)}
```

### Conditional Rendering:
- Only renders when `showSkillSelector === true`
- Parent: `workflow-composer-layout` (the input area container)
- No ref needed (but `selectorRef` is used for @ selector too)

---

## SECTION 2: POSITIONING & STYLING

### CSS Classes (Line 6077):
```
absolute bottom-full left-0 mb-1 z-[190] 
bg-white dark:bg-[#2d2d2d] 
border border-gray-300 dark:border-[#404040] 
rounded-lg shadow-lg overflow-y-auto 
at-selector-container
```

### Inline Styles (Lines 6078-6082):
```typescript
{
  minWidth: '220px',
  maxWidth: '320px',
  maxHeight: '256px',
}
```

### CSS Breakdown:

| Class | Purpose |
|-------|---------|
| `absolute` | Absolute positioning |
| `bottom-full` | `bottom: 100%` - position above parent |
| `left-0` | `left: 0` - left-aligned |
| `mb-1` | `margin-bottom: 0.25rem` - spacing gap |
| `z-[190]` | z-index: 190 - layer depth |
| `bg-white` | White background (light mode) |
| `dark:bg-[#2d2d2d]` | Dark background |
| `border` | Border styling |
| `border-gray-300` | Light border color |
| `dark:border-[#404040]` | Dark border color |
| `rounded-lg` | `border-radius: 0.5rem` |
| `shadow-lg` | Drop shadow |
| `overflow-y-auto` | Vertical scrolling |
| `at-selector-container` | Custom CSS class |

---

## SECTION 3: STATE MANAGEMENT

### Three State Variables (Lines 229-231):

```typescript
const [showSkillSelector, setShowSkillSelector] = useState(false);
const [skillSelectorIndex, setSkillSelectorIndex] = useState(0);
const [skillTriggeredBySlash, setSkillTriggeredBySlash] = useState(false);
```

1. **showSkillSelector** (boolean)
   - Controls visibility
   - Default: `false`
   - Set to `true` to show popover

2. **skillSelectorIndex** (number)
   - Current keyboard navigation position
   - Range: 0 to `allSkillPacks.length - 1`
   - Resets to 0 when selector opens

3. **skillTriggeredBySlash** (boolean)
   - Flag indicating "/" key trigger
   - Used for special cleanup (removing "/" on selection)
   - Default: `false`

### Derived State (Lines 4211-4216):

```typescript
const selectedSkillPackIds = new Set(
  (selectedSkillPackIdsFromProps && selectedSkillPackIdsFromProps.length > 0
    ? selectedSkillPackIdsFromProps
    : selectedComponents
        .filter(c => c.type === 'skillpack')
        .map(c => c.id)
  ),
);
```

This is a **Set** of skill pack IDs currently selected, derived from:
- Props (if provided from parent)
- OR `selectedComponents` array (filtered to skillpacks only)

---

## SECTION 4: TRIGGER MECHANISMS

### Trigger 1: Button Click (Lines 5622-5635)

**Button Location:** Bottom toolbar, left section
**Button Label:** "选择 Skill" (with Package icon)

**Visibility Condition:**
```typescript
{!isLoading && Array.from(selectedSkillPackIds).length === 0 && (
```
- Only visible when NOT loading
- Only visible when NO skill is selected
- Hidden once a skill is selected

**Click Handler:**
```typescript
onClick={() => {
  setShowSkillSelector((v) => !v);        // Toggle
  setSkillSelectorIndex(0);                 // Reset cursor
  setSkillTriggeredBySlash(false);          // Mark as button-triggered
}}
```

### Trigger 2: Slash Key (Lines 4907-4975)

**Handler:** `handleKeyDownWithSlash` function

**Activation:**
```typescript
if (e.key === '/' && !showAtSelector) {
  if (!showSkillSelector) {
    setShowSkillSelector(true);
    setSkillTriggeredBySlash(true);
    setSkillSelectorIndex(0);
  }
}
```

**Conditions:**
- "/" key pressed
- @ selector NOT shown (`!showAtSelector`)
- Skill selector not already open

**Special Slash Handling:**

| Key | Action |
|-----|--------|
| Backspace | Close selector, remove "/" |
| Space | Close selector, keep "/" |
| ArrowDown | Next item |
| ArrowUp | Previous item |
| Enter | Select item, remove "/" |

---

## SECTION 5: KEYBOARD NAVIGATION

### When `showSkillSelector === true` and `allSkillPacks.length > 0`:

**Arrow Down (Lines 4935-4938):**
```typescript
setSkillSelectorIndex((prev) => (prev + 1) % allSkillPacks.length);
```
- Moves to next item
- Wraps to first item from last

**Arrow Up (Lines 4940-4945):**
```typescript
setSkillSelectorIndex((prev) =>
  prev - 1 < 0 ? allSkillPacks.length - 1 : prev - 1,
);
```
- Moves to previous item
- Wraps to last item from first

**Enter (Lines 4947-4968):**
```typescript
const sp = allSkillPacks[skillSelectorIndex];
if (sp) {
  setSelectedComponents([
    { type: 'skillpack', id: sp.skill_pack_id, name: sp.name },
  ]);
  setShowSkillSelector(false);
  // If slash-triggered, remove "/" from input
}
```
- Selects item at current cursor position
- Closes selector
- Updates `selectedComponents`
- Removes "/" if slash-triggered

---

## SECTION 6: ITEM RENDERING

### Structure (Lines 6100-6154):

```
Header Section:
  - Title: "选择要激活的 Skill"
  - Desc: "选中的Skill会在本轮对话中启用，并在消息中打标"

Content Section:
  IF allSkillPacks.length === 0:
    - Show "暂无技能包"
  ELSE:
    - Map each skill pack to a button
```

### Item Button (Lines 6110-6151):

```typescript
<button
  key={sp.skill_pack_id}
  onClick={() => {
    setSelectedComponents([
      { type: 'skillpack', id: sp.skill_pack_id, name: sp.name },
    ]);
    setShowSkillSelector(false);
    // Slash cleanup if needed
  }}
  className={`w-full px-3 py-2 ... ${
    active 
      ? 'bg-emerald-500/10 border-l-2 border-emerald-500 text-emerald-500'
      : isCursor 
      ? 'bg-gray-100 dark:bg-gray-700'
      : 'hover:bg-gray-100'
  }`}
>
  <div className="flex flex-col min-w-0">
    <span className="truncate">{sp.name}</span>
    {sp.summary && (
      <span className="mt-0.5 text-[11px] ...">{sp.summary}</span>
    )}
  </div>
  {active && <Check className="w-3 h-3" />}
</button>
```

### Item Styling States:

| State | Classes |
|-------|---------|
| **Active** (selected) | `bg-emerald-500/10 border-l-2 border-emerald-500 text-emerald-500` with ✓ icon |
| **Cursor** (keyboard hover) | `bg-gray-100 dark:bg-gray-700` |
| **Default** | `hover:bg-gray-100 dark:hover:bg-gray-700` |

### Item Content:
- **Name:** Single line, truncated if long
- **Summary:** Optional, smaller text below name (if `sp.summary` exists)
- **Checkmark:** Shows only when item is active/selected

---

## SECTION 7: EVENT HANDLING

### Mouse Event Prevention (Lines 6083-6090):

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

**Purpose:** Prevent event bubbling that would close the selector when user interacts with items

---

## SECTION 8: DATA SOURCES

### allSkillPacks (State Variable)
- Array of `SkillPack` objects
- Contains: `skill_pack_id`, `name`, `summary`
- Loaded via `loadSkillPacks()` function
- Used for:
  - Rendering items (Line 6106)
  - Keyboard nav bounds (Line 4934-4970)

### selectedComponents (State Variable)
- Array of selected components: `{ type: 'mcp' | 'skillpack' | 'agent', id: string, name: string }`
- Updated when skill is selected (Line 6115-6116)
- Source for `selectedSkillPackIds` derivation

---

## SECTION 9: Z-INDEX LAYERING

```
z-[200] = @ 符号选择器        (Highest - @ selector priority)
z-[190] = Skill 浮动选择器    (Below @ selector)
[other] = Regular UI elements
```

The Skill Selector sits below the @ selector, so if both are open, the @ selector takes focus.

---

## SECTION 10: SELECTION FLOW

### Complete Selection Process:

```
User Action
    ↓
1. Click Item (Line 6113) OR Press Enter (Line 4947)
    ↓
2. Update selectedComponents:
   setSelectedComponents([
     { type: 'skillpack', id: sp.skill_pack_id, name: sp.name }
   ])
    ↓
3. Close Selector:
   setShowSkillSelector(false)
    ↓
4. If Slash-Triggered (Lines 6119-6131):
   - Extract "/" from input
   - Update input text
    ↓
5. Derived State Updates:
   selectedSkillPackIds = new Set([skill_pack_id])
    ↓
6. UI Effects:
   - Item shows with green highlight
   - Button ("选择 Skill") disappears
   - Selected skill is available for use in message
```

---

## SECTION 11: VISIBILITY CONDITIONS

### Selector Shows When:
- `showSkillSelector === true`

### Button Shows When:
- `!isLoading` (not loading)
- `selectedSkillPackIds.length === 0` (no skill selected)

### Button Hides When:
- `isLoading` (loading state)
- `selectedSkillPackIds.length > 0` (skill selected)

---

## SECTION 12: DARK MODE SUPPORT

### Light Mode (Default):
- Background: `bg-white`
- Border: `border-gray-300`
- Text: `text-gray-700`, `text-gray-500`, `text-gray-900`
- Hover: `bg-gray-100`

### Dark Mode (dark: prefix):
- Background: `dark:bg-[#2d2d2d]`
- Border: `dark:border-[#404040]`
- Text: `dark:text-[#ffffff]`, `dark:text-[#b0b0b0]`, `dark:text-[#f5f5f5]`
- Hover: `dark:bg-gray-700`

---

## SECTION 13: DIMENSIONS & SPACING

| Property | Value |
|----------|-------|
| Min Width | 220px |
| Max Width | 320px |
| Max Height | 256px (scrollable) |
| Header Padding | p-2 (0.5rem) |
| Item Padding | px-3 py-2 (0.75rem h, 0.5rem v) |
| Border Spacing | mb-1 (0.25rem) |
| Border Radius | lg (0.5rem) |

---

## SECTION 14: COMMON MODIFICATIONS

### Change Positioning:
```typescript
// From bottom-full to top-full (below instead of above)
bottom-full → top-full
mb-1 → mt-1
```

### Change Width:
```typescript
minWidth: '220px' → '200px'
maxWidth: '320px' → '400px'
```

### Change Colors:
```typescript
bg-white → bg-gray-50
dark:bg-[#2d2d2d] → dark:bg-[#1a1a1a]
border-gray-300 → border-blue-300
```

### Change Scrolling:
```typescript
overflow-y-auto → overflow-hidden
maxHeight: '256px' → '400px'
```

### Change Z-Index:
```typescript
z-[190] → z-[195]  // Higher priority
z-[190] → z-[50]   // Lower priority
```

---

## REFERENCE TABLE

| Aspect | Value |
|--------|-------|
| **File** | `/Users/lilithgames/aiproj/chaya/front/src/components/Workflow.tsx` |
| **Component Type** | Floating Popover |
| **Rendering Lines** | 6074-6156 |
| **Positioning** | Absolute + bottom-full + left-0 |
| **Z-Index** | 190 |
| **Width** | 220px - 320px |
| **Height** | Max 256px (scrollable) |
| **State Variables** | 3 (showSkillSelector, skillSelectorIndex, skillTriggeredBySlash) |
| **State Init Lines** | 229-231 |
| **Button Trigger** | Line 5626 |
| **Slash Trigger** | Line 4907 |
| **Item Rendering** | Lines 6106-6152 |
| **Active Color** | emerald-500 (green) |
| **Cursor Color** | gray-100 (light) / gray-700 (dark) |
| **Dark Mode** | Fully supported |
| **Keyboard Nav** | Arrow Up/Down/Enter/Backspace/Space |
| **Selection Update** | `selectedComponents` array |

---

## FILES PROVIDED

1. **skill_selector_analysis.md** - Detailed analysis document
2. **skill_selector_visual.txt** - Visual layout diagrams
3. **skill_selector_quick_ref.txt** - Quick reference guide
4. **ANALYSIS_SUMMARY.md** - This summary document

