# Skill Selector Component Documentation - Complete Index

## Quick Navigation

This comprehensive analysis covers the Skill Selector UI component in `/front/src/components/Workflow.tsx`

### Documents Provided:

1. **ANALYSIS_SUMMARY.md** (Start here!)
   - Executive summary with all key information
   - 14 detailed sections covering every aspect
   - Reference table with quick facts
   - Best for: Quick understanding and reference

2. **skill_selector_analysis.md** (Detailed deep-dive)
   - Line-by-line code analysis
   - Complete JSX rendering logic
   - CSS class breakdown
   - State management details
   - Best for: Understanding implementation details

3. **skill_selector_visual.txt** (Diagrams & flowcharts)
   - ASCII diagrams showing layout
   - Trigger flow diagrams
   - Keyboard navigation state machine
   - Rendering condition tree
   - Positioning context diagram
   - Best for: Visual learners

4. **skill_selector_quick_ref.txt** (Cheat sheet)
   - Quick reference guide with code snippets
   - All state variables listed
   - CSS classes organized by function
   - Trigger mechanisms highlighted
   - Common modifications guide
   - Testing scenarios
   - Best for: Developers making quick changes

---

## File Location

`/Users/lilithgames/aiproj/chaya/front/src/components/Workflow.tsx`

---

## At-a-Glance Summary

| Property | Value |
|----------|-------|
| **Component Type** | Floating popover selector |
| **Rendering Lines** | 6074-6156 |
| **Positioning** | absolute, bottom-full, left-0 |
| **Z-Index** | 190 (below @ selector at 200) |
| **Dimensions** | 220px-320px width, max 256px height |
| **State Variables** | showSkillSelector, skillSelectorIndex, skillTriggeredBySlash |
| **Triggers** | Button click OR "/" key press |
| **Selection Updates** | selectedComponents array |
| **Active Color** | emerald-500 (green) |
| **Dark Mode** | Fully supported |
| **Keyboard Navigation** | Arrow Up/Down/Enter/Backspace/Space |

---

## Key Code Locations

### State Declaration (Lines 229-231)
```typescript
const [showSkillSelector, setShowSkillSelector] = useState(false);
const [skillSelectorIndex, setSkillSelectorIndex] = useState(0);
const [skillTriggeredBySlash, setSkillTriggeredBySlash] = useState(false);
```

### Button Trigger (Lines 5622-5635)
- Located in bottom toolbar
- Shows only when: `!isLoading && selectedSkillPackIds.length === 0`
- Toggles visibility and resets cursor position

### Slash Trigger Handler (Lines 4907-4975)
- Function: `handleKeyDownWithSlash`
- Activates on "/" key (if @ selector not shown)
- Special handling: Backspace removes "/", Space keeps it

### Rendering (Lines 6074-6156)
- Main popover container (absolute positioning)
- Header section with title and description
- Items list with conditional rendering
- Event handlers for mouse interactions

### Item Rendering (Lines 6106-6152)
- Maps allSkillPacks array to buttons
- Three styling states: active (green), cursor (hover), default
- Shows name and optional summary
- Displays checkmark when selected

---

## CSS Classes Used

### Container Classes:
- `absolute bottom-full left-0 mb-1` - Positioning (above input)
- `z-[190]` - Layer depth (below @ selector)
- `bg-white dark:bg-[#2d2d2d]` - Background (light/dark)
- `border border-gray-300 dark:border-[#404040]` - Border
- `rounded-lg shadow-lg` - Rounded corners and shadow
- `overflow-y-auto` - Vertical scrolling
- `at-selector-container` - Custom CSS class

### Item States:
- **Active**: `bg-emerald-500/10 border-l-2 border-emerald-500 text-emerald-500`
- **Cursor**: `bg-gray-100 dark:bg-gray-700`
- **Default**: `hover:bg-gray-100 dark:hover:bg-gray-700`

### Inline Styles:
- `minWidth: '220px'`
- `maxWidth: '320px'`
- `maxHeight: '256px'` (scrollable beyond)

---

## State Management

### Three State Variables:

1. **showSkillSelector** (boolean)
   - Controls visibility
   - Default: false
   - Toggle with button or "/" key

2. **skillSelectorIndex** (number)
   - Keyboard navigation cursor position
   - Range: 0 to allSkillPacks.length - 1
   - Managed by Arrow Up/Down keys

3. **skillTriggeredBySlash** (boolean)
   - Indicates "/" key trigger
   - Enables special cleanup (removes "/" on selection)
   - Default: false

### Derived State:

**selectedSkillPackIds** (Set<string>)
- Derived from selectedComponents or props
- Contains currently selected skill pack IDs
- Used for rendering "active" state

---

## User Interactions

### Button Trigger Flow
1. User clicks "选择 Skill" button
2. setShowSkillSelector(true)
3. Popover appears above input
4. User selects item → selectedComponents updates → button disappears

### Slash Trigger Flow
1. User types "/" in input
2. Selector appears if @ selector not shown
3. User can:
   - Press Arrow Down/Up to navigate
   - Press Enter to select
   - Press Backspace to close (removes "/")
   - Press Space to close (keeps "/")

### Keyboard Navigation
- **Arrow Down**: Move cursor to next item (wraps)
- **Arrow Up**: Move cursor to previous item (wraps)
- **Enter**: Select item at cursor, close selector
- **Backspace** (slash-triggered): Close, remove "/"
- **Space** (slash-triggered): Close, keep "/"

---

## Styling States

### Active Item (Selected)
- Light green background: `bg-emerald-500/10`
- Left border accent: `border-l-2 border-emerald-500`
- Green text: `text-emerald-500`
- Checkmark icon displayed

### Cursor Item (Keyboard Hover)
- Light gray background: `bg-gray-100` / `dark:bg-gray-700`
- No other styling changes

### Default Item
- Hover background: `hover:bg-gray-100` / `dark:hover:bg-gray-700`
- Cursor positioned elsewhere

---

## Positioning Details

### Container Positioning
- **Method**: Absolute positioning
- **Reference**: Parent container (workflow-composer-layout)
- **Position**: `bottom: 100%` (above parent)
- **Alignment**: `left: 0` (left-aligned)
- **Spacing**: `margin-bottom: 0.25rem` (gap between popover and input)

### Why bottom-full?
- Places popover above the input field
- Doesn't obscure what user is typing
- Natural reading direction (top to bottom)
- Complements @ selector with same approach

---

## Dark Mode Implementation

### Light Mode
- Background: white
- Text: gray-700, gray-500, gray-900
- Border: gray-300
- Hover: bg-gray-100

### Dark Mode (dark: prefix)
- Background: #2d2d2d
- Text: #ffffff, #b0b0b0, #f5f5f5
- Border: #404040
- Hover: bg-gray-700

All colors are carefully chosen for readability and visual consistency.

---

## Performance Considerations

### Rendering
- Conditional rendering: Only renders when showSkillSelector === true
- Efficient mapping: allSkillPacks.map() is straightforward
- No memo() needed (simple component)

### Event Handling
- Mouse events use preventDefault/stopPropagation to avoid bubbling
- Keyboard events are delegated through parent handler
- State updates are minimal and targeted

### Data
- allSkillPacks is managed at parent level
- selectedComponents is shared with other UI elements
- No unnecessary re-renders or subscriptions

---

## Common Customizations

### Change Width
```typescript
minWidth: '220px' → '200px'    // Narrower
maxWidth: '320px' → '400px'    // Wider
```

### Change Height/Scrolling
```typescript
maxHeight: '256px' → '400px'   // Taller
overflow-y-auto → overflow-hidden  // No scrolling
```

### Change Positioning
```typescript
bottom-full → top-full    // Position below instead of above
mb-1 → mt-1             // Adjust spacing for new position
left-0 → right-0        // Right-align instead
```

### Change Colors
```typescript
bg-white → bg-gray-50                    // Lighter background
dark:bg-[#2d2d2d] → dark:bg-[#1a1a1a] // Darker in dark mode
border-gray-300 → border-blue-300      // Change border color
```

### Change Z-Index
```typescript
z-[190] → z-[195]    // Higher priority
z-[190] → z-[50]     // Lower priority
```

---

## Testing Checklist

- [ ] Button trigger: Click "选择 Skill" button
- [ ] Popover appears above input field
- [ ] Popover closes on ESC or clicking outside
- [ ] Slash trigger: Type "/" in input
- [ ] Selector appears when "/" pressed
- [ ] Arrow Down/Up navigate items (wrapping works)
- [ ] Arrow Down/Up show cursor highlighting
- [ ] Enter selects item and closes selector
- [ ] Backspace (slash-triggered) closes and removes "/"
- [ ] Space (slash-triggered) closes and keeps "/"
- [ ] Click item to select
- [ ] Selected item shows green highlight + checkmark
- [ ] Button disappears after selection (skill selected)
- [ ] Dark mode: Colors change appropriately
- [ ] Long names: Truncated with ellipsis
- [ ] Summary text: Shows below name in gray
- [ ] Scrolling: Works when many items present
- [ ] Empty state: Shows "暂无技能包" message
- [ ] Multiple skills: Only one can be selected (button hidden)

---

## References

### Related Components
- @ 符号选择器 (Lines 6159-6173) - Similar floating selector at z-[200]
- AttachmentMenu (Line 5638) - Alternative skill pack selection
- workflow-composer-layout - Parent container

### Related State
- `selectedComponents` - Array of selected components (mcp, skillpack, agent)
- `selectedSkillPackIds` - Derived Set of selected skill IDs
- `allSkillPacks` - Array of available skill packs
- `isLoading` - Determines button visibility

### Related Functions
- `handleKeyDownWithSlash` - Slash key handler (Lines 4907-4975)
- `loadSkillPacks` - Load skill pack data
- `setSelectedComponents` - Update selection

---

## Document Info

**Analysis Date**: 2026-04-03
**File Analyzed**: `/Users/lilithgames/aiproj/chaya/front/src/components/Workflow.tsx`
**Analysis Depth**: Comprehensive (all aspects covered)
**Code Lines**: 6074-6156 (main rendering), 229-231 (state), 4907-4975 (triggers)

---

## How to Use These Documents

1. **First Time**: Read ANALYSIS_SUMMARY.md (sections 1-5)
2. **Need Details**: Check skill_selector_analysis.md for specific aspects
3. **Visual Learner**: Review skill_selector_visual.txt for diagrams
4. **Quick Change**: Use skill_selector_quick_ref.txt for code snippets
5. **Integration**: Reference specific line numbers for finding code

---

## Quick Links to Line Numbers

- State Declaration: 229-231
- Derived State: 4211-4216
- Slash Trigger Handler: 4907-4975
- Button Trigger: 5626
- Toolbar Button: 5622-5635
- Popover Container: 6074-6156
- Header Section: 6092-6099
- Item Rendering: 6106-6152
- Item Click Handler: 6113-6131
- Mouse Event Handlers: 6083-6090

---

End of Documentation Index
