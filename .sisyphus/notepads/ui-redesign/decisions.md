# Decisions — UI Redesign

> Architectural choices made during implementation. Append only, never overwrite.

---
## Task 2: Tailwind Config Simplification

### Decision: CSS Variable Mapping Strategy

**Goal**: Replace hardcoded Tailwind color palettes with CSS variable references from Task 1.

**Mapping Applied**:
- `background`: `var(--bg-primary)` 
- `foreground`: `var(--text-primary)`
- `card`: `var(--surface-card)` with foreground `var(--text-primary)`
- `popover`: `var(--surface-dialog)` with foreground `var(--text-primary)`
- `primaryToken`: `var(--accent-primary)` with foreground `var(--text-inverse)`
- `secondaryToken`: `var(--surface-muted)` with foreground `var(--text-secondary)`
- `mutedToken`: `var(--surface-muted)` with foreground `var(--text-tertiary)`
- `accentToken`: `var(--accent-primary)` with foreground `var(--text-inverse)`
- `destructiveToken`: `var(--status-error)` with foreground `var(--text-inverse)`
- `borderToken`: `var(--border-primary)`
- `inputToken`: `var(--surface-input)`
- `ringToken`: `var(--border-focus)`
- Status colors (success/warning/error/info): Direct mapping to `--status-*` CSS variables

**Removals**:
- `darkMode: 'class'` configuration (entirely removed per requirements)
- Hardcoded color palettes: `gray`, `primary` (old), `success` (old), `warning` (old), `error` (old), `info` (old), `neon`, `cursor`

**Preserved**:
- All animation/keyframe definitions (required by Radix UI components)
- All plugin configurations
- Content paths unchanged
- `backgroundImage` gradients preserved
- `transitionTimingFunction` preserved
- `boxShadow` definitions preserved

### Rationale

1. **Single source of truth**: CSS variables defined in `:root` are now the canonical color definitions, accessed via Tailwind tokens
2. **Dark mode eliminated**: Removed `darkMode: 'class'` entirely as per requirements; dark theme (Niho) now handled via CSS variables in `[data-skin="niho"]` selector in index.css
3. **Simplified config**: Reduced 140+ hardcoded color lines to ~30 CSS variable references (31 total)
4. **Maintained compatibility**: All shadcn/ui token references work as-is since they now reference CSS variables instead of HSL functions

### Verification

✓ Build passes (exit code 0)
✓ darkMode configuration removed (0 matches)
✓ 31 CSS variable references present (requirement: ≥10)
✓ Animation/keyframe sections preserved (6 animations, 1 keyframes block)
✓ Plugin configurations preserved
✓ No hardcoded color values in colors section (all use `var(--*)`)

