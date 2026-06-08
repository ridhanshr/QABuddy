---
name: Precision Logic
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#434655'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#565e74'
  on-secondary: '#ffffff'
  secondary-container: '#dae2fd'
  on-secondary-container: '#5c647a'
  tertiary: '#46566c'
  on-tertiary: '#ffffff'
  tertiary-container: '#5e6e85'
  on-tertiary-container: '#e9f0ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#dae2fd'
  secondary-fixed-dim: '#bec6e0'
  on-secondary-fixed: '#131b2e'
  on-secondary-fixed-variant: '#3f465c'
  tertiary-fixed: '#d3e4fe'
  tertiary-fixed-dim: '#b7c8e1'
  on-tertiary-fixed: '#0b1c30'
  on-tertiary-fixed-variant: '#38485d'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  h1:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  h2:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  code:
    fontFamily: monospace
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 8px
  sidebar_width: 260px
  container_max_width: 1440px
  gutter: 24px
  margin_sm: 12px
  margin_md: 24px
  margin_lg: 48px
---

## Brand & Style

The brand personality is rooted in technical excellence and surgical precision. This design system communicates reliability and high-speed processing, positioning itself as an essential tool for high-stakes software environments. The aesthetic is "Corporate Modern" with a heavy emphasis on "Minimalism," prioritizing functional density over decorative elements.

The target audience consists of QA engineers and developers who require a low-latency, high-utility interface. The UI should evoke a sense of calm control, ensuring that even during complex automated testing cycles, the user feels supported by an intelligent, non-intrusive assistant.

## Colors

The color palette is architected to differentiate between structural navigation and actionable content. This design system utilizes **Deep Navy (#0F172A)** for the sidebar and global navigation elements to anchor the application and provide a clear frame for the content. 

**Vibrant Blue (#2563EB)** serves as the primary action color, signifying trust and intelligence. Semantic colors are refined for high accessibility: a **Subtle Green (#10B981)** for passed tests and a **Subtle Red (#EF4444)** for failures. Backgrounds utilize a cool neutral scale to reduce eye strain during long-form data analysis.

## Typography

This design system uses **Inter** exclusively to ensure maximum legibility across dense data sets and technical logs. The typographic hierarchy is strictly functional, using weight and subtle tracking adjustments to differentiate between UI labels and user-generated content.

Type scales are optimized for a 14px base body size, which is the standard for desktop productivity tools. For technical code snippets or log outputs within the QA interface, a monospaced font is used to maintain character alignment and readability.

## Layout & Spacing

The layout follows a "Native Desktop" model, featuring a fixed-width sidebar for primary navigation and a fluid main content area. This design system utilizes an 8px base grid to ensure consistent alignment and rhythm across all views.

The content area is organized into a spacious grid that adapts to the available viewport width while maintaining a maximum readable container width for documentation and reports. Spacing is generous around key data points to prevent cognitive overload, while being compact within utility toolbars to maximize screen real estate.

## Elevation & Depth

To maintain a tool-like aesthetic, this design system avoids heavy shadows and decorative gradients. Depth is conveyed primarily through **Tonal Layers**. The application surface is the lowest level, with cards and modals sitting on a slightly elevated white surface.

A **Low-contrast Outline** technique is used for all UI components. Borders are 1px thick with a subtle neutral tint. This provides clear definition between sections without the visual weight of traditional drop shadows. Backdrop blurs (Glassmorphism) are used sparingly—only for overlay elements like command palettes or dropdown menus—to maintain focus on the underlying data.

## Shapes

The shape language is "Soft" and professional. A consistent 4px (0.25rem) corner radius is applied to standard UI elements like buttons, input fields, and status chips. This minimal rounding provides a modern feel while retaining the rigid, structural integrity expected of a technical tool. Larger components, such as main content cards, may use up to 8px (0.5rem) to signify containment.

## Components

### Primary Actions & Buttons
Buttons are flat with high-contrast labels. The primary button uses the vibrant blue brand color, while secondary buttons use a ghost style with a subtle border. All buttons include a clear hover state that slightly darkens the background.

### Chat Interface
The AI assistant interface uses a distinct message bubble system. User messages are right-aligned with a subtle background, while AI responses are left-aligned and use a slightly different neutral tone to distinguish the source. Typography in the chat remains high-density for quick reading.

### Data Tables & Logs
Tables are designed for high data density with clear headers and row hovering. Status indicators within tables use small, colored dots (Green/Red) alongside text labels to ensure quick scanning of test results.

### Input Fields & Forms
Forms utilize a "floating label" or "top-aligned label" system to ensure clarity. Focus states are clearly indicated with a 2px blue ring to assist with keyboard navigation, emphasizing the "power user" nature of the application.

### Status Chips
Status chips are used to tag test runs and environment types. They utilize a light background tint of their respective semantic color (e.g., light red background with dark red text) to provide a clear but non-distracting visual cue.