# Learnings — UI Redesign

> Cumulative wisdom from task execution. Append only, never overwrite.

---

## Task 3: Animation Token System

### Key Insights
1. **CSS Variable Architecture**: Animation timing tokens follow the naming convention established in Task 1 (`--animation-*`, `--ease-*`)
2. **Reduced Motion**: Using media query with 0ms duration tokens ensures accessibility while maintaining smooth transitions in normal conditions
3. **Timing Values**: Fast (150ms), Normal (250ms), Slow (400ms) align with Linear.app's refined micro-interaction philosophy
4. **Easing Strategy**: Three easing functions cover most use cases:
   - `ease-default`: Smooth ease-out for standard animations (cubic-bezier(0.16, 1, 0.3, 1))
   - `ease-bounce`: Playful bounce for highlight interactions (cubic-bezier(0.68, -0.55, 0.265, 1.55))
   - `ease-spring`: Springy overshoot for scale animations (cubic-bezier(0.34, 1.56, 0.64, 1))

### Animation Classes Implemented
- **Interactive**: `animate-press` (scale 0.97 on active), `animate-hover-lift` (translateY -2px)
- **Niho-specific**: `animate-hover-glow` with 20px color-specific glow effect
- **Entry**: `animate-fade-in`, `animate-slide-up`, `animate-slide-down`
- **List**: `animate-list-item` with nth-child staggering (50ms intervals)
- **Page Transitions**: `animate-page-enter` (slide right), `animate-page-exit` (slide left)

### Accessibility Compliance
- All animations respect `prefers-reduced-motion: reduce`
- Duration tokens set to 0ms in reduced-motion mode
- Seamless fallback without breaking functionality

### No Conflicts with Existing Keyframes
- Avoided naming collisions with Radix UI keyframes (pageEnter, pageExit, animate-in, animate-out)
- Existing Tailwind animations (fadeIn, slideInRight, etc.) remain untouched
- New classes use unique naming: fadeInAnim, slideUpAnim, listItemAnim, etc.

### Design Philosophy
- Refined, subtle micro-interactions (no flashy effects)
- Consistent timing and easing across all animations
- Prepared for component integration in Task 18


### UI Component Refactoring (Task 4)
- **Radix Primitives**: When updating Radix primitives like `Switch` and `Checkbox`, it's important to maintain the `data-[state=checked]` and `data-[state=unchecked]` selectors but map them to the new CSS variable tokens (e.g., `data-[state=checked]:bg-primaryToken`).
- **Focus States**: Standardized focus states across inputs using `focus-visible:ring-2 focus-visible:ring-ringToken focus-visible:ring-offset-2` along with `ring-offset-background` to ensure accessibility and a clean modern look.
- **Micro-interactions**: Added `active:animate-press` to the `Button` component's base classes to leverage the new animation system for a subtle scale-down effect on press.
- **Clean Aesthetic**: Removed heavy borders and backgrounds in favor of subtle tokens (`border-borderToken`, `bg-inputToken`) to achieve the requested Modern/Clean aesthetic.

### Overlay Components (Dialog, Select, DropdownMenu, Toast)
- **Backgrounds**: Replaced `bg-card` with `bg-popover` for overlay components to correctly map to `var(--surface-dialog)`.
- **Frosted Overlay**: For Dialog overlays, `bg-black/50 backdrop-blur-sm` provides the correct frosted glass effect per `dialog-display.mdc`.
- **Borders**: `border-borderToken` correctly maps to `var(--border-primary)` for subtle borders.
- **Animations**: Radix `data-[state]` animation hooks (`animate-in`, `animate-out`, `fade-in-0`, `zoom-in-95`, etc.) work perfectly alongside CSS variable tokens.

## Task 6 Fix: SettingsPanel Theme Selector Update
- Removed 'dark' option from theme selector UI dropdown
- Simplified `currentTheme` derivation to only support 'light' | 'niho' types
- Updated `handleThemeChange` function signature to match new theme type constraint
- Preserved skin-to-theme migration logic for backward compatibility with `settings.skin === 'niho'`
- Build passes successfully with no TypeScript errors
- Dropdown now displays only two options: "浅色" (light) and "霓虹" (niho) as required

## Task 7: Navigation Restructure
- Desktop top bar: 6 items, glass-top-nav, tooltips bottom
- Mobile bottom tabs: 3 items, fixed bottom positioning, safe-area-inset
- Responsive breakpoint: isMobile state (767px)
- NavItem component reused, no modifications needed
- CSS: glass-bottom-nav uses CSS vars, Niho pure black bg

## Task 8: PageLayout + Glass Classes Cleanup
- PageLayout.tsx: Removed all dark: classes, replaced with CSS variable tokens
- Glass classes: Updated to use CSS vars for backgrounds/borders
- Niho overrides: [data-skin='niho'] .glass-* with pure black bg, neon green border
- Sub-components updated: Card, Section, ListItem, Badge, EmptyState, Alert
- Component API preserved: variant='persona' unchanged
