================================================================================
SKILL SELECTOR COMPONENT ANALYSIS - COMPLETE DOCUMENTATION
================================================================================

ANALYSIS OVERVIEW
File: /front/src/components/Workflow.tsx
Component: Skill Selector (Floating Popover UI)
Analysis Date: 2026-04-03
Status: COMPLETE

DOCUMENTATION FILES
================================================================================

All files are located in: /Users/lilithgames/aiproj/chaya/

1. SKILL_SELECTOR_DOCUMENTATION.md
   Type: Navigation & Index
   Size: 10K
   Purpose: Master guide to all documentation
   Best for: Starting point, navigation, testing checklist
   Contains:
   - Quick navigation to other documents
   - At-a-glance summary table
   - Key code locations with line numbers
   - CSS classes organized by function
   - Testing checklist (19 items)
   - Performance considerations
   - Common customization guide
   - Document usage instructions

2. ANALYSIS_SUMMARY.md
   Type: Comprehensive Summary
   Size: 12K
   Purpose: Complete reference with all key information
   Best for: Understanding all aspects of the component
   Contains:
   - Executive summary (key facts)
   - 14 detailed sections covering:
     * Component rendering location
     * Positioning & styling details
     * State management (3 state variables)
     * Trigger mechanisms (button + slash)
     * Keyboard navigation (5 keys)
     * Item rendering logic
     * Event handling
     * Data sources
     * Z-index layering
     * Selection flow
     * Visibility conditions
     * Dark mode implementation
     * Dimensions & spacing
     * Common modifications
   - Complete reference table
   - Files provided listing

3. skill_selector_analysis.md
   Type: Detailed Technical Analysis
   Size: 9.2K
   Purpose: Deep dive into code implementation
   Best for: Developers understanding implementation details
   Contains:
   - Component rendering location (lines 6074-6156)
   - Positioning approach (absolute + bottom-full)
   - CSS classes & inline styles breakdown
   - State management (3 variables explained)
   - Trigger mechanisms (button at 5626, slash at 4907)
   - Keyboard navigation (lines 4919-4970)
   - JSX rendering logic (header, content, items)
   - Mouse event handling
   - Supporting data & refs
   - Z-index hierarchy
   - Comparison with @ selector
   - Component selection flow
   - Summary table (14 rows)

4. skill_selector_visual.txt
   Type: Visual Diagrams & Flowcharts
   Size: 9.5K
   Purpose: ASCII diagrams for visual understanding
   Best for: Visual learners, understanding relationships
   Contains:
   - Input container layout diagram (ASCII art)
   - Trigger flow diagram (button and slash paths)
   - Keyboard navigation state machine
   - Rendering condition tree
   - CSS positioning details breakdown
   - Header styling breakdown
   - Item button styling breakdown
   - Item content layout diagram
   - Z-index layer visualization
   - State machine diagram
   - Parent positioning context diagram

5. skill_selector_quick_ref.txt
   Type: Quick Reference Guide
   Size: 13K
   Purpose: Cheat sheet with code snippets
   Best for: Quick lookups, making changes
   Contains:
   - State variables (lines 229-231) with code
   - Rendering location (lines 6074-6156) with code
   - Button trigger (line 5626) with code
   - Slash trigger (line 4907) with code
   - Keyboard navigation (lines 4919-4970) with code
   - CSS classes breakdown (organized by function)
   - Dimensions & sizing table
   - Selection flow diagram
   - Visibility conditions
   - Item rendering code
   - Event handling code
   - Dark mode support (light/dark mode side-by-side)
   - Z-index layering diagram
   - Common modifications guide (with code)
   - Testing scenarios (6 scenarios with checklist)

KEY FINDINGS SUMMARY
================================================================================

RENDERING LOCATION
Lines: 6074-6156
Container: div.absolute.bottom-full.left-0.mb-1.z-[190]
Condition: {showSkillSelector && ( ... )}

STATE MANAGEMENT
Line 229-231:
- showSkillSelector (boolean) - Visibility control
- skillSelectorIndex (number) - Keyboard cursor position
- skillTriggeredBySlash (boolean) - Trigger source flag

Derived State (Line 4211-4216):
- selectedSkillPackIds (Set<string>) - Currently selected skills

POSITIONING
Method: Absolute + bottom-full (Tailwind classes)
Position: Above input field (bottom: 100%)
Alignment: Left-aligned (left: 0)
Spacing: 4px gap (mb-1 = margin-bottom: 0.25rem)
Z-Index: 190 (below @ selector at 200)

DIMENSIONS
Width: 220px - 320px (responsive)
Height: Max 256px (scrollable beyond)
Padding: p-2 (header), px-3 py-2 (items)
Border Radius: lg (0.5rem)

TRIGGERS
1. Button Trigger (Line 5626)
   - Location: Toolbar, left section
   - Label: "选择 Skill" with Package icon
   - Visibility: !isLoading && selectedSkillPackIds.length === 0
   - Action: Toggle showSkillSelector

2. Slash Trigger (Line 4907)
   - Key: "/" in input field
   - Handler: handleKeyDownWithSlash function
   - Condition: !showAtSelector (@ selector not shown)
   - Special: Backspace removes "/", Space keeps it

KEYBOARD NAVIGATION
Arrow Down: Next item (wraps to first)
Arrow Up: Previous item (wraps to last)
Enter: Select item at cursor
Backspace (slash-triggered): Close, remove "/"
Space (slash-triggered): Close, keep "/"

CSS STYLING
Container Classes:
- absolute bottom-full left-0 mb-1 z-[190]
- bg-white dark:bg-[#2d2d2d]
- border border-gray-300 dark:border-[#404040]
- rounded-lg shadow-lg overflow-y-auto

Item Active State:
- bg-emerald-500/10 border-l-2 border-emerald-500 text-emerald-500

Item Cursor State:
- bg-gray-100 dark:bg-gray-700

Item Default State:
- hover:bg-gray-100 dark:hover:bg-gray-700

DARK MODE
Full Support: Yes
Light Mode: white bg, gray-300 border, gray-700 text
Dark Mode: #2d2d2d bg, #404040 border, #ffffff text

SELECTION FLOW
1. User clicks item or presses Enter
2. setSelectedComponents([{ type: 'skillpack', id, name }])
3. setShowSkillSelector(false)
4. If slash-triggered: remove "/" from input
5. selectedSkillPackIds updates (derived)
6. Button disappears (skill selected)
7. Skill available for use

REFERENCE DATA
================================================================================

CODE LOCATIONS

State Declaration          Lines 229-231
Derived State             Lines 4211-4216
Slash Trigger Handler     Lines 4907-4975
Keyboard Navigation       Lines 4919-4970
Button Trigger            Line 5626
Toolbar Button            Lines 5622-5635
Popover Container         Lines 6074-6156
Header Section            Lines 6092-6099
Item Mapping              Lines 6106-6152
Item Click Handler        Lines 6113-6131
Mouse Event Handlers      Lines 6083-6090

TOTAL DOCUMENT SIZE
================================================================================
SKILL_SELECTOR_DOCUMENTATION.md   10 KB
ANALYSIS_SUMMARY.md                12 KB
skill_selector_analysis.md         9.2 KB
skill_selector_visual.txt          9.5 KB
skill_selector_quick_ref.txt       13 KB
README_SKILL_SELECTOR.txt          This file

TOTAL: ~53 KB of comprehensive documentation

HOW TO USE THESE DOCUMENTS
================================================================================

For Quick Overview (5 min):
1. Read this file (README_SKILL_SELECTOR.txt)
2. Check SKILL_SELECTOR_DOCUMENTATION.md quick table
3. Review key findings above

For Quick Understanding (15 min):
1. Read SKILL_SELECTOR_DOCUMENTATION.md sections:
   - At-a-Glance Summary
   - Key Code Locations
   - CSS Classes Used
2. Scan ANALYSIS_SUMMARY.md sections 1-5

For Complete Understanding (30 min):
1. Read ANALYSIS_SUMMARY.md (all sections)
2. Review skill_selector_visual.txt diagrams
3. Check skill_selector_quick_ref.txt for code snippets

For Implementation/Modification (10-20 min):
1. Find relevant section in skill_selector_quick_ref.txt
2. Copy code snippet
3. Check SKILL_SELECTOR_DOCUMENTATION.md testing checklist
4. Verify with ANALYSIS_SUMMARY.md for context

For Deep Technical Understanding (45+ min):
1. Read skill_selector_analysis.md (line-by-line)
2. Review ANALYSIS_SUMMARY.md (detailed sections)
3. Study skill_selector_visual.txt diagrams
4. Reference skill_selector_quick_ref.txt for code

COMMON QUESTIONS & ANSWERS
================================================================================

Q: Where is the skill selector rendered?
A: Lines 6074-6156, see ANALYSIS_SUMMARY.md Section 1

Q: What positioning approach is used?
A: Absolute + bottom-full, see ANALYSIS_SUMMARY.md Section 2

Q: How is it triggered?
A: Button (5626) or "/" key (4907), see ANALYSIS_SUMMARY.md Section 4

Q: What CSS classes control positioning?
A: absolute bottom-full left-0 mb-1 z-[190], see skill_selector_quick_ref.txt

Q: How is visibility controlled?
A: showSkillSelector state, see ANALYSIS_SUMMARY.md Section 3

Q: What color is active item?
A: emerald-500 (green), see ANALYSIS_SUMMARY.md Section 6

Q: Does it support dark mode?
A: Yes, fully, see ANALYSIS_SUMMARY.md Section 12

Q: What keyboard keys are supported?
A: Arrow Up/Down, Enter, Backspace, Space, see ANALYSIS_SUMMARY.md Section 5

Q: How is selection stored?
A: selectedComponents array, see ANALYSIS_SUMMARY.md Section 10

Q: What's the Z-index?
A: 190, below @ selector at 200, see ANALYSIS_SUMMARY.md Section 9

MORE QUESTIONS?
================================================================================

Check the QUICK ANSWERS section in SKILL_SELECTOR_DOCUMENTATION.md
It has 10 common questions with direct answers and file references

TESTING
================================================================================

Complete testing checklist available in:
SKILL_SELECTOR_DOCUMENTATION.md - "Testing Checklist" section
(19 items covering all functionality)

DOCUMENT RELATIONSHIPS
================================================================================

README_SKILL_SELECTOR.txt (this file)
   ↓
   ├─→ SKILL_SELECTOR_DOCUMENTATION.md (navigation guide)
   │     ├─→ ANALYSIS_SUMMARY.md (comprehensive reference)
   │     ├─→ skill_selector_analysis.md (technical details)
   │     ├─→ skill_selector_visual.txt (diagrams)
   │     └─→ skill_selector_quick_ref.txt (quick reference)
   │
   └─→ All documents are standalone and cross-referenced

MODIFICATION GUIDE
================================================================================

To make changes, find the relevant section in:

skill_selector_quick_ref.txt - "COMMON MODIFICATIONS" section

Includes changes for:
- Width (220px → custom)
- Height & scrolling (256px → custom)
- Positioning (bottom-full → alternative)
- Colors (white → custom)
- Z-index (190 → custom)

ANALYSIS METADATA
================================================================================

File Analyzed: /Users/lilithgames/aiproj/chaya/front/src/components/Workflow.tsx
Component: Skill Selector (Floating Popover UI)
Analysis Type: Comprehensive (all aspects covered)
Analysis Date: 2026-04-03
Lines Analyzed: 100+ locations, 200+ lines of actual code
Documentation: 5 documents, 53 KB total

STATUS: ANALYSIS COMPLETE AND DOCUMENTED

================================================================================
END OF README
For more information, see SKILL_SELECTOR_DOCUMENTATION.md
================================================================================
